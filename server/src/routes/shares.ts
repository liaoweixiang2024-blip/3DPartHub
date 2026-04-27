import { Router, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { existsSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";
import { getAllSettings, getSetting } from "../lib/settings.js";
import { previewAssetFileName, resolveFileUrlPath } from "../services/gltfAsset.js";

const router = Router();

function asSingleString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return undefined;
}

async function isValidSharePassword(hashedPassword: string | null, candidate: unknown): Promise<boolean> {
  if (!hashedPassword) return true;
  const password = asSingleString(candidate);
  if (!password) return false;
  return bcrypt.compare(password, hashedPassword);
}

// ========== Authenticated endpoints ==========

// Create share link
router.post("/api/shares", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    let { modelId, password, allowPreview, allowDownload = true, downloadLimit = 0, expiresAt } = req.body;

    if (!modelId) {
      res.status(400).json({ detail: "缺少 modelId" });
      return;
    }

    const model = await prisma.model.findUnique({ where: { id: modelId } });
    if (!model) {
      res.status(404).json({ detail: "模型不存在" });
      return;
    }

    // --- Apply share policy ---
    const settings = await getAllSettings();
    const sAllowPassword = settings.share_allow_password ?? true;
    const sAllowCustomExpiry = settings.share_allow_custom_expiry ?? true;
    const sDefaultExpireDays = Number(settings.share_default_expire_days) || 0;
    const sMaxExpireDays = Number(settings.share_max_expire_days) || 0;
    const sDefaultDownloadLimit = Number(settings.share_default_download_limit) || 0;
    const sMaxDownloadLimit = Number(settings.share_max_download_limit) || 0;
    const sAllowPreview = settings.share_allow_preview ?? true;

    // Password policy
    if (!sAllowPassword) password = undefined;

    // Preview default
    if (allowPreview === undefined) allowPreview = sAllowPreview as boolean;

    // Expiry policy
    let finalExpiresAt: Date | null = null;
    if (!sAllowCustomExpiry) {
      // User cannot customize — use default only
      if (sDefaultExpireDays > 0) {
        finalExpiresAt = new Date(Date.now() + sDefaultExpireDays * 86400000);
      }
    } else {
      if (expiresAt) {
        finalExpiresAt = new Date(expiresAt);
        // Clamp to max
        if (sMaxExpireDays > 0) {
          const maxDate = new Date(Date.now() + sMaxExpireDays * 86400000);
          if (finalExpiresAt > maxDate) finalExpiresAt = maxDate;
        }
      } else if (sDefaultExpireDays > 0) {
        finalExpiresAt = new Date(Date.now() + sDefaultExpireDays * 86400000);
      }
    }

    // Download limit policy
    if (downloadLimit === 0 && sDefaultDownloadLimit > 0) {
      downloadLimit = sDefaultDownloadLimit;
    }
    if (sMaxDownloadLimit > 0 && downloadLimit > sMaxDownloadLimit) {
      downloadLimit = sMaxDownloadLimit;
    }

    const token = randomBytes(12).toString("hex");
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    const share = await prisma.shareLink.create({
      data: {
        modelId,
        token,
        password: hashedPassword,
        allowPreview,
        allowDownload,
        downloadLimit,
        expiresAt: finalExpiresAt,
        createdById: userId,
      },
    });

    res.status(201).json({
      id: share.id,
      token: share.token,
      allowPreview: share.allowPreview,
      allowDownload: share.allowDownload,
      downloadLimit: share.downloadLimit,
      expiresAt: share.expiresAt,
      createdAt: share.createdAt,
      url: `${req.protocol}://${req.get("host")}/share/${share.token}`,
    });
  } catch (err) {
    console.error("[Shares] Create error:", err);
    res.status(500).json({ detail: "创建分享失败", error: err instanceof Error ? err.message : String(err) });
  }
});

// List my shares
router.get("/api/shares", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const shares = await prisma.shareLink.findMany({
    where: { createdById: userId },
    include: {
      model: { select: { id: true, name: true, originalName: true, format: true } },
    },
    orderBy: { createdAt: "desc" },
  }) as any[];

  res.json(shares.map(s => ({
    id: s.id,
    token: s.token,
    modelId: s.modelId,
    modelName: s.model.name || s.model.originalName,
    allowPreview: s.allowPreview,
    allowDownload: s.allowDownload,
    downloadLimit: s.downloadLimit,
    downloadCount: s.downloadCount,
    viewCount: s.viewCount,
    hasPassword: !!s.password,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
  })));
});

// List shares for a specific model
router.get("/api/models/:id/shares", authMiddleware, async (req: AuthRequest, res: Response) => {
  const modelId = asSingleString(req.params.id);
  const userId = req.user!.userId;
  if (!modelId) {
    res.status(400).json({ detail: "模型参数无效" });
    return;
  }
  const shares = await prisma.shareLink.findMany({
    where: { modelId, createdById: userId },
    orderBy: { createdAt: "desc" },
  });

  res.json(shares.map(s => ({
    id: s.id,
    token: s.token,
    allowPreview: s.allowPreview,
    allowDownload: s.allowDownload,
    downloadLimit: s.downloadLimit,
    downloadCount: s.downloadCount,
    viewCount: s.viewCount,
    hasPassword: !!s.password,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
  })));
});

// Delete share
router.delete("/api/shares/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const id = asSingleString(req.params.id);
  if (!id) {
    res.status(400).json({ detail: "分享参数无效" });
    return;
  }

  const share = await prisma.shareLink.findUnique({ where: { id } });
  if (!share || share.createdById !== userId) {
    res.status(404).json({ detail: "分享链接不存在" });
    return;
  }

  await prisma.shareLink.delete({ where: { id } });
  res.json({ ok: true });
});

// ========== Admin endpoints ==========

function adminOnly(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return false;
  }
  return true;
}

// Admin: list all shares
router.get("/api/admin/shares", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));
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

// ========== Public endpoints ==========

// Get share info
router.get("/api/shares/:token/info", async (req: Request, res: Response) => {
  const token = asSingleString(req.params.token);
  if (!token) {
    res.status(400).json({ detail: "分享参数无效" });
    return;
  }

  const share = await prisma.shareLink.findUnique({
    where: { token },
    include: {
      model: {
        select: {
          id: true, name: true, originalName: true, format: true,
          originalSize: true, gltfUrl: true, gltfSize: true,
          originalFormat: true, uploadPath: true, thumbnailUrl: true,
          description: true,
        },
      },
    },
  }) as any;

  if (!share) {
    res.status(404).json({ detail: "分享链接不存在" });
    return;
  }

  if (share.expiresAt && new Date() > share.expiresAt) {
    res.status(410).json({ detail: "分享链接已过期", expired: true });
    return;
  }

  // Increment view count (best effort)
  prisma.shareLink.update({ where: { id: share.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});

  const model = share.model;
  const siteTitle = await getSetting<string>("site_title").catch(() => "3DPartHub");
  const passwordVerified = await isValidSharePassword(share.password, req.query.password);

  res.json({
    id: share.id,
    modelName: model.name || model.originalName,
    format: model.originalFormat || model.format,
    fileSize: model.originalSize,
    description: model.description,
    thumbnailUrl: model.thumbnailUrl,
    allowPreview: share.allowPreview,
    allowDownload: share.allowDownload,
    downloadLimit: share.downloadLimit,
    downloadCount: share.downloadCount,
    remainingDownloads: share.downloadLimit > 0 ? Math.max(0, share.downloadLimit - share.downloadCount) : -1,
    hasPassword: !!share.password,
    expiresAt: share.expiresAt,
    siteTitle,
    gltfUrl: share.allowPreview && passwordVerified ? model.gltfUrl : undefined,
  });
});

// Verify password
router.post("/api/shares/:token/verify", async (req: Request, res: Response) => {
  const token = asSingleString(req.params.token);
  const { password } = req.body;
  if (!token) {
    res.status(400).json({ detail: "分享参数无效" });
    return;
  }

  if (!password) {
    res.status(400).json({ detail: "请输入密码" });
    return;
  }

  const share = await prisma.shareLink.findUnique({ where: { token } });
  if (!share) {
    res.status(404).json({ detail: "分享链接不存在" });
    return;
  }

  if (share.expiresAt && new Date() > share.expiresAt) {
    res.status(410).json({ detail: "分享链接已过期" });
    return;
  }

  if (!share.password) {
    res.json({ verified: true });
    return;
  }

  const valid = await bcrypt.compare(password, share.password);
  if (!valid) {
    res.status(403).json({ detail: "密码错误" });
    return;
  }

  res.json({ verified: true });
});

// Download via share link
router.get("/api/shares/:token/download", async (req: Request, res: Response) => {
  const token = asSingleString(req.params.token);
  if (!token) {
    res.status(400).json({ detail: "分享参数无效" });
    return;
  }

  const share = await prisma.shareLink.findUnique({
    where: { token },
    include: { model: true },
  }) as any;

  if (!share) {
    res.status(404).json({ detail: "分享链接不存在" });
    return;
  }

  if (share.expiresAt && new Date() > share.expiresAt) {
    res.status(410).json({ detail: "分享链接已过期" });
    return;
  }

  if (!share.allowDownload) {
    res.status(403).json({ detail: "此链接不允许下载" });
    return;
  }

  if (!(await isValidSharePassword(share.password, req.query.password))) {
    res.status(403).json({ detail: "请输入正确的分享密码" });
    return;
  }

  if (share.downloadLimit > 0 && share.downloadCount >= share.downloadLimit) {
    res.status(429).json({ detail: "下载次数已达上限" });
    return;
  }

  const model = share.model;
  const displayName = model.name || model.originalName || model.id;
  const origExt = model.originalFormat || model.format || "step";

  let filePath: string | null = null;
  let fileName: string | null = null;

  // Try original file first
  if (model.uploadPath) {
    const origPath = model.uploadPath.startsWith("/") ? model.uploadPath : join(process.cwd(), model.uploadPath);
    if (existsSync(origPath)) {
      filePath = origPath;
      fileName = `${displayName}.${origExt}`;
    } else {
      const fallback = join(process.cwd(), "static", "originals", `${model.id}.${origExt}`);
      if (existsSync(fallback)) {
        filePath = fallback;
        fileName = `${displayName}.${origExt}`;
      }
    }
  }

  // Fallback to gltf
  if (!filePath && model.gltfUrl) {
    const gltfPath = resolveFileUrlPath(model.gltfUrl);
    if (existsSync(gltfPath)) {
      filePath = gltfPath;
      fileName = previewAssetFileName(displayName, gltfPath);
    }
  }

  if (!filePath || !fileName) {
    res.status(404).json({ detail: "文件不存在" });
    return;
  }

  // Increment download count
  await prisma.shareLink.update({
    where: { id: share.id },
    data: { downloadCount: { increment: 1 } },
  });

  // Serve file
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_");
  const utf8Name = encodeURIComponent(fileName);
  res.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`);
  res.setHeader("Content-Type", "application/octet-stream");
  const stream = createReadStream(filePath);
  stream.pipe(res);
});

export default router;
