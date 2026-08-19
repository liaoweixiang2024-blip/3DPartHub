import type { Prisma } from '@prisma/client';
import { Router, Response } from 'express';
import { getBusinessConfig } from '../../lib/businessConfig.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { adminOnly, asSingleString, buildSelectionShareNameMap, hasSelectionSharesTable } from './common.js';

type AdminShareItem = {
  id: string;
  rawId: string;
  type: 'model' | 'selection';
  token: string;
  modelId: string | null;
  modelName: string;
  createdById: string;
  createdByUsername: string;
  allowPreview: boolean;
  allowDownload: boolean;
  downloadLimit: number;
  downloadCount: number;
  viewCount: number;
  hasPassword: boolean;
  expiresAt: Date | null;
  createdAt: Date;
};

type AdminShareFilter = 'all' | 'model' | 'selection' | 'active' | 'expired';

function parseAdminShareId(value: string): { type: 'model' | 'selection'; id: string } {
  if (value.startsWith('model:')) return { type: 'model', id: value.slice('model:'.length) };
  if (value.startsWith('selection:')) return { type: 'selection', id: value.slice('selection:'.length) };
  return { type: 'model', id: value };
}

function parseAdminShareFilter(value: unknown): AdminShareFilter {
  const filter = String(value || 'all');
  if (filter === 'model' || filter === 'selection' || filter === 'active' || filter === 'expired') return filter;
  return 'all';
}

const ADMIN_SHARE_LINK_SELECT = {
  id: true,
  modelId: true,
  token: true,
  allowPreview: true,
  allowDownload: true,
  downloadLimit: true,
  downloadCount: true,
  viewCount: true,
  password: true,
  expiresAt: true,
  createdAt: true,
  createdById: true,
} satisfies Prisma.ShareLinkSelect;

export function createAdminSharesRouter() {
  const router = Router();

  // Admin: list all shares
  router.get('/api/admin/shares', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const { pageSizePolicy } = await getBusinessConfig();
      const defaultPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.shareAdminDefault) || 20));
      const maxPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.shareAdminMax) || 100));
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(maxPageSize, Math.max(1, Number(req.query.page_size) || defaultPageSize));
      const search = String(req.query.search || '').trim();
      const searchText = search.toLowerCase();
      const filter = parseAdminShareFilter(req.query.filter);
      const now = new Date();

      const modelFilters: Prisma.ShareLinkWhereInput[] = [];
      if (search) {
        modelFilters.push({
          OR: [
            { model: { name: { contains: search, mode: 'insensitive' as const } } },
            { model: { originalName: { contains: search, mode: 'insensitive' as const } } },
            { createdBy: { username: { contains: search, mode: 'insensitive' as const } } },
            { token: { contains: search, mode: 'insensitive' as const } },
            { id: { contains: search, mode: 'insensitive' as const } },
          ],
        });
      }
      if (filter === 'active') {
        modelFilters.push({ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] });
      } else if (filter === 'expired') {
        modelFilters.push({ expiresAt: { not: null, lt: now } });
      }
      const modelWhere: Prisma.ShareLinkWhereInput = modelFilters.length ? { AND: modelFilters } : {};
      const hasSelectionShares = await hasSelectionSharesTable();

      const [modelRows, selectionRows] = await Promise.all([
        filter === 'selection'
          ? Promise.resolve([])
          : prisma.shareLink.findMany({
              where: modelWhere,
              select: ADMIN_SHARE_LINK_SELECT,
              orderBy: { createdAt: 'desc' },
            }),
        filter === 'model' || filter === 'expired' || !hasSelectionShares
          ? Promise.resolve([])
          : prisma.selectionShare.findMany({
              // autoCreated=true 是提交工单时自动生成的选型快照，不算用户主动分享，管理列表不展示
              where: { autoCreated: false },
              orderBy: { createdAt: 'desc' },
            }),
      ]);

      const modelIds = Array.from(new Set(modelRows.map((row) => row.modelId).filter(Boolean)));
      const userIds = Array.from(
        new Set(
          [...modelRows.map((row) => row.createdById), ...selectionRows.map((row) => row.createdById)].filter(Boolean),
        ),
      );
      const [models, users] = await Promise.all([
        modelIds.length
          ? prisma.model.findMany({
              where: { id: { in: modelIds } },
              select: { id: true, name: true, originalName: true },
            })
          : Promise.resolve([]),
        userIds.length
          ? prisma.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, username: true },
            })
          : Promise.resolve([]),
      ]);
      const modelMap = new Map(models.map((model) => [model.id, model]));
      const userMap = new Map(users.map((user) => [user.id, user]));

      const selectionSlugs = Array.from(new Set(selectionRows.map((row) => row.categorySlug).filter(Boolean)));
      const selectionCategories = selectionSlugs.length
        ? await prisma.selectionCategory.findMany({
            where: { slug: { in: selectionSlugs } },
            select: { slug: true, name: true },
          })
        : [];
      const selectionCategoryMap = new Map(selectionCategories.map((item) => [item.slug, item.name]));
      const selectionNameMap = await buildSelectionShareNameMap(selectionRows, selectionCategoryMap);

      const modelItems: AdminShareItem[] = modelRows.map((s) => ({
        id: `model:${s.id}`,
        rawId: s.id,
        type: 'model',
        token: s.token,
        modelId: s.modelId,
        modelName: modelMap.get(s.modelId)?.name || modelMap.get(s.modelId)?.originalName || '模型已删除',
        createdById: s.createdById,
        createdByUsername: userMap.get(s.createdById)?.username || '未知用户',
        allowPreview: s.allowPreview,
        allowDownload: s.allowDownload,
        downloadLimit: s.downloadLimit,
        downloadCount: s.downloadCount,
        viewCount: s.viewCount,
        hasPassword: !!s.password,
        expiresAt: s.expiresAt,
        createdAt: s.createdAt,
      }));
      const selectionItems: AdminShareItem[] = selectionRows
        .map((s) => {
          const selectionName =
            selectionNameMap.get(s.id) || selectionCategoryMap.get(s.categorySlug) || s.categorySlug || '产品选型';
          return {
            id: `selection:${s.id}`,
            rawId: s.id,
            type: 'selection' as const,
            token: s.token,
            modelId: null,
            modelName: selectionName,
            createdById: s.createdById,
            createdByUsername: userMap.get(s.createdById)?.username || '未知用户',
            allowPreview: true,
            allowDownload: false,
            downloadLimit: 0,
            downloadCount: 0,
            viewCount: s.viewCount,
            hasPassword: false,
            expiresAt: null,
            createdAt: s.createdAt,
          };
        })
        .filter((item) => {
          if (!searchText) return true;
          return [item.token, item.modelName, item.createdByUsername, item.rawId].some((value) =>
            value.toLowerCase().includes(searchText),
          );
        });

      const items = [...modelItems, ...selectionItems].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const total = items.length;
      const pagedItems = items.slice((page - 1) * pageSize, page * pageSize);

      res.json({
        total,
        page,
        pageSize,
        items: pagedItems,
      });
    } catch (err) {
      logger.error({ err }, '[Shares] Admin list error');
      res.status(500).json({ detail: '获取分享列表失败' });
    }
  });

  // Admin: share statistics
  router.get('/api/admin/shares/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const { cacheGetOrSet } = await import('../../lib/cache.js');
      const { value } = await cacheGetOrSet('cache:admin:shares:stats', 60, async () => {
        // autoCreated 选型快照（工单来源）不计入分享统计，与列表口径一致
        const [modelTotal, selectionTotal, expired, modelAgg, selectionAgg] = await Promise.all([
          prisma.shareLink.count(),
          prisma.selectionShare.count({ where: { autoCreated: false } }),
          prisma.shareLink.count({ where: { expiresAt: { not: null, lt: new Date() } } }),
          prisma.shareLink.aggregate({ _sum: { downloadCount: true, viewCount: true } }),
          prisma.selectionShare.aggregate({ where: { autoCreated: false }, _sum: { viewCount: true } }),
        ]);
        const total = modelTotal + selectionTotal;
        return {
          total,
          active: total - expired,
          expired,
          totalDownloads: modelAgg._sum.downloadCount || 0,
          totalViews: (modelAgg._sum.viewCount || 0) + (selectionAgg._sum.viewCount || 0),
          modelShares: modelTotal,
          selectionShares: selectionTotal,
        };
      });
      res.json(value);
    } catch (err) {
      logger.error({ err }, '[Shares] Admin stats error');
      res.status(500).json({ detail: '获取分享统计失败' });
    }
  });

  // Admin: delete any share
  router.delete('/api/admin/shares/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = asSingleString(req.params.id);
      if (!id) {
        res.status(400).json({ detail: '分享参数无效' });
        return;
      }
      const target = parseAdminShareId(id);
      if (target.type === 'selection') {
        const share = await prisma.selectionShare.findUnique({ where: { id: target.id } });
        if (!share) {
          res.status(404).json({ detail: '选型分享链接不存在' });
          return;
        }
        await prisma.selectionShare.delete({ where: { id: target.id } });
        res.json({ ok: true });
        return;
      }
      const share = await prisma.shareLink.findUnique({ where: { id: target.id } });
      if (!share) {
        res.status(404).json({ detail: '分享链接不存在' });
        return;
      }
      await prisma.shareLink.delete({ where: { id: target.id } });
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, '[Shares] Admin delete error');
      res.status(500).json({ detail: '删除分享失败' });
    }
  });

  // Admin: batch delete shares
  router.post('/api/admin/shares/batch-delete', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const rawIds: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
      const ids = Array.from(
        new Set(rawIds.map((id) => asSingleString(id)).filter((id): id is string => Boolean(id))),
      ).slice(0, 500);
      if (ids.length === 0) {
        res.status(400).json({ detail: '请选择要删除的分享链接' });
        return;
      }
      const parsed = ids.map(parseAdminShareId);
      const modelIds = parsed.filter((item) => item.type === 'model').map((item) => item.id);
      const selectionIds = parsed.filter((item) => item.type === 'selection').map((item) => item.id);
      const [modelResult, selectionResult] = await Promise.all([
        modelIds.length
          ? prisma.shareLink.deleteMany({ where: { id: { in: modelIds } } })
          : Promise.resolve({ count: 0 }),
        selectionIds.length
          ? prisma.selectionShare.deleteMany({ where: { id: { in: selectionIds } } })
          : Promise.resolve({ count: 0 }),
      ]);
      res.json({ ok: true, deleted: modelResult.count + selectionResult.count });
    } catch (err) {
      logger.error({ err }, '[Shares] Admin batch delete error');
      res.status(500).json({ detail: '批量删除分享失败' });
    }
  });

  return router;
}
