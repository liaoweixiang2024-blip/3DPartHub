import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { toProductWallItem } from './shared.js';

export function createFavoriteRouter() {
  const router = Router();

  // List user's favorites
  router.get('/api/product-wall/favorites', authMiddleware, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ detail: '请先登录' });
        return;
      }
      const rows = await prisma.productWallImageFavorite.findMany({
        where: { userId },
        select: { imageId: true },
      });
      res.json(rows.map((r) => r.imageId));
    } catch (err) {
      next(err);
    }
  });

  // List user's favorite images (paginated, approved only, newest favorite first)
  router.get('/api/product-wall/favorites/items', authMiddleware, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ detail: '请先登录' });
        return;
      }
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50));
      const where = { userId, image: { status: 'approved' as const, deletedAt: null } };
      const [favorites, total] = await Promise.all([
        prisma.productWallImageFavorite.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: { imageId: true },
        }),
        prisma.productWallImageFavorite.count({ where }),
      ]);
      const imageIds = favorites.map((row) => row.imageId);
      const rows = imageIds.length ? await prisma.productWallImage.findMany({ where: { id: { in: imageIds } } }) : [];
      const byId = new Map(rows.map((row) => [row.id, row]));
      const items = imageIds
        .map((id) => byId.get(id))
        .filter((row) => row != null)
        .map(toProductWallItem);
      res.json({ items, total, page, page_size: pageSize });
    } catch (err) {
      next(err);
    }
  });

  // Add favorite
  router.post('/api/product-wall/:id/favorite', authMiddleware, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ detail: '请先登录' });
        return;
      }
      const imageId = String(req.params.id);
      const image = await prisma.productWallImage.findFirst({ where: { id: imageId, deletedAt: null } });
      if (!image) {
        res.status(404).json({ detail: '图片不存在' });
        return;
      }
      await prisma.productWallImageFavorite.upsert({
        where: { userId_imageId: { userId, imageId } },
        update: {},
        create: { userId, imageId },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Remove favorite
  router.delete('/api/product-wall/:id/favorite', authMiddleware, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ detail: '请先登录' });
        return;
      }
      const imageId = String(req.params.id);
      await prisma.productWallImageFavorite.deleteMany({
        where: { userId, imageId },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
