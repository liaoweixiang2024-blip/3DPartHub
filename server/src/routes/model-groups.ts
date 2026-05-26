import type { Prisma, PrismaClient } from '@prisma/client';
import { Router, Response } from 'express';
import { getErrorMessage } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { MODEL_STATUS } from '../services/modelStatus.js';
import { clearCategoryCache } from './categories/common.js';

const log = createLogger({ component: 'model-groups' });

let prisma: PrismaClient | null = null;
try {
  const mod = await import('../lib/prisma.js');
  prisma = mod.prisma;
} catch {
  log.warn('Failed to import prisma module');
}

const router = Router();
const MAX_GROUP_MODEL_IDS = 200;
const MAX_BATCH_MERGE_ITEMS = 50;
const MAX_SUGGESTION_PAGE_SIZE = 100;

function numericQuery(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function routeParam(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

function respondDatabaseUnavailable(res: Response) {
  res.status(503).json({ detail: '数据库未连接' });
}

// Create group
router.post('/api/model-groups', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  const { name, description, modelIds } = req.body;
  if (!name || !modelIds || !Array.isArray(modelIds) || modelIds.length === 0) {
    res.status(400).json({ detail: '需要 name 和 modelIds' });
    return;
  }
  if (modelIds.length > MAX_GROUP_MODEL_IDS) {
    res.status(400).json({ detail: `单个分组最多支持 ${MAX_GROUP_MODEL_IDS} 个模型` });
    return;
  }
  const db = prisma;
  if (!db) {
    respondDatabaseUnavailable(res);
    return;
  }

  try {
    // Pick the newest model as primary
    const newest = await db.model.findFirst({
      where: { id: { in: modelIds } },
      orderBy: [{ fileModifiedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: { id: true },
    });
    const group = await db.modelGroup.create({
      data: {
        name,
        description: description || null,
        primaryId: newest?.id || modelIds[0],
        models: { connect: modelIds.map((id: string) => ({ id })) },
      },
      include: { models: { select: { id: true, name: true, thumbnailUrl: true, originalName: true } } },
    });
    // Clear model list cache
    const { cacheDelByPrefix, cacheDel } = await import('../lib/cache.js');
    await cacheDelByPrefix('cache:models:');
    await cacheDel('cache:model-groups:list');
    await clearCategoryCache();
    res.json({ success: true, data: group });
  } catch (err: unknown) {
    log.error({ err }, 'Operation failed');
    res.status(500).json({ detail: '操作失败' });
  }
});

// List all groups
router.get('/api/model-groups', authMiddleware, requireRole('ADMIN'), async (_req: AuthRequest, res: Response) => {
  const db = prisma;
  if (!db) {
    res.json({ success: true, data: [] });
    return;
  }
  try {
    const { cacheGetOrSet, TTL } = await import('../lib/cache.js');
    const result = await cacheGetOrSet('cache:model-groups:list', TTL.MODELS_LIST, async () => {
      const groups = await db.modelGroup.findMany({
        include: {
          primary: { select: { id: true, name: true, thumbnailUrl: true } },
          models: {
            select: {
              id: true,
              name: true,
              thumbnailUrl: true,
              originalName: true,
              originalSize: true,
              createdAt: true,
              fileModifiedAt: true,
            },
            orderBy: [{ fileModifiedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        primary: g.primary,
        model_count: g.models.length,
        models: g.models.map((m) => ({
          id: m.id,
          name: m.name,
          thumbnailUrl: m.thumbnailUrl,
          originalName: m.originalName,
          originalSize: m.originalSize,
          createdAt: m.createdAt,
          fileModifiedAt: m.fileModifiedAt,
        })),
        created_at: g.createdAt,
      }));
    });
    res.json({ success: true, data: result.value });
  } catch (err: unknown) {
    log.error({ err }, 'Operation failed');
    res.status(500).json({ detail: '操作失败' });
  }
});

// Get merge suggestions — groups of models with same name, not yet grouped
router.get(
  '/api/model-groups/suggestions',
  authMiddleware,
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const db = prisma;
    if (!db) {
      res.json({ success: true, data: { items: [], total: 0, page: 1, page_size: 20 } });
      return;
    }
    try {
      const page = numericQuery(req.query.page, 1, 1, 100000);
      const pageSize = numericQuery(req.query.page_size, 20, 1, MAX_SUGGESTION_PAGE_SIZE);

      const COMPLETED = MODEL_STATUS.COMPLETED;
      const offset = (page - 1) * pageSize;
      const dupes = await db.$queryRaw<Array<{ name: string; cnt: number }>>`
      SELECT name, COUNT(*)::int as cnt
      FROM models
      WHERE group_id IS NULL AND status = ${COMPLETED}
      GROUP BY name
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC, name ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

      const totalResult = await db.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int as total FROM (
        SELECT name FROM models
        WHERE group_id IS NULL AND status = ${COMPLETED}
        GROUP BY name HAVING COUNT(*) > 1
      ) sub
    `;
      const total = totalResult[0]?.total || 0;
      const paged = dupes;

      const items = [];
      if (paged.length > 0) {
        // Batch query: fetch all models for paged names in one go
        const allModels = await db.model.findMany({
          where: {
            name: { in: paged.map((d) => d.name) },
            groupId: null,
            status: MODEL_STATUS.COMPLETED,
          },
          select: { id: true, name: true, thumbnailUrl: true, originalName: true, originalSize: true, createdAt: true },
          orderBy: [{ fileModifiedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        });
        // Group by name
        const byName = new Map<string, typeof allModels>();
        for (const m of allModels) {
          let arr = byName.get(m.name);
          if (!arr) {
            arr = [];
            byName.set(m.name, arr);
          }
          arr.push(m);
        }
        for (const d of paged) {
          items.push({ name: d.name, count: d.cnt, models: byName.get(d.name) || [] });
        }
      }

      res.json({ success: true, data: { items, total, page, page_size: pageSize } });
    } catch (err: unknown) {
      log.error({ err }, 'Operation failed');
      res.status(500).json({ detail: '操作失败' });
    }
  },
);

router.get(
  '/api/model-groups/count',
  authMiddleware,
  requireRole('ADMIN'),
  async (_req: AuthRequest, res: Response) => {
    const db = prisma;
    if (!db) {
      res.json({ success: true, data: { total: 0 } });
      return;
    }
    try {
      const total = await db.modelGroup.count();
      res.json({ success: true, data: { total } });
    } catch (err: unknown) {
      log.error({ err }, 'Operation failed');
      res.status(500).json({ detail: '操作失败' });
    }
  },
);

// Batch merge — create groups from multiple name sets
router.post(
  '/api/model-groups/batch-merge',
  authMiddleware,
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const { items } = req.body as { items: { name: string; modelIds: string[] }[] };
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ detail: '需要 items 数组' });
      return;
    }
    if (items.length > MAX_BATCH_MERGE_ITEMS) {
      res.status(400).json({ detail: `单次最多合并 ${MAX_BATCH_MERGE_ITEMS} 组` });
      return;
    }
    if (items.some((item) => item && Array.isArray(item.modelIds) && item.modelIds.length > MAX_GROUP_MODEL_IDS)) {
      res.status(400).json({ detail: `单个分组最多支持 ${MAX_GROUP_MODEL_IDS} 个模型` });
      return;
    }
    const db = prisma;
    if (!db) {
      respondDatabaseUnavailable(res);
      return;
    }

    try {
      const results: Array<{ name: string; group_id: string; model_count: number }> = [];
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const item of items) {
          if (!item.name || !Array.isArray(item.modelIds) || item.modelIds.length < 2) continue;
          const newest = await tx.model.findFirst({
            where: { id: { in: item.modelIds } },
            orderBy: [{ fileModifiedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
            select: { id: true },
          });
          const group = await tx.modelGroup.create({
            data: {
              name: item.name,
              primaryId: newest?.id || item.modelIds[0],
              models: { connect: item.modelIds.map((id: string) => ({ id })) },
            },
          });
          results.push({ name: item.name, group_id: group.id, model_count: item.modelIds.length });
        }
      });
      const { cacheDelByPrefix, cacheDel } = await import('../lib/cache.js');
      await cacheDelByPrefix('cache:models:');
      await cacheDel('cache:model-groups:list');
      await clearCategoryCache();
      res.json({ success: true, data: { merged: results.length, groups: results } });
    } catch (err: unknown) {
      log.error({ err }, 'Operation failed');
      res.status(500).json({ detail: '操作失败' });
    }
  },
);

// Get group detail
router.get('/api/model-groups/:id', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  const db = prisma;
  if (!db) {
    res.status(404).json({ detail: 'Not found' });
    return;
  }
  const groupId = routeParam(req.params.id);
  const group = await db.modelGroup.findUnique({
    where: { id: groupId },
    include: {
      primary: true,
      models: {
        select: {
          id: true,
          name: true,
          thumbnailUrl: true,
          originalName: true,
          originalFormat: true,
          originalSize: true,
          gltfUrl: true,
          createdAt: true,
          fileModifiedAt: true,
        },
      },
    },
  });
  if (!group) {
    res.status(404).json({ detail: '分组不存在' });
    return;
  }
  res.json({ success: true, data: group });
});

// Update group
router.put('/api/model-groups/:id', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  const { name, description, primaryId } = req.body;
  const db = prisma;
  if (!db) {
    respondDatabaseUnavailable(res);
    return;
  }
  const groupId = routeParam(req.params.id);
  const nextPrimaryId =
    primaryId === undefined || primaryId === null || typeof primaryId === 'string' ? primaryId : undefined;
  if (primaryId !== undefined && nextPrimaryId === undefined) {
    res.status(400).json({ detail: '主版本 ID 无效' });
    return;
  }
  try {
    if (nextPrimaryId !== undefined && nextPrimaryId !== null) {
      const member = await db.model.findFirst({
        where: { id: nextPrimaryId, groupId },
        select: { id: true },
      });
      if (!member) {
        res.status(400).json({ detail: '主版本必须是当前分组内的模型' });
        return;
      }
    }
    const group = await db.modelGroup.update({
      where: { id: groupId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(nextPrimaryId !== undefined && { primaryId: nextPrimaryId }),
      },
      include: {
        primary: { select: { id: true, name: true, thumbnailUrl: true } },
        models: {
          select: {
            id: true,
            name: true,
            thumbnailUrl: true,
            originalName: true,
            originalSize: true,
            createdAt: true,
            fileModifiedAt: true,
          },
          orderBy: [{ fileModifiedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        },
      },
    });
    const { cacheDelByPrefix, cacheDel } = await import('../lib/cache.js');
    await cacheDelByPrefix('cache:models:');
    await cacheDel('cache:model-groups:list');
    await clearCategoryCache();
    res.json({
      success: true,
      data: {
        id: group.id,
        name: group.name,
        description: group.description,
        primary: group.primary,
        model_count: group.models.length,
        models: group.models,
        created_at: group.createdAt,
      },
    });
  } catch (err: unknown) {
    log.error({ err }, 'Operation failed');
    res.status(500).json({ detail: '操作失败' });
  }
});

// Delete group (unlink all models, don't delete models)
router.delete(
  '/api/model-groups/:id',
  authMiddleware,
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const db = prisma;
    if (!db) {
      respondDatabaseUnavailable(res);
      return;
    }
    const groupId = routeParam(req.params.id);
    try {
      // Unlink models first
      await db.$transaction([
        db.model.updateMany({
          where: { groupId },
          data: { groupId: null },
        }),
        db.modelGroup.delete({ where: { id: groupId } }),
      ]);
      const { cacheDelByPrefix, cacheDel } = await import('../lib/cache.js');
      await cacheDelByPrefix('cache:models:');
      await cacheDel('cache:model-groups:list');
      await clearCategoryCache();
      res.json({ success: true });
    } catch (err: unknown) {
      log.error({ err }, 'Operation failed');
      res.status(500).json({ detail: '操作失败' });
    }
  },
);

// Add models to group
router.post(
  '/api/model-groups/:id/models',
  authMiddleware,
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const { modelIds } = req.body;
    if (!modelIds || !Array.isArray(modelIds)) {
      res.status(400).json({ detail: '需要 modelIds' });
      return;
    }
    if (modelIds.length > MAX_GROUP_MODEL_IDS) {
      res.status(400).json({ detail: `单次最多添加 ${MAX_GROUP_MODEL_IDS} 个模型` });
      return;
    }
    const db = prisma;
    if (!db) {
      respondDatabaseUnavailable(res);
      return;
    }
    const groupId = routeParam(req.params.id);
    try {
      const group = await db.modelGroup.findUnique({ where: { id: groupId } });
      if (!group) {
        res.status(404).json({ detail: '分组不存在' });
        return;
      }
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        const existingCount = await tx.model.count({ where: { groupId } });
        const alreadyInGroup = await tx.model.count({ where: { id: { in: modelIds }, groupId } });
        if (existingCount + modelIds.length - alreadyInGroup > MAX_GROUP_MODEL_IDS) {
          throw new Error(`EXCEEDS_LIMIT:${existingCount}`);
        }
        const oldGroups = await tx.model.findMany({
          where: { id: { in: modelIds }, groupId: { not: null } },
          select: { id: true, groupId: true },
        });
        await tx.model.updateMany({
          where: { id: { in: modelIds } },
          data: { groupId },
        });
        const affectedGroupIds = [
          ...new Set(oldGroups.map((m) => m.groupId).filter((id): id is string => Boolean(id))),
        ];
        for (const oldGroupId of affectedGroupIds) {
          const oldGroup = await tx.modelGroup.findUnique({ where: { id: oldGroupId } });
          if (oldGroup) {
            const remaining = await tx.model.count({ where: { groupId: oldGroupId } });
            if (remaining === 0) {
              await tx.modelGroup.delete({ where: { id: oldGroupId } });
            } else if (oldGroup.primaryId && modelIds.includes(oldGroup.primaryId)) {
              const newest = await tx.model.findFirst({
                where: { groupId: oldGroupId },
                orderBy: [{ fileModifiedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
                select: { id: true },
              });
              await tx.modelGroup.update({ where: { id: oldGroupId }, data: { primaryId: newest?.id || null } });
            }
          }
        }
      });
      const { cacheDelByPrefix, cacheDel } = await import('../lib/cache.js');
      await cacheDelByPrefix('cache:models:');
      await cacheDel('cache:model-groups:list');
      await clearCategoryCache();
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      if (msg.startsWith('EXCEEDS_LIMIT:')) {
        const current = msg.split(':')[1];
        res.status(400).json({ detail: `分组最多支持 ${MAX_GROUP_MODEL_IDS} 个模型，当前已有 ${current} 个` });
        return;
      }
      log.error({ err }, 'Operation failed');
      res.status(500).json({ detail: '操作失败' });
    }
  },
);

// Remove model from group
router.delete(
  '/api/model-groups/:id/models/:modelId',
  authMiddleware,
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const db = prisma;
    if (!db) {
      respondDatabaseUnavailable(res);
      return;
    }
    const groupId = routeParam(req.params.id);
    const modelId = routeParam(req.params.modelId);
    try {
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        const group = await tx.modelGroup.findUnique({
          where: { id: groupId },
          select: {
            id: true,
            primaryId: true,
            models: { select: { id: true, fileModifiedAt: true, createdAt: true } },
          },
        });
        if (!group) {
          throw new Error('NOT_FOUND');
        }
        const current = group.models.some((m) => m.id === modelId);
        if (!current) {
          throw new Error('NOT_IN_GROUP');
        }
        const remaining = group.models.filter((m) => m.id !== modelId);
        if (remaining.length === 0) {
          await tx.model.update({ where: { id: modelId }, data: { groupId: null } });
          await tx.modelGroup.delete({ where: { id: groupId } });
        } else {
          if (group.primaryId === modelId) {
            remaining.sort((a, b) => {
              const toTime = (m: (typeof remaining)[number]) =>
                m.fileModifiedAt ? new Date(m.fileModifiedAt).getTime() : new Date(m.createdAt).getTime();
              return toTime(b) - toTime(a);
            });
            await tx.modelGroup.update({
              where: { id: groupId },
              data: { primaryId: remaining[0]?.id ?? null },
            });
          }
          await tx.model.update({
            where: { id: modelId },
            data: { groupId: null },
          });
        }
      });
      const { cacheDelByPrefix, cacheDel } = await import('../lib/cache.js');
      await cacheDelByPrefix('cache:models:');
      await cacheDel('cache:model-groups:list');
      await clearCategoryCache();
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      if (msg === 'NOT_FOUND') {
        res.status(404).json({ detail: '分组不存在' });
        return;
      }
      if (msg === 'NOT_IN_GROUP') {
        res.status(404).json({ detail: '模型不在当前分组中' });
        return;
      }
      log.error({ err }, 'Operation failed');
      res.status(500).json({ detail: '操作失败' });
    }
  },
);

export default router;
