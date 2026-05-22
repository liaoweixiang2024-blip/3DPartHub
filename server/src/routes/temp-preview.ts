import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type NextFunction, type Response } from 'express';
import multer from 'multer';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { redis } from '../lib/cache.js';
import { config } from '../lib/config.js';
import { normalizeUploadFilename } from '../lib/filenameEncoding.js';
import { logger } from '../lib/logger.js';
import { conversionQueueConfig } from '../lib/queue.js';
import { UPLOAD_REQUEST_TIMEOUT_MS } from '../lib/uploadLimits.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { tempPreviewUploadLimiter } from '../middleware/security.js';
import type { GltfAsset } from '../services/converter.js';

type TempPreviewResult = {
  id: string;
  name: string;
  original_name: string;
  format: string;
  original_size: number;
  gltf_url: string;
  gltf_size: number;
  expires_at: string;
  preview_meta: GltfAsset['previewMeta'];
};

type TempConversionPayload = {
  modelId: string;
  filePath: string;
  originalName: string;
  ext: string;
  modelDir: string;
  gltfUrlBase: string;
  skipThumbnail: true;
};

const router = Router();
const TEMP_PREVIEW_FORMATS = new Set(['step', 'stp']);
const TEMP_PREVIEW_MAX_SIZE_MB = 50;
const TEMP_PREVIEW_MAX_BYTES = TEMP_PREVIEW_MAX_SIZE_MB * 1024 * 1024;
const TEMP_PREVIEW_MAX_ACTIVE_PER_OWNER = clampNumberEnv('TEMP_PREVIEW_MAX_ACTIVE_PER_OWNER', 5, 1, 20);
const TEMP_PREVIEW_TOTAL_ACTIVE_LIMIT = clampNumberEnv('TEMP_PREVIEW_TOTAL_ACTIVE_LIMIT', 500, 10, 10_000);
const TEMP_PREVIEW_MAX_CONCURRENT_PER_OWNER = clampNumberEnv('TEMP_PREVIEW_MAX_CONCURRENT_PER_OWNER', 1, 1, 4);
const TEMP_PREVIEW_TTL_MS = clampNumberEnv(
  'TEMP_PREVIEW_TTL_MS',
  6 * 60 * 60 * 1000,
  10 * 60 * 1000,
  24 * 60 * 60 * 1000,
);
const TEMP_PREVIEW_CLEANUP_INTERVAL_MS = clampNumberEnv(
  'TEMP_PREVIEW_CLEANUP_INTERVAL_MS',
  15 * 60 * 1000,
  60 * 1000,
  6 * 60 * 60 * 1000,
);
const tempUploadRoot = resolve(process.cwd(), config.uploadDir, 'temp-previews');
const tempStaticRoot = resolve(process.cwd(), config.staticDir, 'temp-previews');
const conversionRunnerPath = fileURLToPath(new URL('../workers/conversionRunner.js', import.meta.url));
const tempPreviewGuardTtlSeconds = Math.ceil(
  (TEMP_PREVIEW_TTL_MS + TEMP_PREVIEW_CLEANUP_INTERVAL_MS + 60 * 60 * 1000) / 1000,
);

let lastCleanupAt = 0;

function clampNumberEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function pathInside(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${sep}`);
}

function assertSafeTempId(id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) {
    throw new Error('invalid temp preview id');
  }
}

function ensureTempPreviewRoots() {
  mkdirSync(tempUploadRoot, { recursive: true });
  mkdirSync(tempStaticRoot, { recursive: true });
}

function safeTempPath(root: string, id: string) {
  assertSafeTempId(id);
  const target = resolve(root, id);
  if (!pathInside(root, target)) throw new Error('invalid temp preview path');
  return target;
}

function tempPreviewOwnerKey(req: AuthRequest) {
  const raw = req.user?.userId ? `user:${req.user.userId}` : `ip:${req.ip || 'unknown'}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

function ownerRecordsKey(ownerKey: string) {
  return `temp-preview:records:${ownerKey}`;
}

function ownerConvertingKey(ownerKey: string) {
  return `temp-preview:converting:${ownerKey}`;
}

function ownerBySessionKey(sessionId: string) {
  assertSafeTempId(sessionId);
  return `temp-preview:owner:${sessionId}`;
}

const globalRecordsKey = 'temp-preview:records:global';

type TempPreviewReserveResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      detail: string;
    };

function reserveFailure(reason: string): TempPreviewReserveResult {
  if (reason === 'active') {
    return {
      ok: false,
      status: 429,
      detail: `最多只能临时上传 ${TEMP_PREVIEW_MAX_ACTIVE_PER_OWNER} 个模型，请清理上传记录后再上传。`,
    };
  }
  if (reason === 'concurrent') {
    return {
      ok: false,
      status: 429,
      detail: '已有临时模型正在转换，请等待完成后再上传。',
    };
  }
  if (reason === 'system') {
    return {
      ok: false,
      status: 503,
      detail: '临时看图服务当前繁忙，请稍后再试。',
    };
  }
  return {
    ok: false,
    status: 503,
    detail: '临时看图安全校验暂不可用，请稍后重试。',
  };
}

async function reserveTempPreviewSlot(ownerKey: string, sessionId: string): Promise<TempPreviewReserveResult> {
  const now = Date.now();
  const expiresAt = now + TEMP_PREVIEW_TTL_MS;

  try {
    const result = await redis.eval(
      `
      redis.call("ZREMRANGEBYSCORE", KEYS[1], 0, ARGV[1])
      redis.call("ZREMRANGEBYSCORE", KEYS[2], 0, ARGV[1])

      local ownerActive = redis.call("ZCARD", KEYS[1])
      if ownerActive >= tonumber(ARGV[3]) then
        return "active"
      end

      local globalActive = redis.call("ZCARD", KEYS[2])
      if globalActive >= tonumber(ARGV[4]) then
        return "system"
      end

      local converting = tonumber(redis.call("GET", KEYS[3]) or "0")
      if converting >= tonumber(ARGV[5]) then
        return "concurrent"
      end

      redis.call("ZADD", KEYS[1], ARGV[2], ARGV[7])
      redis.call("ZADD", KEYS[2], ARGV[2], ARGV[7])
      redis.call("EXPIRE", KEYS[1], ARGV[6])
      redis.call("EXPIRE", KEYS[2], ARGV[6])
      redis.call("SET", KEYS[4], ARGV[8], "EX", ARGV[6])
      redis.call("INCR", KEYS[3])
      redis.call("PEXPIRE", KEYS[3], ARGV[9])
      return "ok"
      `,
      4,
      ownerRecordsKey(ownerKey),
      globalRecordsKey,
      ownerConvertingKey(ownerKey),
      ownerBySessionKey(sessionId),
      String(now),
      String(expiresAt),
      String(TEMP_PREVIEW_MAX_ACTIVE_PER_OWNER),
      String(TEMP_PREVIEW_TOTAL_ACTIVE_LIMIT),
      String(TEMP_PREVIEW_MAX_CONCURRENT_PER_OWNER),
      String(tempPreviewGuardTtlSeconds),
      sessionId,
      ownerKey,
      String(conversionQueueConfig.jobTimeoutMs + 30_000),
    );

    if (result === 'ok') return { ok: true };
    return reserveFailure(String(result || 'unknown'));
  } catch (err) {
    logger.error({ err }, 'Temp preview guard failed');
    return reserveFailure('guard');
  }
}

async function releaseTempPreviewConversion(ownerKey: string) {
  try {
    await redis.eval(
      `
      local value = tonumber(redis.call("GET", KEYS[1]) or "0")
      if value <= 1 then
        return redis.call("DEL", KEYS[1])
      end
      return redis.call("DECR", KEYS[1])
      `,
      1,
      ownerConvertingKey(ownerKey),
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to release temp preview conversion guard');
  }
}

async function removeTempPreviewSlot(ownerKey: string, sessionId: string): Promise<'ok' | 'forbidden'> {
  try {
    const result = await redis.eval(
      `
      local owner = redis.call("GET", KEYS[3])
      if owner and owner ~= ARGV[1] then
        return "forbidden"
      end
      redis.call("ZREM", KEYS[1], ARGV[2])
      redis.call("ZREM", KEYS[2], ARGV[2])
      redis.call("DEL", KEYS[3])
      return "ok"
      `,
      3,
      ownerRecordsKey(ownerKey),
      globalRecordsKey,
      ownerBySessionKey(sessionId),
      ownerKey,
      sessionId,
    );
    return result === 'forbidden' ? 'forbidden' : 'ok';
  } catch (err) {
    logger.warn({ err }, 'Failed to remove temp preview guard record');
    return 'ok';
  }
}

async function cleanupRoot(root: string, cutoff: number) {
  if (!existsSync(root)) return;
  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory() || entry.name.startsWith('.')) return;
      const target = resolve(root, entry.name);
      if (!pathInside(root, target)) return;
      try {
        const info = await stat(target);
        if (info.mtimeMs < cutoff) rmSync(target, { recursive: true, force: true });
      } catch {
        rmSync(target, { recursive: true, force: true });
      }
    }),
  );
}

async function cleanupExpiredTempPreviews(force = false) {
  const now = Date.now();
  if (!force && now - lastCleanupAt < TEMP_PREVIEW_CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  const cutoff = now - TEMP_PREVIEW_TTL_MS;
  await Promise.all([cleanupRoot(tempUploadRoot, cutoff), cleanupRoot(tempStaticRoot, cutoff)]);
}

function runTempConversion(payload: TempConversionPayload): Promise<GltfAsset> {
  const timeoutMs = conversionQueueConfig.jobTimeoutMs;

  return new Promise((resolvePromise, reject) => {
    const child = fork(conversionRunnerPath, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      execArgv: process.execArgv,
    });
    let settled = false;
    let timeoutError: Error | null = null;
    let timeoutTimer: NodeJS.Timeout;
    let forceKillTimer: NodeJS.Timeout | null = null;

    const finish = (err: Error | null, result?: GltfAsset) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      child.removeAllListeners();
      if (err) {
        reject(err);
        return;
      }
      resolvePromise(result!);
    };

    timeoutTimer = setTimeout(() => {
      timeoutError = new Error('临时预览转换超时，请稍后换一个更小的模型重试');
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      logger.info(`[temp-preview:${payload.modelId}] ${String(chunk).trimEnd()}`);
    });
    child.stderr?.on('data', (chunk) => {
      logger.error(`[temp-preview:${payload.modelId}] ${String(chunk).trimEnd()}`);
    });
    child.on('message', (message: unknown) => {
      const msg = message as Record<string, unknown>;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'log' && msg.message) {
        logger.info(`[temp-preview:${payload.modelId}] ${String(msg.message)}`);
      } else if (msg.type === 'result') {
        finish(null, msg.result as GltfAsset);
      } else if (msg.type === 'error') {
        const err = new Error(String(msg.message || '临时预览转换失败'));
        if (msg.stack) err.stack = String(msg.stack);
        finish(err);
      }
    });
    child.on('error', (err) => finish(err));
    child.on('exit', (code, signal) => {
      if (settled) return;
      if (timeoutError) {
        finish(timeoutError);
        return;
      }
      finish(new Error(`临时预览转换子进程异常退出: ${signal || code || 'unknown'}`));
    });

    child.send({ payload });
  });
}

async function validateTempPreviewUpload(file: Express.Multer.File, res: Response): Promise<string | null> {
  const originalName = normalizeUploadFilename(file.originalname, 'unknown.step');
  const ext = originalName.split('.').pop()?.toLowerCase() || '';
  const { uploadPolicy } = await getBusinessConfig();
  const configuredFormats = uploadPolicy.modelFormats.map((item) => item.toLowerCase());
  const allowedFormats = configuredFormats.filter((item) => TEMP_PREVIEW_FORMATS.has(item));
  const allowed = allowedFormats.length ? allowedFormats : Array.from(TEMP_PREVIEW_FORMATS);

  if (!ext || !allowed.includes(ext)) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: `临时看图仅支持 ${allowed.map((item) => `.${item}`).join(' / ')} 文件` });
    return null;
  }
  if (file.size <= 0) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: '文件内容为空，请重新选择有效的模型文件' });
    return null;
  }
  if (file.size > TEMP_PREVIEW_MAX_BYTES) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: `临时看图单个文件最大 ${TEMP_PREVIEW_MAX_SIZE_MB}MB` });
    return null;
  }
  if (!(await looksLikeStepFile(file.path))) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: '文件内容不是有效的 STEP/STP 模型，请重新选择文件' });
    return null;
  }
  return ext;
}

async function looksLikeStepFile(filePath: string) {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, 'r');
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead).toString('latin1').toUpperCase();
    return header.includes('ISO-10303-21') || header.includes('HEADER;');
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function tempPreviewUpload(fieldName: string) {
  const upload = multer({
    dest: config.uploadDir,
    limits: { fileSize: TEMP_PREVIEW_MAX_BYTES },
  }).single(fieldName);

  return (req: AuthRequest, res: Response, next: NextFunction) => {
    upload(req, res, (err) => {
      if (!err) {
        next();
        return;
      }

      const uploadError = err as { code?: string; message?: string };
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ detail: `临时看图单个文件最大 ${TEMP_PREVIEW_MAX_SIZE_MB}MB` });
        return;
      }
      res.status(400).json({ detail: uploadError.message || '上传失败' });
    });
  };
}

router.post(
  '/api/temp-preview/upload',
  authMiddleware,
  tempPreviewUploadLimiter,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    req.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS);
    res.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS);
    next();
  },
  tempPreviewUpload('file'),
  async (req: AuthRequest, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ detail: '没有文件' });
      return;
    }

    ensureTempPreviewRoots();
    void cleanupExpiredTempPreviews().catch((err) => logger.warn({ err }, 'Failed to clean temp previews'));

    const originalName = normalizeUploadFilename(file.originalname, 'unknown.step');
    const ext = await validateTempPreviewUpload(file, res);
    if (!ext) return;

    const sessionId = randomUUID();
    const modelId = sessionId.replace(/-/g, '');
    const ownerKey = tempPreviewOwnerKey(req);
    const reserved = await reserveTempPreviewSlot(ownerKey, sessionId);
    if (!reserved.ok) {
      rmSync(file.path, { force: true });
      res.status(reserved.status).json({ detail: reserved.detail });
      return;
    }

    const uploadDir = safeTempPath(tempUploadRoot, sessionId);
    const outputDir = safeTempPath(tempStaticRoot, sessionId);
    const sourcePath = resolve(uploadDir, `source.${ext}`);

    try {
      mkdirSync(uploadDir, { recursive: true });
      mkdirSync(outputDir, { recursive: true });
      renameSync(file.path, sourcePath);

      const result = await runTempConversion({
        modelId,
        filePath: sourcePath,
        originalName,
        ext,
        modelDir: outputDir,
        gltfUrlBase: `/static/temp-previews/${sessionId}`,
        skipThumbnail: true,
      });

      rmSync(uploadDir, { recursive: true, force: true });

      const data: TempPreviewResult = {
        id: sessionId,
        name: basename(originalName, extname(originalName)) || originalName,
        original_name: originalName,
        format: ext.toUpperCase(),
        original_size: file.size,
        gltf_url: result.gltfUrl,
        gltf_size: result.gltfSize,
        expires_at: new Date(Date.now() + TEMP_PREVIEW_TTL_MS).toISOString(),
        preview_meta: result.previewMeta,
      };

      res.json({ success: true, data });
    } catch (err) {
      logger.error({ err, originalName }, 'Temp preview conversion failed');
      rmSync(file.path, { force: true });
      rmSync(uploadDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
      await removeTempPreviewSlot(ownerKey, sessionId);
      res.status(400).json({ detail: err instanceof Error ? err.message : '临时预览转换失败' });
    } finally {
      await releaseTempPreviewConversion(ownerKey);
    }
  },
);

router.delete('/api/temp-preview/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const ownerKey = tempPreviewOwnerKey(req);
    const guardResult = await removeTempPreviewSlot(ownerKey, id);
    if (guardResult === 'forbidden') {
      res.status(404).json({ detail: '临时预览记录不存在或已失效' });
      return;
    }
    const uploadDir = safeTempPath(tempUploadRoot, id);
    const outputDir = safeTempPath(tempStaticRoot, id);
    rmSync(uploadDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch {
    res.status(400).json({ detail: '无效的临时预览记录' });
  }
});

ensureTempPreviewRoots();
void cleanupExpiredTempPreviews(true).catch((err) => logger.warn({ err }, 'Failed to clean temp previews on startup'));
const tempPreviewCleanupTimer = setInterval(() => {
  cleanupExpiredTempPreviews(true).catch((err) => logger.warn({ err }, 'Failed to clean temp previews'));
}, TEMP_PREVIEW_CLEANUP_INTERVAL_MS);
tempPreviewCleanupTimer.unref?.();

export default router;
