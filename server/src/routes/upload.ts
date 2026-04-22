import { Router, Response } from "express";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { join } from "node:path";
import { mkdirSync, readdirSync, createReadStream, createWriteStream, rmSync, statSync, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { config } from "../lib/config.js";
import { deleteUploadSession, loadUploadSession, saveUploadSession, cleanupExpiredSessions } from "../lib/uploadSessionStore.js";

const router = Router();

const CHUNKS_DIR = join(config.uploadDir, "chunks");
mkdirSync(CHUNKS_DIR, { recursive: true });

// Clean up expired sessions on startup and every 30 minutes
cleanupExpiredSessions(CHUNKS_DIR);
setInterval(() => cleanupExpiredSessions(CHUNKS_DIR), 30 * 60 * 1000);

// Initialize chunked upload
router.post("/api/upload/init", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { fileName, fileSize, totalChunks } = req.body;

  const normalizedFileSize = Number(fileSize);
  const normalizedTotalChunks = Number(totalChunks);

  if (!fileName || !Number.isFinite(normalizedFileSize) || !Number.isInteger(normalizedTotalChunks)) {
    res.status(400).json({ detail: "缺少参数" });
    return;
  }
  if (normalizedFileSize <= 0 || normalizedTotalChunks <= 0) {
    res.status(400).json({ detail: "文件参数无效" });
    return;
  }

  const uploadId = randomUUID().slice(0, 16);
  const chunkSize = Math.ceil(normalizedFileSize / normalizedTotalChunks);

  saveUploadSession(uploadId, {
    fileName,
    fileSize: normalizedFileSize,
    totalChunks: normalizedTotalChunks,
    chunkSize,
    userId: req.user!.userId,
    createdAt: Date.now(),
  });

  mkdirSync(join(CHUNKS_DIR, uploadId), { recursive: true });

  res.json({
    uploadId,
    chunkSize,
  });
});

// Upload a chunk
router.put("/api/upload/chunk", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const uploadId = req.query.uploadId as string | undefined;
  const chunkIndex = req.query.chunkIndex as string | undefined;

  if (!uploadId || !chunkIndex) {
    res.status(400).json({ detail: "缺少参数" });
    return;
  }

  const ci = Number(chunkIndex);
  if (!Number.isInteger(ci) || ci < 0) {
    res.status(400).json({ detail: "分片索引无效" });
    return;
  }

  const session = loadUploadSession(uploadId);

  if (!session) {
    res.status(404).json({ detail: "上传会话不存在" });
    return;
  }

  if (session.userId !== req.user!.userId) {
    res.status(403).json({ detail: "无权操作" });
    return;
  }

  if (ci >= session.totalChunks) {
    res.status(400).json({ detail: "分片索引越界" });
    return;
  }

  const chunkPath = join(CHUNKS_DIR, uploadId, `${ci}`);

  // Stream chunk data directly to disk — avoid buffering entire body in memory
  const ws = createWriteStream(chunkPath);
  let receivedBytes = 0;
  req.on("data", (chunk: Buffer) => { receivedBytes += chunk.length; });
  await pipeline(req, ws);

  // Validate chunk size doesn't exceed expected (with 20% tolerance for last chunk)
  const expectedMax = Math.ceil(session.chunkSize * 1.2);
  if (receivedBytes > expectedMax && ci < session.totalChunks - 1) {
    rmSync(chunkPath, { force: true });
    res.status(400).json({ detail: `分片大小(${receivedBytes})超出预期(${expectedMax})` });
    return;
  }

  if (receivedBytes <= 0) {
    rmSync(chunkPath, { force: true });
    res.status(400).json({ detail: "分片内容为空" });
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
router.post("/api/upload/complete", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { uploadId } = req.body;

  if (!uploadId) {
    res.status(400).json({ detail: "缺少 uploadId" });
    return;
  }

  const session = loadUploadSession(uploadId);
  if (!session) {
    res.status(404).json({ detail: "上传会话不存在" });
    return;
  }

  if (session.userId !== req.user!.userId) {
    res.status(403).json({ detail: "无权操作" });
    return;
  }

  const chunksDir = join(CHUNKS_DIR, uploadId);
  const mergedPath = join(config.uploadDir, `${uploadId}_${session.fileName}`);

  if (!existsSync(chunksDir)) {
    res.status(404).json({ detail: "分片目录不存在" });
    return;
  }

  const chunkFiles = readdirSync(chunksDir)
    .map((name) => Number(name))
    .filter((value) => Number.isInteger(value))
    .sort((a, b) => a - b);

  if (chunkFiles.length !== session.totalChunks) {
    res.status(400).json({ detail: "分片数量不完整，请继续上传后重试" });
    return;
  }

  for (let expected = 0; expected < session.totalChunks; expected++) {
    if (chunkFiles[expected] !== expected) {
      res.status(400).json({ detail: "分片序号不连续，请重新上传缺失分片" });
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
    await once(ws, "finish");
  } catch (error) {
    ws.destroy();
    rmSync(mergedPath, { force: true });
    res.status(500).json({ detail: "合并上传文件失败" });
    return;
  }

  const mergedSize = statSync(mergedPath).size;
  if (mergedSize !== session.fileSize) {
    rmSync(mergedPath, { force: true });
    res.status(400).json({ detail: "合并后的文件大小异常，请重新上传" });
    return;
  }

  rmSync(chunksDir, { recursive: true, force: true });
  deleteUploadSession(uploadId);

  // Return merged file info (caller should use this to create model + start conversion)
  res.json({
    filePath: mergedPath,
    fileName: session.fileName,
    fileSize: session.fileSize,
    ext: session.fileName.split(".").pop()?.toLowerCase() || "step",
  });
});

export default router;
