import { Router, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { existsSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";
import { getSetting } from "../lib/settings.js";

const router = Router();

// ========== Authenticated endpoints ==========

// Create share link
router.post("/api/shares", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { modelId, password, allowPreview = true, allowDownload = true, downloadLimit = 0, expiresAt } = req.body;

  if (!modelId) {
    res.status(400).json({ detail: "缺少 modelId" });
    return;
  }

  const model = await prisma.model.findUnique({ where: { id: modelId } });
  if (!model) {
    res.status(404).json({ detail: "模型不存在" });
    return;
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
      expiresAt: expiresAt ? new Date(expiresAt) : null,
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
  });

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
  const modelId = req.params.id;
  const userId = req.user!.userId;
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
  const { id } = req.params;

  const share = await prisma.shareLink.findUnique({ where: { id } });
  if (!share || share.createdById !== userId) {
    res.status(404).json({ detail: "分享链接不存在" });
    return;
  }

  await prisma.shareLink.delete({ where: { id } });
  res.json({ ok: true });
});

// ========== Public endpoints ==========

// Get share info
router.get("/api/shares/:token/info", async (req: Request, res: Response) => {
  const { token } = req.params;

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
  });

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
    gltfUrl: share.allowPreview ? model.gltfUrl : undefined,
  });
});

// Verify password
router.post("/api/shares/:token/verify", async (req: Request, res: Response) => {
  const { token } = req.params;
  const { password } = req.body;

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
  const { token } = req.params;

  const share = await prisma.shareLink.findUnique({
    where: { token },
    include: { model: true },
  });

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
    const gltfPath = model.gltfUrl.startsWith("/") ? model.gltfUrl : join(process.cwd(), model.gltfUrl);
    if (existsSync(gltfPath)) {
      filePath = gltfPath;
      fileName = `${displayName}.gltf`;
    }
  }

  if (!filePath) {
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
