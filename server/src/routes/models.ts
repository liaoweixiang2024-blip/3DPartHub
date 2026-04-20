import { Router, Request, Response } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync, readdirSync, readFileSync, rmSync, existsSync, writeFileSync, copyFileSync } from "node:fs";
import { convertStepToGltf } from "../services/converter.js";
import { conversionQueue } from "../lib/queue.js";
import { convertXtToGltf } from "../services/xt-converter.js";
import { generateThumbnail } from "../services/thumbnail.js";
import { compareModels } from "../services/comparison.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { getSetting } from "../lib/settings.js";
import { config } from "../lib/config.js";
import { cacheGet, cacheSet, cacheDelByPrefix, TTL } from "../lib/cache.js";

// Try to import Prisma, fallback to null if DB is not configured
let prisma: any = null;
try {
  const mod = await import("../lib/prisma.js");
  prisma = mod.prisma;
} catch {
  console.log("  ⚠️  Prisma not available, using filesystem storage");
}

const upload = multer({
  dest: config.uploadDir,
  limits: { fileSize: config.maxFileSize },
});

const router = Router();

const METADATA_DIR = join(config.uploadDir, ".metadata");
mkdirSync(METADATA_DIR, { recursive: true });

// Filesystem fallback helpers
function getMeta(id: string): Record<string, unknown> | null {
  const p = join(METADATA_DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

function saveMeta(id: string, data: Record<string, unknown>) {
  writeFileSync(join(METADATA_DIR, `${id}.json`), JSON.stringify(data, null, 2));
}

const ACCEPTED_EXTS = new Set(["step", "stp", "iges", "igs", "xt", "x_t"]);

// Upload requires auth
router.post("/api/models/upload", authMiddleware, requireRole("ADMIN"), upload.single("file"), async (req: AuthRequest, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ detail: "没有文件" });
    return;
  }

  const originalName = file.originalname || "unknown.step";
  const ext = originalName.split(".").pop()?.toLowerCase();
  if (!ext || !ACCEPTED_EXTS.has(ext)) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: `不支持的格式: .${ext}` });
    return;
  }

  const modelId = randomUUID().slice(0, 12);
  const createdAt = new Date().toISOString();
  const userId = req.user!.userId;
  const categoryId = req.body.categoryId || null;

  // Save filesystem metadata (always, as backup)
  const meta: Record<string, unknown> = {
    model_id: modelId,
    original_name: originalName,
    original_size: file.size,
    format: ext,
    status: "queued",
    created_at: createdAt,
    upload_path: file.path,
    created_by_id: userId,
  };
  saveMeta(modelId, meta);

  // Save initial DB record
  if (prisma) {
    try {
      await prisma.model.upsert({
        where: { id: modelId },
        create: {
          id: modelId,
          name: originalName.replace(/\.[^.]+$/, ""),
          originalName,
          originalFormat: ext,
          originalSize: file.size,
          gltfUrl: "",
          gltfSize: 0,
          format: ext,
          status: "queued",
          uploadPath: file.path,
          createdById: userId,
          ...(categoryId && { categoryId }),
        },
        update: {},
      });
    } catch (dbErr) {
      console.error("Database save failed:", dbErr);
    }
  }

  // Enqueue conversion job
  try {
    await conversionQueue.add("convert", {
      modelId,
      filePath: file.path,
      originalName,
      ext,
      userId,
    });
  } catch (queueErr) {
    console.error("Queue add failed, falling back to sync:", queueErr);
    // Fallback: synchronous conversion if Redis is down
    let result;
    if (ext === "xt" || ext === "x_t") {
      result = await convertXtToGltf(file.path, join(config.staticDir, "models"), modelId, originalName);
    } else {
      result = await convertStepToGltf(file.path, join(config.staticDir, "models"), modelId, originalName);
    }
    const thumb = await generateThumbnail(result.gltfPath, join(config.staticDir, "thumbnails"), modelId);

    // Save original file to persistent storage
    const originalsDir = join(config.staticDir, "originals");
    mkdirSync(originalsDir, { recursive: true });
    const originalDest = join(originalsDir, `${modelId}.${ext}`);
    if (existsSync(file.path)) {
      copyFileSync(file.path, originalDest);
      rmSync(file.path, { force: true });
    }

    const persistedPath = existsSync(originalDest) ? originalDest : file.path;
    meta.status = "completed";
    meta.gltf_url = result.gltfUrl;
    meta.gltf_size = result.gltfSize;
    meta.thumbnail_url = thumb.thumbnailUrl;
    saveMeta(modelId, meta);
    if (prisma) {
      await prisma.model.update({ where: { id: modelId }, data: {
        status: "completed", gltfUrl: result.gltfUrl, gltfSize: result.gltfSize, thumbnailUrl: thumb.thumbnailUrl,
        uploadPath: persistedPath,
      } }).catch(() => {});
      await cacheDelByPrefix("cache:models:");
    }
  }

  res.json({
    success: true,
    data: {
      model_id: modelId,
      original_name: originalName,
      format: ext,
      status: "queued",
      created_at: createdAt,
    },
  });



});

// List models (public, with optional pagination/search/category)
router.get("/api/models", async (req: Request, res: Response) => {
  // Check if login is required to browse
  const requireLogin = await getSetting<boolean>("require_login_browse");
  if (requireLogin) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ detail: "需要登录后才能浏览模型" });
      return;
    }
  }

  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.page_size) || 20;
  const search = req.query.search as string | undefined;
  const format = req.query.format as string | undefined;
  const category = req.query.category as string | undefined;
  const categoryId = req.query.category_id as string | undefined;
  const sort = (req.query.sort as string) || "created_at";
  const order = (req.query.order as string) || "desc";

  // Try Redis cache
  const cacheKey = `cache:models:${page}:${pageSize}:${search || ""}:${format || ""}:${category || ""}:${categoryId || ""}:${sort}:${order}`;
  const cached = await cacheGet(cacheKey);
  if (cached) { res.json(cached); return; }

  if (prisma) {
    try {
      const where: any = { status: "completed" };
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { originalName: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ];
      }
      if (format) {
        where.format = format;
      }
      if (categoryId) {
        // Filter by category ID, including children (single query)
        const catIds = await prisma.category.findMany({
          where: { OR: [{ id: categoryId }, { parentId: categoryId }] },
          select: { id: true },
        });
        where.categoryId = { in: catIds.map((c: any) => c.id) };
      } else if (category) {
        // Find category and its children to include all subcategory models
        const cat = await prisma.category.findFirst({ where: { name: category } });
        if (cat) {
          const catIds = await prisma.category.findMany({
            where: { OR: [{ id: cat.id }, { parentId: cat.id }] },
            select: { id: true },
          });
          where.categoryId = { in: catIds.map((c: any) => c.id) };
        } else {
          // Fallback: match by category string field
          where.category = category;
        }
      }

      const total = await prisma.model.count({ where });

      const orderBy: any = {};
      if (sort === "name") orderBy.name = order;
      else if (sort === "file_size") orderBy.gltfSize = order;
      else orderBy.createdAt = order;

      const models = await prisma.model.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { categoryRef: { select: { name: true } } },
      });

      const items = models.map((m: any) => ({
        model_id: m.id,
        name: m.name || m.originalName,
        format: m.format,
        thumbnail_url: m.thumbnailUrl,
        gltf_url: m.gltfUrl,
        file_size: m.gltfSize,
        original_size: m.originalSize,
        category: m.categoryRef?.name || null,
        category_id: m.categoryId || null,
        download_count: m.downloadCount || 0,
        created_at: m.createdAt,
      }));

      const responseData = { total, items, page, page_size: pageSize };
      await cacheSet(cacheKey, responseData, TTL.MODELS_LIST);
      res.json(responseData);
      return;
    } catch {
      // Fallback to filesystem
    }
  }

  // Filesystem fallback
  let items: any[] = [];
  const files = readdirSync(METADATA_DIR).filter((f) => f.endsWith(".json")).sort().reverse();
  for (const f of files) {
    const m = JSON.parse(readFileSync(join(METADATA_DIR, f), "utf-8"));
    if (m.status !== "completed") continue;
    if (format && m.format !== format) continue;
    if (search) {
      const q = search.toLowerCase();
      const name = (m.original_name || "").toString().toLowerCase();
      if (!name.includes(q)) continue;
    }
    items.push({
      model_id: m.model_id,
      name: m.original_name,
      format: m.format,
      thumbnail_url: m.thumbnail_url,
      gltf_url: m.gltf_url,
      file_size: m.gltf_size,
      original_size: m.original_size,
      created_at: m.created_at,
    });
  }

  // Sort filesystem fallback
  const total = items.length;
  const start = (page - 1) * pageSize;
  items = items.slice(start, start + pageSize);

  res.json({ total, items, page, page_size: pageSize });
});

// Get model detail (public)
router.get("/api/models/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (prisma) {
    try {
      const m = await prisma.model.findUnique({ where: { id }, include: { categoryRef: { select: { name: true } } } });
      if (m) {
        res.json({
          model_id: m.id,
          name: m.name,
          original_name: m.originalName,
          gltf_url: m.gltfUrl,
          thumbnail_url: m.thumbnailUrl,
          gltf_size: m.gltfSize,
          original_size: m.originalSize,
          format: m.format,
          status: m.status,
          description: m.description,
          category: (m as any).categoryRef?.name || null,
          category_id: m.categoryId || null,
          created_at: m.createdAt,
        });
        return;
      }
    } catch {
      // Fallback to filesystem
    }
  }

  const m = getMeta(id);
  if (!m) {
    res.status(404).json({ detail: "模型不存在" });
    return;
  }
  res.json({
    model_id: m.model_id,
    original_name: m.original_name,
    gltf_url: m.gltf_url,
    thumbnail_url: m.thumbnail_url,
    gltf_size: m.gltf_size,
    original_size: m.original_size,
    format: m.format,
    status: m.status,
    created_at: m.created_at,
  });
});

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

// Download model file
router.get("/api/models/:id/download", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const requestedFormat = req.query.format as string | undefined;

  // Check if login is required to download
  const requireLogin = await getSetting<boolean>("require_login_download");
  if (requireLogin) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ detail: "需要登录后才能下载" });
      return;
    }
  }

  // Check daily download limit
  const dailyLimit = await getSetting<number>("daily_download_limit");
  if (dailyLimit > 0) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const { verifyToken } = await import("../lib/jwt.js");
        const payload = verifyToken(authHeader.slice(7));
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (prisma) {
          const count = await prisma.download.count({
            where: {
              userId: payload.userId,
              createdAt: { gte: today },
            },
          });
          if (count >= dailyLimit) {
            res.status(429).json({ detail: `每日下载次数已达上限 (${dailyLimit} 次)` });
            return;
          }
        }
      } catch { /* token invalid, allow download if login not required */ }
    }
  }

  let filePath: string | null = null;
  let fileName: string | null = null;
  let fileSize = 0;

  if (prisma) {
    try {
      const m = await prisma.model.findUnique({ where: { id } });
      if (m) {
        if (requestedFormat === "original" && m.uploadPath) {
          const origPath = join(process.cwd(), m.uploadPath.replace(/^\//, ""));
          if (existsSync(origPath)) {
            filePath = origPath;
            fileName = m.originalName || `${id}.${m.format}`;
            fileSize = m.originalSize;
          }
        }
        if (!filePath) {
          filePath = join(process.cwd(), m.gltfUrl.replace(/^\//, ""));
          fileName = m.originalName
            ? m.originalName.replace(/\.[^.]+$/, ".gltf")
            : `${id}.gltf`;
          fileSize = m.gltfSize;
        }

        // Record download (best effort, skip if no_record=1)
        try {
          const noRecord = req.query.no_record === "1";
          if (!noRecord) {
            let userId: string | undefined;
            const authHeader = req.headers.authorization;
            if (authHeader?.startsWith("Bearer ")) {
              try {
                const { verifyToken } = await import("../lib/jwt.js");
                const payload = verifyToken(authHeader.slice(7));
                userId = payload.userId;
              } catch { /* token invalid */ }
            }
            if (userId) {
              await prisma.download.create({
                data: {
                  userId,
                  modelId: id,
                  format: requestedFormat === "original" ? m.format : "gltf",
                  fileSize,
                },
              });
            }
          }
          await prisma.model.update({
            where: { id },
            data: { downloadCount: { increment: 1 } },
          });
        } catch { /* ignore download tracking errors */ }
      }
    } catch {
      // Fallback
    }
  }

  // Filesystem fallback
  if (!filePath) {
    const meta = getMeta(id);
    if (!meta) {
      res.status(404).json({ detail: "模型不存在" });
      return;
    }
    if (requestedFormat === "original" && meta.upload_path) {
      const origPath = join(process.cwd(), (meta.upload_path as string).replace(/^\//, ""));
      if (existsSync(origPath)) {
        filePath = origPath;
        fileName = (meta.original_name as string) || `${id}.${meta.format}`;
      }
    }
    if (!filePath) {
      const gltfUrl = meta.gltf_url as string;
      if (gltfUrl) {
        filePath = join(process.cwd(), gltfUrl.replace(/^\//, ""));
        fileName = (meta.original_name as string)
          ? (meta.original_name as string).replace(/\.[^.]+$/, ".gltf")
          : `${id}.gltf`;
      }
    }
  }

  if (!filePath || !existsSync(filePath)) {
    res.status(404).json({ detail: "文件不存在" });
    return;
  }

  res.download(filePath, fileName!);
});

// Delete model requires auth
router.delete("/api/models/:id", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  // Collect format info before deleting from DB
  let origExt = "";
  if (prisma) {
    try {
      const dbModel = await prisma.model.findUnique({ where: { id }, select: { format: true } });
      origExt = dbModel?.format || "";
    } catch {}
  }

  // Delete files first
  const m = getMeta(id);
  if (m) {
    origExt = origExt || (m.format as string) || "";
    for (const p of [
      m.upload_path as string,
      join(config.staticDir, "models", `${id}.gltf`),
      join(config.staticDir, "models", `${id}.bin`),
      join(config.staticDir, "thumbnails", `${id}.png`),
      ...(origExt ? [join(config.staticDir, "originals", `${id}.${origExt}`)] : []),
    ]) {
      if (p && existsSync(p)) rmSync(p, { force: true });
    }
  } else {
    // No filesystem metadata, clean up by convention using DB format
    for (const p of [
      join(config.staticDir, "models", `${id}.gltf`),
      join(config.staticDir, "models", `${id}.bin`),
      join(config.staticDir, "thumbnails", `${id}.png`),
      ...(origExt ? [join(config.staticDir, "originals", `${id}.${origExt}`)] : []),
    ]) {
      if (existsSync(p)) rmSync(p, { force: true });
    }
  }

  // Delete from database after files are cleaned up
  if (prisma) {
    try {
      await prisma.model.delete({ where: { id } }).catch(() => {});
      await cacheDelByPrefix("cache:models:");
    } catch { /* ignore */ }
  }

  const metaPath = join(METADATA_DIR, `${id}.json`);
  if (existsSync(metaPath)) rmSync(metaPath, { force: true });

  res.json({ message: "删除成功" });
});

// Upload custom thumbnail for a model
router.post("/api/models/:id/thumbnail", authMiddleware, requireRole("ADMIN"), upload.single("file"), async (req: AuthRequest, res: Response) => {
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

    const thumbnailUrl = `/static/thumbnails/${id}.png`;

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

// Re-convert a single model with higher tessellation quality + regenerate thumbnail
router.post("/api/models/:id/reconvert", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  if (!prisma) {
    res.status(503).json({ detail: "数据库未连接" });
    return;
  }

  try {
    const m = await prisma.model.findUnique({ where: { id } });
    if (!m) {
      res.status(404).json({ detail: "模型不存在" });
      return;
    }

    // Find original file
    const origPath = m.uploadPath && existsSync(m.uploadPath)
      ? m.uploadPath
      : join(config.staticDir, "originals", `${m.id}.${m.format}`);

    const modelDir = join(config.staticDir, "models");
    let gltfSize = m.gltfSize;

    // Re-convert from original if available, otherwise just regenerate thumbnail from existing glTF
    if (existsSync(origPath)) {
      const result = await convertStepToGltf(origPath, modelDir, m.id, m.originalName || `${m.id}.${m.format}`);
      gltfSize = result.gltfSize;
    }

    // Regenerate thumbnail from glTF
    let thumbnailUrl = m.thumbnailUrl;
    const gltfPath = join(modelDir, `${m.id}.gltf`);
    if (existsSync(gltfPath)) {
      try {
        const thumb = await generateThumbnail(gltfPath, join(config.staticDir, "thumbnails"), m.id);
        thumbnailUrl = thumb.thumbnailUrl;
      } catch { /* non-critical */ }
    }

    // Update DB
    await prisma.model.update({
      where: { id },
      data: { ...(gltfSize !== m.gltfSize ? { gltfSize } : {}), ...(thumbnailUrl !== m.thumbnailUrl ? { thumbnailUrl } : {}) },
    });

    await cacheDelByPrefix("cache:models:");

    res.json({
      success: true,
      data: {
        model_id: m.id,
        name: m.name,
        gltf_size: gltfSize,
        thumbnail_url: thumbnailUrl,
      },
    });
  } catch (err: any) {
    console.error("Re-convert failed:", err);
    res.status(500).json({ detail: err.message || "重新转换失败" });
  }
});

// Batch re-convert all completed models
router.post("/api/models/reconvert-all", authMiddleware, requireRole("ADMIN"), async (_req: AuthRequest, res: Response) => {
  if (!prisma) {
    res.status(503).json({ detail: "数据库未连接" });
    return;
  }

  try {
    const models = await prisma.model.findMany({
      where: { status: "completed" },
      select: { id: true, name: true, format: true, uploadPath: true },
    });

    let success = 0, failed = 0;
    const modelDir = join(config.staticDir, "models");
    const thumbDir = join(config.staticDir, "thumbnails");

    for (const m of models) {
      const origPath = m.uploadPath && existsSync(m.uploadPath)
        ? m.uploadPath
        : join(config.staticDir, "originals", `${m.id}.${m.format}`);

      if (!existsSync(origPath)) { failed++; continue; }

      try {
        const result = await convertStepToGltf(origPath, modelDir, m.id, `${m.id}.${m.format}`);

        let thumbnailUrl: string | null = null;
        const gltfPath = join(modelDir, `${m.id}.gltf`);
        if (existsSync(gltfPath)) {
          try {
            const thumb = await generateThumbnail(gltfPath, thumbDir, m.id);
            thumbnailUrl = thumb.thumbnailUrl;
          } catch { /* non-critical */ }
        }

        await prisma.model.update({
          where: { id: m.id },
          data: { gltfSize: result.gltfSize, ...(thumbnailUrl ? { thumbnailUrl } : {}) },
        });
        success++;
      } catch {
        failed++;
      }
    }

    await cacheDelByPrefix("cache:models:");
    res.json({ success: true, data: { total: models.length, success, failed } });
  } catch (err: any) {
    res.status(500).json({ detail: err.message || "批量重新转换失败" });
  }
});

// --- Version Management ---

// List model versions
router.get("/api/models/:id/versions", async (req: Request, res: Response) => {
  const modelId = req.params.id;
  if (!prisma) {
    res.status(503).json({ detail: "数据库未连接" });
    return;
  }
  try {
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
router.post("/api/models/:id/versions", authMiddleware, requireRole("ADMIN"), upload.single("file"), async (req: AuthRequest, res: Response) => {
  const modelId = req.params.id;
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

    const ext = file.originalname?.split(".").pop()?.toLowerCase() || "step";
    const versionNumber = model.currentVersion + 1;

    // Convert file
    const modelDir = join(config.staticDir, "models");
    let result;
    if (ext === "xt" || ext === "x_t") {
      result = await convertXtToGltf(file.path, modelDir, `${modelId}_v${versionNumber}`, file.originalname || "model.xt");
    } else {
      result = await convertStepToGltf(file.path, modelDir, `${modelId}_v${versionNumber}`, file.originalname || "model.step");
    }

    // Create version record
    const version = await prisma.modelVersion.create({
      data: {
        modelId,
        versionNumber,
        fileKey: result.gltfUrl,
        format: ext,
        fileSize: result.gltfSize,
        changeLog: changeLog || `版本 ${versionNumber}`,
        createdById: req.user!.userId,
      },
    });

    // Update model's current version and glTF URL
    await prisma.model.update({
      where: { id: modelId },
      data: {
        currentVersion: versionNumber,
        gltfUrl: result.gltfUrl,
        gltfSize: result.gltfSize,
        status: "completed",
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
    const message = err instanceof Error ? err.message : "上传版本失败";
    res.status(500).json({ detail: message });
  }
});

// Rollback to a specific version
router.post("/api/models/:id/versions/:versionId/rollback", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { id: modelId, versionId } = req.params;

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

    await prisma.model.update({
      where: { id: modelId },
      data: {
        gltfUrl: version.fileKey,
        gltfSize: version.fileSize,
        currentVersion: version.versionNumber,
      },
    });

    await cacheDelByPrefix("cache:models:");

    res.json({ message: "已回滚", version_number: version.versionNumber });
  } catch {
    res.status(500).json({ detail: "回滚失败" });
  }
});

// Compare two models
router.get("/api/models/compare", async (req: Request, res: Response) => {
  const id1 = req.query.id1 as string;
  const id2 = req.query.id2 as string;
  if (!id1 || !id2) {
    res.status(400).json({ detail: "需要 id1 和 id2 参数" });
    return;
  }
  try {
    const result = await compareModels(id1, id2);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ detail: err.message || "对比失败" });
  }
});

router.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "model-converter", db: prisma ? "connected" : "filesystem-only" });
});

// Download history for the current user
router.get("/api/downloads", authMiddleware, async (req: Request, res: Response) => {
  if (!prisma) {
    res.json({ data: [] });
    return;
  }
  try {
    const userId = (req as AuthRequest).user!.userId;
    const downloads = await prisma.download.findMany({
      where: { userId },
      include: {
        model: {
          select: {
            id: true,
            name: true,
            originalName: true,
            format: true,
            thumbnailUrl: true,
            gltfSize: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const items = downloads.map((d: any) => ({
      id: d.id,
      modelId: d.modelId,
      format: d.format,
      fileSize: d.fileSize,
      createdAt: d.createdAt,
      model: d.model
        ? {
            model_id: d.model.id,
            name: d.model.name || d.model.originalName,
            format: d.model.format,
            thumbnail_url: d.model.thumbnailUrl,
            gltf_size: d.model.gltfSize,
          }
        : null,
    }));
    res.json({ data: items });
  } catch (err) {
    console.error("Failed to fetch downloads:", err);
    res.status(500).json({ detail: "获取下载历史失败" });
  }
});

// Batch delete download records
router.post("/api/downloads/batch-delete", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) { res.status(503).json({ detail: "DB unavailable" }); return; }
    const { ids } = req.body as { ids: string[] };
    if (!ids || !Array.isArray(ids)) { res.status(400).json({ detail: "参数错误" }); return; }
    const result = await prisma.download.deleteMany({
      where: { id: { in: ids }, userId: req.user!.userId },
    });
    res.json({ success: true, count: result.count });
  } catch {
    res.status(500).json({ detail: "批量删除失败" });
  }
});

// Clear all download records
router.delete("/api/downloads/clear", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) { res.status(503).json({ detail: "DB unavailable" }); return; }
    const result = await prisma.download.deleteMany({
      where: { userId: req.user!.userId },
    });
    res.json({ success: true, count: result.count });
  } catch {
    res.status(500).json({ detail: "清空失败" });
  }
});

// Delete single download record
router.delete("/api/downloads/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) { res.status(503).json({ detail: "DB unavailable" }); return; }
    const download = await prisma.download.findUnique({ where: { id: req.params.id } });
    if (!download) { res.status(404).json({ detail: "记录不存在" }); return; }
    if (download.userId !== req.user!.userId) { res.status(403).json({ detail: "无权操作" }); return; }
    await prisma.download.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ detail: "删除失败" });
  }
});

export default router;
