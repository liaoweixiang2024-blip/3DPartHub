import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { deleteCloudFiles, keyFromStaticUrl } from '../../lib/storageProvider.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import {
  requireAdmin,
  canUploadProductWall,
  normalizeKind,
  parseTags,
  safeTitle,
  safeDescription,
  requirePublicUploadMeta,
  toProductWallItem,
  MULTER_MAX_IMAGE_FILES,
  imageUpload,
  validateProductWallUploadFiles,
  createItemsFromUploadedFiles,
  createItemFromRemoteUrl,
  removeManagedImage,
} from './shared.js';

async function invalidateProductWallCache() {
  try {
    const { cacheDelByPrefix } = await import('../../lib/cache.js');
    await cacheDelByPrefix('cache:product-wall:');
  } catch {
    // cache unavailable — non-critical
  }
}

export function createItemRouter() {
  const router = Router();

  // Public: upload images
  router.post(
    '/api/product-wall/upload',
    authMiddleware,
    imageUpload.array('files', MULTER_MAX_IMAGE_FILES),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const files = (req.files || []) as Express.Multer.File[];
        if (!files.length) {
          res.status(400).json({ detail: '请选择图片、文件夹或 zip/rar 压缩包' });
          return;
        }
        if (req.user && !(await canUploadProductWall(req.user))) {
          res.status(403).json({ detail: '当前账号没有图库上传权限', code: 'PRODUCT_WALL_UPLOAD_DISABLED' });
          return;
        }
        await validateProductWallUploadFiles(files);
        if (!requirePublicUploadMeta(req, res, files)) return;
        const created = await createItemsFromUploadedFiles(
          req,
          files,
          req.user?.role === 'ADMIN' ? 'approved' : 'pending',
        );
        if (!created.length) {
          res.status(400).json({ detail: '没有识别到可上传的图片' });
          return;
        }
        res.json({ items: created });
        void invalidateProductWallCache();
      } catch (err) {
        next(err);
      }
    },
  );

  // Admin: upload images
  router.post(
    '/api/admin/product-wall/upload',
    authMiddleware,
    requireAdmin,
    imageUpload.array('files', MULTER_MAX_IMAGE_FILES),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const files = (req.files || []) as Express.Multer.File[];
        if (!files.length) {
          res.status(400).json({ detail: '请选择图片、文件夹或 zip/rar 压缩包' });
          return;
        }
        await validateProductWallUploadFiles(files);
        const created = await createItemsFromUploadedFiles(req, files, 'approved');
        if (!created.length) {
          res.status(400).json({ detail: '没有识别到可上传的图片' });
          return;
        }
        res.json({ items: created });
        void invalidateProductWallCache();
      } catch (err) {
        next(err);
      }
    },
  );

  // Public: create from URL
  router.post('/api/product-wall/from-url', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (req.user && !(await canUploadProductWall(req.user))) {
      res.status(403).json({ detail: '当前账号没有图库上传权限', code: 'PRODUCT_WALL_UPLOAD_DISABLED' });
      return;
    }
    if (!requirePublicUploadMeta(req, res)) return;
    await createItemFromRemoteUrl(req, res, req.user?.role === 'ADMIN' ? 'approved' : 'pending');
  });

  // Admin: create from URL
  router.post(
    '/api/admin/product-wall/from-url',
    authMiddleware,
    requireAdmin,
    async (req: AuthRequest, res: Response) => {
      await createItemFromRemoteUrl(req, res, 'approved');
    },
  );

  // Admin: review item
  router.patch(
    '/api/admin/product-wall/:id/review',
    authMiddleware,
    requireAdmin,
    async (req: AuthRequest, res: Response, next) => {
      try {
        const id = String(req.params.id);
        const rawStatus = req.body?.status;
        if (rawStatus !== 'approved' && rawStatus !== 'rejected') {
          res.status(400).json({ detail: '状态只能是 approved 或 rejected' });
          return;
        }
        const existingForReview = await prisma.productWallImage.findFirst({ where: { id, deletedAt: null } });
        if (!existingForReview) {
          res.status(404).json({ detail: '图片不存在' });
          return;
        }
        const status = rawStatus as 'pending' | 'approved' | 'rejected';
        const item = await prisma.productWallImage
          .update({
            where: { id },
            data: {
              status,
              reviewedAt: new Date(),
              reviewedById: req.user?.userId,
              rejectReason: status === 'rejected' ? safeTitle(req.body?.rejectReason, '未通过审核') : null,
            },
          })
          .catch(() => null);
        if (!item) {
          res.status(404).json({ detail: '图片不存在' });
          return;
        }
        res.json(toProductWallItem(item));
        void invalidateProductWallCache();
      } catch (err) {
        next(err);
      }
    },
  );

  // Admin: update item
  router.put(
    '/api/admin/product-wall/:id',
    authMiddleware,
    requireAdmin,
    async (req: AuthRequest, res: Response, next) => {
      try {
        const id = String(req.params.id);
        const existing = await prisma.productWallImage.findFirst({ where: { id, deletedAt: null } });
        if (!existing) {
          res.status(404).json({ detail: '图片不存在' });
          return;
        }
        const item = await prisma.productWallImage.update({
          where: { id },
          data: {
            title: req.body?.title !== undefined ? safeTitle(req.body.title, existing.title) : undefined,
            description:
              req.body?.description !== undefined ? safeDescription(req.body.description) || null : undefined,
            kind: req.body?.kind !== undefined ? normalizeKind(req.body.kind) : undefined,
            tags: req.body?.tags !== undefined ? parseTags(req.body.tags, existing.title) : undefined,
            sortOrder: Number.isFinite(Number(req.body?.sortOrder))
              ? Math.min(2147483647, Math.max(-2147483648, Math.trunc(Number(req.body?.sortOrder) || 0)))
              : undefined,
          },
        });
        res.json(toProductWallItem(item));
        void invalidateProductWallCache();
      } catch (err) {
        next(err);
      }
    },
  );

  // Admin: batch delete
  router.post(
    '/api/admin/product-wall/batch-delete',
    authMiddleware,
    requireAdmin,
    async (req: AuthRequest, res: Response, next) => {
      try {
        const ids: string[] = Array.isArray(req.body?.ids)
          ? Array.from(new Set(req.body.ids.map((id: unknown) => String(id))))
          : [];
        if (!ids.length) {
          res.status(400).json({ detail: '请选择要删除的图片' });
          return;
        }
        if (ids.length > 200) {
          res.status(400).json({ detail: '单次最多删除 200 张图片' });
          return;
        }
        // 软删除：进回收站（保留文件），30 天内可恢复
        const result = await prisma.productWallImage.updateMany({
          where: { id: { in: ids }, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        res.json({ ok: true, deleted: result.count });
        void invalidateProductWallCache();
      } catch (err) {
        next(err);
      }
    },
  );

  // Admin: batch move items to another category (kind)
  router.post(
    '/api/admin/product-wall/batch-update-kind',
    authMiddleware,
    requireAdmin,
    async (req: AuthRequest, res: Response, next) => {
      try {
        const ids: string[] = Array.isArray(req.body?.ids)
          ? Array.from(new Set(req.body.ids.map((id: unknown) => String(id))))
          : [];
        if (!ids.length) {
          res.status(400).json({ detail: '请选择要移动的图片' });
          return;
        }
        if (ids.length > 200) {
          res.status(400).json({ detail: '单次最多移动 200 张图片' });
          return;
        }
        const kind = normalizeKind(req.body?.kind);
        const result = await prisma.productWallImage.updateMany({
          where: { id: { in: ids } },
          data: { kind },
        });
        res.json({ ok: true, updated: result.count, kind });
        void invalidateProductWallCache();
      } catch (err) {
        next(err);
      }
    },
  );

  // Admin: delete single item
  router.delete(
    '/api/admin/product-wall/:id',
    authMiddleware,
    requireAdmin,
    async (req: AuthRequest, res: Response, next) => {
      try {
        const id = String(req.params.id);
        const target = await prisma.productWallImage.findFirst({ where: { id, deletedAt: null } });
        if (!target) {
          res.status(404).json({ detail: '图片不存在' });
          return;
        }
        // 软删除：进回收站（保留文件），30 天内可恢复，也可在回收站彻底删除
        await prisma.productWallImage.update({ where: { id }, data: { deletedAt: new Date() } });
        res.json({ ok: true });
        void invalidateProductWallCache();
      } catch (err) {
        next(err);
      }
    },
  );

  // Admin: restore items from trash
  router.post(
    '/api/admin/product-wall/restore',
    authMiddleware,
    requireAdmin,
    async (req: AuthRequest, res: Response, next) => {
      try {
        const ids: string[] = Array.isArray(req.body?.ids)
          ? Array.from(new Set(req.body.ids.map((id: unknown) => String(id))))
          : [];
        if (!ids.length) {
          res.status(400).json({ detail: '请选择要恢复的图片' });
          return;
        }
        if (ids.length > 200) {
          res.status(400).json({ detail: '单次最多恢复 200 张图片' });
          return;
        }
        // 恢复时若原分类已被删除，回落到当前第一个分类，避免悬挂分类名
        const categories = await prisma.productWallCategory.findMany({
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          take: 1,
        });
        const fallbackKind = categories[0]?.name || '公司产品';
        const targets = await prisma.productWallImage.findMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
          select: { id: true, kind: true },
        });
        let restored = 0;
        for (const target of targets) {
          const kindExists =
            fallbackKind === target.kind ||
            (await prisma.productWallCategory.findFirst({ where: { name: target.kind } })) != null;
          await prisma.productWallImage.update({
            where: { id: target.id },
            data: { deletedAt: null, kind: kindExists ? target.kind : fallbackKind },
          });
          restored += 1;
        }
        res.json({ ok: true, restored });
        void invalidateProductWallCache();
      } catch (err) {
        next(err);
      }
    },
  );

  // Admin: purge trashed items permanently (delete files + rows)
  router.post(
    '/api/admin/product-wall/purge',
    authMiddleware,
    requireAdmin,
    async (req: AuthRequest, res: Response, next) => {
      try {
        const ids: string[] = Array.isArray(req.body?.ids)
          ? Array.from(new Set(req.body.ids.map((id: unknown) => String(id))))
          : [];
        if (!ids.length) {
          res.status(400).json({ detail: '请选择要彻底删除的图片' });
          return;
        }
        if (ids.length > 200) {
          res.status(400).json({ detail: '单次最多彻底删除 200 张图片' });
          return;
        }
        const targets = await prisma.productWallImage.findMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        await prisma.productWallImage.deleteMany({ where: { id: { in: targets.map((t) => t.id) } } });
        for (const item of targets) {
          removeManagedImage(item.imageUrl);
          removeManagedImage(item.previewImageUrl);
        }
        await deleteCloudFiles(
          targets
            .flatMap((item) => [item.imageUrl, item.previewImageUrl])
            .filter((u): u is string => u != null && u.startsWith('/static/'))
            .map((u) => keyFromStaticUrl(u.split('?')[0])),
        );
        res.json({ ok: true, purged: targets.length });
        void invalidateProductWallCache();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
