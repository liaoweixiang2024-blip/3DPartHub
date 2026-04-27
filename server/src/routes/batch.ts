import { Router, Response } from "express";
import multer from "multer";
import { copyFileSync, createReadStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import { randomUUID } from "node:crypto";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { config } from "../lib/config.js";
import { getPreviewAssetExtension, resolveFileUrlPath } from "../services/gltfAsset.js";

const router = Router();

const upload = multer({
  dest: join(config.uploadDir, "batch"),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB for batch ZIP
});

// Batch download — create ZIP of multiple models' preview assets
router.post("/api/batch/download", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { modelIds, format } = req.body;

  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    res.status(400).json({ detail: "请选择要下载的模型" });
    return;
  }

  if (modelIds.length > 50) {
    res.status(400).json({ detail: "一次最多下载 50 个模型" });
    return;
  }

  try {
    // Dynamic import to avoid loading prisma if not needed
    const { prisma } = await import("../lib/prisma.js");
    if (!prisma) {
      res.status(503).json({ detail: "数据库未连接" });
      return;
    }

    const models = await prisma.model.findMany({
      where: { id: { in: modelIds }, status: "completed" },
    });

    if (models.length === 0) {
      res.status(404).json({ detail: "没有可下载的模型" });
      return;
    }

    const zipName = `batch_${randomUUID().slice(0, 8)}.zip`;
    const zipPath = join(config.staticDir, "batch", zipName);
    mkdirSync(join(config.staticDir, "batch"), { recursive: true });

    const archive = archiver("zip", { zlib: { level: 5 } });
    const output = require("fs").createWriteStream(zipPath);

    archive.pipe(output);

    for (const model of models) {
      const gltfPath = resolveFileUrlPath(model.gltfUrl);
      if (existsSync(gltfPath)) {
        const ext = getPreviewAssetExtension(gltfPath);
        const fileName = `${model.name || model.id}.${model.format}.${ext}`;
        archive.file(gltfPath, { name: fileName });

        // Legacy glTF assets need their external .bin next to them.
        const binPath = gltfPath.replace(/\.gltf$/i, ".bin");
        if (ext === "gltf" && existsSync(binPath)) {
          archive.file(binPath, { name: `${model.name || model.id}.${model.format}.bin` });
        }
      }
    }

    await archive.finalize();

    // Record downloads
    for (const model of models) {
      try {
        await prisma.download.create({
          data: {
            userId: req.user!.userId,
            modelId: model.id,
            format: "zip-batch",
            fileSize: model.gltfSize,
          },
        });
        await prisma.model.update({
          where: { id: model.id },
          data: { downloadCount: { increment: 1 } },
        });
      } catch { /* ignore */ }
    }

    res.json({ url: `/static/batch/${zipName}`, count: models.length });
  } catch (err) {
    res.status(500).json({ detail: "批量下载失败" });
  }
});

// Batch upload from ZIP
router.post("/api/batch/upload", authMiddleware, requireRole("ADMIN"), upload.single("file"), async (req: AuthRequest, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ detail: "没有文件" });
    return;
  }

  if (!file.originalname?.endsWith(".zip")) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: "请上传 ZIP 文件" });
    return;
  }

  try {
    const { convertStepToGltf } = await import("../services/converter.js");
    const { generateThumbnail } = await import("../services/thumbnail.js");
    const { prisma } = await import("../lib/prisma.js");

    // Extract ZIP
    const extractDir = join(config.uploadDir, "batch", file.filename);
    mkdirSync(extractDir, { recursive: true });

    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(file.path);
    zip.extractAllTo(extractDir, true);

    // Find supported files
    const ACCEPTED_EXTS = ["step", "stp", "iges", "igs", "xt", "x_t"];
    const results: any[] = [];
    const entries = zip.getEntries();

    for (const entry of entries) {
      const ext = entry.entryName.split(".").pop()?.toLowerCase();
      if (!ext || !ACCEPTED_EXTS.includes(ext)) continue;
      if (entry.isDirectory) continue;

      const filePath = join(extractDir, entry.entryName);
      if (!existsSync(filePath)) continue;

      const modelId = randomUUID().slice(0, 12);
      const originalName = entry.entryName.split("/").pop() || entry.entryName;
      let originalDest: string | null = null;

      try {
        const originalsDir = join(config.staticDir, "originals");
        mkdirSync(originalsDir, { recursive: true });
        originalDest = join(originalsDir, `${modelId}.${ext}`);
        copyFileSync(filePath, originalDest);
        const originalSize = statSync(originalDest).size;

        let result;
        if (ext === "xt" || ext === "x_t") {
          result = await convertXtToGltfLocal(originalDest, join(config.staticDir, "models"), modelId, originalName);
        } else {
          result = await convertStepToGltf(originalDest, join(config.staticDir, "models"), modelId, originalName);
        }

        const thumb = await generateThumbnail(result.gltfPath, join(config.staticDir, "thumbnails"), modelId);

        if (prisma) {
          await prisma.model.create({
            data: {
              id: modelId,
              name: originalName.replace(/\.[^.]+$/, ""),
              originalName,
              originalFormat: ext,
              originalSize,
              gltfUrl: result.gltfUrl,
              gltfSize: result.gltfSize,
              thumbnailUrl: thumb.thumbnailUrl,
              format: ext,
              status: "completed",
              uploadPath: originalDest,
              createdById: req.user!.userId,
            },
          });
        }

        results.push({ model_id: modelId, name: originalName, status: "completed" });
      } catch (err) {
        if (originalDest && existsSync(originalDest)) rmSync(originalDest, { force: true });
        results.push({ name: originalName, status: "failed", error: (err as Error).message });
      }
    }

    // Clean up
    rmSync(extractDir, { recursive: true, force: true });
    rmSync(file.path, { force: true });

    res.json({ total: results.length, results });
  } catch (err) {
    rmSync(file.path, { force: true });
    res.status(500).json({ detail: "批量上传处理失败" });
  }
});

// Stub for XT conversion in batch (reuse existing)
async function convertXtToGltfLocal(sourcePath: string, outputDir: string, modelId: string, name: string) {
  const { convertXtToGltf } = await import("../services/xt-converter.js");
  return convertXtToGltf(sourcePath, outputDir, modelId, name);
}

export default router;
