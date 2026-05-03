import { Router, Request, Response } from "express";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cacheDelByPrefix } from "../../lib/cache.js";
import { config } from "../../lib/config.js";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { requireBrowseAccess } from "../../middleware/browseAccess.js";
import { requireRole } from "../../middleware/rbac.js";
import { convertStepToGltf } from "../../services/converter.js";
import { MODEL_STATUS } from "../../services/modelStatus.js";
import { generateThumbnail } from "../../services/thumbnail.js";
import { convertXtToGltf } from "../../services/xt-converter.js";
import { modelUpload, validateModelUpload } from "./uploadHelpers.js";

type ModelVersionsContext = {
  prisma: any;
  optionalVerifiedUser: (req: Request) => Promise<{ role?: string | null } | null>;
};

export function createModelVersionsRouter({ prisma, optionalVerifiedUser }: ModelVersionsContext) {
  const router = Router();

  // List model versions
  router.get("/api/models/:id/versions", async (req: Request, res: Response) => {
    if (!(await requireBrowseAccess(req, res))) return;

    const modelId = req.params.id;
    if (!prisma) {
      res.status(503).json({ detail: "数据库未连接" });
      return;
    }
    try {
      const authPayload = await optionalVerifiedUser(req);
      const model = await prisma.model.findUnique({ where: { id: modelId }, select: { id: true, status: true } });
      if (!model || (model.status !== MODEL_STATUS.COMPLETED && authPayload?.role !== "ADMIN")) {
        res.status(404).json({ detail: "模型不存在" });
        return;
      }
      const versions = await prisma.modelVersion.findMany({
        where: { modelId },
        orderBy: { versionNumber: "desc" },
        include: { createdBy: { select: { id: true, username: true } } },
      });
      res.json(versions);
    } catch {
      res.status(500).json({ detail: "获取版本列表失败" });
    }
  });

  // Upload new version
  router.post("/api/models/:id/versions", authMiddleware, requireRole("ADMIN"), modelUpload.single("file"), async (req: AuthRequest, res: Response) => {
    const modelId = req.params.id as string;
    const file = req.file;
    const changeLog = req.body.changeLog as string | undefined;

    if (!file) {
      res.status(400).json({ detail: "没有文件" });
      return;
    }

    if (!prisma) {
      res.status(503).json({ detail: "数据库未连接" });
      return;
    }

    try {
      const model = await prisma.model.findUnique({ where: { id: modelId } });
      if (!model) {
        res.status(404).json({ detail: "模型不存在" });
        return;
      }

      if (model.status === MODEL_STATUS.QUEUED || model.status === MODEL_STATUS.PROCESSING) {
        try { rmSync(file.path, { force: true }); } catch {}
        res.status(409).json({ detail: "模型正在转换中，请稍后重试" });
        return;
      }

      const ext = await validateModelUpload(file, res);
      if (!ext) return;

      const updated = await prisma.model.update({
        where: { id: modelId },
        data: { currentVersion: { increment: 1 } },
        select: { currentVersion: true },
      });
      const versionNumber = updated.currentVersion;

      const modelDir = join(config.staticDir, "models");
      let result: Awaited<ReturnType<typeof convertStepToGltf>>;
      try {
        if (ext === "xt" || ext === "x_t") {
          result = await convertXtToGltf(file.path, modelDir, `${modelId}_v${versionNumber}`, file.originalname || "model.xt");
        } else {
          result = await convertStepToGltf(file.path, modelDir, `${modelId}_v${versionNumber}`, file.originalname || "model.step");
        }
      } finally {
        try { rmSync(file.path, { force: true }); } catch {}
      }

      const version = await prisma.modelVersion.create({
        data: {
          modelId,
          versionNumber,
          fileKey: result.gltfUrl,
          format: ext,
          fileSize: result.gltfSize,
          previewMeta: result.previewMeta,
          changeLog: changeLog || `版本 ${versionNumber}`,
          createdById: req.user!.userId,
        },
      });

      let thumbnailUrl: string | null = null;
      if (existsSync(result.gltfPath)) {
        try {
          const thumb = await generateThumbnail(result.gltfPath, join(config.staticDir, "thumbnails"), modelId);
          thumbnailUrl = `${thumb.thumbnailUrl}?t=${Date.now()}`;
        } catch { /* non-critical */ }
      }

      await prisma.model.update({
        where: { id: modelId },
        data: {
          gltfUrl: result.gltfUrl,
          gltfSize: result.gltfSize,
          previewMeta: result.previewMeta,
          ...(thumbnailUrl && { thumbnailUrl }),
          status: MODEL_STATUS.COMPLETED,
        },
      });

      await cacheDelByPrefix("cache:models:");

      res.json({
        version_id: version.id,
        version_number: versionNumber,
        file_key: result.gltfUrl,
        format: ext,
        file_size: result.gltfSize,
        change_log: changeLog,
      });
    } catch (err: unknown) {
      console.error("[versions] Upload failed:", err);
      res.status(500).json({ detail: "上传版本失败" });
    }
  });

  // Rollback to a specific version
  router.post("/api/models/:id/versions/:versionId/rollback", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
    const modelId = req.params.id as string;
    const versionId = req.params.versionId as string;

    if (!prisma) {
      res.status(503).json({ detail: "数据库未连接" });
      return;
    }

    try {
      const version = await prisma.modelVersion.findUnique({ where: { id: versionId } });
      if (!version || version.modelId !== modelId) {
        res.status(404).json({ detail: "版本不存在" });
        return;
      }

      const currentModel = await prisma.model.findUnique({ where: { id: modelId }, select: { status: true } });
      if (currentModel?.status === MODEL_STATUS.QUEUED || currentModel?.status === MODEL_STATUS.PROCESSING) {
        res.status(409).json({ detail: "模型正在转换中，无法回滚" });
        return;
      }

      const glbPath = join(config.staticDir, "models", version.fileKey);
      if (!existsSync(glbPath)) {
        res.status(410).json({ detail: "版本文件不存在，无法回滚" });
        return;
      }

      let thumbnailUrl: string | null = null;
      try {
        const thumb = await generateThumbnail(glbPath, join(config.staticDir, "thumbnails"), modelId);
        thumbnailUrl = `${thumb.thumbnailUrl}?t=${Date.now()}`;
      } catch { /* non-critical */ }

      await prisma.model.update({
        where: { id: modelId },
        data: {
          gltfUrl: version.fileKey,
          gltfSize: version.fileSize,
          previewMeta: version.previewMeta,
          ...(thumbnailUrl && { thumbnailUrl }),
          status: MODEL_STATUS.COMPLETED,
        },
      });

      await cacheDelByPrefix("cache:models:");

      res.json({ message: "已回滚", version_number: version.versionNumber });
    } catch {
      res.status(500).json({ detail: "回滚失败" });
    }
  });

  return router;
}
