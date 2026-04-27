import { Router, Response } from "express";
import multer from "multer";
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, posix } from "node:path";
import archiver from "archiver";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { authMiddleware, verifyRequestToken, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { config } from "../lib/config.js";
import { sendAcceleratedFile } from "../lib/acceleratedDownload.js";
import { findPreviewAssetPath, getPreviewAssetExtension } from "../services/gltfAsset.js";
import { conversionQueue } from "../lib/queue.js";
import { cacheDelByPrefix } from "../lib/cache.js";
import { getBusinessConfig } from "../lib/businessConfig.js";

const router = Router();

const upload = multer({
  dest: join(config.uploadDir, "batch"),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB for batch ZIP
});

const MAX_BATCH_MODEL_FILES = 200;

function normalizeZipEntryName(entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return null;
  const clean = posix.normalize(normalized);
  if (clean === "." || clean === ".." || clean.startsWith("../")) return null;
  return clean;
}

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
    const output = createWriteStream(zipPath);

    archive.pipe(output);
    const outputClosed = once(output, "close");

    for (const model of models) {
      const gltfPath = findPreviewAssetPath(join(config.staticDir, "models"), model.id, model.gltfUrl);
      if (gltfPath && existsSync(gltfPath)) {
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
    await outputClosed;

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

    res.json({ url: `/api/batch/downloads/${zipName}`, count: models.length });
  } catch (err) {
    res.status(500).json({ detail: "批量下载失败" });
  }
});

router.get("/api/batch/downloads/:file", async (req, res: Response) => {
  const user = verifyRequestToken(req, { allowQueryToken: true });
  if (!user || user.role !== "ADMIN") {
    res.status(401).json({ detail: "需要管理员权限" });
    return;
  }

  const fileName = basename(String(req.params.file || ""));
  if (!/^batch_[0-9a-f]{8}\.zip$/i.test(fileName)) {
    res.status(400).json({ detail: "文件参数无效" });
    return;
  }

  const filePath = join(process.cwd(), config.staticDir, "batch", fileName);
  if (!existsSync(filePath)) {
    res.status(404).json({ detail: "文件不存在" });
    return;
  }

  sendAcceleratedFile(req, res, {
    filePath,
    fileName,
    contentType: "application/zip",
    disposition: "attachment",
  });
});

// Batch upload from ZIP
router.post("/api/batch/upload", authMiddleware, requireRole("ADMIN"), upload.single("file"), async (req: AuthRequest, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ detail: "没有文件" });
    return;
  }

  if (!file.originalname?.toLowerCase().endsWith(".zip")) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: "请上传 ZIP 文件" });
    return;
  }

  try {
    const { prisma } = await import("../lib/prisma.js");
    const { uploadPolicy } = await getBusinessConfig();
    const acceptedExts = uploadPolicy.modelFormats.map((item) => item.toLowerCase());
    const maxModelBytes = Math.max(1, uploadPolicy.modelMaxSizeMb) * 1024 * 1024;

    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(file.path);
    const results: any[] = [];
    const entries = zip.getEntries()
      .filter((entry) => !entry.isDirectory)
      .map((entry) => ({ entry, safeName: normalizeZipEntryName(entry.entryName) }))
      .filter((item) => Boolean(item.safeName))
      .slice(0, MAX_BATCH_MODEL_FILES);

    for (const { entry, safeName } of entries) {
      const cleanName = safeName!;
      const ext = cleanName.split(".").pop()?.toLowerCase();
      if (!ext || !acceptedExts.includes(ext)) continue;

      const modelId = randomUUID().slice(0, 12);
      const originalName = posix.basename(cleanName);
      let originalDest: string | null = null;

      try {
        const declaredSize = Number((entry as any).header?.size || 0);
        if (declaredSize > maxModelBytes) {
          results.push({ name: originalName, status: "failed", error: `文件过大，最大支持 ${uploadPolicy.modelMaxSizeMb}MB` });
          continue;
        }

        const data = entry.getData();
        if (data.length <= 0 || data.length > maxModelBytes) {
          results.push({ name: originalName, status: "failed", error: `文件大小异常，最大支持 ${uploadPolicy.modelMaxSizeMb}MB` });
          continue;
        }

        const originalsDir = join(config.staticDir, "originals");
        mkdirSync(originalsDir, { recursive: true });
        originalDest = join(originalsDir, `${modelId}.${ext}`);
        writeFileSync(originalDest, data);

        if (prisma) {
          await prisma.model.create({
            data: {
              id: modelId,
              name: originalName.replace(/\.[^.]+$/, ""),
              originalName,
              originalFormat: ext,
              originalSize: data.length,
              gltfUrl: "",
              gltfSize: 0,
              format: ext,
              status: "queued",
              uploadPath: originalDest,
              createdById: req.user!.userId,
            },
          });
        }

        try {
          await conversionQueue.add("convert", {
            modelId,
            filePath: originalDest,
            originalName,
            ext,
            userId: req.user!.userId,
            preserveSource: true,
          });
          results.push({ model_id: modelId, name: originalName, status: "queued" });
        } catch (err) {
          if (prisma) {
            await prisma.model.update({ where: { id: modelId }, data: { status: "failed" } }).catch(() => {});
          }
          results.push({ model_id: modelId, name: originalName, status: "failed", error: "转换队列暂不可用" });
        }
      } catch (err) {
        if (originalDest && existsSync(originalDest)) rmSync(originalDest, { force: true });
        results.push({ name: originalName, status: "failed", error: (err as Error).message });
      }
    }

    rmSync(file.path, { force: true });
    if (results.some((item) => item.status === "queued")) {
      await cacheDelByPrefix("cache:models:");
    }

    res.json({ total: results.length, results });
  } catch (err) {
    rmSync(file.path, { force: true });
    res.status(500).json({ detail: "批量上传处理失败" });
  }
});

export default router;
