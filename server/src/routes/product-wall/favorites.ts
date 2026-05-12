import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';

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

  // Add favorite
  router.post('/api/product-wall/:id/favorite', authMiddleware, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ detail: '请先登录' });
        return;
      }
      const imageId = String(req.params.id);
      const image = await prisma.productWallImage.findUnique({ where: { id: imageId } });
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
