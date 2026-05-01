import { Router, Response } from "express";
import { existsSync } from "fs";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { createNotification } from "./notifications.js";
import archiver from "archiver";
import { getPreviewAssetExtension, withAssetVersion } from "../services/gltfAsset.js";
import { resolveDbModelDownloadTarget } from "../services/modelDownloadTarget.js";
import { getSetting } from "../lib/settings.js";
import { getBusinessConfig } from "../lib/businessConfig.js";
import { DailyDownloadLimitError, recordModelDownload } from "../services/modelDownloadRecorder.js";

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
            status: true, createdAt: true, updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(favorites.map((favorite: any) => ({
      ...favorite,
      model: favorite.model ? {
        ...favorite.model,
        thumbnailUrl: withAssetVersion(favorite.model.thumbnailUrl, favorite.model.updatedAt),
        gltfUrl: withAssetVersion(favorite.model.gltfUrl, favorite.model.updatedAt),
      } : favorite.model,
    })));
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
            message: `有用户收藏了模型「${model.name}」`,
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
  const uniqueModelIds = Array.from(new Set(modelIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())));
  if (uniqueModelIds.length === 0) {
    res.status(400).json({ detail: "请选择要下载的模型" });
    return;
  }
  const { pageSizePolicy } = await getBusinessConfig();
  const batchMax = Math.max(1, Math.floor(Number(pageSizePolicy.userBatchDownloadMax) || 100));
  if (uniqueModelIds.length > batchMax) {
    res.status(400).json({ detail: `单次最多下载 ${batchMax} 个模型` });
    return;
  }

  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId: req.user!.userId, modelId: { in: uniqueModelIds } },
      include: {
        model: {
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
          },
        },
      },
    });
    const modelById = new Map(
      favorites
        .map((favorite: any) => favorite.model)
        .filter((model: any) => model?.status === "completed")
        .map((model: any) => [model.id, model])
    );
    const models = uniqueModelIds.map((id) => modelById.get(id)).filter(Boolean);

    if (models.length === 0) {
      res.status(404).json({ detail: "没有可下载的模型" });
      return;
    }

    const downloadOriginal = format === "original";

    // Pre-scan files before committing response headers
    const fileEntries: Array<{ filePath: string; fileName: string; binPath?: string; record?: { modelId: string; format: string; fileSize: number } }> = [];
    for (const m of models) {
      const target = resolveDbModelDownloadTarget(m, downloadOriginal ? "original" : undefined);
      if (target && existsSync(target.filePath)) {
        const ext = getPreviewAssetExtension(target.filePath);
        const binPath = ext === "gltf" ? target.filePath.replace(/\.gltf$/, ".bin") : undefined;
        fileEntries.push({
          filePath: target.filePath,
          fileName: target.fileName,
          binPath: binPath && existsSync(binPath) ? binPath : undefined,
          record: target.record,
        });
      }
    }

    if (fileEntries.length === 0) {
      res.status(404).json({ detail: "没有找到可下载的文件" });
      return;
    }

    const dailyLimit = Number(await getSetting<number>("daily_download_limit")) || 0;
    if (dailyLimit > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const currentCount = await prisma.download.count({
        where: { userId: req.user!.userId, createdAt: { gte: today } },
      });
      if (currentCount + fileEntries.length > dailyLimit) {
        res.status(429).json({ detail: `每日下载次数已达上限 (${dailyLimit} 次)` });
        return;
      }
    }

    for (const entry of fileEntries) {
      if (!entry.record) continue;
      await recordModelDownload(prisma, {
        userId: req.user!.userId,
        ...entry.record,
        dailyLimit,
        noRecord: false,
      });
    }

    // Now safe to commit headers and stream
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="favorites_${Date.now()}.zip"`);

    const archive = archiver("zip", { zlib: { level: 5 } });
    archive.pipe(res);

    for (const entry of fileEntries) {
      const safeName = (entry.fileName.replace(/\.[^.]+$/, "") || "file").replace(/[<>:"/\\|?*]/g, "_");
      const ext = entry.filePath.split(".").pop();
      archive.file(entry.filePath, { name: `${safeName}.${ext}` });
      if (entry.binPath) {
        archive.file(entry.binPath, { name: `${safeName}.bin` });
      }
    }

    await archive.finalize();
  } catch (err: any) {
    console.error("[favorites] Batch download error:", err.message);
    if (!res.headersSent) {
      if (err instanceof DailyDownloadLimitError) {
        res.status(429).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: "打包下载失败" });
    }
  }
});

export default router;
