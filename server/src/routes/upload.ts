import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  mkdirSync,
  readdirSync,
  createReadStream,
  createWriteStream,
  rmSync,
  statSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Router, Response } from 'express';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import {
  deleteUploadSession,
  loadUploadSession,
  saveUploadSession,
  cleanupExpiredSessions,
} from '../lib/uploadSessionStore.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = Router();

// Magic byte signatures for 3D model formats
const FILE_SIGNATURES: Record<string, Array<{ offset: number; bytes: number[] }>> = {
  step: [{ offset: 0, bytes: [0x49, 0x53, 0x4f] }], // ISO-10303
  stp: [{ offset: 0, bytes: [0x49, 0x53, 0x4f] }],
  iges: [{ offset: 0, bytes: [] }], // text-based, no reliable magic
  igs: [{ offset: 0, bytes: [] }],
  stl: [
    { offset: 0, bytes: [0x73, 0x6f, 0x6c, 0x69, 0x64] }, // "solid" (ASCII) or binary
    { offset: 0, bytes: [] },
  ], // binary STL has no fixed magic
  obj: [{ offset: 0, bytes: [] }], // text-based
  f3d: [{ offset: 0, bytes: [] }], // proprietary, no check
  '3mf': [{ offset: 0, bytes: [0x3c, 0x3f, 0x78, 0x6d] }], // <?xml
  glb: [{ offset: 0, bytes: [0x67, 0x6c, 0x54, 0x46] }], // glTF
  gltf: [{ offset: 0, bytes: [0x7b] }], // { (JSON)
  zip: [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }], // PK
  'tar.gz': [{ offset: 0, bytes: [0x1f, 0x8b] }], // gzip
  tgz: [{ offset: 0, bytes: [0x1f, 0x8b] }],
};

function readFileMagic(filePath: string, bytesToRead: number): Buffer {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytesToRead);
    const n = readSync(fd, buf, 0, bytesToRead, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

function validateFileMagic(filePath: string, ext: string): boolean {
  const signatures = FILE_SIGNATURES[ext];
  if (!signatures) return true; // Unknown extension — skip validation
  if (signatures.length === 1 && signatures[0].bytes.length === 0) return true; // Text formats — no magic check

  const maxLen = Math.max(...signatures.map((s) => s.offset + s.bytes.length));
  const header = readFileMagic(filePath, maxLen);
  if (header.length < maxLen) return true; // File too small to validate

  const match = signatures.some((sig) => {
    if (sig.bytes.length === 0) return true;
    const slice = header.subarray(sig.offset, sig.offset + sig.bytes.length);
    return sig.bytes.every((b, i) => slice[i] === b);
  });

  return match;
}

const CHUNKS_DIR = join(config.uploadDir, 'chunks');
const UPLOAD_ROOT = resolve(process.cwd(), config.uploadDir);
const MAX_UPLOAD_CHUNKS = 20_000;
const MAX_BACKUP_UPLOAD_BYTES = 100 * 1024 * 1024 * 1024;
const COMPLETED_BACKUP_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
mkdirSync(CHUNKS_DIR, { recursive: true });

function normalizeUploadFileName(fileName: unknown): string | null {
  if (typeof fileName !== 'string') return null;
  const trimmed = fileName.trim();
  if (!trimmed || trimmed.length > 255) return null;
  if (/[/\\\0]/.test(trimmed) || trimmed === '.' || trimmed === '..') return null;
  return trimmed;
}

function resolveUploadPath(fileName: string): string | null {
  const resolved = resolve(UPLOAD_ROOT, fileName);
  if (resolved !== UPLOAD_ROOT && resolved.startsWith(`${UPLOAD_ROOT}${sep}`)) return resolved;
  return null;
}

function isBackupArchiveName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.tar.gz') || lower.endsWith('.tgz');
}

function isCompletedBackupUploadName(fileName: string): boolean {
  return /^[0-9a-f-]{16}_.+\.(?:tar\.gz|tgz)$/i.test(fileName);
}

function cleanupCompletedBackupUploads() {
  const now = Date.now();
  try {
    if (!existsSync(UPLOAD_ROOT)) return;
    for (const entry of readdirSync(UPLOAD_ROOT, { withFileTypes: true })) {
      if (!entry.isFile() || !isCompletedBackupUploadName(entry.name)) continue;
      const fullPath = join(UPLOAD_ROOT, entry.name);
      const ageMs = now - statSync(fullPath).mtime.getTime();
      if (ageMs <= COMPLETED_BACKUP_UPLOAD_TTL_MS) continue;
      rmSync(fullPath, { force: true });
      logger.info({ file: entry.name }, 'Cleaned unclaimed backup upload');
    }
  } catch (err: any) {
    logger.warn({ err }, 'Failed to clean completed backup uploads');
  }
}

// Clean up expired sessions on startup and every 30 minutes
cleanupExpiredSessions(CHUNKS_DIR);
cleanupCompletedBackupUploads();
setInterval(
  () => {
    cleanupExpiredSessions(CHUNKS_DIR);
    cleanupCompletedBackupUploads();
  },
  30 * 60 * 1000,
).unref();

// Initialize chunked upload
router.post('/api/upload/init', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  const { fileName, fileSize, totalChunks, purpose } = req.body;

  const normalizedFileSize = Number(fileSize);
  const normalizedTotalChunks = Number(totalChunks);

  const safeFileName = normalizeUploadFileName(fileName);
  if (!safeFileName || !Number.isFinite(normalizedFileSize) || !Number.isInteger(normalizedTotalChunks)) {
    res.status(400).json({ detail: '缺少参数' });
    return;
  }
  if (normalizedFileSize <= 0 || normalizedTotalChunks <= 0 || normalizedTotalChunks > MAX_UPLOAD_CHUNKS) {
    res.status(400).json({ detail: '文件参数无效' });
    return;
  }
  if (purpose === 'backup') {
    if (!isBackupArchiveName(safeFileName)) {
      res.status(400).json({ detail: '备份文件只支持 .tar.gz / .tgz 格式' });
      return;
    }
    if (normalizedFileSize > MAX_BACKUP_UPLOAD_BYTES) {
      res.status(400).json({ detail: '备份文件过大，最大支持 100GB' });
      return;
    }
    const uploadId = randomUUID().slice(0, 16);
    const chunkSize = Math.ceil(normalizedFileSize / normalizedTotalChunks);

    saveUploadSession(uploadId, {
      fileName: safeFileName,
      fileSize: normalizedFileSize,
      totalChunks: normalizedTotalChunks,
      chunkSize,
      userId: req.user!.userId,
      createdAt: Date.now(),
      purpose: 'backup',
    });

    mkdirSync(join(CHUNKS_DIR, uploadId), { recursive: true });

    res.json({
      uploadId,
      chunkSize,
    });
    return;
  }
  const { uploadPolicy } = await getBusinessConfig();
  const maxBytes = Math.max(1, uploadPolicy.modelMaxSizeMb) * 1024 * 1024;
  const ext = safeFileName.split('.').pop()?.toLowerCase() || '';
  if (normalizedFileSize > maxBytes) {
    res.status(400).json({ detail: `文件过大，最大支持 ${uploadPolicy.modelMaxSizeMb}MB` });
    return;
  }
  if (!uploadPolicy.modelFormats.map((item) => item.toLowerCase()).includes(ext)) {
    res
      .status(400)
      .json({ detail: `不支持的格式，请上传 ${uploadPolicy.modelFormats.map((item) => `.${item}`).join(' / ')} 文件` });
    return;
  }

  const uploadId = randomUUID().slice(0, 16);
  const chunkSize = Math.ceil(normalizedFileSize / normalizedTotalChunks);

  saveUploadSession(uploadId, {
    fileName: safeFileName,
    fileSize: normalizedFileSize,
    totalChunks: normalizedTotalChunks,
    chunkSize,
    userId: req.user!.userId,
    createdAt: Date.now(),
    purpose: 'model',
  });

  mkdirSync(join(CHUNKS_DIR, uploadId), { recursive: true });

  res.json({
    uploadId,
    chunkSize,
  });
});

// Upload a chunk
router.put('/api/upload/chunk', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  const uploadId = req.query.uploadId as string | undefined;
  const chunkIndex = req.query.chunkIndex as string | undefined;

  if (!uploadId || !chunkIndex) {
    res.status(400).json({ detail: '缺少参数' });
    return;
  }

  const ci = Number(chunkIndex);
  if (!Number.isInteger(ci) || ci < 0) {
    res.status(400).json({ detail: '分片索引无效' });
    return;
  }

  const session = loadUploadSession(uploadId);

  if (!session) {
    res.status(404).json({ detail: '上传会话不存在' });
    return;
  }

  if (session.userId !== req.user!.userId) {
    res.status(403).json({ detail: '无权操作' });
    return;
  }
  saveUploadSession(uploadId, { ...session, createdAt: Date.now() });

  if (ci >= session.totalChunks) {
    res.status(400).json({ detail: '分片索引越界' });
    return;
  }

  const chunkPath = join(CHUNKS_DIR, uploadId, `${ci}`);

  // Stream chunk data directly to disk — avoid buffering entire body in memory
  const ws = createWriteStream(chunkPath);
  let receivedBytes = 0;
  req.on('data', (chunk: Buffer) => {
    receivedBytes += chunk.length;
  });
  await pipeline(req, ws);

  // Validate chunk size doesn't exceed expected (with 20% tolerance for last chunk)
  const expectedMax = Math.ceil(session.chunkSize * 1.2);
  const maxOverallBytes = session.fileSize * 1.1;
  if (receivedBytes > expectedMax || (ci === session.totalChunks - 1 && receivedBytes > session.fileSize)) {
    rmSync(chunkPath, { force: true });
    res.status(400).json({ detail: `分片大小(${receivedBytes})超出预期` });
    return;
  }
  if (receivedBytes > maxOverallBytes) {
    rmSync(chunkPath, { force: true });
    res.status(400).json({ detail: `上传数据超出文件总大小` });
    return;
  }

  if (receivedBytes <= 0) {
    rmSync(chunkPath, { force: true });
    res.status(400).json({ detail: '分片内容为空' });
    return;
  }

  // Check progress
  const uploadedChunks = readdirSync(join(CHUNKS_DIR, uploadId)).length;

  res.json({
    uploadedChunks,
    totalChunks: session.totalChunks,
    complete: uploadedChunks >= session.totalChunks,
  });
});

// Complete chunked upload and start conversion
router.post('/api/upload/complete', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  const { uploadId } = req.body;

  if (!uploadId) {
    res.status(400).json({ detail: '缺少 uploadId' });
    return;
  }

  const session = loadUploadSession(uploadId);
  if (!session) {
    res.status(404).json({ detail: '上传会话不存在' });
    return;
  }

  if (session.userId !== req.user!.userId) {
    res.status(403).json({ detail: '无权操作' });
    return;
  }

  const chunksDir = join(CHUNKS_DIR, uploadId);
  const mergedPath = resolveUploadPath(`${uploadId}_${session.fileName}`);
  if (!mergedPath) {
    res.status(400).json({ detail: '文件名无效' });
    return;
  }

  if (!existsSync(chunksDir)) {
    res.status(404).json({ detail: '分片目录不存在' });
    return;
  }

  const chunkFiles = readdirSync(chunksDir)
    .map((name) => Number(name))
    .filter((value) => Number.isInteger(value))
    .sort((a, b) => a - b);

  if (chunkFiles.length !== session.totalChunks) {
    res.status(400).json({ detail: '分片数量不完整，请继续上传后重试' });
    return;
  }

  for (let expected = 0; expected < session.totalChunks; expected++) {
    if (chunkFiles[expected] !== expected) {
      res.status(400).json({ detail: '分片序号不连续，请重新上传缺失分片' });
      return;
    }
  }

  const ws = createWriteStream(mergedPath);
  try {
    for (const currentChunk of chunkFiles) {
      const chunkPath = join(chunksDir, String(currentChunk));
      const rs = createReadStream(chunkPath);
      await pipeline(rs, ws, { end: false });
    }
    ws.end();
    await once(ws, 'finish');
  } catch {
    ws.destroy();
    rmSync(mergedPath, { force: true });
    res.status(500).json({ detail: '合并上传文件失败' });
    return;
  }

  const mergedSize = statSync(mergedPath).size;
  if (mergedSize !== session.fileSize) {
    rmSync(mergedPath, { force: true });
    res.status(400).json({ detail: '合并后的文件大小异常，请重新上传' });
    return;
  }

  // Magic byte validation — verify file content matches declared extension
  const ext = session.fileName.split('.').pop()?.toLowerCase() || '';
  if (!validateFileMagic(mergedPath, ext)) {
    logger.warn(
      { fileName: session.fileName, ext, uploadId, userId: session.userId },
      "Upload rejected: file magic bytes don't match extension",
    );
    rmSync(mergedPath, { force: true });
    res.status(400).json({ detail: '文件内容与扩展名不匹配，请上传正确的文件' });
    return;
  }

  rmSync(chunksDir, { recursive: true, force: true });
  deleteUploadSession(uploadId);

  // Return merged file info (caller should use this to create model + start conversion)
  res.json({
    filePath: mergedPath,
    fileName: session.fileName,
    fileSize: session.fileSize,
    ext: session.fileName.split('.').pop()?.toLowerCase() || 'step',
  });
});

export default router;
