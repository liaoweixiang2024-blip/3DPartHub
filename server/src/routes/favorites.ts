import { Router, Response } from "express";
import { existsSync, createReadStream } from "fs";
import { join } from "path";
import { PassThrough } from "stream";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { config } from "../lib/config.js";
import { createNotification } from "./notifications.js";
import archiver from "archiver";

const router = Router();

function param(req: { params: Record<string, string | string[]> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

// List user's favorites
router.get("/api/favorites", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId: req.user!.userId },
      include: {
        model: {
          select: {
            id: true, name: true, originalName: true, format: true,
            thumbnailUrl: true, gltfUrl: true, gltfSize: true, originalSize: true,
            status: true, createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(favorites);
  } catch {
    res.status(500).json({ detail: "获取收藏列表失败" });
  }
});

// Add to favorites
router.post("/api/models/:id/favorite", authMiddleware, async (req: AuthRequest, res: Response) => {
  const modelId = param(req, "id");
  try {
    const favorite = await prisma.favorite.create({
      data: { userId: req.user!.userId, modelId },
    });
    // Notify model owner about new favorite
    if (prisma) {
      try {
        const model = await prisma.model.findUnique({ where: { id: modelId }, select: { createdById: true, name: true } });
        if (model && model.createdById !== req.user!.userId) {
          await createNotification({
            userId: model.createdById,
            title: "新收藏",
            message: `${req.user!.username || "用户"} 收藏了模型「${model.name}」`,
            type: "favorite",
            relatedId: modelId,
          });
        }
      } catch {}
    }
    res.json(favorite);
  } catch (err: any) {
    if (err.code === "P2002") {
      res.json({ message: "已收藏" });
      return;
    }
    res.status(500).json({ detail: "收藏失败" });
  }
});

// Remove from favorites
router.delete("/api/models/:id/favorite", authMiddleware, async (req: AuthRequest, res: Response) => {
  const modelId = param(req, "id");
  try {
    await prisma.favorite.deleteMany({
      where: { userId: req.user!.userId, modelId },
    });
    res.json({ message: "已取消收藏" });
  } catch {
    res.status(500).json({ detail: "取消收藏失败" });
  }
});

// Batch remove favorites
router.post("/api/favorites/batch-remove", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { modelIds } = req.body as { modelIds: string[] };
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    res.status(400).json({ detail: "请选择要取消收藏的模型" });
    return;
  }
  try {
    const result = await prisma.favorite.deleteMany({
      where: {
        userId: req.user!.userId,
        modelId: { in: modelIds },
      },
    });
    res.json({ removed: result.count });
  } catch {
    res.status(500).json({ detail: "批量取消收藏失败" });
  }
});

// Batch download favorites as ZIP
router.post("/api/favorites/batch-download", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { modelIds, format } = req.body as { modelIds: string[]; format?: string };
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    res.status(400).json({ detail: "请选择要下载的模型" });
    return;
  }
  if (modelIds.length > 100) {
    res.status(400).json({ detail: "单次最多下载 100 个模型" });
    return;
  }

  try {
    const models = await prisma.model.findMany({
      where: { id: { in: modelIds }, status: "completed" },
      select: { id: true, name: true, originalName: true, format: true, gltfUrl: true, uploadPath: true },
    });

    if (models.length === 0) {
      res.status(404).json({ detail: "没有可下载的模型" });
      return;
    }

    const downloadOriginal = format === "original";

    // Set up ZIP streaming
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="favorites_${Date.now()}.zip"`);

    const archive = archiver("zip", { zlib: { level: 5 } });
    archive.pipe(res);

    const staticDir = join(process.cwd(), config.staticDir);
    let added = 0;

    for (const m of models) {
      let filePath: string | null = null;
      let fileName: string;

      if (downloadOriginal && m.uploadPath) {
        // Try uploadPath first, then convention
        const origPath = m.uploadPath.startsWith("/")
          ? join(process.cwd(), m.uploadPath.slice(1))
          : m.uploadPath;
        if (existsSync(origPath)) {
          filePath = origPath;
        } else {
          const convPath = join(staticDir, "originals", `${m.id}.${m.format}`);
          if (existsSync(convPath)) filePath = convPath;
        }
        fileName = m.originalName || `${m.name || m.id}.${m.format}`;
      }

      if (!filePath && m.gltfUrl) {
        const gltfPath = m.gltfUrl.startsWith("/")
          ? join(process.cwd(), m.gltfUrl.slice(1))
          : m.gltfUrl;
        if (existsSync(gltfPath)) {
          filePath = gltfPath;
          fileName = `${m.name || m.id}.gltf`;
          // Also add the .bin file if exists
          const binPath = gltfPath.replace(/\.gltf$/, ".bin");
          if (existsSync(binPath)) {
            archive.file(binPath, { name: `${m.name || m.id}.bin` });
          }
        }
      }

      if (filePath && existsSync(filePath)) {
        // Sanitize name to avoid path traversal
        const safeName = (m.name || m.id).replace(/[<>:"/\\|?*]/g, "_");
        const ext = filePath.split(".").pop();
        archive.file(filePath, { name: `${safeName}.${ext}` });
        added++;
      }
    }

    if (added === 0) {
      archive.destroy();
      res.status(404).json({ detail: "没有找到可下载的文件" });
      return;
    }

    await archive.finalize();
  } catch (err: any) {
    console.error("[favorites] Batch download error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ detail: "打包下载失败" });
    }
  }
});

export default router;
