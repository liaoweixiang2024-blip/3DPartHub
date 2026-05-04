import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { stat as statAsync } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Router, Response } from 'express';
import { getBusinessConfig } from '../../lib/businessConfig.js';
import { cacheDelByPrefix } from '../../lib/cache.js';
import { config } from '../../lib/config.js';
import { normalizeUploadFilename } from '../../lib/filenameEncoding.js';
import { logger } from '../../lib/logger.js';
import { conversionQueue } from '../../lib/queue.js';
import { optionalString, requiredString, RequestValidationError } from '../../lib/requestValidation.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { parseStepFileDate } from '../../services/modelFileDates.js';
import { MODEL_STATUS } from '../../services/modelStatus.js';
import { modelUpload, pathInside, validateModelUpload } from './uploadHelpers.js';

type ModelUploadContext = {
  prisma: any;
  saveMeta: (id: string, data: Record<string, unknown>) => void;
};

export function createModelUploadRouter({ prisma, saveMeta }: ModelUploadContext) {
  const router = Router();

  async function markQueueUnavailable(modelId: string, meta: Record<string, unknown>, res: Response) {
    meta.status = MODEL_STATUS.FAILED;
    meta.error = 'conversion_queue_unavailable';
    saveMeta(modelId, meta);
    if (prisma) {
      await prisma.model
        .update({
          where: { id: modelId },
          data: { status: MODEL_STATUS.FAILED },
        })
        .catch(() => {});
      await cacheDelByPrefix('cache:models:');
    }
    res.status(503).json({ detail: '转换队列暂不可用，请稍后重试' });
  }

  // Upload requires auth
  router.post(
    '/api/models/upload',
    authMiddleware,
    requireRole('ADMIN'),
    modelUpload.single('file'),
    async (req: AuthRequest, res: Response) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({ detail: '没有文件' });
        return;
      }

      const originalName = normalizeUploadFilename(file.originalname, 'unknown.step');
      const ext = await validateModelUpload(file, res);
      if (!ext) return;

      const modelId = randomUUID().slice(0, 12);
      const createdAt = new Date().toISOString();
      const userId = req.user!.userId;
      const categoryId = req.body.categoryId || null;

      // Preserve original file modification time: STEP header > client filesystem > null
      const stepFileDate = parseStepFileDate(file.path);
      const clientLastModified = req.body.lastModified ? Number(req.body.lastModified) : null;
      const fileDate =
        stepFileDate || (clientLastModified && !isNaN(clientLastModified) ? new Date(clientLastModified) : null);
      const originalModifiedAt = fileDate ? fileDate.toISOString() : null;

      // Save filesystem metadata (always, as backup)
      const meta: Record<string, unknown> = {
        model_id: modelId,
        original_name: originalName,
        original_size: file.size,
        format: ext,
        status: MODEL_STATUS.QUEUED,
        created_at: createdAt,
        upload_path: file.path,
        created_by_id: userId,
        ...(originalModifiedAt && { original_modified_at: originalModifiedAt }),
      };
      saveMeta(modelId, meta);

      // Save initial DB record
      let dbSaved = false;
      if (prisma) {
        try {
          await prisma.model.upsert({
            where: { id: modelId },
            create: {
              id: modelId,
              name: originalName.replace(/\.[^.]+$/, ''),
              originalName,
              originalFormat: ext,
              originalSize: file.size,
              gltfUrl: '',
              gltfSize: 0,
              format: ext,
              status: MODEL_STATUS.QUEUED,
              uploadPath: file.path,
              createdById: userId,
              ...(categoryId && { categoryId }),
              ...(originalModifiedAt && { metadata: { originalModifiedAt } }),
              ...(originalModifiedAt && { fileModifiedAt: new Date(originalModifiedAt) }),
            },
            update: {},
          });
          dbSaved = true;
        } catch (dbErr) {
          logger.error({ dbErr }, 'Database save failed');
        }
      }

      // Auto-merge: check if models with same name exist, auto-group them
      if (prisma) {
        try {
          const modelName = originalName.replace(/\.[^.]+$/, '');
          const sameNameModels = await prisma.model.findMany({
            where: { name: modelName, status: MODEL_STATUS.COMPLETED, id: { not: modelId } },
            select: { id: true, groupId: true, fileModifiedAt: true, createdAt: true },
          });
          if (sameNameModels.length > 0) {
            const allModels = [{ id: modelId, fileModifiedAt: originalModifiedAt, createdAt }, ...sameNameModels];
            const toTime = (m: any) =>
              m.fileModifiedAt ? new Date(m.fileModifiedAt).getTime() : new Date(m.createdAt).getTime();
            allModels.sort((a: any, b: any) => toTime(b) - toTime(a));
            const primaryId =
              allModels.length > 1
                ? allModels.find((m: any) => m.id !== modelId)?.id || allModels[0].id
                : allModels[0].id;

            const existingGroup = sameNameModels.find((m: any) => m.groupId);
            if (existingGroup?.groupId) {
              await prisma.model.update({ where: { id: modelId }, data: { groupId: existingGroup.groupId } });
              await prisma.modelGroup.update({ where: { id: existingGroup.groupId }, data: { primaryId } });
            } else {
              const allIds = [modelId, ...sameNameModels.map((m: any) => m.id)];
              await prisma.$transaction(async (tx: any) => {
                const existing = await tx.modelGroup.findFirst({
                  where: { models: { some: { name: modelName } } },
                });
                if (existing) {
                  await tx.model.update({ where: { id: modelId }, data: { groupId: existing.id } });
                  await tx.modelGroup.update({ where: { id: existing.id }, data: { primaryId } });
                } else {
                  await tx.modelGroup.create({
                    data: {
                      name: modelName,
                      primaryId,
                      models: { connect: allIds.map((id) => ({ id })) },
                    },
                  });
                }
              });
            }
          }
        } catch (mergeErr) {
          logger.error({ mergeErr }, 'Auto-merge failed (non-critical)');
        }
      }

      if (!dbSaved) {
        try {
          rmSync(file.path, { force: true });
        } catch {}
        res.status(500).json({ detail: '保存模型记录失败' });
        return;
      }

      try {
        await conversionQueue.add('convert', {
          modelId,
          filePath: file.path,
          originalName,
          ext,
          userId,
        });
      } catch (queueErr) {
        logger.error({ queueErr }, 'Queue add failed');
        await markQueueUnavailable(modelId, meta, res);
        return;
      }

      res.json({
        success: true,
        data: {
          model_id: modelId,
          original_name: originalName,
          gltf_url: '',
          thumbnail_url: '',
          gltf_size: 0,
          original_size: file.size,
          format: ext,
          status: MODEL_STATUS.QUEUED,
          created_at: createdAt,
        },
      });
    },
  );

  // Upload from server-local file (used after chunked upload merges the file)
  router.post(
    '/api/models/upload-local',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      let filePath: string;
      let fileName: string;
      try {
        filePath = requiredString(req.body?.filePath, 'filePath');
        fileName = normalizeUploadFilename(
          requiredString(req.body?.fileName, 'fileName', { maxLength: 255 }),
          'unknown.step',
        );
      } catch (err) {
        if (err instanceof RequestValidationError) {
          res.status(err.status).json({ detail: err.message });
          return;
        }
        res.status(400).json({ detail: '缺少 filePath 或 fileName' });
        return;
      }
      const categoryId = optionalString(req.body?.categoryId, { maxLength: 80 }) || null;

      const absPath = resolve(process.cwd(), filePath);
      const allowedDirs = [join(process.cwd(), config.uploadDir), join(process.cwd(), 'uploads')];
      let resolvedPath: string;
      try {
        resolvedPath = realpathSync(absPath);
      } catch {
        res.status(400).json({ detail: '文件不存在' });
        return;
      }
      const isAllowed = allowedDirs.some((d) => pathInside(resolvedPath, d));
      if (!isAllowed) {
        res.status(400).json({ detail: '文件路径不在允许的目录内' });
        return;
      }
      if (!existsSync(resolvedPath)) {
        res.status(400).json({ detail: '文件不存在' });
        return;
      }

      const ext = fileName.split('.').pop()?.toLowerCase() || '';
      const { uploadPolicy } = await getBusinessConfig();
      const formats = uploadPolicy.modelFormats.map((item) => item.toLowerCase());
      const fileSize = (await statAsync(resolvedPath)).size;
      const maxBytes = Math.max(1, uploadPolicy.modelMaxSizeMb) * 1024 * 1024;
      if (!formats.includes(ext)) {
        res.status(400).json({ detail: `不支持的格式，请上传 ${formats.map((item) => `.${item}`).join(' / ')} 文件` });
        return;
      }
      if (fileSize > maxBytes) {
        res.status(400).json({ detail: `文件过大，最大支持 ${uploadPolicy.modelMaxSizeMb}MB` });
        return;
      }
      const modelId = randomUUID().slice(0, 12);
      const createdAt = new Date().toISOString();
      const userId = req.user!.userId;
      const managedUploadRoot = resolve(process.cwd(), config.uploadDir);
      let storedUploadPath = resolvedPath;
      if (!pathInside(resolvedPath, managedUploadRoot)) {
        try {
          mkdirSync(managedUploadRoot, { recursive: true });
          storedUploadPath = join(managedUploadRoot, `${modelId}.${ext}`);
          copyFileSync(resolvedPath, storedUploadPath);
        } catch {
          res.status(500).json({ detail: '保存模型文件失败' });
          return;
        }
      }

      const meta: Record<string, unknown> = {
        model_id: modelId,
        original_name: fileName,
        original_size: fileSize,
        format: ext,
        status: MODEL_STATUS.QUEUED,
        created_at: createdAt,
        upload_path: storedUploadPath,
        created_by_id: userId,
      };
      saveMeta(modelId, meta);

      let dbSaved = false;
      if (prisma) {
        try {
          await prisma.model.upsert({
            where: { id: modelId },
            create: {
              id: modelId,
              name: fileName.replace(/\.[^.]+$/, ''),
              originalName: fileName,
              originalFormat: ext,
              originalSize: fileSize,
              gltfUrl: '',
              gltfSize: 0,
              format: ext,
              status: MODEL_STATUS.QUEUED,
              uploadPath: storedUploadPath,
              createdById: userId,
              ...(categoryId && { categoryId }),
            },
            update: {},
          });
          dbSaved = true;
        } catch (dbErr) {
          logger.error({ dbErr }, 'Database save failed');
        }
      }

      if (!dbSaved) {
        try {
          rmSync(storedUploadPath, { force: true });
        } catch {}
        res.status(500).json({ detail: '保存模型记录失败' });
        return;
      }

      try {
        await conversionQueue.add('convert', {
          modelId,
          filePath: storedUploadPath,
          originalName: fileName,
          ext,
          userId,
          preserveSource: true,
        });
      } catch (err) {
        logger.error({ err }, 'Failed to queue conversion');
        await markQueueUnavailable(modelId, meta, res);
        return;
      }

      res.json({
        success: true,
        data: {
          model_id: modelId,
          original_name: fileName,
          gltf_url: '',
          thumbnail_url: '',
          gltf_size: 0,
          original_size: fileSize,
          format: ext,
          status: MODEL_STATUS.QUEUED,
          created_at: createdAt,
        },
      });
    },
  );

  return router;
}
