import { Router, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { getBusinessConfig } from "../../lib/businessConfig.js";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { adminOnly, asSingleString } from "./common.js";

export function createAdminSharesRouter() {
  const router = Router();

  // Admin: list all shares
  router.get("/api/admin/shares", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const { pageSizePolicy } = await getBusinessConfig();
      const defaultPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.shareAdminDefault) || 20));
      const maxPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.shareAdminMax) || 100));
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(maxPageSize, Math.max(1, Number(req.query.page_size) || defaultPageSize));
      const search = (req.query.search as string) || "";

      const where = search
        ? {
            OR: [
              { model: { name: { contains: search, mode: "insensitive" as const } } },
              { model: { originalName: { contains: search, mode: "insensitive" as const } } },
              { createdBy: { username: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {};

      const [total, rows] = await Promise.all([
        prisma.shareLink.count({ where }),
        prisma.shareLink.findMany({
          where,
          include: {
            model: { select: { id: true, name: true, originalName: true } },
            createdBy: { select: { id: true, username: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      res.json({
        total,
        page,
        pageSize,
        items: rows.map((s) => ({
          id: s.id,
          token: s.token,
          modelId: s.modelId,
          modelName: s.model.name || s.model.originalName,
          createdById: s.createdById,
          createdByUsername: s.createdBy.username,
          allowPreview: s.allowPreview,
          allowDownload: s.allowDownload,
          downloadLimit: s.downloadLimit,
          downloadCount: s.downloadCount,
          viewCount: s.viewCount,
          hasPassword: !!s.password,
          expiresAt: s.expiresAt,
          createdAt: s.createdAt,
        })),
      });
    } catch (err) {
      console.error("[Shares] Admin list error:", err);
      res.status(500).json({ detail: "获取分享列表失败" });
    }
  });

  // Admin: share statistics
  router.get("/api/admin/shares/stats", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const [total, expired, agg] = await Promise.all([
        prisma.shareLink.count(),
        prisma.shareLink.count({ where: { expiresAt: { not: null, lt: new Date() } } }),
        prisma.shareLink.aggregate({ _sum: { downloadCount: true, viewCount: true } }),
      ]);
      res.json({
        total,
        active: total - expired,
        expired,
        totalDownloads: agg._sum.downloadCount || 0,
        totalViews: agg._sum.viewCount || 0,
      });
    } catch (err) {
      console.error("[Shares] Admin stats error:", err);
      res.status(500).json({ detail: "获取分享统计失败" });
    }
  });

  // Admin: delete any share
  router.delete("/api/admin/shares/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = asSingleString(req.params.id);
      if (!id) {
        res.status(400).json({ detail: "分享参数无效" });
        return;
      }
      const share = await prisma.shareLink.findUnique({ where: { id } });
      if (!share) {
        res.status(404).json({ detail: "分享链接不存在" });
        return;
      }
      await prisma.shareLink.delete({ where: { id } });
      res.json({ ok: true });
    } catch (err) {
      console.error("[Shares] Admin delete error:", err);
      res.status(500).json({ detail: "删除分享失败" });
    }
  });

  return router;
}
