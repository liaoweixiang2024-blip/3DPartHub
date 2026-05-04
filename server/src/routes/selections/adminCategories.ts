import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { adminOnly, asSingleString, invalidateSelectionCache, isValidGroupImageFit } from './common.js';
import { logger } from '../../lib/logger.js';

export function createSelectionAdminCategoriesRouter() {
  const router = Router();

  // Create category
  router.post('/api/admin/selections/categories', authMiddleware, async (req: AuthRequest, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const {
        name,
        slug,
        description,
        icon,
        sortOrder,
        columns,
        image,
        optionImages,
        optionOrder,
        groupId,
        groupName,
        groupIcon,
        groupImage,
        groupImageFit,
        kind,
        catalogPdf,
        catalogShared,
        optionCatalogs,
      } = req.body;
      if (!name || !slug) {
        res.status(400).json({ detail: '分类名称和标识不能为空' });
        return;
      }
      if (!Array.isArray(columns)) {
        res.status(400).json({ detail: 'columns 必须是数组' });
        return;
      }
      if (groupImageFit !== undefined && !isValidGroupImageFit(groupImageFit)) {
        res.status(400).json({ detail: '分组封面展示方式无效' });
        return;
      }

      const category = await prisma.selectionCategory.create({
        data: {
          name,
          slug,
          description,
          icon,
          sortOrder: sortOrder ?? 0,
          columns,
          image,
          optionImages,
          optionOrder,
          groupId,
          groupName,
          groupIcon,
          groupImage,
          groupImageFit,
          kind,
          catalogPdf: catalogPdf || null,
          catalogShared: catalogShared ?? false,
          optionCatalogs: optionCatalogs || null,
        },
      });
      await invalidateSelectionCache();
      res.status(201).json(category);
    } catch (err: any) {
      if (err.code === 'P2002') {
        res.status(409).json({ detail: 'slug 已存在' });
        return;
      }
      logger.error({ err }, '[Selections] Create category error');
      res.status(500).json({ detail: '创建分类失败' });
    }
  });

  // Update category
  router.put('/api/admin/selections/categories/:id', authMiddleware, async (req: AuthRequest, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = req.params.id as string;
      const {
        name,
        slug,
        description,
        icon,
        sortOrder,
        columns,
        image,
        optionImages,
        optionOrder,
        groupId,
        groupName,
        groupIcon,
        groupImage,
        groupImageFit,
        kind,
        catalogPdf,
        catalogShared,
        optionCatalogs,
      } = req.body;
      const data: any = {};
      if (name !== undefined) data.name = name;
      if (slug !== undefined) data.slug = slug;
      if (description !== undefined) data.description = description;
      if (icon !== undefined) data.icon = icon;
      if (sortOrder !== undefined) data.sortOrder = sortOrder;
      if (columns !== undefined) {
        if (!Array.isArray(columns)) {
          res.status(400).json({ detail: 'columns 必须是数组' });
          return;
        }
        data.columns = columns;
      }
      if (image !== undefined) data.image = image;
      if (optionImages !== undefined) data.optionImages = optionImages;
      if (optionOrder !== undefined) data.optionOrder = optionOrder;
      if (groupId !== undefined) data.groupId = groupId;
      if (groupName !== undefined) data.groupName = groupName;
      if (groupIcon !== undefined) data.groupIcon = groupIcon;
      if (groupImage !== undefined) data.groupImage = groupImage;
      if (groupImageFit !== undefined) {
        if (!isValidGroupImageFit(groupImageFit)) {
          res.status(400).json({ detail: '分组封面展示方式无效' });
          return;
        }
        data.groupImageFit = groupImageFit;
      }
      if (kind !== undefined) data.kind = kind;
      if (catalogPdf !== undefined) data.catalogPdf = catalogPdf || null;
      if (catalogShared !== undefined) data.catalogShared = Boolean(catalogShared);
      if (optionCatalogs !== undefined) data.optionCatalogs = optionCatalogs || null;

      const category = await prisma.selectionCategory.update({
        where: { id },
        data,
      });
      await invalidateSelectionCache();
      res.json(category);
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ detail: '分类不存在' });
        return;
      }
      logger.error({ err }, '[Selections] Update category error');
      if (err.code === 'P2022') {
        res.status(500).json({ detail: '数据库字段缺失，请执行迁移并重启服务后再试' });
        return;
      }
      res.status(500).json({ detail: '更新分类失败' });
    }
  });

  // Delete category
  router.delete('/api/admin/selections/categories/:id', authMiddleware, async (req: AuthRequest, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = req.params.id as string;
      const category = await prisma.selectionCategory.findUnique({ where: { id } });
      if (!category) {
        res.status(404).json({ detail: '分类不存在' });
        return;
      }
      await prisma.selectionShare.deleteMany({ where: { categorySlug: category.slug } });
      await prisma.selectionProduct.deleteMany({ where: { categoryId: id } });
      await prisma.selectionCategory.delete({ where: { id } });
      await invalidateSelectionCache();
      res.json({ ok: true });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ detail: '分类不存在' });
        return;
      }
      logger.error({ err }, '[Selections] Delete category error');
      res.status(500).json({ detail: '删除分类失败' });
    }
  });

  // Sort categories
  router.put('/api/admin/selections/categories-sort', authMiddleware, async (req: AuthRequest, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const { items }: { items: { id: string; sortOrder: number }[] } = req.body;
      if (!Array.isArray(items)) {
        res.status(400).json({ detail: 'items 必须是数组' });
        return;
      }
      if (items.length > 500) {
        res.status(400).json({ detail: '排序数组长度不能超过 500' });
        return;
      }
      await prisma.$transaction(
        items.map((item) =>
          prisma.selectionCategory.update({
            where: { id: item.id },
            data: { sortOrder: item.sortOrder },
          }),
        ),
      );
      await invalidateSelectionCache();
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, '[Selections] Sort categories error');
      res.status(500).json({ detail: '排序失败' });
    }
  });

  // Batch rename option value across all products in a category
  router.put(
    '/api/admin/selections/categories/:id/rename-option',
    authMiddleware,
    async (req: AuthRequest, res: Response) => {
      if (!adminOnly(req, res)) return;
      try {
        const id = asSingleString(req.params.id);
        const { field, oldValue, newValue } = req.body;
        if (!id) {
          res.status(400).json({ detail: '分类参数无效' });
          return;
        }
        if (!field || !oldValue || !newValue) {
          res.status(400).json({ detail: '缺少参数' });
          return;
        }
        if (oldValue === newValue) {
          res.json({ updated: 0 });
          return;
        }

        // Find category to get product scope
        const category = await prisma.selectionCategory.findUnique({ where: { id } });
        if (!category) {
          res.status(404).json({ detail: '分类不存在' });
          return;
        }

        // Batch update products
        const updated = await prisma.$transaction(async (tx: any) => {
          const products = await tx.selectionProduct.findMany({
            where: { categoryId: id },
            select: { id: true, specs: true },
          });

          const optImages = category.optionImages as Record<string, Record<string, string>> | null;

          let count = 0;
          const updateOps = [];
          for (const p of products) {
            const specs = p.specs as Record<string, string>;
            if (specs[field] === oldValue) {
              specs[field] = newValue;
              updateOps.push(
                tx.selectionProduct.update({
                  where: { id: p.id },
                  data: { specs },
                }),
              );
              count++;
            }
          }

          if (optImages?.[field]?.[oldValue] !== undefined) {
            const updatedImages = { ...optImages };
            updatedImages[field] = { ...updatedImages[field] };
            updatedImages[field][newValue] = updatedImages[field][oldValue];
            delete updatedImages[field][oldValue];
            updateOps.push(
              tx.selectionCategory.update({
                where: { id },
                data: { optionImages: updatedImages },
              }),
            );
          }

          if (updateOps.length > 0) {
            await Promise.all(updateOps);
          }

          return count;
        });

        if (updated > 0) {
          await invalidateSelectionCache();
        }
        res.json({ updated });
      } catch (err) {
        logger.error({ err }, '[Selections] Rename option error');
        res.status(500).json({ detail: '修改失败' });
      }
    },
  );

  return router;
}
