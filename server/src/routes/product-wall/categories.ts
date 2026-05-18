import { Router, Response } from 'express';
import { getErrorMessage } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import {
  requireAdmin,
  normalizeKind,
  toProductWallCategory,
  toProductWallItem,
  ensureProductWallData,
  queueProductWallPreviewBackfill,
} from './shared.js';

async function invalidateProductWallCache() {
  try {
    const { cacheDelByPrefix } = await import('../../lib/cache.js');
    await cacheDelByPrefix('cache:product-wall:');
  } catch {
    // cache unavailable — non-critical
  }
}

export function createCategoryRouter() {
  const router = Router();

  // Public: list categories
  router.get('/api/product-wall/categories', async (_req, res, next) => {
    try {
      await ensureProductWallData();
      const { cacheGetOrSet, TTL } = await import('../../lib/cache.js');
      const { value: data } = await cacheGetOrSet('cache:product-wall:categories', TTL.CATEGORIES, async () => {
        const rows = await prisma.productWallCategory.findMany({
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        return rows.map(toProductWallCategory);
      });
      res.set('Cache-Control', 'public, max-age=300');
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // Public: list approved items
  router.get('/api/product-wall', async (req, res, next) => {
    try {
      await ensureProductWallData();
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50));
      const cacheKey = `cache:product-wall:list:${page}:${pageSize}`;
      const { cacheGetOrSet, TTL } = await import('../../lib/cache.js');
      const { value: data } = await cacheGetOrSet(cacheKey, TTL.CATEGORIES, async () => {
        const where = { status: 'approved' };
        const [rows, total] = await Promise.all([
          prisma.productWallImage.findMany({
            where,
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          prisma.productWallImage.count({ where }),
        ]);
        queueProductWallPreviewBackfill(rows);
        return { items: rows.map(toProductWallItem), total, page, page_size: pageSize };
      });
      res.set('Cache-Control', 'public, max-age=60');
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // Admin: list all items
  router.get('/api/admin/product-wall', authMiddleware, requireAdmin, async (_req, res, next) => {
    try {
      await ensureProductWallData();
      const rows = await prisma.productWallImage.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      queueProductWallPreviewBackfill(rows);
      res.json(rows.map(toProductWallItem));
    } catch (err) {
      next(err);
    }
  });

  // Admin: list categories
  router.get('/api/admin/product-wall/categories', authMiddleware, requireAdmin, async (_req, res, next) => {
    try {
      await ensureProductWallData();
      const rows = await prisma.productWallCategory.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      res.json(rows.map(toProductWallCategory));
    } catch (err) {
      next(err);
    }
  });

  // Admin: create category
  router.post(
    '/api/admin/product-wall/categories',
    authMiddleware,
    requireAdmin,
    async (req: AuthRequest, res: Response, next) => {
      try {
        const name = normalizeKind(req.body?.name);
        const maxSort = await prisma.productWallCategory.aggregate({ _max: { sortOrder: true } });
        const row = await prisma.productWallCategory
          .create({
            data: { name, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 },
          })
          .catch(() => null);
        if (!row) {
          res.status(409).json({ detail: '分类名称已存在' });
          return;
        }
        res.json(toProductWallCategory(row));
        void invalidateProductWallCache();
      } catch (err) {
        next(err);
      }
    },
  );

  // Admin: update category
  router.put(
    '/api/admin/product-wall/categories/:id',
    authMiddleware,
    requireAdmin,
    async (req: AuthRequest, res: Response, next) => {
      try {
        const id = String(req.params.id);
        const existing = await prisma.productWallCategory.findUnique({ where: { id } });
        if (!existing) {
          res.status(404).json({ detail: '分类不存在' });
          return;
        }
        const nextName = req.body?.name !== undefined ? normalizeKind(req.body.name) : existing.name;
        const sortOrder = Number.isFinite(Number(req.body?.sortOrder))
          ? Number(req.body.sortOrder)
          : existing.sortOrder;
        const row = await prisma
          .$transaction(async (tx) => {
            const updated = await tx.productWallCategory.update({
              where: { id },
              data: { name: nextName, sortOrder },
            });
            if (nextName !== existing.name) {
              await tx.productWallImage.updateMany({
                where: { kind: existing.name },
                data: { kind: nextName },
              });
            }
            return updated;
          })
          .catch(() => null);
        if (!row) {
          res.status(409).json({ detail: '分类名称已存在' });
          return;
        }
        res.json(toProductWallCategory(row));
        void invalidateProductWallCache();
      } catch (err) {
        next(err);
      }
    },
  );

  // Admin: delete category
  router.delete(
    '/api/admin/product-wall/categories/:id',
    authMiddleware,
    requireAdmin,
    async (req: AuthRequest, res: Response, next) => {
      try {
        const id = String(req.params.id);
        await prisma.$transaction(async (tx) => {
          const existing = await tx.productWallCategory.findUnique({ where: { id } });
          if (!existing) throw Object.assign(new Error('NOT_FOUND'), { statusCode: 404 });
          const imageCount = await tx.productWallImage.count({ where: { kind: existing.name } });
          if (imageCount > 0)
            throw Object.assign(new Error(`分类下还有 ${imageCount} 张图片，请先移动或删除图片`), { statusCode: 409 });
          const categoryCount = await tx.productWallCategory.count();
          if (categoryCount <= 1) throw Object.assign(new Error('至少保留一个分类'), { statusCode: 400 });
          await tx.productWallCategory.delete({ where: { id } });
        });
        res.json({ ok: true });
        void invalidateProductWallCache();
      } catch (err: unknown) {
        const statusCode = err instanceof Error && 'statusCode' in err ? (err as any).statusCode : undefined;
        if (statusCode) {
          res.status(statusCode).json({ detail: getErrorMessage(err).replace(/^Error:\s*/, '') });
          return;
        }
        next(err);
      }
    },
  );

  return router;
}
