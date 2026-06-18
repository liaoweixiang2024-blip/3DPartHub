import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import { Router, Response } from 'express';
import { cacheDelByPrefix, cacheDel } from '../../lib/cache.js';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { MAX_MODEL_PAGE, modelTextSearchWhere, normalizeSearchParam, numericQuery } from '../../lib/searchQuery.js';
import { persistFile } from '../../lib/storageProvider.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { mutationLimiter } from '../../middleware/security.js';
import { hasActiveModelDownload } from '../../services/activeModelDownloads.js';
import { purgeModelFromCloud, removeExistingFiles, removeModelFiles } from '../../services/modelFiles.js';
import { MODEL_STATUS } from '../../services/modelStatus.js';
import { clearCategoryCache } from '../categories/common.js';
import { modelImageUpload } from './uploadHelpers.js';

type ModelManagementContext = {
  prisma: PrismaClient | null;
  metadataDir: string;
  getMeta: (id: string) => Record<string, unknown> | null;
  saveMeta: (id: string, data: Record<string, unknown>) => void;
};

class ModelDeleteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelDeleteBlockedError';
  }
}

export function createModelManagementRouter({ prisma, metadataDir, getMeta, saveMeta }: ModelManagementContext) {
  const router = Router();
  const modelFileCleanupSelect = {
    format: true,
    originalFormat: true,
    uploadPath: true,
    drawingUrl: true,
    status: true,
    metadata: true,
    groupId: true,
    group: { select: { id: true, primaryId: true } },
    versions: { select: { fileKey: true } },
  } satisfies Prisma.ModelSelect;
  type ModelFileCleanupRecord = Prisma.ModelGetPayload<{ select: typeof modelFileCleanupSelect }>;

  async function clearModelManagementCaches() {
    await cacheDelByPrefix('cache:models:');
    await cacheDelByPrefix('cache:favorites:');
    await cacheDelByPrefix('cache:share:info:');
    await cacheDel('cache:model-groups:list');
    await cacheDel('cache:models:count:grouped');
    await cacheDel('cache:models:count:all');
    await clearCategoryCache();
  }

  function metadataObject(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
    return { ...(metadata as Record<string, unknown>) };
  }

  async function deleteModelRecord(tx: Prisma.TransactionClient, id: string, deletedById?: string | null) {
    const model = await tx.model.findUnique({
      where: { id },
      select: modelFileCleanupSelect,
    });

    if (!model) return null;
    if (model.status === MODEL_STATUS.DELETED) return null;
    if (
      model.status === MODEL_STATUS.QUEUED ||
      model.status === MODEL_STATUS.PROCESSING ||
      model.status === MODEL_STATUS.PURGING
    ) {
      throw new ModelDeleteBlockedError('模型正在上传、转换或清理中，请完成后再删除');
    }
    if (hasActiveModelDownload(id)) {
      throw new ModelDeleteBlockedError('模型正在下载中，请稍后再删除');
    }

    const recentDownload = await tx.download.findFirst({
      where: {
        modelId: id,
        createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
      },
      select: { id: true },
    });
    if (recentDownload) {
      throw new ModelDeleteBlockedError('模型最近正在下载或刚开始下载，请稍后再删除');
    }

    // If this model is the primary of its group, transfer primary to the newest remaining variant.
    if (model.groupId && model.group && model.group.primaryId === id) {
      const remaining = await tx.model.findMany({
        where: { groupId: model.groupId, id: { not: id }, status: MODEL_STATUS.COMPLETED },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true },
      });
      if (remaining.length > 0) {
        await tx.modelGroup.update({
          where: { id: model.groupId },
          data: { primaryId: remaining[0].id },
        });
      } else {
        await tx.modelGroup.update({
          where: { id: model.groupId },
          data: { primaryId: null },
        });
      }
    }

    // Soft delete keeps files and related records recoverable while hiding the model from normal lists.
    await tx.model.update({
      where: { id },
      data: {
        status: MODEL_STATUS.DELETED,
        groupId: null,
        metadata: {
          ...metadataObject(model.metadata),
          deletedAt: new Date().toISOString(),
          ...(deletedById && { deletedById }),
          ...(model.groupId && { deletedFromGroupId: model.groupId }),
          deletedWasGroupPrimary: Boolean(model.group && model.group.primaryId === id),
        },
      },
    });

    if (model.groupId) {
      const remainingCount = await tx.model.count({
        where: { groupId: model.groupId, status: { not: MODEL_STATUS.DELETED } },
      });
      if (remainingCount === 0) {
        await tx.modelGroup.delete({ where: { id: model.groupId } });
      }
    }

    return model;
  }

  async function cleanupDeletedModelFiles(
    id: string,
    dbModel: ModelFileCleanupRecord | null,
    options: { clearCaches?: boolean; dbModelFound?: boolean } = {},
  ) {
    const dbModelFound = options.dbModelFound ?? Boolean(dbModel);
    const dbFileInfo = dbModel
      ? { format: dbModel.format, originalFormat: dbModel.originalFormat, uploadPath: dbModel.uploadPath }
      : null;
    const relatedStaticUrls = [
      dbModel?.drawingUrl,
      ...(dbModel?.versions.map((version: { fileKey: string | null }) => version.fileKey) || []),
    ].filter(Boolean) as string[];

    const meta = getMeta(id);
    if (!dbModelFound && prisma && !meta) {
      return { id, deleted: false, warnings: [] };
    }

    const modelRef = meta
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
        };

    const cleanup = removeModelFiles(modelRef);
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

    // 双删：同步清理云端副本（best-effort，失败不影响本地删除结果）
    await purgeModelFromCloud(modelRef, relatedStaticUrls);

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

  async function deleteModelById(id: string, options: { clearCaches?: boolean; deletedById?: string | null } = {}) {
    let dbModel: Awaited<ReturnType<typeof deleteModelRecord>> | null = null;

    if (prisma) {
      try {
        dbModel = await prisma.$transaction((tx: Prisma.TransactionClient) =>
          deleteModelRecord(tx, id, options.deletedById),
        );
      } catch (err) {
        if (err instanceof ModelDeleteBlockedError) throw err;
        logger.error({ err, modelId: id }, '[models] Failed to delete model row');
        throw err;
      }
    }

    if (dbModel) {
      if (options.clearCaches !== false) {
        await clearModelManagementCaches();
      }
      return { id, deleted: true, warnings: [] };
    }

    return cleanupDeletedModelFiles(id, dbModel, { ...options, dbModelFound: Boolean(dbModel) });
  }

  async function purgeDeletedModelById(id: string) {
    if (!prisma) {
      return cleanupDeletedModelFiles(id, null, { clearCaches: false });
    }

    const dbModel = await prisma.model.findUnique({
      where: { id },
      select: modelFileCleanupSelect,
    });
    if (!dbModel || dbModel.status !== MODEL_STATUS.DELETED) {
      return { id, deleted: false, warnings: [] };
    }

    const locked = await prisma.model.updateMany({
      where: { id, status: MODEL_STATUS.DELETED },
      data: { status: MODEL_STATUS.PURGING },
    });
    if (locked.count === 0) {
      return { id, deleted: false, warnings: [] };
    }

    try {
      const cleanup = await cleanupDeletedModelFiles(id, dbModel, { clearCaches: false, dbModelFound: true });
      if (cleanup.warnings.length > 0) {
        await prisma.model.updateMany({
          where: { id, status: MODEL_STATUS.PURGING },
          data: { status: MODEL_STATUS.DELETED },
        });
        return { id, deleted: false, warnings: cleanup.warnings };
      }

      const deleted = await prisma.model.deleteMany({ where: { id, status: MODEL_STATUS.PURGING } });
      if (deleted.count === 0) {
        await prisma.model.updateMany({
          where: { id, status: MODEL_STATUS.PURGING },
          data: { status: MODEL_STATUS.DELETED },
        });
        return { id, deleted: false, warnings: ['模型状态已变化，已取消彻底删除'] };
      }
      return { id, deleted: true, warnings: [] };
    } catch (err) {
      await prisma.model
        .updateMany({ where: { id, status: MODEL_STATUS.PURGING }, data: { status: MODEL_STATUS.DELETED } })
        .catch((restoreErr: unknown) => {
          logger.error(
            { restoreErr, modelId: id },
            '[models] Failed to restore recycle-bin status after purge failure',
          );
        });
      throw err;
    }
  }

  async function buildBatchDeleteFilterWhere(rawFilters: unknown) {
    const filters = rawFilters && typeof rawFilters === 'object' ? (rawFilters as Record<string, unknown>) : {};
    const search = normalizeSearchParam(filters.search);
    const categoryId = normalizeSearchParam(filters.categoryId, 80);
    const where: Prisma.ModelWhereInput = { status: MODEL_STATUS.COMPLETED };
    const andConditions: Prisma.ModelWhereInput[] = [];
    const searchCond = modelTextSearchWhere(search);
    if (searchCond) andConditions.push(searchCond as Prisma.ModelWhereInput);

    if (categoryId) {
      const db = prisma;
      if (!db) throw new Error('DATABASE_UNAVAILABLE');
      const catIdsRaw = await db.$queryRaw<Array<{ id: string }>>`
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
          category: updated.categoryRef?.name || null,
          category_id: updated.categoryId || null,
          download_count: updated.downloadCount || 0,
          created_at: updated.createdAt,
          file_modified_at: updated.fileModifiedAt || null,
          drawing_url: updated.drawingUrl,
          drawing_name: updated.drawingName || null,
          drawing_size: updated.drawingSize || null,
          preview_meta: updated.previewMeta || null,
          group: updated.group || null,
        });
        return;
      } catch (err) {
        logger.error({ err, modelId: id }, '[models] Update failed');
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
    mutationLimiter,
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

      try {
        let items: Awaited<ReturnType<typeof cleanupDeletedModelFiles>>[];
        if (prisma) {
          const dbModels = await prisma.$transaction(
            async (tx: Prisma.TransactionClient) => {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('model-batch-delete'))`;
              const deletedRows: { id: string; dbModel: Awaited<ReturnType<typeof deleteModelRecord>> | null }[] = [];
              for (const id of modelIds) {
                deletedRows.push({ id, dbModel: await deleteModelRecord(tx, id, req.user!.userId) });
              }
              return deletedRows;
            },
            { maxWait: 10_000, timeout: 120_000 },
          );
          items = [];
          for (const item of dbModels) {
            if (item.dbModel) {
              items.push({ id: item.id, deleted: true, warnings: [] });
            } else {
              items.push(
                await cleanupDeletedModelFiles(item.id, item.dbModel, {
                  clearCaches: false,
                  dbModelFound: false,
                }),
              );
            }
          }
        } else {
          const results = [];
          for (const id of modelIds) {
            results.push(await deleteModelById(id, { clearCaches: false }));
          }
          items = results;
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
      } catch (err) {
        if (err instanceof ModelDeleteBlockedError) {
          res.status(409).json({ detail: err.message });
          return;
        }
        logger.error({ err, modelIds }, '[models] Batch delete failed');
        res.status(500).json({ detail: '批量删除失败，模型记录未完整删除，请稍后重试' });
      }
    },
  );

  // Deleted model listing and restore endpoints for recycle-bin workflows.
  router.get('/api/models/deleted', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!prisma) {
      res.status(503).json({ detail: '数据库未连接，无法读取已删除模型' });
      return;
    }

    const page = numericQuery(req.query.page, 1, 1, MAX_MODEL_PAGE);
    const pageSize = numericQuery(req.query.page_size, 20, 1, 100);
    const search = normalizeSearchParam(req.query.search);
    const where: Record<string, unknown> = { status: MODEL_STATUS.DELETED };
    const searchCond = modelTextSearchWhere(search);
    if (searchCond) where.AND = [searchCond];

    try {
      const [total, models] = await prisma.$transaction([
        prisma.model.count({ where }),
        prisma.model.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            name: true,
            originalName: true,
            originalFormat: true,
            originalSize: true,
            uploadPath: true,
            metadata: true,
            updatedAt: true,
            createdAt: true,
            categoryRef: { select: { id: true, name: true } },
          },
        }),
      ]);

      res.json({
        total,
        page,
        page_size: pageSize,
        items: models.map((model) => {
          const metadata = metadataObject(model.metadata);
          const updatedAt =
            model.updatedAt instanceof Date ? model.updatedAt.toISOString() : String(model.updatedAt || '');
          return {
            model_id: model.id,
            name: model.name || model.originalName,
            original_name: model.originalName,
            format: model.originalFormat,
            original_size: model.originalSize,
            category_id: model.categoryRef?.id || null,
            category: model.categoryRef?.name || null,
            deleted_at: typeof metadata.deletedAt === 'string' ? metadata.deletedAt : updatedAt,
            deleted_by_id: typeof metadata.deletedById === 'string' ? metadata.deletedById : null,
            can_restore: model.uploadPath ? existsSync(model.uploadPath) : true,
            created_at: model.createdAt,
          };
        }),
      });
    } catch (err) {
      logger.error({ err }, '[models] Failed to list deleted models');
      res.status(500).json({ detail: '读取已删除模型失败' });
    }
  });

  router.post(
    '/api/models/:id/restore',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      if (!prisma) {
        res.status(503).json({ detail: '数据库未连接，无法恢复模型' });
        return;
      }

      const id = req.params.id as string;
      try {
        const model = await prisma.model.findUnique({
          where: { id },
          select: { id: true, status: true, uploadPath: true, metadata: true },
        });
        if (!model) {
          res.status(404).json({ detail: '模型不存在' });
          return;
        }
        if (model.status !== MODEL_STATUS.DELETED) {
          res.status(400).json({ detail: '模型未处于删除状态' });
          return;
        }
        if (model.uploadPath && !existsSync(model.uploadPath)) {
          res.status(409).json({ detail: '原始模型文件不存在，无法恢复' });
          return;
        }

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const metadata = metadataObject(model.metadata);
          const previousGroupId = typeof metadata.deletedFromGroupId === 'string' ? metadata.deletedFromGroupId : null;
          const wasPrimary = metadata.deletedWasGroupPrimary === true;
          delete metadata.deletedAt;
          delete metadata.deletedById;
          delete metadata.deletedFromGroupId;
          delete metadata.deletedWasGroupPrimary;

          const previousGroup = previousGroupId
            ? await tx.modelGroup.findUnique({ where: { id: previousGroupId }, select: { id: true, primaryId: true } })
            : null;

          await tx.model.update({
            where: { id },
            data: {
              status: MODEL_STATUS.COMPLETED,
              groupId: previousGroup?.id || null,
              metadata: metadata as Prisma.InputJsonValue,
            },
          });

          if (previousGroup && (wasPrimary || !previousGroup.primaryId)) {
            await tx.modelGroup.update({ where: { id: previousGroup.id }, data: { primaryId: id } });
          }
        });
        await clearModelManagementCaches();
        res.json({ message: '模型已恢复', model_id: id });
      } catch (err) {
        logger.error({ err, modelId: id }, '[models] Restore failed');
        res.status(500).json({ detail: '恢复失败，请稍后重试' });
      }
    },
  );

  router.post(
    '/api/models/deleted/purge',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const all = req.body?.all === true;
      let modelIds: string[] = [];

      if (all) {
        if (!prisma) {
          res.status(503).json({ detail: '数据库未连接，无法清空回收站' });
          return;
        }
        const search = normalizeSearchParam(req.body?.search);
        const where: Record<string, unknown> = { status: MODEL_STATUS.DELETED };
        const searchCond = modelTextSearchWhere(search);
        if (searchCond) where.AND = [searchCond];
        const matched = await prisma.model.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          take: 5001,
          select: { id: true },
        });
        if (matched.length > 5000) {
          res.status(400).json({ detail: '单次最多彻底删除 5000 个模型，请先缩小范围' });
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
        res.status(400).json({ detail: all ? '回收站为空' : '请选择要彻底删除的模型' });
        return;
      }
      if (!all && modelIds.length > 500) {
        res.status(400).json({ detail: '单次最多彻底删除 500 个模型' });
        return;
      }

      try {
        const items = [];
        for (const id of modelIds) {
          items.push(await purgeDeletedModelById(id));
        }
        await clearModelManagementCaches();
        const deleted = items.filter((item) => item.deleted).length;
        const warningCount = items.reduce((sum, item) => sum + item.warnings.length, 0);
        if (warningCount > 0) {
          logger.warn(
            { detail: items.filter((item) => item.warnings.length > 0) },
            '[models] Recycle bin purge warnings',
          );
        }
        res.json({
          message: warningCount > 0 ? '回收站清理完成，但部分文件清理失败' : '回收站清理完成',
          requested: modelIds.length,
          deleted,
          warnings: warningCount,
          items: items.map((item) => ({ id: item.id, deleted: item.deleted, warnings: item.warnings.length })),
        });
      } catch (err) {
        logger.error({ err, modelIds }, '[models] Failed to purge deleted models');
        res.status(500).json({ detail: '彻底删除失败，请稍后重试' });
      }
    },
  );

  // Delete model requires auth
  router.delete('/api/models/:id', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
    let result: Awaited<ReturnType<typeof deleteModelById>>;
    try {
      result = await deleteModelById(req.params.id as string, { deletedById: req.user!.userId });
    } catch (err) {
      if (err instanceof ModelDeleteBlockedError) {
        res.status(409).json({ detail: err.message });
        return;
      }
      logger.error({ err, modelId: req.params.id }, '[models] Delete failed');
      res.status(500).json({ detail: '删除失败，模型记录未删除' });
      return;
    }

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
    modelImageUpload.single('file'),
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
        await persistFile(thumbPath);
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
      } catch (err: unknown) {
        logger.error({ err }, '[management] Thumbnail upload failed');
        rmSync(file.path, { force: true });
        res.status(500).json({ detail: '上传预览图失败' });
      }
    },
  );

  return router;
}
