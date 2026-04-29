import { Router, Response } from "express";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cacheDelByPrefix } from "../../lib/cache.js";
import { config } from "../../lib/config.js";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { removeExistingFiles, removeModelFiles } from "../../services/modelFiles.js";
import { modelUpload } from "./uploadHelpers.js";

type ModelManagementContext = {
  prisma: any;
  metadataDir: string;
  getMeta: (id: string) => Record<string, unknown> | null;
  saveMeta: (id: string, data: Record<string, unknown>) => void;
};

export function createModelManagementRouter({ prisma, metadataDir, getMeta, saveMeta }: ModelManagementContext) {
  const router = Router();

  // Update model info (requires auth)
  router.put("/api/models/:id", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { name, description, categoryId } = req.body;

    if (prisma) {
      try {
        const model = await prisma.model.findUnique({ where: { id } });
        if (!model) {
          res.status(404).json({ detail: "模型不存在" });
          return;
        }

        const updated = await prisma.model.update({
          where: { id },
          data: {
            ...(name !== undefined && { name }),
            ...(description !== undefined && { description }),
            ...(categoryId !== undefined && { categoryId }),
          },
          include: { categoryRef: { select: { name: true } } },
        });

        await cacheDelByPrefix("cache:models:");

        res.json({
          model_id: updated.id,
          name: updated.name,
          original_name: updated.originalName,
          description: updated.description,
          category: (updated as any).categoryRef?.name || null,
          format: updated.format,
          status: updated.status,
        });
        return;
      } catch {
        res.status(500).json({ detail: "更新失败" });
        return;
      }
    }

    // Filesystem fallback
    const meta = getMeta(id);
    if (!meta) {
      res.status(404).json({ detail: "模型不存在" });
      return;
    }
    if (name !== undefined) meta.name = name;
    if (description !== undefined) meta.description = description;
    if (categoryId !== undefined) meta.category = categoryId;
    saveMeta(id, meta);
    res.json({ model_id: id, ...meta });
  });

  // Delete model requires auth
  router.delete("/api/models/:id", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    // Collect format info + group info before deleting from DB
    let dbFileInfo: { format?: string | null; originalFormat?: string | null; uploadPath?: string | null } | null = null;
    let relatedStaticUrls: string[] = [];
    if (prisma) {
      try {
        const dbModel = await prisma.model.findUnique({
          where: { id },
          select: {
            format: true,
            originalFormat: true,
            uploadPath: true,
            drawingUrl: true,
            groupId: true,
            group: { select: { id: true, primaryId: true } },
            versions: { select: { fileKey: true } },
          },
        });
        dbFileInfo = dbModel
          ? { format: dbModel.format, originalFormat: dbModel.originalFormat, uploadPath: dbModel.uploadPath }
          : null;
        relatedStaticUrls = [
          dbModel?.drawingUrl,
          ...(dbModel?.versions.map((version: { fileKey: string | null }) => version.fileKey) || []),
        ].filter(Boolean) as string[];

        // If this model is the primary of its group, transfer primary to the newest remaining variant
        if (dbModel?.group && dbModel.group.primaryId === id) {
          const remaining = await prisma.model.findMany({
            where: { groupId: dbModel.groupId, id: { not: id } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true },
          });
          if (remaining.length > 0) {
            await prisma.modelGroup.update({
              where: { id: dbModel.groupId },
              data: { primaryId: remaining[0].id },
            });
          } else {
            // No remaining variants - delete the group too
            await prisma.modelGroup.delete({ where: { id: dbModel.groupId } }).catch(() => {});
          }
        }
      } catch {}
    }

    const meta = getMeta(id);
    const cleanup = removeModelFiles(meta
      ? {
          id,
          uploadPath: meta.upload_path as string | undefined,
          format: meta.format as string | undefined,
          originalFormat: dbFileInfo?.originalFormat || dbFileInfo?.format,
        }
      : {
          id,
          uploadPath: dbFileInfo?.uploadPath,
          format: dbFileInfo?.format,
          originalFormat: dbFileInfo?.originalFormat,
        });
    if (cleanup.failed.length > 0) {
      console.warn("[models] Some model files could not be deleted:", cleanup.failed);
    }

    const staticUrlCleanup = removeExistingFiles(relatedStaticUrls.map((url) => {
      const cleanUrl = String(url).split("?")[0];
      if (!cleanUrl.startsWith("/static/")) return null;
      return join(config.staticDir, cleanUrl.slice("/static/".length));
    }));
    if (staticUrlCleanup.failed.length > 0) {
      console.warn("[models] Some related static files could not be deleted:", staticUrlCleanup.failed);
    }

    // Delete from database after files are cleaned up
    if (prisma) {
      try {
        await prisma.model.delete({ where: { id } }).catch(() => {});
        await cacheDelByPrefix("cache:models:");
      } catch { /* ignore */ }
    }

    const metaPath = join(metadataDir, `${id}.json`);
    const metaCleanup = removeExistingFiles([metaPath]);
    if (metaCleanup.failed.length > 0) {
      console.warn("[models] Metadata file could not be deleted:", metaCleanup.failed);
    }

    res.json({ message: "删除成功" });
  });

  // Upload custom thumbnail for a model
  router.post("/api/models/:id/thumbnail", authMiddleware, requireRole("ADMIN"), modelUpload.single("file"), async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const file = req.file;

    if (!file) {
      res.status(400).json({ detail: "没有文件" });
      return;
    }

    // Validate image type
    const allowedMimes = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (!allowedMimes.has(file.mimetype || "")) {
      rmSync(file.path, { force: true });
      res.status(400).json({ detail: "仅支持 PNG/JPEG/WebP 格式的图片" });
      return;
    }

    if (!prisma) {
      rmSync(file.path, { force: true });
      res.status(503).json({ detail: "数据库未连接" });
      return;
    }

    try {
      const m = await prisma.model.findUnique({ where: { id } });
      if (!m) {
        rmSync(file.path, { force: true });
        res.status(404).json({ detail: "模型不存在" });
        return;
      }

      // Save thumbnail as {id}.png in thumbnails dir
      const thumbDir = join(config.staticDir, "thumbnails");
      mkdirSync(thumbDir, { recursive: true });
      const thumbPath = join(thumbDir, `${id}.png`);

      // Move uploaded file to thumbnail path
      copyFileSync(file.path, thumbPath);
      rmSync(file.path, { force: true });

      const ts = Date.now();
      const thumbnailUrl = `/static/thumbnails/${id}.png?t=${ts}`;

      await prisma.model.update({
        where: { id },
        data: { thumbnailUrl },
      });

      await cacheDelByPrefix("cache:models:");

      res.json({ success: true, data: { model_id: id, thumbnail_url: thumbnailUrl } });
    } catch (err: any) {
      rmSync(file.path, { force: true });
      res.status(500).json({ detail: err.message || "上传预览图失败" });
    }
  });

  return router;
}
