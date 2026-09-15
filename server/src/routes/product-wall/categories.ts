import type { Prisma } from '@prisma/client';
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
  sweepExpiredProductWallTrash,
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

  // Public: list approved items (supports kind filter + title/description search)
  router.get('/api/product-wall', async (req, res, next) => {
    try {
      await ensureProductWallData();
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50));
      const kind = typeof req.query.kind === 'string' && req.query.kind.trim() ? req.query.kind.trim() : '';
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
      const cacheKey = `cache:product-wall:list:${kind || 'all'}:${encodeURIComponent(q).slice(0, 60)}:${page}:${pageSize}`;
      const { cacheGetOrSet, TTL } = await import('../../lib/cache.js');
      const { value: data } = await cacheGetOrSet(cacheKey, TTL.CATEGORIES, async () => {
        const where: Prisma.ProductWallImageWhereInput = { status: 'approved', deletedAt: null };
        if (kind) where.kind = kind;
        if (q) {
          where.OR = [
            { title: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
          ];
        }
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

  // Public: approved counts (total + per kind) for filter tabs
  router.get('/api/product-wall/counts', async (_req, res, next) => {
    try {
      await ensureProductWallData();
      const { cacheGetOrSet, TTL } = await import('../../lib/cache.js');
      const { value: data } = await cacheGetOrSet('cache:product-wall:counts', TTL.CATEGORIES, async () => {
        const groups = await prisma.productWallImage.groupBy({
          by: ['kind'],
          where: { status: 'approved', deletedAt: null },
          _count: { _all: true },
        });
        const byKind: Record<string, number> = {};
        let total = 0;
        for (const group of groups) {
          const count = group._count._all;
          byKind[group.kind] = count;
          total += count;
        }
        return { total, byKind };
      });
      res.set('Cache-Control', 'public, max-age=60');
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // Admin: list items (paginated, filterable by status/kind/search)
  router.get('/api/admin/product-wall', authMiddleware, requireAdmin, async (req, res, next) => {
    try {
      await ensureProductWallData();
      // 访问回收站时顺带清理过期（30 天）记录，fire-and-forget 不阻塞响应
      if (String(req.query.status || '') === 'trash') void sweepExpiredProductWallTrash();
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 40));
      const rawStatus = String(req.query.status || 'all');
      const status =
        rawStatus === 'pending' || rawStatus === 'approved' || rawStatus === 'rejected' || rawStatus === 'trash'
          ? rawStatus
          : 'all';
      const kind = typeof req.query.kind === 'string' && req.query.kind.trim() ? req.query.kind.trim() : '';
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
      const where: Prisma.ProductWallImageWhereInput =
        status === 'trash' ? { deletedAt: { not: null } } : { deletedAt: null };
      if (status !== 'all' && status !== 'trash') where.status = status;
      if (kind) where.kind = kind;
      if (q) {
        where.OR = [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ];
      }
      const [rows, total, statusGroups, trashCount] = await Promise.all([
        prisma.productWallImage.findMany({
          where,
          orderBy: status === 'trash' ? { deletedAt: 'desc' } : [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.productWallImage.count({ where }),
        prisma.productWallImage.groupBy({ by: ['status'], _count: { _all: true }, where: { deletedAt: null } }),
        prisma.productWallImage.count({ where: { deletedAt: { not: null } } }),
      ]);
      const counts: Record<string, number> = { all: 0, pending: 0, approved: 0, rejected: 0, trash: trashCount };
      for (const group of statusGroups) {
        counts[group.status] = group._count._all;
        counts.all += group._count._all;
      }
      if (status !== 'trash') queueProductWallPreviewBackfill(rows);
      res.json({ items: rows.map(toProductWallItem), total, page, page_size: pageSize, counts });
    } catch (err) {
      next(err);
    }
  });

  // Admin: resolve upload whitelist users (display names for the settings UI)
  router.get('/api/admin/product-wall/upload-whitelist', authMiddleware, requireAdmin, async (_req, res, next) => {
    try {
      const { getSetting } = await import('../../lib/settings.js');
      const raw = String((await getSetting<string>('product_wall_upload_allowed_user_ids')) ?? '');
      const ids = Array.from(
        new Set(
          raw
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      );
      if (!ids.length) {
        res.json({ users: [] });
        return;
      }
      const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, username: true, email: true, role: true, disabled: true },
      });
      res.json({ users });
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
        const statusCode =
          err instanceof Error && 'statusCode' in err && typeof err.statusCode === 'number'
            ? err.statusCode
            : undefined;
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
