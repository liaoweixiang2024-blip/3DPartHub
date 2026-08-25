import { existsSync } from 'node:fs';
import type { Prisma } from '@prisma/client';
import archiver from 'archiver';
import { Router, Request, Response, urlencoded } from 'express';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { createModelDownloadToken, createProtectedResourceToken } from '../lib/downloadTokenStore.js';
import { createLogger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { optionalString } from '../lib/requestValidation.js';
import { getSetting } from '../lib/settings.js';
import { authMiddleware, optionalAuthMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getInvisibleCategoryIds } from '../services/categoryAccess.js';
import { resolveDbModelDownloadTarget } from '../services/modelDownloadTarget.js';
import { findOriginalModelPath } from '../services/modelFiles.js';
import { MODEL_STATUS } from '../services/modelStatus.js';

const log = createLogger({ component: 'downloads' });

const router = Router();
const parseBatchDownloadForm = urlencoded({ extended: false, limit: '1mb' });

type DownloadArchiveEntry = { filePath: string; fileName: string };
type DownloadArchiveLookup =
  | { ok: true; fileEntries: DownloadArchiveEntry[] }
  | { ok: false; status: number; detail: string };

function adminOnly(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ detail: '需要管理员权限' });
    return false;
  }
  return true;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function containsText(value: string): Prisma.StringFilter {
  return { contains: value, mode: 'insensitive' };
}

function buildAdminDownloadSearchWhere(search: string): Prisma.DownloadWhereInput {
  if (!search) return {};
  const contains = containsText(search);
  return {
    OR: [
      { id: contains },
      { modelId: contains },
      { format: contains },
      { user: { username: contains } },
      { user: { email: contains } },
      { model: { name: contains } },
      { model: { originalName: contains } },
      { model: { format: contains } },
      { model: { category: contains } },
      { model: { categoryRef: { is: { name: contains } } } },
    ],
  };
}

function buildAdminDownloadModelSearchWhere(search: string): Prisma.ModelWhereInput {
  if (!search) return {};
  const contains = containsText(search);
  return {
    OR: [
      { id: contains },
      { name: contains },
      { originalName: contains },
      { format: contains },
      { category: contains },
      { categoryRef: { is: { name: contains } } },
    ],
  };
}

function combineDownloadWhere(...items: Prisma.DownloadWhereInput[]): Prisma.DownloadWhereInput {
  const filters = items.filter((item) => Object.keys(item).length > 0);
  if (filters.length === 0) return {};
  if (filters.length === 1) return filters[0];
  return { AND: filters };
}

function uniqueArchiveFileName(fileName: string, usedNames: Map<string, number>): string {
  const safeFileName = (fileName || 'model.step').replace(/[<>:"/\\|?*]/g, '_');
  const match = safeFileName.match(/^(.*?)(\.[^.]+)?$/);
  const stem = (match?.[1] || 'model').trim() || 'model';
  const ext = match?.[2] || '.step';
  const baseName = `${stem}${ext}`;
  const count = usedNames.get(baseName) || 0;
  usedNames.set(baseName, count + 1);
  return count > 0 ? `${stem}_${count}${ext}` : baseName;
}

function uniqueDownloadIds(ids: unknown): string[] {
  let values: unknown[] = [];
  if (Array.isArray(ids)) {
    values = ids;
  } else if (typeof ids === 'string') {
    const trimmed = ids.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        values = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        values = [trimmed];
      }
    } else if (trimmed) {
      values = [trimmed];
    }
  }

  return Array.from(new Set(values.filter((id): id is string => typeof id === 'string' && id.length > 0)));
}

function readBatchDownloadIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const data = body as { ids?: unknown; 'ids[]'?: unknown };
  return uniqueDownloadIds(data.ids ?? data['ids[]']);
}

function readBatchDownloadCheckIds(req: Request): string[] {
  const bodyIds = readBatchDownloadIds(req.body);
  if (bodyIds.length > 0) return bodyIds;
  const query = req.query as { ids?: unknown; 'ids[]'?: unknown };
  return uniqueDownloadIds(query.ids ?? query['ids[]']);
}

async function lookupDownloadArchiveEntries(
  ids: string[],
  userId: string,
  invisible: Set<string>,
): Promise<DownloadArchiveLookup> {
  if (!prisma) return { ok: false, status: 503, detail: 'DB unavailable' };

  const uniqueIds = uniqueDownloadIds(ids);
  if (uniqueIds.length === 0) {
    return { ok: false, status: 400, detail: '请选择要下载的记录' };
  }

  const { pageSizePolicy } = await getBusinessConfig();
  const batchMax = Math.max(1, Math.floor(Number(pageSizePolicy.userBatchDownloadMax) || 100));
  if (uniqueIds.length > batchMax) {
    return { ok: false, status: 400, detail: `单次最多打包 ${batchMax} 条下载记录` };
  }

  const downloads = await prisma.download.findMany({
    where: { id: { in: uniqueIds }, userId },
    select: {
      id: true,
      modelId: true,
    },
  });
  const modelIds = Array.from(new Set(downloads.map((download) => download.modelId).filter(Boolean)));
  const models = modelIds.length
    ? await prisma.model.findMany({
        where: { id: { in: modelIds } },
        select: {
          id: true,
          name: true,
          originalName: true,
          format: true,
          originalFormat: true,
          originalSize: true,
          gltfUrl: true,
          gltfSize: true,
          uploadPath: true,
          status: true,
          categoryId: true,
        },
      })
    : [];
  const downloadById = new Map(downloads.map((download) => [download.id, download]));
  const modelById = new Map(models.map((model) => [model.id, model]));
  const addedModelIds = new Set<string>();
  const fileEntries: DownloadArchiveEntry[] = [];

  for (const id of uniqueIds) {
    const download = downloadById.get(id);
    const model = download ? modelById.get(download.modelId) : null;
    if (!model || model.status !== MODEL_STATUS.COMPLETED || addedModelIds.has(model.id)) continue;
    // 分类访问控制：受限分类的模型不参与打包（防绕过）
    if (model.categoryId && invisible.has(model.categoryId)) continue;
    if (!findOriginalModelPath(model)) continue;

    const target = resolveDbModelDownloadTarget(model, 'original');
    if (!target || !existsSync(target.filePath)) continue;

    fileEntries.push({ filePath: target.filePath, fileName: target.fileName });
    addedModelIds.add(model.id);
  }

  if (fileEntries.length === 0) {
    return { ok: false, status: 404, detail: '没有找到可打包下载的原始模型文件' };
  }

  return { ok: true, fileEntries };
}

// Download history for the current user.
router.get('/api/downloads', authMiddleware, async (req: Request, res: Response) => {
  if (!prisma) {
    res.json({ data: [] });
    return;
  }
  try {
    const userId = (req as AuthRequest).user!.userId;
    // 分类访问控制：受限分类的模型不出现在下载历史
    const invisible = await getInvisibleCategoryIds((req as AuthRequest).user!.role, userId);
    const downloads = await prisma.download.findMany({
      where: { userId },
      select: {
        id: true,
        modelId: true,
        format: true,
        fileSize: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const modelIds = Array.from(new Set(downloads.map((download) => download.modelId).filter(Boolean)));
    const models = modelIds.length
      ? await prisma.model.findMany({
          where: { id: { in: modelIds } },
          select: {
            id: true,
            name: true,
            originalName: true,
            format: true,
            thumbnailUrl: true,
            gltfSize: true,
            categoryId: true,
          },
        })
      : [];
    const modelById = new Map(models.map((model) => [model.id, model]));
    const items = downloads.map((d) => {
      const model = modelById.get(d.modelId);
      const visible = model && (!model.categoryId || !invisible.has(model.categoryId));
      return {
        id: d.id,
        modelId: d.modelId,
        format: d.format,
        fileSize: d.fileSize,
        createdAt: d.createdAt,
        model: visible
          ? {
              model_id: model!.id,
              name: model!.name || model!.originalName,
              format: model!.format,
              thumbnail_url: model!.thumbnailUrl,
              gltf_size: model!.gltfSize,
            }
          : null,
      };
    });
    res.json({ data: items });
  } catch (err) {
    log.error({ err }, 'Failed to fetch downloads');
    res.status(500).json({ detail: '获取下载历史失败' });
  }
});

// Admin download statistics. Model.downloadCount is the source of truth for all model downloads;
// Download rows are user-level history records and may not include anonymous/share-only traffic.
router.get('/api/admin/downloads/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  if (!prisma) {
    res.status(503).json({ detail: 'DB unavailable' });
    return;
  }

  try {
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 6);
    const chartStart = new Date(todayStart);
    chartStart.setDate(chartStart.getDate() - 13);
    const search = String(req.query.search || '').trim();
    const downloadWhere = buildAdminDownloadSearchWhere(search);
    const modelWhere = buildAdminDownloadModelSearchWhere(search);

    const [
      modelDownloads,
      historyRecords,
      todayDownloads,
      weekDownloads,
      activeDownloaders,
      downloadBytes,
      topModels,
      recentDownloadRows,
      formatGroups,
      chartRows,
    ] = await Promise.all([
      prisma.model.aggregate({ where: modelWhere, _sum: { downloadCount: true } }),
      prisma.download.count({ where: downloadWhere }),
      prisma.download.count({ where: combineDownloadWhere(downloadWhere, { createdAt: { gte: todayStart } }) }),
      prisma.download.count({ where: combineDownloadWhere(downloadWhere, { createdAt: { gte: weekStart } }) }),
      prisma.download.findMany({
        where: combineDownloadWhere(downloadWhere, { createdAt: { gte: weekStart } }),
        distinct: ['userId'],
        select: { userId: true },
      }),
      prisma.download.aggregate({ where: downloadWhere, _sum: { fileSize: true } }),
      prisma.model.findMany({
        where: modelWhere,
        orderBy: [{ downloadCount: 'desc' }, { createdAt: 'desc' }],
        take: 12,
        select: {
          id: true,
          name: true,
          originalName: true,
          format: true,
          thumbnailUrl: true,
          downloadCount: true,
          category: true,
          categoryRef: { select: { name: true } },
        },
      }),
      prisma.download.findMany({
        where: downloadWhere,
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          modelId: true,
          userId: true,
          format: true,
          fileSize: true,
          createdAt: true,
        },
      }),
      prisma.download.groupBy({
        by: ['format'],
        where: downloadWhere,
        _count: { _all: true },
        _sum: { fileSize: true },
      }),
      prisma.download.findMany({
        where: combineDownloadWhere(downloadWhere, { createdAt: { gte: chartStart } }),
        select: { createdAt: true, fileSize: true },
      }),
    ]);

    const recentUserIds = Array.from(new Set(recentDownloadRows.map((download) => download.userId).filter(Boolean)));
    const recentModelIds = Array.from(new Set(recentDownloadRows.map((download) => download.modelId).filter(Boolean)));
    const [recentUsers, recentModels] = await Promise.all([
      recentUserIds.length > 0
        ? prisma.user.findMany({
            where: { id: { in: recentUserIds } },
            select: { id: true, username: true, email: true },
          })
        : Promise.resolve([]),
      recentModelIds.length > 0
        ? prisma.model.findMany({
            where: { id: { in: recentModelIds } },
            select: {
              id: true,
              name: true,
              originalName: true,
              format: true,
              thumbnailUrl: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const recentUserMap = new Map(recentUsers.map((user) => [user.id, user]));
    const recentModelMap = new Map(recentModels.map((model) => [model.id, model]));

    const dailyMap = new Map<string, { downloads: number; bytes: number }>();
    for (let offset = 13; offset >= 0; offset -= 1) {
      const day = new Date(todayStart);
      day.setDate(day.getDate() - offset);
      dailyMap.set(dateKey(day), { downloads: 0, bytes: 0 });
    }
    for (const row of chartRows) {
      const key = dateKey(row.createdAt);
      const current = dailyMap.get(key);
      if (current) {
        current.downloads += 1;
        current.bytes += row.fileSize || 0;
      }
    }

    res.json({
      summary: {
        totalModelDownloads: modelDownloads._sum.downloadCount || 0,
        historyRecords,
        todayDownloads,
        weekDownloads,
        activeDownloaders: activeDownloaders.length,
        downloadedBytes: downloadBytes._sum.fileSize || 0,
      },
      topModels: topModels.map((model) => ({
        model_id: model.id,
        name: model.name || model.originalName,
        format: model.format,
        thumbnail_url: model.thumbnailUrl,
        category: model.categoryRef?.name || model.category || null,
        download_count: model.downloadCount || 0,
      })),
      recentDownloads: recentDownloadRows.map((download) => {
        const model = recentModelMap.get(download.modelId);
        const user = recentUserMap.get(download.userId);
        return {
          id: download.id,
          model_id: download.modelId,
          model_name: model?.name || model?.originalName || '已删除模型',
          model_format: model?.format || download.format,
          thumbnail_url: model?.thumbnailUrl || null,
          user_id: download.userId,
          username: user?.username || user?.email || '未知用户',
          format: download.format,
          file_size: download.fileSize,
          created_at: download.createdAt,
        };
      }),
      formatStats: formatGroups
        .map((group) => ({
          format: group.format || 'unknown',
          downloads: group._count._all,
          bytes: group._sum.fileSize || 0,
        }))
        .sort((a, b) => b.downloads - a.downloads),
      dailyStats: Array.from(dailyMap.entries()).map(([date, value]) => ({ date, ...value })),
    });
  } catch (err) {
    log.error({ err }, 'Admin stats error');
    res.status(500).json({ detail: '获取下载统计失败' });
  }
});

// Generate a short-lived one-time token for browser downloads.
// This avoids placing the user's JWT in URLs, browser history, reverse-proxy logs, or Referer headers.
router.post('/api/downloads/model-token', optionalAuthMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const requireLogin = await getSetting<boolean>('require_login_download');
    if (requireLogin && !req.user) {
      res.status(401).json({ detail: '需要登录后才能下载' });
      return;
    }

    const modelId = optionalString((req.body as Record<string, unknown>)?.modelId, { maxLength: 128 });
    const format = optionalString((req.body as Record<string, unknown>)?.format, { maxLength: 20 }) || 'original';
    if (!modelId) {
      res.status(400).json({ detail: '缺少模型 ID' });
      return;
    }

    // 分类访问控制：受限分类的模型不发放下载令牌（/download 端点还有同款兜底拦截）
    const invisible = await getInvisibleCategoryIds(req.user?.role ?? null, req.user?.userId ?? null);
    if (invisible.size > 0) {
      const model = await prisma.model.findUnique({
        where: { id: modelId },
        select: { categoryId: true },
      });
      if (model?.categoryId && invisible.has(model.categoryId)) {
        res.status(403).json({ detail: '无权下载该模型' });
        return;
      }
    }

    const created = await createModelDownloadToken({
      modelId,
      format,
      userId: req.user?.userId,
    });

    res.json(created);
  } catch (err) {
    log.error({ err }, 'Failed to create model download token');
    res.status(500).json({ detail: '创建下载令牌失败' });
  }
});

// Generate a short-lived token for PDF drawings. It follows the same login-download policy as model downloads.
router.post('/api/downloads/drawing-token', optionalAuthMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const requireLogin = await getSetting<boolean>('require_login_download');
    if (requireLogin && !req.user) {
      res.status(401).json({ detail: '需要登录后才能查看图纸' });
      return;
    }

    const modelId = optionalString((req.body as Record<string, unknown>)?.modelId, { maxLength: 128 });
    if (!modelId) {
      res.status(400).json({ detail: '缺少模型 ID' });
      return;
    }

    const model = await prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true, drawingUrl: true, categoryId: true },
    });
    if (!model?.drawingUrl) {
      res.status(404).json({ detail: '图纸不存在' });
      return;
    }

    // 分类访问控制：受限分类的模型不发放图纸令牌（/drawing/download 端点还有同款兜底拦截）
    const invisible = await getInvisibleCategoryIds(req.user?.role ?? null, req.user?.userId ?? null);
    if (model.categoryId && invisible.has(model.categoryId)) {
      res.status(403).json({ detail: '无权访问该图纸' });
      return;
    }

    const created = createProtectedResourceToken({
      type: 'model-drawing',
      resourceId: modelId,
      userId: req.user?.userId || 'anonymous',
      role: req.user?.role,
      singleUse: false,
    });

    const url = `/api/models/${encodeURIComponent(modelId)}/drawing/download?download_token=${encodeURIComponent(created.token)}`;
    res.json({ ...created, url });
  } catch (err) {
    log.error({ err }, 'Failed to create drawing token');
    res.status(500).json({ detail: '创建图纸访问令牌失败' });
  }
});

// Batch download selected history records as a single ZIP of original model files.
router.all(
  '/api/downloads/batch-download/check',
  parseBatchDownloadForm,
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const invisible = await getInvisibleCategoryIds(req.user!.role, req.user!.userId);
      const lookup = await lookupDownloadArchiveEntries(readBatchDownloadCheckIds(req), req.user!.userId, invisible);
      if (!lookup.ok) {
        res.status(lookup.status).json({ detail: lookup.detail });
        return;
      }
      res.json({ fileCount: lookup.fileEntries.length });
    } catch (err) {
      log.error({ err }, 'Download history batch check failed');
      res.status(500).json({ detail: '检查打包下载失败' });
    }
  },
);

router.post(
  '/api/downloads/batch-download',
  parseBatchDownloadForm,
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const invisible = await getInvisibleCategoryIds(req.user!.role, req.user!.userId);
      const lookup = await lookupDownloadArchiveEntries(readBatchDownloadIds(req.body), req.user!.userId, invisible);
      if (!lookup.ok) {
        res.status(lookup.status).json({ detail: lookup.detail });
        return;
      }

      if (req.get('x-download-preflight') === '1') {
        res.json({ fileCount: lookup.fileEntries.length });
        return;
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="downloads_${Date.now()}.zip"`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      archive.on('error', (err) => {
        log.error({ err }, 'Download history batch archive error');
        if (!res.headersSent) {
          res.status(500).json({ detail: '打包下载失败' });
        } else {
          res.destroy(err);
        }
      });
      archive.pipe(res);

      const usedNames = new Map<string, number>();
      for (const entry of lookup.fileEntries) {
        archive.file(entry.filePath, { name: uniqueArchiveFileName(entry.fileName, usedNames) });
      }

      await archive.finalize();
    } catch (err) {
      log.error({ err }, 'Download history batch download failed');
      if (!res.headersSent) res.status(500).json({ detail: '打包下载失败' });
    }
  },
);

// Batch delete download records.
router.post('/api/downloads/batch-delete', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) {
      res.status(503).json({ detail: 'DB unavailable' });
      return;
    }
    const { ids } = req.body as { ids: string[] };
    if (!ids || !Array.isArray(ids)) {
      res.status(400).json({ detail: '参数错误' });
      return;
    }
    if (ids.length > 1000) {
      res.status(400).json({ detail: '单次最多删除 1000 条记录' });
      return;
    }
    const result = await prisma.download.deleteMany({
      where: { id: { in: ids }, userId: req.user!.userId },
    });
    res.json({ success: true, count: result.count });
  } catch {
    res.status(500).json({ detail: '批量删除失败' });
  }
});

// Clear all download records.
router.delete('/api/downloads/clear', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) {
      res.status(503).json({ detail: 'DB unavailable' });
      return;
    }
    const result = await prisma.download.deleteMany({
      where: { userId: req.user!.userId },
    });
    res.json({ success: true, count: result.count });
  } catch {
    res.status(500).json({ detail: '清空失败' });
  }
});

// Delete single download record.
router.delete('/api/downloads/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) {
      res.status(503).json({ detail: 'DB unavailable' });
      return;
    }
    const downloadId = optionalString(req.params.id, { maxLength: 128 });
    if (!downloadId) {
      res.status(400).json({ detail: '缺少记录 ID' });
      return;
    }
    const download = await prisma.download.findUnique({ where: { id: downloadId } });
    if (!download) {
      res.status(404).json({ detail: '记录不存在' });
      return;
    }
    if (download.userId !== req.user!.userId) {
      res.status(403).json({ detail: '无权操作' });
      return;
    }
    await prisma.download.delete({ where: { id: downloadId } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ detail: '删除失败' });
  }
});

export default router;
