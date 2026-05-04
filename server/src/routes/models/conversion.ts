import { Router, Response } from 'express';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDelByPrefix } from '../../lib/cache.js';
import { config } from '../../lib/config.js';
import { conversionQueue } from '../../lib/queue.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { convertStepToGltf } from '../../services/converter.js';
import { findPreviewAssetPath } from '../../services/gltfAsset.js';
import { generateThumbnail } from '../../services/thumbnail.js';
import { convertXtToGltf } from '../../services/xt-converter.js';
import { findOriginalModelPath, isDeprecatedHtmlPreviewFormat, removeModelFiles } from '../../services/modelFiles.js';
import { parseStepFileDate } from '../../services/modelFileDates.js';
import { MODEL_STATUS } from '../../services/modelStatus.js';
import { modelUpload, validateModelUpload } from './uploadHelpers.js';
import { logger } from '../../lib/logger.js';

type ModelConversionContext = {
  prisma: any;
  getMeta: (id: string) => Record<string, unknown> | null;
  saveMeta: (id: string, data: Record<string, unknown>) => void;
  getPreviewMeta: (
    id: string,
    options?: { gltfUrl?: string | null; originalName?: string | null; format?: string | null; previewMeta?: unknown },
  ) => Promise<Record<string, unknown> | null>;
};

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

      const originalName = file.originalname || 'unknown.step';
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
          } catch {}
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
          } catch {}
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

        // Save new file as original
        const originalsDir = join(config.staticDir, 'originals');
        mkdirSync(originalsDir, { recursive: true });
        const destPath = join(originalsDir, `${id}.${ext}`);
        copyFileSync(file.path, destPath);
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
            previewMeta: null,
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
      } catch (err: any) {
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
          res.status(400).json({ detail: 'HTML 预览已停用，请上传 STEP/IGES/XT 文件' });
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

        const modelDir = join(config.staticDir, 'models');
        let gltfSize = m.gltfSize;
        let gltfUrl = m.gltfUrl;
        let previewPath = findPreviewAssetPath(modelDir, m.id, m.gltfUrl);
        let nextPreviewMeta = (m as any).previewMeta || null;

        // Re-convert from original if available, otherwise just regenerate thumbnail from existing glTF
        if (origPath) {
          const result =
            m.format === 'xt' || m.format === 'x_t'
              ? await convertXtToGltf(origPath, modelDir, m.id, m.originalName || `${m.id}.${m.format}`)
              : await convertStepToGltf(origPath, modelDir, m.id, m.originalName || `${m.id}.${m.format}`);
          gltfSize = result.gltfSize;
          gltfUrl = result.gltfUrl;
          previewPath = result.gltfPath;
          nextPreviewMeta = result.previewMeta;
        }

        // Regenerate thumbnail from current preview asset (GLB for new conversions, glTF for legacy assets)
        let thumbnailUrl = m.thumbnailUrl;
        if (previewPath && existsSync(previewPath)) {
          try {
            const thumb = await generateThumbnail(previewPath, join(config.staticDir, 'thumbnails'), m.id);
            thumbnailUrl = thumb.thumbnailUrl;
          } catch {
            /* non-critical */
          }
        }

        // Append timestamp for cache busting
        const ts = Date.now();
        const versionedUrl = thumbnailUrl ? `${thumbnailUrl.split('?')[0]}?t=${ts}` : null;

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

        res.json({
          success: true,
          data: {
            model_id: m.id,
            name: m.name,
            gltf_url: gltfUrl,
            gltf_size: gltfSize,
            thumbnail_url: versionedUrl,
            preview_meta: previewMeta,
          },
        });
      } catch (err: any) {
        await prisma.model
          .update({
            where: { id },
            data: { status: MODEL_STATUS.FAILED },
          })
          .catch(() => {});
        logger.error({ err }, 'Re-convert failed');
        res.status(500).json({ detail: '重新转换失败' });
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

              const result =
                m.format === 'xt' || m.format === 'x_t'
                  ? await convertXtToGltf(origPath, modelDir, m.id, m.originalName || `${m.id}.${m.format}`)
                  : await convertStepToGltf(origPath, modelDir, m.id, m.originalName || `${m.id}.${m.format}`);

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
                  previewMeta: result.previewMeta,
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
      } catch (err: any) {
        logger.error({ err }, '[conversion] Batch reconvert failed');
        res.status(500).json({ detail: '批量重新转换失败' });
      }
    },
  );

  return router;
}
