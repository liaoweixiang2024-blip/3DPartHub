import { Router, Response } from 'express';
import { cacheDelByPrefix } from '../../lib/cache.js';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { clearCategoryCache } from './common.js';

const ALLOWED_CATEGORY_ROLES = ['EDITOR', 'VIEWER', 'INTERNAL'] as const;
const MAX_ALLOWED_USERS = 100;

/** 校验并规整访问限制三字段；非法输入返回错误文案，合法返回规整后的值 */
async function normalizeAccessFields(
  body: Record<string, unknown>,
): Promise<
  | { ok: true; data: { restricted?: boolean; allowedRoles?: string[]; allowedUserIds?: string[] } }
  | { ok: false; detail: string }
> {
  const result: { restricted?: boolean; allowedRoles?: string[]; allowedUserIds?: string[] } = {};

  if (body.restricted !== undefined) {
    if (typeof body.restricted !== 'boolean') return { ok: false, detail: '访问限制开关必须为布尔值' };
    result.restricted = body.restricted;
  }

  if (body.allowedRoles !== undefined) {
    if (!Array.isArray(body.allowedRoles)) return { ok: false, detail: '允许角色格式错误' };
    const roles = [...new Set(body.allowedRoles.filter((r): r is string => typeof r === 'string'))];
    if (roles.some((r) => !(ALLOWED_CATEGORY_ROLES as readonly string[]).includes(r))) {
      return { ok: false, detail: `允许角色只能是 ${ALLOWED_CATEGORY_ROLES.join(' / ')}` };
    }
    result.allowedRoles = roles;
  }

  if (body.allowedUserIds !== undefined) {
    if (!Array.isArray(body.allowedUserIds)) return { ok: false, detail: '允许用户格式错误' };
    const ids = [
      ...new Set(
        body.allowedUserIds.filter((u): u is string => typeof u === 'string' && Boolean(u.trim())).map((u) => u.trim()),
      ),
    ];
    if (ids.length > MAX_ALLOWED_USERS) {
      return { ok: false, detail: `允许用户最多 ${MAX_ALLOWED_USERS} 个` };
    }
    if (ids.length > 0) {
      // 校验存在性：不存在的用户直接剔除（用户被删后白名单残留无效 id 属正常情况）
      const existing = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
      const existingSet = new Set(existing.map((u) => u.id));
      result.allowedUserIds = ids.filter((id) => existingSet.has(id));
    } else {
      result.allowedUserIds = [];
    }
  }

  return { ok: true, data: result };
}

/** 权限字段变更后要失效模型/收藏缓存（列表内容按可见性分桶） */
async function clearAccessCaches() {
  await clearCategoryCache();
  await cacheDelByPrefix('cache:models:');
  await cacheDelByPrefix('cache:favorites:');
}

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
    const access = await normalizeAccessFields(req.body as Record<string, unknown>);
    if (!access.ok) {
      res.status(400).json({ detail: access.detail });
      return;
    }

    try {
      const category = await prisma.category.create({
        data: {
          name: name.trim(),
          icon: icon || 'folder',
          parentId: parentId || null,
          sortOrder: sortOrder ?? 0,
          ...access.data,
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

    const access = await normalizeAccessFields(req.body as Record<string, unknown>);
    if (!access.ok) {
      res.status(400).json({ detail: access.detail });
      return;
    }
    const accessChanged =
      access.data.restricted !== undefined ||
      access.data.allowedRoles !== undefined ||
      access.data.allowedUserIds !== undefined;

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
          ...access.data,
        },
      });
      if (accessChanged) {
        await clearAccessCaches();
      } else {
        await clearCategoryCache();
      }
      res.json({ data: category });
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'P2025') {
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
        await prisma.$transaction(async (tx) => {
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
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'P2025') {
          res.status(404).json({ detail: '分类不存在' });
          return;
        }
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'HAS_CHILDREN') {
          res.status(400).json({ detail: '请先删除子分类' });
          return;
        }
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'HAS_MODELS') {
          res.status(400).json({ detail: '该分类下还有模型，请先移动或删除' });
          return;
        }
        res.status(500).json({ detail: '删除分类失败' });
      }
    },
  );

  return router;
}
