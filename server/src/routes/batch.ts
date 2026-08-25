import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import archiver from 'archiver';
import { Router, Response, type NextFunction } from 'express';
import multer from 'multer';
import { sendAcceleratedFile } from '../lib/acceleratedDownload.js';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { cacheDelByPrefix } from '../lib/cache.js';
import { config } from '../lib/config.js';
import { consumeProtectedResourceToken, createProtectedResourceToken } from '../lib/downloadTokenStore.js';
import { syncJob, loadJob } from '../lib/jobStore.js';
import { createLogger } from '../lib/logger.js';
import { optionalString } from '../lib/requestValidation.js';
import { batchArchiveMaxSizeMb, UPLOAD_REQUEST_TIMEOUT_MS } from '../lib/uploadLimits.js';
import { authMiddleware, getVerifiedRequestUser, type AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  BatchArchiveUploadError,
  type BatchArchiveUploadOutput,
  type BatchArchiveUploadProgress,
  isSupportedBatchArchive,
  processBatchArchiveUpload,
} from '../services/batchArchiveUpload.js';
import { resolveDbModelDownloadTarget } from '../services/modelDownloadTarget.js';
import { normalizeModelFormat } from '../services/modelFiles.js';
import { MODEL_STATUS } from '../services/modelStatus.js';
import { clearCategoryCache } from './categories/common.js';

const router = Router();
const log = createLogger({ component: 'batch-routes' });

// Startup cleanup: remove stale batch_*.zip files left from previous crashes/restarts
{
  const staticDir = join(process.cwd(), config.staticDir);
  try {
    const entries = readdirSync(staticDir);
    const stale = entries.filter((e) => /^batch_[0-9a-f]{8}\.zip$/i.test(e));
    if (stale.length > 0) {
      for (const f of stale) {
        try {
          rmSync(join(staticDir, f), { force: true });
        } catch {
          /* best-effort */
        }
      }
      log.info(`Cleaned up ${stale.length} stale batch download file(s)`);
    }
  } catch {
    /* static dir may not exist yet */
  }
}

type BatchArchiveUploadJob = {
  id: string;
  stage: 'queued' | 'processing' | 'done' | 'error';
  percent: number;
  message: string;
  processed?: number;
  total?: number;
  error?: string;
  result?: Pick<BatchArchiveUploadOutput, 'total' | 'results'>;
  createdAt: string;
  updatedAt: string;
};

const batchArchiveUploadJobs = new Map<string, BatchArchiveUploadJob>();

function updateBatchArchiveUploadJob(job: BatchArchiveUploadJob, patch: Partial<BatchArchiveUploadJob>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  batchArchiveUploadJobs.set(job.id, job);
  syncJob(job);
}

function getBatchArchiveUploadJob(id: string): BatchArchiveUploadJob | undefined {
  const persisted = loadJob<BatchArchiveUploadJob>(id);
  if (persisted) {
    batchArchiveUploadJobs.set(id, persisted);
    return persisted;
  }
  return batchArchiveUploadJobs.get(id);
}

const ALLOWED_ARCHIVE_MIMES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
  'application/vnd.rar',
  'application/x-rar-compressed',
]);

function batchArchiveUpload(req: AuthRequest, res: Response, next: NextFunction) {
  req.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS);
  res.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS);
  getBusinessConfig()
    .then(({ uploadPolicy }) => {
      const maxMb = batchArchiveMaxSizeMb(uploadPolicy);
      const upload = multer({
        dest: join(config.uploadDir, 'batch'),
        limits: { fileSize: maxMb * 1024 * 1024 },
        fileFilter(_req, file, cb) {
          if (
            ALLOWED_ARCHIVE_MIMES.has(file.mimetype) ||
            file.originalname.toLowerCase().endsWith('.zip') ||
            file.originalname.toLowerCase().endsWith('.rar')
          ) {
            cb(null, true);
          } else {
            cb(new Error(`不支持的批量上传格式: ${file.mimetype}`));
          }
        },
      }).single('file');

      upload(req, res, (err) => {
        if (!err) {
          next();
          return;
        }

        const uploadError = err as { code?: string; message?: string };
        if (uploadError.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ detail: `压缩包超过 ${maxMb}MB，请上传更小的 ZIP/RAR 文件` });
          return;
        }
        res.status(400).json({ detail: uploadError.message || '压缩包上传失败' });
      });
    })
    .catch(next);
}

// Batch download — create ZIP of selected models' original source files.
router.post('/api/batch/download', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  const { modelIds } = req.body;

  let zipPath: string | undefined;

  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    res.status(400).json({ detail: '请选择要下载的模型' });
    return;
  }

  const { pageSizePolicy } = await getBusinessConfig();
  const batchMax = Math.max(1, Math.floor(Number(pageSizePolicy.adminBatchDownloadMax) || 50));
  if (modelIds.length > batchMax) {
    res.status(400).json({ detail: `一次最多下载 ${batchMax} 个模型` });
    return;
  }

  try {
    // Dynamic import to avoid loading prisma if not needed
    const { prisma } = await import('../lib/prisma.js');
    if (!prisma) {
      res.status(503).json({ detail: '数据库未连接' });
      return;
    }

    const models = await prisma.model.findMany({
      where: { id: { in: modelIds }, status: MODEL_STATUS.COMPLETED },
    });

    if (models.length === 0) {
      res.status(404).json({ detail: '没有可下载的模型' });
      return;
    }

    const archivedModels = new Map<string, { format: string; fileSize: number }>();
    const downloadItems: Array<{ filePath: string; fileName: string }> = [];

    for (const model of models) {
      const target = resolveDbModelDownloadTarget(model, 'original');
      if (!target || !existsSync(target.filePath)) continue;

      const format =
        normalizeModelFormat(target.record?.format) ||
        normalizeModelFormat(model.originalName?.split('.').pop()) ||
        normalizeModelFormat(basename(target.filePath).split('.').pop()) ||
        'model';
      const fileSize = statSync(target.filePath).size;
      downloadItems.push({ filePath: target.filePath, fileName: target.fileName });
      archivedModels.set(model.id, { format, fileSize });
    }

    if (archivedModels.size === 0) {
      res.status(404).json({ detail: '没有可下载的原始模型文件' });
      return;
    }

    const zipName = `batch_${randomUUID().slice(0, 8)}.zip`;
    zipPath = join(config.staticDir, 'batch', zipName);
    mkdirSync(join(config.staticDir, 'batch'), { recursive: true });

    const archive = archiver('zip', { zlib: { level: 5 } });
    const output = createWriteStream(zipPath);

    archive.pipe(output);
    const outputClosed = once(output, 'close');

    for (const item of downloadItems) {
      archive.file(item.filePath, { name: item.fileName });
    }

    await archive.finalize();
    await outputClosed;

    // Record downloads only for models actually archived
    for (const model of models) {
      const archived = archivedModels.get(model.id);
      if (!archived) continue;
      try {
        await prisma.$transaction([
          prisma.download.create({
            data: {
              userId: req.user!.userId,
              modelId: model.id,
              format: archived.format,
              fileSize: archived.fileSize,
            },
          }),
          prisma.model.update({
            where: { id: model.id },
            data: { downloadCount: { increment: 1 } },
          }),
        ]);
      } catch (err) {
        log.warn({ err, modelId: model.id }, 'Failed to record batch download for model');
      }
    }

    const token = createProtectedResourceToken({
      type: 'batch-download',
      resourceId: zipName,
      userId: req.user!.userId,
      role: req.user!.role,
      singleUse: true,
    });

    res.json({
      url: `/api/batch/downloads/${zipName}?download_token=${encodeURIComponent(token.token)}`,
      count: archivedModels.size,
    });
  } catch (err) {
    try {
      if (typeof zipPath !== 'undefined') rmSync(zipPath, { force: true });
    } catch (cleanupErr) {
      log.warn({ cleanupErr, zipPath }, 'Failed to clean up batch zip after error');
    }
    log.warn({ err }, 'Batch download failed');
    res.status(500).json({ detail: '批量下载失败' });
  }
});

router.get('/api/batch/downloads/:file', async (req, res: Response) => {
  const fileName = basename(String(req.params.file || ''));
  if (!/^batch_[0-9a-f]{8}\.zip$/i.test(fileName)) {
    res.status(400).json({ detail: '文件参数无效' });
    return;
  }

  const queryToken = optionalString(req.query.download_token, { maxLength: 160 });
  const tokenPayload = queryToken ? consumeProtectedResourceToken(queryToken, 'batch-download', fileName) : null;
  if (queryToken && !tokenPayload) {
    res.status(401).json({ detail: '下载令牌无效或已过期' });
    return;
  }

  // JWT 分支必须查库解析：降级/禁用后的旧 token 仍带着 ADMIN 字样，不能凭快照放行
  const user = tokenPayload ?? (await getVerifiedRequestUser(req))?.payload ?? null;
  if (!user || user.role !== 'ADMIN') {
    res.status(401).json({ detail: '需要管理员权限' });
    return;
  }

  const filePath = join(process.cwd(), config.staticDir, 'batch', fileName);
  if (!existsSync(filePath)) {
    res.status(404).json({ detail: '文件不存在' });
    return;
  }

  sendAcceleratedFile(req, res, {
    filePath,
    fileName,
    contentType: 'application/zip',
    disposition: 'attachment',
  });

  let cleanupDone = false;
  const cleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    try {
      rmSync(filePath, { force: true });
    } catch (err) {
      log.warn({ err, filePath }, 'Failed to clean up batch download file');
    }
  };
  res.on('close', cleanup);
  setTimeout(cleanup, 600_000);
});

// Async batch upload from ZIP/RAR with polling progress.
router.post(
  '/api/batch/upload-async',
  authMiddleware,
  requireRole('ADMIN'),
  batchArchiveUpload,
  async (req: AuthRequest, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ detail: '没有文件' });
      return;
    }

    if (!isSupportedBatchArchive(file.originalname || '')) {
      rmSync(file.path, { force: true });
      res.status(400).json({ detail: '请上传 ZIP 或 RAR 压缩包' });
      return;
    }

    const job: BatchArchiveUploadJob = {
      id: `batch_upload_${Date.now()}_${randomUUID().slice(0, 8)}`,
      stage: 'queued',
      percent: 0,
      message: '已上传，等待服务器处理...',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    batchArchiveUploadJobs.set(job.id, job);
    syncJob(job);

    const filePath = file.path;
    const originalName = file.originalname;
    const userId = req.user!.userId;
    const categoryId = optionalString(req.body?.categoryId, { maxLength: 80 }) || null;

    res.json({ jobId: job.id });

    setImmediate(async () => {
      try {
        updateBatchArchiveUploadJob(job, { stage: 'processing', percent: 3, message: '正在读取压缩包...' });
        const uploadResult = await processBatchArchiveUpload({
          filePath,
          originalName,
          categoryId,
          userId,
          onProgress: (progress: BatchArchiveUploadProgress) => {
            updateBatchArchiveUploadJob(job, {
              stage: 'processing',
              percent: Math.min(98, progress.percent),
              message: progress.message,
              processed: progress.processed,
              total: progress.total,
            });
          },
        });

        if (uploadResult.hasQueuedModels) {
          await cacheDelByPrefix('cache:models:');
          await clearCategoryCache();
        } else if (uploadResult.categoryTreeChanged) {
          await clearCategoryCache();
        }

        updateBatchArchiveUploadJob(job, {
          stage: 'done',
          percent: 100,
          message: '批量上传完成',
          result: { total: uploadResult.total, results: uploadResult.results },
        });
      } catch (error) {
        const detail =
          error instanceof BatchArchiveUploadError
            ? error.message
            : error instanceof Error
              ? error.message || '批量上传处理失败'
              : '批量上传处理失败';
        log.error({ error, jobId: job.id }, 'Async batch upload failed');
        updateBatchArchiveUploadJob(job, {
          stage: 'error',
          percent: 100,
          message: detail,
          error: detail,
        });
      }
    });
  },
);

router.get('/api/batch/upload-progress/:jobId', authMiddleware, requireRole('ADMIN'), async (req, res: Response) => {
  const jobId = optionalString(req.params.jobId, { maxLength: 80 });
  if (!jobId || !jobId.startsWith('batch_upload_')) {
    res.status(400).json({ detail: '任务参数无效' });
    return;
  }

  const job = getBatchArchiveUploadJob(jobId);
  if (!job) {
    res.status(404).json({ detail: '批量上传任务不存在，服务器可能已重启' });
    return;
  }

  res.json(job);
});

// Batch upload from ZIP/RAR
router.post(
  '/api/batch/upload',
  authMiddleware,
  requireRole('ADMIN'),
  batchArchiveUpload,
  async (req: AuthRequest, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ detail: '没有文件' });
      return;
    }

    if (!isSupportedBatchArchive(file.originalname || '')) {
      rmSync(file.path, { force: true });
      res.status(400).json({ detail: '请上传 ZIP 或 RAR 压缩包' });
      return;
    }

    try {
      const categoryId = optionalString(req.body?.categoryId, { maxLength: 80 }) || null;
      const uploadResult = await processBatchArchiveUpload({
        filePath: file.path,
        originalName: file.originalname,
        categoryId,
        userId: req.user!.userId,
      });

      if (uploadResult.hasQueuedModels) {
        await cacheDelByPrefix('cache:models:');
        await clearCategoryCache();
      } else if (uploadResult.categoryTreeChanged) {
        await clearCategoryCache();
      }

      res.json({ total: uploadResult.total, results: uploadResult.results });
    } catch (error) {
      if (error instanceof BatchArchiveUploadError) {
        res.status(error.statusCode).json({ detail: error.message });
        return;
      }
      res.status(500).json({ detail: '批量上传处理失败' });
    }
  },
);

export default router;
