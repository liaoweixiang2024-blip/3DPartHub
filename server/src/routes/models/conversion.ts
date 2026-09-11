import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';
import multer from 'multer';
import { Router, Response, type NextFunction } from 'express';
import { cacheDelByPrefix } from '../../lib/cache.js';
import { config } from '../../lib/config.js';
import { normalizeUploadFilename } from '../../lib/filenameEncoding.js';
import { logger } from '../../lib/logger.js';
import { conversionChildHeapLimitMb, conversionQueue } from '../../lib/queue.js';
import { persistFile } from '../../lib/storageProvider.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { convertStepToGltf } from '../../services/converter.js';
import { findPreviewAssetPath } from '../../services/gltfAsset.js';
import { parseStepFileDate } from '../../services/modelFileDates.js';
import {
  findOriginalModelPath,
  isDeprecatedHtmlPreviewFormat,
  purgeModelFromCloud,
  removeModelFiles,
} from '../../services/modelFiles.js';
import { MODEL_STATUS } from '../../services/modelStatus.js';
import { generateThumbnail } from '../../services/thumbnail.js';
import { UPLOAD_REQUEST_TIMEOUT_MS } from '../../lib/uploadLimits.js';
import { createNotification } from '../notifications.js';
import { modelUpload, validateModelUpload } from './uploadHelpers.js';

type ModelConversionContext = {
  prisma: PrismaClient | null;
  getMeta: (id: string) => Record<string, unknown> | null;
  saveMeta: (id: string, data: Record<string, unknown>) => void;
  getPreviewMeta: (
    id: string,
    options?: { gltfUrl?: string | null; originalName?: string | null; format?: string | null; previewMeta?: unknown },
  ) => Promise<Record<string, unknown> | null>;
};

const toPrismaJson = (value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

// ── 手动重转异步任务（编辑弹窗进度条）──
// 内存 job 表：重启即失（与批量上传同款策略）；单管理员场景足够。
type ReconvertJob = {
  id: string;
  modelId: string;
  engine: 'standard' | 'gmsh';
  stage: 'queued' | 'processing' | 'done' | 'error';
  percent: number;
  message: string;
  result?: Record<string, unknown> & { thumbnail_url?: string | null };
  error?: string;
  createdAt: number;
};

const reconvertJobs = new Map<string, ReconvertJob>();
const RECONVERT_JOB_TTL_MS = 10 * 60 * 1000;

// fork 隔离子进程执行重转换：occt WASM / gmsh / 软件光栅化都在子进程跑，
// API 进程事件循环不受影响（在 API 进程内跑会同步冻结全部 HTTP 请求）。
type RunnerOutcome = { thumbnailUrl: string | null } | { error: string };

function runReconvertInChild(job: ReconvertJob, inputPath: string, modelId: string, originalName: string) {
  const runnerPath = new URL('../../workers/reconvertRunner.js', import.meta.url);
  return new Promise<RunnerOutcome>((resolve) => {
    // 堆上限与上传转换子进程同源（见 queue.ts conversionChildHeapLimitMb），
    // 同一套 occt WASM 重活，同样的堆爆防护
    const child = fork(runnerPath, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      execArgv: [...process.execArgv, `--max-old-space-size=${conversionChildHeapLimitMb()}`],
    });
    let settled = false;
    const finish = (outcome: RunnerOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      child.removeAllListeners();
      child.kill();
      resolve(outcome);
    };
    const timeoutTimer = setTimeout(
      () => {
        logger.warn({ jobId: job.id }, '[conversion] Reconvert child timeout, killing');
        finish({ error: '转换超时（15 分钟），已终止' });
      },
      15 * 60 * 1000,
    );
    child.stdout?.on('data', (chunk) => logger.info(`[reconvert:${job.id}] ${String(chunk).trimEnd()}`));
    child.stderr?.on('data', (chunk) => logger.warn(`[reconvert:${job.id}] ${String(chunk).trimEnd()}`));
    child.on(
      'message',
      (msg: { type: string; progress?: number; message?: string; thumbnail?: { thumbnailUrl: string } }) => {
        if (msg.type === 'progress' && typeof msg.progress === 'number' && Number.isFinite(msg.progress)) {
          updateReconvertJob_progress(job, msg.progress, msg.message || '转换中...');
        } else if (msg.type === 'done') {
          finish({ thumbnailUrl: msg.thumbnail?.thumbnailUrl ?? null });
        } else if (msg.type === 'error') {
          finish({ error: msg.message || '转换失败' });
        }
      },
    );
    child.on('exit', (code, signal) => {
      if (settled) return;
      if (signal === 'SIGABRT' || signal === 'SIGSEGV' || signal === 'SIGKILL') {
        const containerTotalMb = Math.floor((process.constrainedMemory?.() || 0) / 1024 / 1024);
        finish({
          error:
            `转换子进程异常退出: ${signal}（容器内存配额 ${containerTotalMb || '未知'}MB）。` +
            (signal === 'SIGKILL'
              ? '容器内存不足被系统终止（OOM），请调大 API_MEMORY_LIMIT 后重试'
              : '转换引擎内存不足或该模型几何过于复杂导致崩溃，请尝试调大 API_MEMORY_LIMIT 后重试'),
        });
        return;
      }
      finish({ error: `转换子进程异常退出（code ${code}）` });
    });
    child.send({ type: 'run', payload: { engine: job.engine, inputPath, modelId, originalName } });
  });
}

function updateReconvertJob_progress(job: ReconvertJob, percent: number, message: string) {
  job.stage = 'processing';
  job.percent = Math.max(job.percent, Math.min(99, Math.round(percent)));
  job.message = message;
}

function createReconvertJob(modelId: string, engine: 'standard' | 'gmsh'): ReconvertJob {
  // 清理过期任务，防内存缓慢增长
  const now = Date.now();
  for (const [id, job] of reconvertJobs) {
    if (now - job.createdAt > RECONVERT_JOB_TTL_MS) reconvertJobs.delete(id);
  }
  const job: ReconvertJob = {
    id: `reconvert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    modelId,
    engine,
    stage: 'queued',
    percent: 0,
    message: engine === 'gmsh' ? '等待修复转换...' : '等待标准转换...',
    createdAt: now,
  };
  reconvertJobs.set(job.id, job);
  return job;
}

export function createModelConversionRouter({ prisma, getMeta, saveMeta, getPreviewMeta }: ModelConversionContext) {
  const router = Router();

  // Replace model source file and re-convert
  router.post(
    '/api/models/:id/replace-file',
    authMiddleware,
    requireRole('ADMIN'),
    modelUpload.single('file'),
    async (req: AuthRequest, res: Response) => {
      const id = req.params.id as string;
      const file = req.file;
      if (!file) {
        res.status(400).json({ detail: '没有文件' });
        return;
      }

      const originalName = normalizeUploadFilename(file.originalname, 'unknown.step');
      const ext = await validateModelUpload(file, res);
      if (!ext) return;

      if (!prisma) {
        rmSync(file.path, { force: true });
        res.status(503).json({ detail: '数据库未连接' });
        return;
      }

      try {
        const m = await prisma.model.findUnique({ where: { id } });
        if (!m) {
          rmSync(file.path, { force: true });
          res.status(404).json({ detail: '模型不存在' });
          return;
        }

        if (m.status === MODEL_STATUS.QUEUED || m.status === MODEL_STATUS.PROCESSING) {
          try {
            rmSync(file.path, { force: true });
          } catch {
            /* best-effort temp file cleanup */
          }
          res.status(409).json({ detail: '模型正在转换中，请稍后重试' });
          return;
        }

        const statusUpdate = await prisma.model.updateMany({
          where: { id, status: { notIn: [MODEL_STATUS.QUEUED, MODEL_STATUS.PROCESSING] } },
          data: { status: MODEL_STATUS.PROCESSING },
        });
        if (statusUpdate.count === 0) {
          try {
            rmSync(file.path, { force: true });
          } catch {
            /* best-effort temp file cleanup */
          }
          res.status(409).json({ detail: '模型正在转换中，请稍后重试' });
          return;
        }

        const cleanup = removeModelFiles({
          id,
          uploadPath: m.uploadPath,
          format: m.format,
          originalFormat: m.originalFormat,
        });
        if (cleanup.failed.length > 0) {
          logger.warn({ detail: cleanup.failed }, '[models] Some old model files could not be deleted');
        }
        // 双删：清理旧文件在云端的副本（best-effort）
        await purgeModelFromCloud({
          id,
          uploadPath: m.uploadPath,
          format: m.format,
          originalFormat: m.originalFormat,
        });

        // Save new file as original
        const originalsDir = join(config.staticDir, 'originals');
        mkdirSync(originalsDir, { recursive: true });
        const destPath = join(originalsDir, `${id}.${ext}`);
        copyFileSync(file.path, destPath);
        await persistFile(destPath);
        rmSync(file.path, { force: true });

        // Update database - preserve original file modification time: STEP header > client filesystem
        const stepFileDate = parseStepFileDate(destPath);
        const clientLastModified = req.body.lastModified ? Number(req.body.lastModified) : null;
        const fileDate =
          stepFileDate || (clientLastModified && !isNaN(clientLastModified) ? new Date(clientLastModified) : null);
        const originalModifiedAt = fileDate ? fileDate.toISOString() : null;
        const existingModel = await prisma.model.findUnique({ where: { id }, select: { metadata: true } });
        const existingMeta = (existingModel?.metadata as Record<string, unknown>) || {};

        await prisma.model.update({
          where: { id },
          data: {
            originalName,
            originalFormat: ext,
            originalSize: file.size,
            format: ext,
            uploadPath: destPath,
            status: MODEL_STATUS.PROCESSING,
            gltfUrl: '',
            gltfSize: 0,
            thumbnailUrl: null,
            previewMeta: Prisma.JsonNull,
            ...(originalModifiedAt && { metadata: { ...existingMeta, originalModifiedAt } }),
            ...(originalModifiedAt && { fileModifiedAt: new Date(originalModifiedAt) }),
          },
        });

        // Update filesystem metadata
        const meta = getMeta(id) || {
          model_id: id,
          created_at: new Date().toISOString(),
          created_by_id: req.user!.userId,
        };
        Object.assign(meta, {
          original_name: originalName,
          original_size: file.size,
          format: ext,
          status: MODEL_STATUS.PROCESSING,
          upload_path: destPath,
        });
        saveMeta(id, meta);

        // Enqueue conversion
        try {
          await conversionQueue.add('convert', {
            modelId: id,
            filePath: destPath,
            originalName,
            ext,
            userId: req.user!.userId,
            preserveSource: true,
          });
        } catch (queueErr) {
          logger.error({ queueErr }, 'Queue add failed');
          meta.status = MODEL_STATUS.FAILED;
          meta.error = 'conversion_queue_unavailable';
          saveMeta(id, meta);
          await prisma.model
            .update({
              where: { id },
              data: { status: MODEL_STATUS.FAILED },
            })
            .catch(() => {});
          await cacheDelByPrefix('cache:models:');
          res.status(503).json({ detail: '转换队列暂不可用，请稍后重试' });
          return;
        }

        await cacheDelByPrefix('cache:models:');
        res.json({ success: true, data: { model_id: id, status: MODEL_STATUS.PROCESSING } });
      } catch (err: unknown) {
        if (prisma) {
          await prisma.model
            .update({
              where: { id },
              data: { status: MODEL_STATUS.FAILED },
            })
            .catch(() => {});
          await cacheDelByPrefix('cache:models:');
        }
        logger.error({ err }, 'Replace file failed');
        res.status(500).json({ detail: '替换文件失败' });
      }
    },
  );

  // Re-convert a single model with higher tessellation quality + regenerate thumbnail
  router.post(
    '/api/models/:id/reconvert',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const id = req.params.id as string;

      if (!prisma) {
        res.status(503).json({ detail: '数据库未连接' });
        return;
      }

      try {
        const m = await prisma.model.findUnique({ where: { id } });
        if (!m) {
          res.status(404).json({ detail: '模型不存在' });
          return;
        }

        if (m.status === MODEL_STATUS.QUEUED || m.status === MODEL_STATUS.PROCESSING) {
          res.status(409).json({ detail: '模型正在转换中，请稍后重试' });
          return;
        }

        const origPath = findOriginalModelPath(m);

        if (isDeprecatedHtmlPreviewFormat(m.format)) {
          res.status(400).json({ detail: 'HTML 预览已停用，请上传 STEP/IGES 文件' });
          return;
        }

        if (!origPath) {
          const previewPath = findPreviewAssetPath(join(config.staticDir, 'models'), m.id, m.gltfUrl);
          if (!previewPath || !existsSync(previewPath)) {
            res.status(400).json({ detail: '模型无原始文件且无预览文件，无法重新转换' });
            return;
          }
        }

        const statusUpdate = await prisma.model.updateMany({
          where: { id, status: { notIn: [MODEL_STATUS.QUEUED, MODEL_STATUS.PROCESSING] } },
          data: { status: MODEL_STATUS.PROCESSING },
        });
        if (statusUpdate.count === 0) {
          res.status(409).json({ detail: '模型正在转换中，请稍后重试' });
          return;
        }

        // 异步任务 + 进度上报：立即返回 jobId，前端轮询进度条
        const job = createReconvertJob(id, 'standard');
        res.json({ jobId: job.id });

        setImmediate(async () => {
          try {
            // 重活全部在隔离子进程执行（occt WASM/gmsh/光栅化），API 进程事件循环
            // 不被冻结——此前在 API 进程内同步跑，转换期间全站无响应。
            let thumbnailUrl = m.thumbnailUrl;
            let thumbnailWarning: string | null = null;
            const outcome = await runReconvertInChild(job, origPath!, m.id, m.originalName || `${m.id}.${m.format}`);
            if ('error' in outcome) {
              throw new Error(outcome.error);
            }
            if (outcome.thumbnailUrl) {
              thumbnailUrl = outcome.thumbnailUrl;
            } else {
              thumbnailWarning = '模型已重新转换，预览图生成失败，已保留原预览图';
            }
            // 重读转换产物元数据（子进程已写盘）
            let gltfSize = m.gltfSize;
            let gltfUrl = m.gltfUrl;
            let nextPreviewMeta = toPrismaJson(m.previewMeta);
            try {
              const fresh = await prisma.model.findUnique({
                where: { id },
                select: { gltfUrl: true, gltfSize: true, previewMeta: true },
              });
              if (fresh) {
                gltfUrl = fresh.gltfUrl;
                gltfSize = fresh.gltfSize;
                nextPreviewMeta = toPrismaJson(fresh.previewMeta);
              }
            } catch {
              /* 保留旧值 */
            }

            // Append timestamp for cache busting
            const ts = Date.now();
            const versionedUrl = thumbnailWarning
              ? thumbnailUrl
              : thumbnailUrl
                ? `${thumbnailUrl.split('?')[0]}?t=${ts}`
                : null;

            // Update DB with versioned URL
            await prisma.model.update({
              where: { id },
              data: {
                ...(gltfUrl !== m.gltfUrl ? { gltfUrl } : {}),
                ...(gltfSize !== m.gltfSize ? { gltfSize } : {}),
                ...(versionedUrl !== m.thumbnailUrl ? { thumbnailUrl: versionedUrl } : {}),
                previewMeta: nextPreviewMeta,
                status: MODEL_STATUS.COMPLETED,
              },
            });

            await cacheDelByPrefix('cache:models:');
            const previewMeta = await getPreviewMeta(m.id, {
              gltfUrl,
              originalName: m.originalName,
              format: m.format,
              previewMeta: nextPreviewMeta,
            });

            Object.assign(job, {
              stage: 'done' as const,
              percent: 100,
              message: '转换完成',
              result: {
                model_id: m.id,
                name: m.name,
                gltf_url: gltfUrl,
                gltf_size: gltfSize,
                thumbnail_url: versionedUrl,
                thumbnail_warning: thumbnailWarning,
                preview_meta: previewMeta,
              },
            });
          } catch (err: unknown) {
            await prisma.model
              .update({
                where: { id },
                data: { status: MODEL_STATUS.FAILED },
              })
              .catch(() => {});
            logger.error({ err }, 'Re-convert failed');
            Object.assign(job, {
              stage: 'error' as const,
              percent: 100,
              message: '重新转换失败',
              error: err instanceof Error ? err.message : '重新转换失败',
            });
          }
        });
      } catch (err: unknown) {
        res.status(500).json({ detail: '任务创建失败' });
      }
    },
  );

  // Repair a broken preview: re-mesh with the gmsh fallback engine.
  // For models whose main conversion silently dropped faces (missing parts /
  // holes in the preview) — the main engine (OCCT 7.6 BRepMesh) fails on some
  // geometries that gmsh handles correctly.
  router.post(
    '/api/models/:id/reconvert-gmsh',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const id = req.params.id as string;

      if (!prisma) {
        res.status(503).json({ detail: '数据库未连接' });
        return;
      }

      try {
        const m = await prisma.model.findUnique({ where: { id } });
        if (!m) {
          res.status(404).json({ detail: '模型不存在' });
          return;
        }
        if (m.status === MODEL_STATUS.QUEUED || m.status === MODEL_STATUS.PROCESSING) {
          res.status(409).json({ detail: '模型正在转换中，请稍后重试' });
          return;
        }
        const origPath = findOriginalModelPath(m);
        if (!origPath || !existsSync(origPath)) {
          res.status(400).json({ detail: '模型无原始 STEP/IGES 文件，无法用修复引擎重转' });
          return;
        }
        const ext = (m.originalFormat || m.format || '').toLowerCase();
        if (!['step', 'stp'].includes(ext)) {
          res.status(400).json({ detail: '修复引擎目前仅支持 STEP 文件' });
          return;
        }

        const statusUpdate = await prisma.model.updateMany({
          where: { id, status: { notIn: [MODEL_STATUS.QUEUED, MODEL_STATUS.PROCESSING] } },
          data: { status: MODEL_STATUS.PROCESSING },
        });
        if (statusUpdate.count === 0) {
          res.status(409).json({ detail: '模型正在转换中，请稍后重试' });
          return;
        }

        // 异步任务 + 进度上报：立即返回 jobId，前端轮询进度条
        const job = createReconvertJob(id, 'gmsh');
        res.json({ jobId: job.id });

        setImmediate(async () => {
          try {
            // 与标准转换同构：重活（occt 探针/gmsh/光栅化）全部在隔离子进程，
            // API 进程事件循环不被冻结
            let thumbnailUrl = m.thumbnailUrl;
            const outcome = await runReconvertInChild(job, origPath, m.id, m.originalName || `${m.id}.${m.format}`);
            if ('error' in outcome) {
              throw new Error(outcome.error);
            }
            if (outcome.thumbnailUrl) thumbnailUrl = outcome.thumbnailUrl;

            // 子进程已写盘产物；从磁盘产物重读元数据（gmsh runner 不写 DB）
            const modelDir = join(config.staticDir, 'models');
            const glbPath = join(modelDir, `${m.id}.glb`);
            const stat = existsSync(glbPath) ? statSync(glbPath) : null;
            const ts = Date.now();
            const versionedThumb = thumbnailUrl ? `${thumbnailUrl.split('?')[0]}?t=${ts}` : null;

            await prisma.model.update({
              where: { id },
              data: {
                gltfUrl: `/static/models/${m.id}.glb?v=${ts.toString(36)}`,
                gltfSize: stat?.size ?? m.gltfSize,
                ...(versionedThumb ? { thumbnailUrl: versionedThumb } : {}),
                status: MODEL_STATUS.COMPLETED,
              },
            });

            await cacheDelByPrefix('cache:models:');
            const previewMeta = await getPreviewMeta(m.id, {
              gltfUrl: `/static/models/${m.id}.glb?v=${ts.toString(36)}`,
              originalName: m.originalName,
              format: m.format,
            });

            Object.assign(job, {
              stage: 'done' as const,
              percent: 100,
              message: '修复转换完成',
              result: {
                model_id: m.id,
                name: m.name,
                gltf_url: `/static/models/${m.id}.glb?v=${ts.toString(36)}`,
                gltf_size: stat?.size ?? m.gltfSize,
                thumbnail_url: versionedThumb,
                engine: 'gmsh',
                preview_meta: previewMeta,
              },
            });
          } catch (err: unknown) {
            await prisma.model
              .update({
                where: { id },
                data: { status: MODEL_STATUS.FAILED },
              })
              .catch(() => {});
            logger.error({ err }, '[conversion] gmsh re-convert failed');
            const message = err instanceof Error ? err.message : '修复引擎重转失败';
            Object.assign(job, {
              stage: 'error' as const,
              percent: 100,
              message: '修复转换失败',
              error: message,
            });
          }
        });
      } catch (err: unknown) {
        res.status(500).json({ detail: '任务创建失败' });
      }
    },
  );

  // 手动重转进度查询（编辑弹窗进度条轮询）
  router.get(
    '/api/models/reconvert-progress/:jobId',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const jobId = req.params.jobId as string;
      const job = reconvertJobs.get(jobId);
      if (!job || !jobId.startsWith('reconvert_')) {
        res.status(404).json({ detail: '任务不存在，服务器可能已重启' });
        return;
      }
      res.json({
        job_id: job.id,
        model_id: job.modelId,
        engine: job.engine,
        stage: job.stage,
        percent: job.percent,
        message: job.message,
        ...(job.result ? { result: job.result } : {}),
        ...(job.error ? { error: job.error } : {}),
      });
    },
  );

  // ── 离线转换产物导入 ──
  // 服务器内存不足转不动的模型：本地用 convert:offline CLI 转好打包
  // （model.glb + thumbnail.png + meta.json + original.<ext>），此处导入，
  // 模型直接置为 COMPLETED，不再经过服务器转换队列。
  const IMPORT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 上传 zip 上限 2GB
  const IMPORT_PREVIEW_EXTRACT_MAX_BYTES = 4 * 1024 * 1024 * 1024; // 解压总量上限（防 zip 炸弹）
  const IMPORT_PREVIEW_ALLOWED_ORIGINAL_EXTS = new Set(['step', 'stp', 'iges', 'igs']);

  router.post(
    '/api/models/:id/import-preview',
    authMiddleware,
    requireRole('ADMIN'),
    (req: AuthRequest, res: Response, next: NextFunction) => {
      req.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS);
      res.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS);
      next();
    },
    multer({ dest: config.uploadDir, limits: { fileSize: IMPORT_PREVIEW_MAX_BYTES } }).single('file'),
    async (req: AuthRequest, res: Response) => {
      const id = req.params.id as string;
      const file = req.file;
      if (!file) {
        res.status(400).json({ detail: '没有文件' });
        return;
      }
      const cleanupUpload = () => rmSync(file.path, { force: true });

      if (!prisma) {
        cleanupUpload();
        res.status(503).json({ detail: '数据库未连接' });
        return;
      }

      const m = await prisma.model.findUnique({ where: { id } });
      if (!m) {
        cleanupUpload();
        res.status(404).json({ detail: '模型不存在' });
        return;
      }
      if (m.status !== MODEL_STATUS.FAILED) {
        cleanupUpload();
        res.status(409).json({ detail: '仅转换失败的模型支持导入转换产物' });
        return;
      }

      const AdmZip = (await import('adm-zip')).default;
      let zip: InstanceType<typeof AdmZip>;
      try {
        zip = new AdmZip(file.path);
      } catch {
        cleanupUpload();
        res.status(400).json({ detail: '无法读取压缩包，请确认上传的是离线转换产出的 .offline.zip' });
        return;
      }

      // 白名单解包：仅根层精确文件名，天然拒绝路径穿越与多余条目
      const entries = zip.getEntries().filter((e) => !e.isDirectory);
      if (entries.length > 10) {
        cleanupUpload();
        res.status(400).json({ detail: '压缩包内容异常（条目过多）' });
        return;
      }
      const filesByKey = new Map<string, Buffer>();
      let extractedBytes = 0;
      for (const entry of entries) {
        const name = entry.entryName.replace(/^\/+/, '');
        if (name.includes('/')) continue; // 子目录条目一律忽略
        const lower = name.toLowerCase();
        const ext = lower.split('.').pop() || '';
        const isAllowed =
          lower === 'model.glb' || lower === 'thumbnail.png' || lower === 'meta.json'
            ? true
            : lower.startsWith('original.') && IMPORT_PREVIEW_ALLOWED_ORIGINAL_EXTS.has(ext);
        if (!isAllowed) continue;
        const data = entry.getData();
        extractedBytes += data.length;
        if (extractedBytes > IMPORT_PREVIEW_EXTRACT_MAX_BYTES) {
          cleanupUpload();
          res.status(400).json({ detail: '压缩包解压总量超限（4GB）' });
          return;
        }
        filesByKey.set(lower, data);
      }

      const glbData = filesByKey.get('model.glb');
      if (!glbData || glbData.length === 0) {
        cleanupUpload();
        res.status(400).json({ detail: '压缩包缺少 model.glb（请用 npm run convert:offline 生成）' });
        return;
      }
      // glb magic：'glTF'（与上传分片校验同源）
      if (glbData.length < 4 || glbData.subarray(0, 4).toString('latin1') !== 'glTF') {
        cleanupUpload();
        res.status(400).json({ detail: 'model.glb 内容不是有效的 glb 文件' });
        return;
      }

      // meta.json：非法/缺失由 ensurePreviewMeta 从 glb 自动生成兜底
      let offlineMeta: unknown;
      const metaData = filesByKey.get('meta.json');
      if (metaData) {
        try {
          offlineMeta = JSON.parse(metaData.toString('utf8'));
        } catch {
          offlineMeta = undefined;
        }
      }

      // 落盘：glb → models/{id}.glb；缩略图优先 zip 自带，缺省服务端从 glb 生成
      const modelsDir = join(config.staticDir, 'models');
      const thumbsDir = join(config.staticDir, 'thumbnails');
      mkdirSync(modelsDir, { recursive: true });
      mkdirSync(thumbsDir, { recursive: true });
      const glbPath = join(modelsDir, `${id}.glb`);
      const workDir = join(config.uploadDir, `import-preview-${Date.now()}-${randomUUID().slice(0, 8)}`);
      try {
        mkdirSync(workDir, { recursive: true });
        writeFileSync(glbPath, glbData);

        let thumbnailUrl: string | null = null;
        const thumbData = filesByKey.get('thumbnail.png');
        if (thumbData && thumbData.length > 0 && thumbData.subarray(0, 4).toString('latin1') === '\x89PNG') {
          const thumbPath = join(thumbsDir, `${id}.png`);
          writeFileSync(thumbPath, thumbData);
          await persistFile(thumbPath);
          thumbnailUrl = `/static/thumbnails/${id}.png`;
        } else {
          try {
            const thumb = await generateThumbnail(glbPath, thumbsDir, id);
            if (existsSync(thumb.thumbnailPath)) {
              await persistFile(thumb.thumbnailPath);
              thumbnailUrl = thumb.thumbnailUrl;
            }
          } catch {
            /* 缩略图失败不阻塞导入（详情页有占位） */
          }
        }
        await persistFile(glbPath);

        // 原始文件（可选）：恢复「下载原文件」与日后重转能力
        let uploadPathUpdate: { uploadPath: string } | Record<string, never> = {};
        let originalUpdates: { originalFormat?: string; originalSize?: number } = {};
        const originalEntry = [...filesByKey.keys()].find((name) => name.startsWith('original.'));
        if (originalEntry) {
          const originalExt = originalEntry.split('.').pop()!;
          const originalsDir = join(config.staticDir, 'originals');
          mkdirSync(originalsDir, { recursive: true });
          const originalPath = join(originalsDir, `${id}.${originalExt}`);
          writeFileSync(originalPath, filesByKey.get(originalEntry)!);
          await persistFile(originalPath);
          uploadPathUpdate = { uploadPath: originalPath };
          originalUpdates = {
            originalFormat: originalExt,
            originalSize: filesByKey.get(originalEntry)!.length,
          };
        }

        // 失败残留元数据清除 + 转换产物入库
        const existingMetadata =
          m.metadata && typeof m.metadata === 'object' && !Array.isArray(m.metadata)
            ? { ...(m.metadata as Record<string, unknown>) }
            : {};
        delete existingMetadata.conversionError;
        delete existingMetadata.failedAt;

        const ts = Date.now();
        const gltfUrl = `/static/models/${id}.glb?v=${ts.toString(36)}`;
        await prisma.model.update({
          where: { id },
          data: {
            status: MODEL_STATUS.COMPLETED,
            gltfUrl,
            gltfSize: glbData.length,
            ...(thumbnailUrl ? { thumbnailUrl: `${thumbnailUrl.split('?')[0]}?t=${ts}` } : {}),
            ...(originalUpdates.originalFormat ? { format: originalUpdates.originalFormat } : {}),
            ...originalUpdates,
            ...uploadPathUpdate,
            metadata: existingMetadata as unknown as Prisma.InputJsonValue,
          },
        });

        // previewMeta：优先 zip 里的 meta.json（含本地转换诊断），非法/缺失回落从 glb 解析
        const previewMeta = await getPreviewMeta(id, {
          gltfUrl,
          originalName: m.originalName,
          format: originalUpdates.originalFormat || m.format,
          previewMeta: offlineMeta ?? m.previewMeta,
        });
        if (offlineMeta && previewMeta) {
          // 打导入标记：预览运维/详情页可区分「离线导入」与「服务器转换」
          await prisma.model
            .update({
              where: { id },
              data: {
                previewMeta: {
                  ...previewMeta,
                  offlineImported: true,
                  importedAt: new Date().toISOString(),
                } as unknown as Prisma.InputJsonValue,
              },
            })
            .catch(() => {});
        }

        await cacheDelByPrefix('cache:models:');
        await createNotification({
          userId: req.user!.userId,
          title: '离线转换产物已导入',
          message: `${m.originalName || m.name} 已导入本地转换的预览产物，模型恢复可用。`,
          type: 'model_conversion',
          audience: 'user',
          relatedId: id,
        }).catch(() => {});

        logger.info(
          { modelId: id, glbSize: glbData.length, hasOriginal: Boolean(originalEntry) },
          '[conversion] Offline preview imported',
        );
        res.json({
          success: true,
          data: {
            model_id: id,
            status: MODEL_STATUS.COMPLETED,
            gltf_url: gltfUrl,
            gltf_size: glbData.length,
            has_original: Boolean(originalEntry),
            thumbnail_generated: Boolean(thumbnailUrl),
          },
        });
      } catch (err) {
        logger.error({ err, modelId: id }, '[conversion] Import offline preview failed');
        await prisma.model.update({ where: { id }, data: { status: MODEL_STATUS.FAILED } }).catch(() => {});
        res.status(500).json({ detail: '导入转换产物失败' });
      } finally {
        rmSync(workDir, { recursive: true, force: true });
        cleanupUpload();
      }
    },
  );

  // Batch re-convert all completed models
  router.post(
    '/api/models/reconvert-all',
    authMiddleware,
    requireRole('ADMIN'),
    async (_req: AuthRequest, res: Response) => {
      if (!prisma) {
        res.status(503).json({ detail: '数据库未连接' });
        return;
      }

      try {
        const BATCH_SIZE = 100;
        let cursor: string | undefined;
        let success = 0,
          failed = 0,
          totalProcessed = 0;
        const modelDir = join(config.staticDir, 'models');
        const thumbDir = join(config.staticDir, 'thumbnails');

        while (true) {
          const models = await prisma.model.findMany({
            where: { status: MODEL_STATUS.COMPLETED },
            select: { id: true, name: true, originalName: true, format: true, uploadPath: true },
            take: BATCH_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { id: 'asc' },
          });
          if (models.length === 0) break;
          cursor = models[models.length - 1].id;

          for (const m of models) {
            const origPath = findOriginalModelPath(m);

            if (!origPath) {
              failed++;
              continue;
            }
            if (isDeprecatedHtmlPreviewFormat(m.format)) {
              failed++;
              continue;
            }

            try {
              const recheck = await prisma.model.findUnique({ where: { id: m.id }, select: { status: true } });
              if (!recheck || recheck.status !== MODEL_STATUS.COMPLETED) {
                failed++;
                continue;
              }

              await prisma.model.update({
                where: { id: m.id },
                data: { status: MODEL_STATUS.PROCESSING },
              });

              const result = await convertStepToGltf(origPath, modelDir, m.id, m.originalName || `${m.id}.${m.format}`);

              let thumbnailUrl: string | null = null;
              if (existsSync(result.gltfPath)) {
                try {
                  const thumb = await generateThumbnail(result.gltfPath, thumbDir, m.id);
                  thumbnailUrl = `${thumb.thumbnailUrl}?t=${Date.now()}`;
                } catch {
                  /* non-critical */
                }
              }

              await prisma.model.update({
                where: { id: m.id },
                data: {
                  gltfUrl: result.gltfUrl,
                  gltfSize: result.gltfSize,
                  previewMeta: toPrismaJson(result.previewMeta),
                  status: MODEL_STATUS.COMPLETED,
                  ...(thumbnailUrl ? { thumbnailUrl } : {}),
                },
              });
              success++;
            } catch {
              await prisma.model
                .update({
                  where: { id: m.id },
                  data: { status: MODEL_STATUS.FAILED },
                })
                .catch(() => {});
              failed++;
            }
          }
          totalProcessed += models.length;
        }

        await cacheDelByPrefix('cache:models:');
        res.json({ success: true, data: { total: totalProcessed, success, failed } });
      } catch (err: unknown) {
        logger.error({ err }, '[conversion] Batch reconvert failed');
        res.status(500).json({ detail: '批量重新转换失败' });
      }
    },
  );

  return router;
}
