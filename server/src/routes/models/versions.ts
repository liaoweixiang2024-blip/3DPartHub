import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';
import { Router, Request, Response } from 'express';
import { cacheDelByPrefix } from '../../lib/cache.js';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { requireBrowseAccess } from '../../middleware/browseAccess.js';
import { requireRole } from '../../middleware/rbac.js';
import { getInvisibleCategoryIdsForRequest } from '../../services/categoryAccess.js';
import { convertStepToGltf } from '../../services/converter.js';
import { MODEL_STATUS } from '../../services/modelStatus.js';
import { generateThumbnail } from '../../services/thumbnail.js';
import { modelUpload, validateModelUpload } from './uploadHelpers.js';

type ModelVersionsContext = {
  prisma: PrismaClient | null;
  optionalVerifiedUser: (req: Request) => Promise<{ role?: string | null } | null>;
};

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

// 与 conversion.ts 一致：PROCESSING 卡死超过 20 分钟放行（进程崩溃等留下的死状态）
const STALE_PROCESSING_MS = 20 * 60_000;

export function createModelVersionsRouter({ prisma, optionalVerifiedUser }: ModelVersionsContext) {
  const router = Router();

  // List model versions
  router.get('/api/models/:id/versions', async (req: Request, res: Response) => {
    if (!(await requireBrowseAccess(req, res))) return;

    const modelId = routeParam(req.params.id);
    if (!prisma) {
      res.status(503).json({ detail: '数据库未连接' });
      return;
    }
    try {
      const authPayload = await optionalVerifiedUser(req);
      const model = await prisma.model.findUnique({
        where: { id: modelId },
        select: { id: true, status: true, categoryId: true },
      });
      if (!model || (model.status !== MODEL_STATUS.COMPLETED && authPayload?.role !== 'ADMIN')) {
        res.status(404).json({ detail: '模型不存在' });
        return;
      }
      // 分类访问控制：受限分类的模型版本列表不对外暴露
      const invisible = await getInvisibleCategoryIdsForRequest(req);
      if (model.categoryId && invisible.has(model.categoryId)) {
        res.status(404).json({ detail: '模型不存在' });
        return;
      }
      const versions = await prisma.modelVersion.findMany({
        where: { modelId },
        orderBy: { versionNumber: 'desc' },
        include: { createdBy: { select: { id: true, username: true } } },
      });
      res.json(versions);
    } catch {
      res.status(500).json({ detail: '获取版本列表失败' });
    }
  });

  // Upload new version
  router.post(
    '/api/models/:id/versions',
    authMiddleware,
    requireRole('ADMIN'),
    modelUpload.single('file'),
    async (req: AuthRequest, res: Response) => {
      const modelId = req.params.id as string;
      const file = req.file;
      const changeLog = req.body.changeLog as string | undefined;

      if (!file) {
        res.status(400).json({ detail: '没有文件' });
        return;
      }

      if (!prisma) {
        res.status(503).json({ detail: '数据库未连接' });
        return;
      }

      let prevStatus: string | null = null;
      try {
        const model = await prisma.model.findUnique({ where: { id: modelId }, select: { status: true } });
        if (!model) {
          try {
            rmSync(file.path, { force: true });
          } catch {
            /* best-effort temp file cleanup */
          }
          res.status(404).json({ detail: '模型不存在' });
          return;
        }

        if (model.status === MODEL_STATUS.QUEUED || model.status === MODEL_STATUS.PROCESSING) {
          try {
            rmSync(file.path, { force: true });
          } catch {
            /* best-effort temp file cleanup */
          }
          res.status(409).json({ detail: '模型正在转换中，请稍后重试' });
          return;
        }

        // 原子抢占：分钟级的转换期间置 PROCESSING，阻断并发的删除/替换文件/重转/
        // 其他版本上传（findUnique 的状态检查与转换开始之间存在竞态窗口）
        const statusUpdate = await prisma.model.updateMany({
          where: {
            id: modelId,
            OR: [
              { status: { notIn: [MODEL_STATUS.QUEUED, MODEL_STATUS.PROCESSING] } },
              { updatedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
            ],
          },
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
        prevStatus = model.status;

        const ext = await validateModelUpload(file, res);
        if (!ext) {
          // 抢占已生效，失败路径恢复原状态（validateModelUpload 已自删临时文件）
          await prisma.model.update({ where: { id: modelId }, data: { status: prevStatus } }).catch(() => {});
          return;
        }

        const updated = await prisma.model.update({
          where: { id: modelId },
          data: { currentVersion: { increment: 1 } },
          select: { currentVersion: true },
        });
        const versionNumber = updated.currentVersion;

        const modelDir = join(config.staticDir, 'models');
        let result: Awaited<ReturnType<typeof convertStepToGltf>>;
        try {
          result = await convertStepToGltf(
            file.path,
            modelDir,
            `${modelId}_v${versionNumber}`,
            file.originalname || 'model.step',
          );
        } finally {
          try {
            rmSync(file.path, { force: true });
          } catch {
            /* best-effort temp file cleanup */
          }
        }

        const version = await prisma.modelVersion.create({
          data: {
            modelId,
            versionNumber,
            fileKey: result.gltfUrl,
            format: ext,
            fileSize: result.gltfSize,
            previewMeta: toPrismaJson(result.previewMeta),
            changeLog: changeLog || `版本 ${versionNumber}`,
            createdById: req.user!.userId,
          },
        });

        let thumbnailUrl: string | null = null;
        if (existsSync(result.gltfPath)) {
          try {
            const thumb = await generateThumbnail(result.gltfPath, join(config.staticDir, 'thumbnails'), modelId);
            thumbnailUrl = `${thumb.thumbnailUrl}?t=${Date.now()}`;
          } catch {
            /* non-critical */
          }
        }

        await prisma.model.update({
          where: { id: modelId },
          data: {
            gltfUrl: result.gltfUrl,
            gltfSize: result.gltfSize,
            previewMeta: toPrismaJson(result.previewMeta),
            ...(thumbnailUrl && { thumbnailUrl }),
            status: MODEL_STATUS.COMPLETED,
          },
        });

        await cacheDelByPrefix('cache:models:');

        res.json({
          version_id: version.id,
          version_number: versionNumber,
          file_key: result.gltfUrl,
          format: ext,
          file_size: result.gltfSize,
          change_log: changeLog,
        });
      } catch (err: unknown) {
        // 抢占后失败：恢复原状态，避免把模型永久留在 PROCESSING（卡死要等 20 分钟放行）
        if (prevStatus) {
          await prisma.model.update({ where: { id: modelId }, data: { status: prevStatus } }).catch(() => {});
        }
        logger.error({ err }, '[versions] Upload failed');
        res.status(500).json({ detail: '上传版本失败' });
      }
    },
  );

  // Rollback to a specific version
  router.post(
    '/api/models/:id/versions/:versionId/rollback',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const modelId = req.params.id as string;
      const versionId = req.params.versionId as string;

      if (!prisma) {
        res.status(503).json({ detail: '数据库未连接' });
        return;
      }

      let prevStatus: string | null = null;
      try {
        const version = await prisma.modelVersion.findUnique({ where: { id: versionId } });
        if (!version || version.modelId !== modelId) {
          res.status(404).json({ detail: '版本不存在' });
          return;
        }

        const currentModel = await prisma.model.findUnique({ where: { id: modelId }, select: { status: true } });
        if (currentModel?.status === MODEL_STATUS.QUEUED || currentModel?.status === MODEL_STATUS.PROCESSING) {
          res.status(409).json({ detail: '模型正在转换中，无法回滚' });
          return;
        }

        // 原子抢占：缩略图生成/指针切换期间置 PROCESSING，与版本上传/重转/删除互斥
        const statusUpdate = await prisma.model.updateMany({
          where: {
            id: modelId,
            OR: [
              { status: { notIn: [MODEL_STATUS.QUEUED, MODEL_STATUS.PROCESSING] } },
              { updatedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
            ],
          },
          data: { status: MODEL_STATUS.PROCESSING },
        });
        if (statusUpdate.count === 0) {
          res.status(409).json({ detail: '模型正在转换中，无法回滚' });
          return;
        }
        if (currentModel) prevStatus = currentModel.status;

        // fileKey 存的是完整带版本的 URL（/static/models/xxx.glb?v=...），
        // 拼本地路径必须剥离 /static/ 前缀和查询串，
        // 否则 join 出 static/models/static/models/xxx.glb?v=...，回滚永远 410
        const relativeKey = version.fileKey.replace(/^\/static\//, '').split('?')[0];
        const glbPath = join(config.staticDir, relativeKey);
        if (!existsSync(glbPath)) {
          await prisma.model
            .update({ where: { id: modelId }, data: { status: prevStatus ?? MODEL_STATUS.COMPLETED } })
            .catch(() => {});
          res.status(410).json({ detail: '版本文件不存在，无法回滚' });
          return;
        }

        let thumbnailUrl: string | null = null;
        try {
          const thumb = await generateThumbnail(glbPath, join(config.staticDir, 'thumbnails'), modelId);
          thumbnailUrl = `${thumb.thumbnailUrl}?t=${Date.now()}`;
        } catch {
          /* non-critical */
        }

        await prisma.model.update({
          where: { id: modelId },
          data: {
            gltfUrl: version.fileKey,
            gltfSize: version.fileSize,
            previewMeta: toPrismaJson(version.previewMeta),
            ...(thumbnailUrl && { thumbnailUrl }),
            status: MODEL_STATUS.COMPLETED,
          },
        });

        await cacheDelByPrefix('cache:models:');

        res.json({ message: '已回滚', version_number: version.versionNumber });
      } catch {
        // 抢占后失败：恢复原状态，避免把模型永久留在 PROCESSING
        if (prevStatus) {
          await prisma.model.update({ where: { id: modelId }, data: { status: prevStatus } }).catch(() => {});
        }
        res.status(500).json({ detail: '回滚失败' });
      }
    },
  );

  return router;
}
