import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, optionalAuthMiddleware, type AuthRequest } from "../middleware/auth.js";
import { createModelDownloadToken, createProtectedResourceToken } from "../lib/downloadTokenStore.js";
import { optionalString } from "../lib/requestValidation.js";
import { getSetting } from "../lib/settings.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger({ component: "downloads" });

const router = Router();

function adminOnly(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
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

// Download history for the current user.
router.get("/api/downloads", authMiddleware, async (req: Request, res: Response) => {
  if (!prisma) {
    res.json({ data: [] });
    return;
  }
  try {
    const userId = (req as AuthRequest).user!.userId;
    const downloads = await prisma.download.findMany({
      where: { userId },
      include: {
        model: {
          select: {
            id: true,
            name: true,
            originalName: true,
            format: true,
            thumbnailUrl: true,
            gltfSize: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const items = downloads.map((d: any) => ({
      id: d.id,
      modelId: d.modelId,
      format: d.format,
      fileSize: d.fileSize,
      createdAt: d.createdAt,
      model: d.model
        ? {
            model_id: d.model.id,
            name: d.model.name || d.model.originalName,
            format: d.model.format,
            thumbnail_url: d.model.thumbnailUrl,
            gltf_size: d.model.gltfSize,
          }
        : null,
    }));
    res.json({ data: items });
  } catch (err) {
    log.error({ err }, "Failed to fetch downloads");
    res.status(500).json({ detail: "获取下载历史失败" });
  }
});

// Admin download statistics. Model.downloadCount is the source of truth for all model downloads;
// Download rows are user-level history records and may not include anonymous/share-only traffic.
router.get("/api/admin/downloads/stats", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  if (!prisma) {
    res.status(503).json({ detail: "DB unavailable" });
    return;
  }

  try {
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 6);
    const chartStart = new Date(todayStart);
    chartStart.setDate(chartStart.getDate() - 13);

    const [
      modelDownloads,
      historyRecords,
      todayDownloads,
      weekDownloads,
      activeDownloaders,
      topModels,
      recentDownloads,
      formatGroups,
      chartRows,
    ] = await Promise.all([
      prisma.model.aggregate({ _sum: { downloadCount: true } }),
      prisma.download.count(),
      prisma.download.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.download.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.download.findMany({
        where: { createdAt: { gte: weekStart } },
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.model.findMany({
        orderBy: [{ downloadCount: "desc" }, { createdAt: "desc" }],
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
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          user: { select: { id: true, username: true, email: true } },
          model: {
            select: {
              id: true,
              name: true,
              originalName: true,
              format: true,
              thumbnailUrl: true,
            },
          },
        },
      }),
      prisma.download.groupBy({
        by: ["format"],
        _count: { _all: true },
        _sum: { fileSize: true },
      }),
      prisma.download.findMany({
        where: { createdAt: { gte: chartStart } },
        select: { createdAt: true, fileSize: true },
      }),
    ]);

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
      },
      topModels: topModels.map((model) => ({
        model_id: model.id,
        name: model.name || model.originalName,
        format: model.format,
        thumbnail_url: model.thumbnailUrl,
        category: model.categoryRef?.name || model.category || null,
        download_count: model.downloadCount || 0,
      })),
      recentDownloads: recentDownloads.map((download) => ({
        id: download.id,
        model_id: download.modelId,
        model_name: download.model?.name || download.model?.originalName || "已删除模型",
        model_format: download.model?.format || download.format,
        thumbnail_url: download.model?.thumbnailUrl || null,
        user_id: download.userId,
        username: download.user?.username || download.user?.email || "未知用户",
        format: download.format,
        file_size: download.fileSize,
        created_at: download.createdAt,
      })),
      formatStats: formatGroups
        .map((group) => ({
          format: group.format || "unknown",
          downloads: group._count._all,
          bytes: group._sum.fileSize || 0,
        }))
        .sort((a, b) => b.downloads - a.downloads),
      dailyStats: Array.from(dailyMap.entries()).map(([date, value]) => ({ date, ...value })),
    });
  } catch (err) {
    log.error({ err }, "Admin stats error");
    res.status(500).json({ detail: "获取下载统计失败" });
  }
});

// Generate a short-lived one-time token for browser downloads.
// This avoids placing the user's JWT in URLs, browser history, reverse-proxy logs, or Referer headers.
router.post("/api/downloads/model-token", optionalAuthMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const requireLogin = await getSetting<boolean>("require_login_download");
    if (requireLogin && !req.user) {
      res.status(401).json({ detail: "需要登录后才能下载" });
      return;
    }

    const modelId = optionalString((req.body as Record<string, unknown>)?.modelId, { maxLength: 128 });
    const format = optionalString((req.body as Record<string, unknown>)?.format, { maxLength: 20 }) || "original";
    if (!modelId) {
      res.status(400).json({ detail: "缺少模型 ID" });
      return;
    }

    const created = await createModelDownloadToken({
      modelId,
      format,
      userId: req.user?.userId,
    });

    res.json(created);
  } catch (err) {
    log.error({ err }, "Failed to create model download token");
    res.status(500).json({ detail: "创建下载令牌失败" });
  }
});

// Generate a short-lived one-time token for protected PDF drawings.
router.post("/api/downloads/drawing-token", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const modelId = optionalString((req.body as Record<string, unknown>)?.modelId, { maxLength: 128 });
    if (!modelId) {
      res.status(400).json({ detail: "缺少模型 ID" });
      return;
    }

    const model = await prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true, drawingUrl: true },
    });
    if (!model?.drawingUrl) {
      res.status(404).json({ detail: "图纸不存在" });
      return;
    }

    const created = createProtectedResourceToken({
      type: "model-drawing",
      resourceId: modelId,
      userId: req.user!.userId,
      role: req.user!.role,
      singleUse: true,
    });

    const url = `/api/models/${encodeURIComponent(modelId)}/drawing/download?download_token=${encodeURIComponent(created.token)}`;
    res.json({ ...created, url });
  } catch (err) {
    log.error({ err }, "Failed to create drawing token");
    res.status(500).json({ detail: "创建图纸访问令牌失败" });
  }
});

// Batch delete download records.
router.post("/api/downloads/batch-delete", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) { res.status(503).json({ detail: "DB unavailable" }); return; }
    const { ids } = req.body as { ids: string[] };
    if (!ids || !Array.isArray(ids)) { res.status(400).json({ detail: "参数错误" }); return; }
    if (ids.length > 1000) { res.status(400).json({ detail: "单次最多删除 1000 条记录" }); return; }
    const result = await prisma.download.deleteMany({
      where: { id: { in: ids }, userId: req.user!.userId },
    });
    res.json({ success: true, count: result.count });
  } catch {
    res.status(500).json({ detail: "批量删除失败" });
  }
});

// Clear all download records.
router.delete("/api/downloads/clear", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) { res.status(503).json({ detail: "DB unavailable" }); return; }
    const result = await prisma.download.deleteMany({
      where: { userId: req.user!.userId },
    });
    res.json({ success: true, count: result.count });
  } catch {
    res.status(500).json({ detail: "清空失败" });
  }
});

// Delete single download record.
router.delete("/api/downloads/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) { res.status(503).json({ detail: "DB unavailable" }); return; }
    const downloadId = optionalString(req.params.id, { maxLength: 128 });
    if (!downloadId) { res.status(400).json({ detail: "缺少记录 ID" }); return; }
    const download = await prisma.download.findUnique({ where: { id: downloadId } });
    if (!download) { res.status(404).json({ detail: "记录不存在" }); return; }
    if (download.userId !== req.user!.userId) { res.status(403).json({ detail: "无权操作" }); return; }
    await prisma.download.delete({ where: { id: downloadId } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ detail: "删除失败" });
  }
});

export default router;
