import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { clearCategoryCache } from './common.js';

export function createAdminCategoriesRouter() {
  const router = Router();

  router.post('/api/categories', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
    const { name, icon, parentId, sortOrder } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ detail: '分类名称不能为空' });
      return;
    }
    if (name.length > 50) {
      res.status(400).json({ detail: '分类名称不能超过50个字符' });
      return;
    }

    try {
      const category = await prisma.category.create({
        data: {
          name: name.trim(),
          icon: icon || 'folder',
          parentId: parentId || null,
          sortOrder: sortOrder ?? 0,
        },
      });
      await clearCategoryCache();
      res.json({ data: category });
    } catch {
      res.status(500).json({ detail: '创建分类失败' });
    }
  });

  router.put(
    '/api/categories/reorder',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const { items }: { items: { id: string; sortOrder: number }[] } = req.body;

      if (!Array.isArray(items)) {
        res.status(400).json({ detail: '参数格式错误' });
        return;
      }
      if (items.length > 500) {
        res.status(400).json({ detail: '排序数组长度不能超过 500' });
        return;
      }

      try {
        await prisma.$transaction(
          items.map((item) =>
            prisma.category.update({
              where: { id: item.id },
              data: { sortOrder: item.sortOrder },
            }),
          ),
        );
        await clearCategoryCache();
        res.json({ message: '排序已更新' });
      } catch {
        res.status(500).json({ detail: '排序更新失败' });
      }
    },
  );

  router.put('/api/categories/:id', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { name, icon, parentId, sortOrder } = req.body;

    try {
      if (parentId) {
        let current: string | null = parentId;
        const visited = new Set<string>();
        while (current) {
          if (current === id) {
            res.status(400).json({ detail: '不能将分类设置为自己的子分类' });
            return;
          }
          if (visited.has(current)) break;
          visited.add(current);
          const parent = await prisma.category.findUnique({ where: { id: current }, select: { parentId: true } });
          current = parent?.parentId ?? null;
        }
      }

      const category = await prisma.category.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(icon !== undefined && { icon }),
          ...(parentId !== undefined && { parentId: parentId || null }),
          ...(sortOrder !== undefined && { sortOrder }),
        },
      });
      await clearCategoryCache();
      res.json({ data: category });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ detail: '分类不存在' });
        return;
      }
      res.status(500).json({ detail: '更新分类失败' });
    }
  });

  router.delete(
    '/api/categories/:id',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const id = req.params.id as string;

      try {
        await prisma.$transaction(async (tx: any) => {
          const childCount = await tx.category.count({ where: { parentId: id } });
          if (childCount > 0) {
            throw Object.assign(new Error('HAS_CHILDREN'), { code: 'HAS_CHILDREN' });
          }
          const modelCount = await tx.model.count({ where: { categoryId: id } });
          if (modelCount > 0) {
            throw Object.assign(new Error('HAS_MODELS'), { code: 'HAS_MODELS' });
          }
          await tx.category.delete({ where: { id } });
        });
        await clearCategoryCache();
        res.json({ message: '分类已删除' });
      } catch (err: any) {
        if (err.code === 'P2025') {
          res.status(404).json({ detail: '分类不存在' });
          return;
        }
        if (err.code === 'HAS_CHILDREN') {
          res.status(400).json({ detail: '请先删除子分类' });
          return;
        }
        if (err.code === 'HAS_MODELS') {
          res.status(400).json({ detail: '该分类下还有模型，请先移动或删除' });
          return;
        }
        res.status(500).json({ detail: '删除分类失败' });
      }
    },
  );

  return router;
}
