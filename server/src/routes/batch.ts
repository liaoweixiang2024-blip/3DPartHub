import { Router, Response } from "express";
import multer from "multer";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, posix } from "node:path";
import archiver from "archiver";
import { createExtractorFromData } from "node-unrar-js";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { authMiddleware, verifyRequestToken, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { config } from "../lib/config.js";
import { sendAcceleratedFile } from "../lib/acceleratedDownload.js";
import { consumeProtectedResourceToken, createProtectedResourceToken } from "../lib/downloadTokenStore.js";
import { optionalString } from "../lib/requestValidation.js";
import { findPreviewAssetPath, getPreviewAssetExtension } from "../services/gltfAsset.js";
import { conversionQueue } from "../lib/queue.js";
import { clearCategoryCache } from "./categories/common.js";
import { cacheDelByPrefix } from "../lib/cache.js";
import { getBusinessConfig } from "../lib/businessConfig.js";
import { normalizeUploadFilename } from "../lib/filenameEncoding.js";
import { MODEL_STATUS } from "../services/modelStatus.js";

const router = Router();

const ALLOWED_ARCHIVE_MIMES = new Set([
  "application/zip", "application/x-zip-compressed", "application/x-zip",
  "application/vnd.rar", "application/x-rar-compressed",
]);

const upload = multer({
  dest: join(config.uploadDir, "batch"),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB for batch archives
  fileFilter(_req, file, cb) {
    if (ALLOWED_ARCHIVE_MIMES.has(file.mimetype) || file.originalname.toLowerCase().endsWith(".zip") || file.originalname.toLowerCase().endsWith(".rar")) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的批量上传格式: ${file.mimetype}`));
    }
  },
});

const MAX_BATCH_MODEL_FILES = 200;

function normalizeZipEntryName(entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return null;
  const clean = posix.normalize(normalized);
  if (clean === "." || clean === ".." || clean.startsWith("../")) return null;
  return clean;
}

function isSupportedBatchArchive(fileName: string) {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".zip") || lower.endsWith(".rar");
}

// Batch download — create ZIP of multiple models' preview assets
router.post("/api/batch/download", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { modelIds, format } = req.body;

  let zipPath: string | undefined;

  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    res.status(400).json({ detail: "请选择要下载的模型" });
    return;
  }

  const { pageSizePolicy } = await getBusinessConfig();
  const batchMax = Math.max(1, Math.floor(Number(pageSizePolicy.adminBatchDownloadMax) || 50));
  if (modelIds.length > batchMax) {
    res.status(400).json({ detail: `一次最多下载 ${batchMax} 个模型` });
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
      where: { id: { in: modelIds }, status: MODEL_STATUS.COMPLETED },
    });

    if (models.length === 0) {
      res.status(404).json({ detail: "没有可下载的模型" });
      return;
    }

    const zipName = `batch_${randomUUID().slice(0, 8)}.zip`;
    zipPath = join(config.staticDir, "batch", zipName);
    mkdirSync(join(config.staticDir, "batch"), { recursive: true });

    const archive = archiver("zip", { zlib: { level: 5 } });
    const output = createWriteStream(zipPath);

    archive.pipe(output);
    const outputClosed = once(output, "close");

    const archivedModelIds = new Set<string>();

    for (const model of models) {
      const gltfPath = findPreviewAssetPath(join(config.staticDir, "models"), model.id, model.gltfUrl);
      if (gltfPath && existsSync(gltfPath)) {
        const ext = getPreviewAssetExtension(gltfPath);
        const safeName = (model.name || model.id).replace(/[<>:"/\\|?*]/g, "_");
        const fileName = `${safeName}.${model.format}.${ext}`;
        archive.file(gltfPath, { name: fileName });

        const binPath = gltfPath.replace(/\.gltf$/i, ".bin");
        if (ext === "gltf" && existsSync(binPath)) {
          archive.file(binPath, { name: `${safeName}.${model.format}.bin` });
        }
        archivedModelIds.add(model.id);
      }
    }

    await archive.finalize();
    await outputClosed;

    // Record downloads only for models actually archived
    for (const model of models) {
      if (!archivedModelIds.has(model.id)) continue;
      try {
        await prisma.$transaction([
          prisma.download.create({
            data: {
              userId: req.user!.userId,
              modelId: model.id,
              format: "zip-batch",
              fileSize: model.gltfSize,
            },
          }),
          prisma.model.update({
            where: { id: model.id },
            data: { downloadCount: { increment: 1 } },
          }),
        ]);
      } catch { /* ignore */ }
    }

    const token = createProtectedResourceToken({
      type: "batch-download",
      resourceId: zipName,
      userId: req.user!.userId,
      role: req.user!.role,
      singleUse: true,
    });

    res.json({
      url: `/api/batch/downloads/${zipName}?download_token=${encodeURIComponent(token.token)}`,
      count: archivedModelIds.size,
    });
  } catch (err) {
    try { if (typeof zipPath !== "undefined") rmSync(zipPath, { force: true }); } catch {}
    res.status(500).json({ detail: "批量下载失败" });
  }
});

router.get("/api/batch/downloads/:file", async (req, res: Response) => {
  const fileName = basename(String(req.params.file || ""));
  if (!/^batch_[0-9a-f]{8}\.zip$/i.test(fileName)) {
    res.status(400).json({ detail: "文件参数无效" });
    return;
  }

  const queryToken = optionalString(req.query.download_token, { maxLength: 160 });
  const tokenPayload = queryToken ? consumeProtectedResourceToken(queryToken, "batch-download", fileName) : null;
  if (queryToken && !tokenPayload) {
    res.status(401).json({ detail: "下载令牌无效或已过期" });
    return;
  }

  const user = tokenPayload || verifyRequestToken(req);
  if (!user || user.role !== "ADMIN") {
    res.status(401).json({ detail: "需要管理员权限" });
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

  const cleanup = () => {
    try { rmSync(filePath, { force: true }); } catch {}
  };
  res.on("close", cleanup);
  setTimeout(cleanup, 600_000);
});

// Batch upload from ZIP/RAR
router.post("/api/batch/upload", authMiddleware, requireRole("ADMIN"), upload.single("file"), async (req: AuthRequest, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ detail: "没有文件" });
    return;
  }

  if (!isSupportedBatchArchive(file.originalname || "")) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: "请上传 ZIP 或 RAR 压缩包" });
    return;
  }

  try {
    const { prisma } = await import("../lib/prisma.js");
    const { uploadPolicy } = await getBusinessConfig();
    const acceptedExts = uploadPolicy.modelFormats.map((item) => item.toLowerCase());
    const maxModelBytes = Math.max(1, uploadPolicy.modelMaxSizeMb) * 1024 * 1024;
    const categoryId = optionalString(req.body?.categoryId, { maxLength: 80 }) || null;
    const results: any[] = [];

    const queueModelFromBuffer = async (originalName: string, ext: string, data: Buffer) => {
      const modelId = randomUUID().slice(0, 12);
      let originalDest: string | null = null;

      try {
        if (data.length <= 0 || data.length > maxModelBytes) {
          results.push({ name: originalName, status: MODEL_STATUS.FAILED, error: `文件大小异常，最大支持 ${uploadPolicy.modelMaxSizeMb}MB` });
          return;
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
              status: MODEL_STATUS.QUEUED,
              uploadPath: originalDest,
              createdById: req.user!.userId,
              ...(categoryId && { categoryId }),
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
          results.push({ model_id: modelId, name: originalName, status: MODEL_STATUS.QUEUED });
        } catch (err) {
          if (prisma) {
            await prisma.model.update({ where: { id: modelId }, data: { status: MODEL_STATUS.FAILED } }).catch(() => {});
          }
          results.push({ model_id: modelId, name: originalName, status: MODEL_STATUS.FAILED, error: "转换队列暂不可用" });
        }
      } catch (err) {
        if (originalDest && existsSync(originalDest)) rmSync(originalDest, { force: true });
        results.push({ name: originalName, status: MODEL_STATUS.FAILED, error: (err as Error).message });
      }
    };

    if (file.originalname.toLowerCase().endsWith(".zip")) {
      const AdmZip = (await import("adm-zip")).default;
      const zip = new AdmZip(file.path);
      const entries = zip.getEntries()
        .filter((entry) => !entry.isDirectory)
        .map((entry) => ({ entry, safeName: normalizeZipEntryName(entry.entryName) }))
        .filter((item) => Boolean(item.safeName))
        .slice(0, MAX_BATCH_MODEL_FILES);

      const maxTotalExtractBytes = maxModelBytes * MAX_BATCH_MODEL_FILES;
      let totalExtractedBytes = 0;

      for (const { entry, safeName } of entries) {
        const cleanName = safeName!;
        const ext = cleanName.split(".").pop()?.toLowerCase();
        if (!ext || !acceptedExts.includes(ext)) continue;
        const originalName = normalizeUploadFilename(posix.basename(cleanName));
        const data = entry.getData();
        if (data.length > maxModelBytes || totalExtractedBytes + data.length > maxTotalExtractBytes) {
          results.push({ name: originalName, status: MODEL_STATUS.FAILED, error: `文件过大或解压总量超限` });
          continue;
        }
        totalExtractedBytes += data.length;
        await queueModelFromBuffer(originalName, ext, data);
      }
    } else {
      const MAX_RAR_MEMORY_BYTES = 100 * 1024 * 1024;
      const { statSync } = await import("node:fs");
      const stat = statSync(file.path);
      if (stat.size > MAX_RAR_MEMORY_BYTES) {
        rmSync(file.path, { force: true });
        res.status(400).json({ detail: "RAR 压缩包超过 100MB，请使用 ZIP 格式" });
        return;
      }
      const archiveBuffer = readFileSync(file.path);
      const archiveData = archiveBuffer.buffer.slice(archiveBuffer.byteOffset, archiveBuffer.byteOffset + archiveBuffer.byteLength);
      const extractor = await createExtractorFromData({ data: archiveData });
      const extracted = extractor.extract({
        files: (header) => !header.flags.directory && Boolean(normalizeZipEntryName(header.name)),
      });
      const maxTotalExtractBytes = maxModelBytes * MAX_BATCH_MODEL_FILES;
      let rarTotalBytes = 0;
      let processed = 0;
      for (const item of extracted.files) {
        if (processed >= MAX_BATCH_MODEL_FILES) break;
        const safeName = normalizeZipEntryName(item.fileHeader.name);
        if (!safeName) continue;
        const ext = safeName.split(".").pop()?.toLowerCase();
        if (!ext || !acceptedExts.includes(ext)) continue;
        processed += 1;
        const originalName = normalizeUploadFilename(posix.basename(safeName));
        const content = item.extraction;
        if (!content?.byteLength) {
          results.push({ name: originalName, status: MODEL_STATUS.FAILED, error: "文件为空或无法解压" });
          continue;
        }
        if (content.byteLength > maxModelBytes || rarTotalBytes + content.byteLength > maxTotalExtractBytes) {
          results.push({ name: originalName, status: MODEL_STATUS.FAILED, error: `解压后文件过大或总量超限` });
          continue;
        }
        rarTotalBytes += content.byteLength;
        await queueModelFromBuffer(originalName, ext, Buffer.from(content));
      }
    }

    rmSync(file.path, { force: true });
    if (!results.length) {
      res.status(400).json({ detail: `压缩包内没有识别到支持的模型文件，请上传 ${acceptedExts.map((item) => `.${item}`).join(" / ")} 文件` });
      return;
    }
    if (results.some((item) => item.status === MODEL_STATUS.QUEUED)) {
      await cacheDelByPrefix("cache:models:");
      await clearCategoryCache();
    }

    res.json({ total: results.length, results });
  } catch (err) {
    rmSync(file.path, { force: true });
    res.status(500).json({ detail: "批量上传处理失败" });
  }
});

export default router;
