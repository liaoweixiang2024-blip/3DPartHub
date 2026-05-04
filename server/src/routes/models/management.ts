import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Router, Response } from 'express';
import { cacheDelByPrefix, cacheDel } from '../../lib/cache.js';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { modelTextSearchWhere, normalizeSearchParam } from '../../lib/searchQuery.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { removeExistingFiles, removeModelFiles } from '../../services/modelFiles.js';
import { MODEL_STATUS } from '../../services/modelStatus.js';
import { clearCategoryCache } from '../categories/common.js';
import { modelUpload } from './uploadHelpers.js';

type ModelManagementContext = {
  prisma: any;
  metadataDir: string;
  getMeta: (id: string) => Record<string, unknown> | null;
  saveMeta: (id: string, data: Record<string, unknown>) => void;
};

export function createModelManagementRouter({ prisma, metadataDir, getMeta, saveMeta }: ModelManagementContext) {
  const router = Router();

  async function clearModelManagementCaches() {
    await cacheDelByPrefix('cache:models:');
    await cacheDelByPrefix('cache:favorites:');
    await cacheDelByPrefix('cache:share:info:');
    await cacheDel('cache:model-groups:list');
    await cacheDel('cache:models:count:grouped');
    await cacheDel('cache:models:count:all');
    await clearCategoryCache();
  }

  async function deleteModelById(id: string, options: { clearCaches?: boolean } = {}) {
    let dbFileInfo: { format?: string | null; originalFormat?: string | null; uploadPath?: string | null } | null =
      null;
    let relatedStaticUrls: string[] = [];
    let dbModelFound = false;

    if (prisma) {
      try {
        const dbModel = await prisma.model.findUnique({
          where: { id },
          select: {
            format: true,
            originalFormat: true,
            uploadPath: true,
            drawingUrl: true,
            groupId: true,
            group: { select: { id: true, primaryId: true } },
            versions: { select: { fileKey: true } },
          },
        });
        dbModelFound = Boolean(dbModel);
        dbFileInfo = dbModel
          ? { format: dbModel.format, originalFormat: dbModel.originalFormat, uploadPath: dbModel.uploadPath }
          : null;
        relatedStaticUrls = [
          dbModel?.drawingUrl,
          ...(dbModel?.versions.map((version: { fileKey: string | null }) => version.fileKey) || []),
        ].filter(Boolean) as string[];

        // If this model is the primary of its group, transfer primary to the newest remaining variant.
        if (dbModel?.group && dbModel.group.primaryId === id) {
          const remaining = await prisma.model.findMany({
            where: { groupId: dbModel.groupId, id: { not: id } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true },
          });
          if (remaining.length > 0) {
            await prisma.modelGroup.update({
              where: { id: dbModel.groupId },
              data: { primaryId: remaining[0].id },
            });
          } else {
            await prisma.modelGroup.delete({ where: { id: dbModel.groupId } }).catch(() => {});
          }
        }
      } catch (err) {
        logger.warn({ err, modelId: id }, '[models] Failed to read model before deletion');
      }
    }

    const meta = getMeta(id);
    const cleanup = removeModelFiles(
      meta
        ? {
            id,
            uploadPath: meta.upload_path as string | undefined,
            format: meta.format as string | undefined,
            originalFormat: dbFileInfo?.originalFormat || dbFileInfo?.format,
          }
        : {
            id,
            uploadPath: dbFileInfo?.uploadPath,
            format: dbFileInfo?.format,
            originalFormat: dbFileInfo?.originalFormat,
          },
    );
    const allFailed = [...cleanup.failed];

    const staticUrlCleanup = removeExistingFiles(
      relatedStaticUrls.map((url) => {
        const cleanUrl = String(url).split('?')[0];
        if (!cleanUrl.startsWith('/static/')) return null;
        return join(config.staticDir, cleanUrl.slice('/static/'.length));
      }),
    );
    allFailed.push(...staticUrlCleanup.failed);

    const metaPath = join(metadataDir, `${id}.json`);
    const metaCleanup = removeExistingFiles([metaPath]);
    allFailed.push(...metaCleanup.failed);

    if (prisma) {
      try {
        await prisma.favorite.deleteMany({ where: { modelId: id } }).catch(() => {});
        await prisma.download.deleteMany({ where: { modelId: id } }).catch(() => {});
        await prisma.shareLink.deleteMany({ where: { modelId: id } }).catch(() => {});
        await prisma.comment.deleteMany({ where: { modelId: id } }).catch(() => {});
        await prisma.modelVersion.deleteMany({ where: { modelId: id } }).catch(() => {});
        await prisma.model.delete({ where: { id } }).catch(() => {});
      } catch (err) {
        logger.warn({ err, modelId: id }, '[models] Failed to delete related database rows');
      }
    }

    if (options.clearCaches !== false) {
      await clearModelManagementCaches();
    }

    const removedFileCount = cleanup.removed.length + staticUrlCleanup.removed.length + metaCleanup.removed.length;
    return {
      id,
      deleted: dbModelFound || Boolean(meta) || removedFileCount > 0,
      warnings: allFailed,
    };
  }

  async function buildBatchDeleteFilterWhere(rawFilters: unknown) {
    const filters = rawFilters && typeof rawFilters === 'object' ? (rawFilters as Record<string, unknown>) : {};
    const search = normalizeSearchParam(filters.search);
    const categoryId = normalizeSearchParam(filters.categoryId, 80);
    const where: any = { status: MODEL_STATUS.COMPLETED };
    const andConditions: Record<string, unknown>[] = [];
    const searchCond = modelTextSearchWhere(search);
    if (searchCond) andConditions.push(searchCond);

    if (categoryId) {
      const catIdsRaw = await prisma.$queryRaw<Array<{ id: string }>>`
        WITH RECURSIVE cat_tree AS (
          SELECT id FROM categories WHERE id = ${categoryId}
          UNION ALL
          SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_id = ct.id
        ) SELECT id FROM cat_tree
      `;
      const catIds = catIdsRaw.map((cat: { id: string }) => cat.id);
      where.categoryId = catIds.length > 0 ? { in: catIds } : categoryId;
    }

    if (andConditions.length) where.AND = andConditions;
    return where;
  }

  // Update model info (requires auth)
  router.put('/api/models/:id', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { name, description, categoryId } = req.body;

    if (prisma) {
      try {
        const model = await prisma.model.findUnique({ where: { id } });
        if (!model) {
          res.status(404).json({ detail: '模型不存在' });
          return;
        }
        if (name !== undefined) {
          if (!name.trim()) {
            res.status(400).json({ detail: '模型名称不能为空' });
            return;
          }
          if (name.length > 200) {
            res.status(400).json({ detail: '模型名称不能超过 200 个字符' });
            return;
          }
        }
        if (categoryId !== undefined && categoryId !== null) {
          const catExists = await prisma.category.findUnique({ where: { id: categoryId } });
          if (!catExists) {
            res.status(400).json({ detail: '分类不存在' });
            return;
          }
        }

        const updated = await prisma.model.update({
          where: { id },
          data: {
            ...(name !== undefined && { name }),
            ...(description !== undefined && { description }),
            ...(categoryId !== undefined && { categoryId }),
          },
          include: {
            categoryRef: { select: { name: true } },
            group: { select: { id: true, name: true, primaryId: true, _count: { select: { models: true } } } },
          },
        });

        await cacheDelByPrefix('cache:models:');
        await clearCategoryCache();

        res.json({
          model_id: updated.id,
          name: updated.name,
          original_name: updated.originalName,
          description: updated.description,
          format: updated.format,
          status: updated.status,
          thumbnail_url: updated.thumbnailUrl,
          gltf_url: updated.gltfUrl,
          gltf_size: updated.gltfSize,
          original_size: updated.originalSize,
          category: (updated as any).categoryRef?.name || null,
          category_id: updated.categoryId || null,
          download_count: updated.downloadCount || 0,
          created_at: updated.createdAt,
          file_modified_at: updated.fileModifiedAt || null,
          drawing_url: updated.drawingUrl,
          drawing_name: updated.drawingName || null,
          drawing_size: updated.drawingSize || null,
          preview_meta: (updated as any).previewMeta || null,
          group: (updated as any).group || null,
        });
        return;
      } catch {
        res.status(500).json({ detail: '更新失败' });
        return;
      }
    }

    // Filesystem fallback
    const meta = getMeta(id);
    if (!meta) {
      res.status(404).json({ detail: '模型不存在' });
      return;
    }
    if (name !== undefined) meta.name = name;
    if (description !== undefined) meta.description = description;
    if (categoryId !== undefined) meta.category = categoryId;
    saveMeta(id, meta);
    res.json({ model_id: id, ...meta });
  });

  // Batch delete models requires auth
  router.post(
    '/api/models/batch-delete',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      let modelIds: string[];
      const allMatching = req.body?.allMatching === true;
      if (allMatching) {
        if (!prisma) {
          res.status(503).json({ detail: '数据库未连接，无法按筛选条件批量删除' });
          return;
        }
        const where = await buildBatchDeleteFilterWhere(req.body?.filters);
        const matched = await prisma.model.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 5001,
          select: { id: true },
        });
        if (matched.length > 5000) {
          res.status(400).json({ detail: '单次按筛选条件最多删除 5000 个模型，请缩小筛选范围' });
          return;
        }
        modelIds = matched.map((model: { id: string }) => model.id);
      } else {
        const rawIds = req.body?.modelIds;
        if (!Array.isArray(rawIds)) {
          res.status(400).json({ detail: 'modelIds 必须是数组' });
          return;
        }
        modelIds = Array.from(new Set(rawIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)));
      }

      if (modelIds.length === 0) {
        res.status(400).json({ detail: '请选择要删除的模型' });
        return;
      }
      if (!allMatching && modelIds.length > 500) {
        res.status(400).json({ detail: '单次最多删除 500 个模型' });
        return;
      }

      const items = [];
      for (const id of modelIds) {
        items.push(await deleteModelById(id, { clearCaches: false }));
      }
      await clearModelManagementCaches();

      const deleted = items.filter((item) => item.deleted).length;
      const warningCount = items.reduce((sum, item) => sum + item.warnings.length, 0);
      if (warningCount > 0) {
        logger.warn({ detail: items.filter((item) => item.warnings.length > 0) }, '[models] Batch delete warnings');
      }

      res.json({
        message: warningCount > 0 ? '批量删除完成，但部分文件清理失败' : '批量删除完成',
        allMatching,
        requested: modelIds.length,
        deleted,
        warnings: warningCount,
        items: items.map((item) => ({
          id: item.id,
          deleted: item.deleted,
          warnings: item.warnings.length,
        })),
      });
    },
  );

  // Delete model requires auth
  router.delete('/api/models/:id', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
    const result = await deleteModelById(req.params.id as string);

    if (result.warnings.length > 0) {
      logger.warn({ detail: result.warnings }, '[models] Some files could not be deleted');
      res.json({ message: '删除成功，但部分文件清理失败', warnings: result.warnings.length });
      return;
    }
    res.json({ message: '删除成功' });
  });

  // Upload custom thumbnail for a model
  router.post(
    '/api/models/:id/thumbnail',
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

      // Validate image type
      const allowedMimes = new Set(['image/png', 'image/jpeg', 'image/webp']);
      if (!allowedMimes.has(file.mimetype || '')) {
        rmSync(file.path, { force: true });
        res.status(400).json({ detail: '仅支持 PNG/JPEG/WebP 格式的图片' });
        return;
      }

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

        // Save thumbnail as {id}.png in thumbnails dir
        const thumbDir = join(config.staticDir, 'thumbnails');
        mkdirSync(thumbDir, { recursive: true });
        const mimeToExt: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
        const ext = mimeToExt[file.mimetype] || 'png';
        const thumbPath = join(thumbDir, `${id}.${ext}`);

        copyFileSync(file.path, thumbPath);
        rmSync(file.path, { force: true });

        const ts = Date.now();
        const thumbnailUrl = `/static/thumbnails/${id}.${ext}?t=${ts}`;

        await prisma.model.update({
          where: { id },
          data: { thumbnailUrl },
        });

        await cacheDelByPrefix('cache:models:');
        await clearCategoryCache();

        res.json({ success: true, data: { model_id: id, thumbnail_url: thumbnailUrl } });
      } catch (err: any) {
        logger.error({ err }, '[management] Thumbnail upload failed');
        rmSync(file.path, { force: true });
        res.status(500).json({ detail: '上传预览图失败' });
      }
    },
  );

  return router;
}
