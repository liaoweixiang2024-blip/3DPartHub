import { Router, Request, Response } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { mkdirSync, readdirSync, readFileSync, rmSync, existsSync, writeFileSync, copyFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { stat as statAsync } from "node:fs/promises";
import { convertStepToGltf } from "../services/converter.js";
import { conversionQueue } from "../lib/queue.js";
import { convertXtToGltf } from "../services/xt-converter.js";
import { generateThumbnail } from "../services/thumbnail.js";
import { compareModels } from "../services/comparison.js";
import { findPreviewAssetPath, getPreviewAssetExtension, previewAssetFileName, resolveFileUrlPath } from "../services/gltfAsset.js";
import { ensurePreviewMeta } from "../services/previewMeta.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { getSetting } from "../lib/settings.js";
import { config } from "../lib/config.js";
import { getBusinessConfig } from "../lib/businessConfig.js";
import {
  MAX_MODEL_PAGE,
  MAX_MODEL_PAGE_SIZE,
  enumQuery,
  getSearchTerms,
  modelTextSearchWhere,
  normalizeSearchParam,
  numericQuery,
  searchCacheToken,
} from "../lib/searchQuery.js";

// Parse STEP/IGES file header for the original creation timestamp
function parseStepFileDate(filePath: string): Date | null {
  try {
    const fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(2000);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    closeSync(fd);
    const head = buffer.toString("utf-8", 0, bytesRead);
    // STEP: FILE_NAME('name', '2026-03-19T09:10:22', ...)
    const match = head.match(/FILE_NAME\s*\([^;]*?'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})'/);
    if (match) return new Date(match[1]);
    // IGES: may have date in S06 or similar fields
    const igMatch = head.match(/(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})(\d{2})/);
    if (igMatch) return new Date(`${igMatch[1]}-${igMatch[2]}-${igMatch[3]}T${igMatch[4]}:${igMatch[5]}:${igMatch[6]}`);
  } catch { /* ignore */ }
  return null;
}
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

function getPreviewMeta(
  id: string,
  options: { gltfUrl?: string | null; originalName?: string | null; format?: string | null } = {}
): Record<string, unknown> | null {
  return ensurePreviewMeta({
    modelDir: join(config.staticDir, "models"),
    modelId: id,
    preferredUrl: options.gltfUrl,
    sourceName: options.originalName || id,
    sourceFormat: options.format || "gltf",
  }) as Record<string, unknown> | null;
}

function findOriginalModelPath(m: { id: string; format?: string | null; uploadPath?: string | null }): string | null {
  if (m.uploadPath && existsSync(m.uploadPath)) return m.uploadPath;
  const format = String(m.format || "").toLowerCase();
  if (!format) return null;
  const fallback = join(config.staticDir, "originals", `${m.id}.${format}`);
  return existsSync(fallback) ? fallback : null;
}

type PreviewDiagnosticStatus = "ok" | "warning" | "invalid" | "missing";
type PreviewDiagnosticFilter = PreviewDiagnosticStatus | "problem" | "all";
type PreviewAssetStatus = "ok" | "warning" | "invalid" | "missing";

const PREVIEW_DIAGNOSTIC_FILTERS = new Set(["all", "problem", "ok", "warning", "invalid", "missing"]);
const MIN_THUMBNAIL_BYTES = 1024;

function normalizePreviewDiagnosticFilter(value: unknown): PreviewDiagnosticFilter {
  const status = String(value || "problem").toLowerCase();
  return PREVIEW_DIAGNOSTIC_FILTERS.has(status) ? status as PreviewDiagnosticFilter : "problem";
}

function getPreviewBoundsSize(meta: Record<string, any> | null): [number, number, number] | null {
  const size = meta?.bounds?.size;
  if (Array.isArray(size) && size.length >= 3) {
    const tuple = size.slice(0, 3).map((value: unknown) => Number(value)) as [number, number, number];
    if (tuple.every((value) => Number.isFinite(value))) return tuple;
  }

  const parts = Array.isArray(meta?.parts) ? meta.parts : [];
  const mins: [number, number, number] = [Infinity, Infinity, Infinity];
  const maxs: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let valid = false;
  for (const part of parts) {
    const min = part?.bounds?.min;
    const max = part?.bounds?.max;
    if (!Array.isArray(min) || !Array.isArray(max) || min.length < 3 || max.length < 3) continue;
    for (let i = 0; i < 3; i++) {
      const lo = Number(min[i]);
      const hi = Number(max[i]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      mins[i] = Math.min(mins[i], lo);
      maxs[i] = Math.max(maxs[i], hi);
      valid = true;
    }
  }
  if (!valid) return null;
  return [
    Math.max(0, maxs[0] - mins[0]),
    Math.max(0, maxs[1] - mins[1]),
    Math.max(0, maxs[2] - mins[2]),
  ];
}

function classifyPreviewMeta(meta: Record<string, any> | null): { status: PreviewDiagnosticStatus; label: string; reason: string } {
  if (!meta) {
    return { status: "missing", label: "缺少诊断", reason: "没有找到可用的预览诊断或预览资产" };
  }

  const totals = meta.totals || {};
  const boundsSize = getPreviewBoundsSize(meta);
  const hasGeometry = Number(totals.faceCount) > 0 && Number(totals.vertexCount) > 0;

  if (!hasGeometry || !boundsSize || !boundsSize.some((value) => value > 0)) {
    return { status: "invalid", label: "转换异常", reason: "面片、顶点或包围盒数据异常" };
  }

  const warnings = Array.isArray(meta.diagnostics?.warnings) ? meta.diagnostics.warnings : [];
  const skipped = Number(meta.diagnostics?.skippedMeshCount || 0);
  if (!meta.diagnostics || !meta.bounds) {
    return { status: "warning", label: "需复核", reason: "旧版诊断缺少完整转换字段" };
  }
  if (warnings.length > 0 || skipped > 0) {
    return { status: "warning", label: "需复核", reason: skipped > 0 ? `转换时跳过 ${skipped} 个网格` : "转换诊断包含警告" };
  }

  return { status: "ok", label: "正常", reason: "预览诊断正常" };
}

function inspectFileUrl(
  value?: string | null,
  options: { label: string; minBytes?: number } = { label: "文件" }
): { status: PreviewAssetStatus; reason: string; size: number; path: string | null } {
  if (!value) {
    return { status: "missing", reason: `${options.label}地址为空`, size: 0, path: null };
  }

  try {
    const filePath = resolveFileUrlPath(value);
    if (!existsSync(filePath)) {
      return { status: "missing", reason: `${options.label}不存在`, size: 0, path: filePath };
    }

    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return { status: "invalid", reason: `${options.label}不是有效文件`, size: 0, path: filePath };
    }
    if (stats.size <= 0) {
      return { status: "invalid", reason: `${options.label}为空文件`, size: stats.size, path: filePath };
    }
    if (options.minBytes && stats.size < options.minBytes) {
      return { status: "warning", reason: `${options.label}文件过小，可能是异常图或占位图`, size: stats.size, path: filePath };
    }

    return { status: "ok", reason: `${options.label}正常`, size: stats.size, path: filePath };
  } catch {
    return { status: "invalid", reason: `${options.label}检查失败`, size: 0, path: null };
  }
}

function mergePreviewHealth(
  metaHealth: ReturnType<typeof classifyPreviewMeta>,
  assetHealth: ReturnType<typeof inspectFileUrl>,
  thumbnailHealth: ReturnType<typeof inspectFileUrl>
): { status: PreviewDiagnosticStatus; label: string; reason: string } {
  if (assetHealth.status === "missing" || assetHealth.status === "invalid") {
    return {
      status: assetHealth.status,
      label: assetHealth.status === "missing" ? "缺少预览" : "预览异常",
      reason: assetHealth.reason,
    };
  }

  if (metaHealth.status === "missing" || metaHealth.status === "invalid") {
    return metaHealth;
  }

  if (thumbnailHealth.status === "missing" || thumbnailHealth.status === "invalid") {
    return {
      status: "warning",
      label: "缩略图异常",
      reason: thumbnailHealth.reason,
    };
  }

  if (metaHealth.status === "warning") return metaHealth;
  if (thumbnailHealth.status === "warning") {
    return { status: "warning", label: "需复核", reason: thumbnailHealth.reason };
  }

  return metaHealth;
}

function shouldIncludePreviewDiagnostic(status: PreviewDiagnosticStatus, filter: PreviewDiagnosticFilter): boolean {
  if (filter === "all") return true;
  if (filter === "problem") return status !== "ok";
  return status === filter;
}

function buildPreviewDiagnosticItem(m: {
  id: string;
  name?: string | null;
  originalName?: string | null;
  format?: string | null;
  thumbnailUrl?: string | null;
  gltfUrl?: string | null;
  originalSize?: number | null;
  createdAt?: Date | string | null;
  category?: string | null;
}, meta: Record<string, any> | null) {
  const metaHealth = classifyPreviewMeta(meta);
  const assetHealth = inspectFileUrl(m.gltfUrl, { label: "预览资产" });
  const thumbnailHealth = inspectFileUrl(m.thumbnailUrl, { label: "缩略图", minBytes: MIN_THUMBNAIL_BYTES });
  const health = mergePreviewHealth(metaHealth, assetHealth, thumbnailHealth);
  return {
    model_id: m.id,
    name: m.name || m.originalName || "未命名模型",
    original_name: m.originalName || null,
    format: m.format || null,
    thumbnail_url: m.thumbnailUrl || null,
    gltf_url: m.gltfUrl || null,
    original_size: m.originalSize || 0,
    category: m.category || null,
    created_at: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt || null,
    preview_status: health.status,
    preview_label: health.label,
    preview_reason: health.reason,
    asset_status: assetHealth.status,
    asset_reason: assetHealth.reason,
    asset_size: assetHealth.size,
    thumbnail_status: thumbnailHealth.status,
    thumbnail_reason: thumbnailHealth.reason,
    thumbnail_size: thumbnailHealth.size,
    part_count: Number(meta?.totals?.partCount || 0),
    vertex_count: Number(meta?.totals?.vertexCount || 0),
    face_count: Number(meta?.totals?.faceCount || 0),
    skipped_mesh_count: Number(meta?.diagnostics?.skippedMeshCount || 0),
    warnings: Array.isArray(meta?.diagnostics?.warnings) ? meta.diagnostics.warnings : [],
    bounds_size: getPreviewBoundsSize(meta),
    converter: meta?.diagnostics?.converter || (meta ? "legacy-meta" : null),
    generated_at: meta?.diagnostics?.generatedAt || null,
  };
}

async function validateModelUpload(file: Express.Multer.File, res: Response): Promise<string | null> {
  const originalName = file.originalname || "unknown.step";
  const ext = originalName.split(".").pop()?.toLowerCase() || "";
  const { uploadPolicy } = await getBusinessConfig();
  const formats = uploadPolicy.modelFormats.map((item) => item.toLowerCase());
  const maxBytes = Math.max(1, uploadPolicy.modelMaxSizeMb) * 1024 * 1024;
  if (!ext || !formats.includes(ext)) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: `不支持的格式，请上传 ${formats.map((item) => `.${item}`).join(" / ")} 文件` });
    return null;
  }
  if (file.size > maxBytes) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: `文件过大，最大支持 ${uploadPolicy.modelMaxSizeMb}MB` });
    return null;
  }
  return ext;
}

function pathInside(candidate: string, root: string): boolean {
  const resolved = resolve(candidate);
  const resolvedRoot = resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${sep}`);
}

async function markQueueUnavailable(modelId: string, meta: Record<string, unknown>, res: Response) {
  meta.status = "failed";
  meta.error = "conversion_queue_unavailable";
  saveMeta(modelId, meta);
  if (prisma) {
    await prisma.model.update({
      where: { id: modelId },
      data: { status: "failed" },
    }).catch(() => {});
    await cacheDelByPrefix("cache:models:");
  }
  res.status(503).json({ detail: "转换队列暂不可用，请稍后重试" });
}

// Upload requires auth
router.post("/api/models/upload", authMiddleware, requireRole("ADMIN"), upload.single("file"), async (req: AuthRequest, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ detail: "没有文件" });
    return;
  }

  const originalName = file.originalname || "unknown.step";
  const ext = await validateModelUpload(file, res);
  if (!ext) return;

  const modelId = randomUUID().slice(0, 12);
  const createdAt = new Date().toISOString();
  const userId = req.user!.userId;
  const categoryId = req.body.categoryId || null;

  // Preserve original file modification time: STEP header > client filesystem > null
  const stepFileDate = parseStepFileDate(file.path);
  const clientLastModified = req.body.lastModified ? Number(req.body.lastModified) : null;
  const fileDate = stepFileDate || (clientLastModified && !isNaN(clientLastModified) ? new Date(clientLastModified) : null);
  const originalModifiedAt = fileDate ? fileDate.toISOString() : null;

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
    ...(originalModifiedAt && { original_modified_at: originalModifiedAt }),
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
          ...(originalModifiedAt && { metadata: { originalModifiedAt } }),
          ...(originalModifiedAt && { fileModifiedAt: new Date(originalModifiedAt) }),
        },
        update: {},
      });
    } catch (dbErr) {
      console.error("Database save failed:", dbErr);
    }
  }

  // Auto-merge: check if models with same name exist, auto-group them
  if (prisma) {
    try {
      const modelName = originalName.replace(/\.[^.]+$/, "");
      // Find other completed models with same name
      const sameNameModels = await prisma.model.findMany({
        where: { name: modelName, status: "completed", id: { not: modelId } },
        select: { id: true, groupId: true },
      });
      if (sameNameModels.length > 0) {
        // Check if any of them already belong to a group
        const existingGroup = sameNameModels.find((m: any) => m.groupId);
        if (existingGroup?.groupId) {
          // Join existing group
          await prisma.model.update({ where: { id: modelId }, data: { groupId: existingGroup.groupId } });
          // Update primary to the newest (this new upload is the newest)
          await prisma.modelGroup.update({ where: { id: existingGroup.groupId }, data: { primaryId: modelId } });
        } else {
          // Create new group with all same-name models, newest (this one) as primary
          const allIds = [modelId, ...sameNameModels.map((m: any) => m.id)];
          await prisma.modelGroup.create({
            data: {
              name: modelName,
              primaryId: modelId,
              models: { connect: allIds.map(id => ({ id })) },
            },
          });
        }
      }
    } catch (mergeErr) {
      console.error("Auto-merge failed (non-critical):", mergeErr);
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
    console.error("Queue add failed:", queueErr);
    await markQueueUnavailable(modelId, meta, res);
    return;
  }

  res.json({
    success: true,
    data: {
      model_id: modelId,
      original_name: originalName,
      gltf_url: "",
      thumbnail_url: "",
      gltf_size: 0,
      original_size: file.size,
      format: ext,
      status: "queued",
      created_at: createdAt,
    },
  });
});

// Upload from server-local file (used after chunked upload merges the file)
router.post("/api/models/upload-local", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { filePath, fileName, categoryId } = req.body;
  if (!filePath || !fileName) {
    res.status(400).json({ detail: "缺少 filePath 或 fileName" });
    return;
  }

  // Validate file exists and is within allowed directories
  const absPath = resolve(filePath.startsWith("/") ? filePath : join(process.cwd(), filePath));
  const allowedDirs = [join(process.cwd(), config.uploadDir), join(process.cwd(), "uploads"), "/tmp"];
  const isAllowed = allowedDirs.some((d) => pathInside(absPath, d));
  if (!isAllowed) {
    res.status(400).json({ detail: "文件路径不在允许的目录内" });
    return;
  }
  if (!existsSync(absPath)) {
    res.status(400).json({ detail: "文件不存在" });
    return;
  }

  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const { uploadPolicy } = await getBusinessConfig();
  const formats = uploadPolicy.modelFormats.map((item) => item.toLowerCase());
  const fileSize = (await statAsync(absPath)).size;
  const maxBytes = Math.max(1, uploadPolicy.modelMaxSizeMb) * 1024 * 1024;
  if (!formats.includes(ext)) {
    res.status(400).json({ detail: `不支持的格式，请上传 ${formats.map((item) => `.${item}`).join(" / ")} 文件` });
    return;
  }
  if (fileSize > maxBytes) {
    res.status(400).json({ detail: `文件过大，最大支持 ${uploadPolicy.modelMaxSizeMb}MB` });
    return;
  }
  const modelId = randomUUID().slice(0, 12);
  const createdAt = new Date().toISOString();
  const userId = req.user!.userId;

  const meta: Record<string, unknown> = {
    model_id: modelId,
    original_name: fileName,
    original_size: fileSize,
    format: ext,
    status: "queued",
    created_at: createdAt,
    upload_path: absPath,
    created_by_id: userId,
  };
  saveMeta(modelId, meta);

  if (prisma) {
    try {
      await prisma.model.upsert({
        where: { id: modelId },
        create: {
          id: modelId,
          name: fileName.replace(/\.[^.]+$/, ""),
          originalName: fileName,
          originalFormat: ext,
          originalSize: fileSize,
          gltfUrl: "",
          gltfSize: 0,
          format: ext,
          status: "queued",
          uploadPath: absPath,
          createdById: userId,
          ...(categoryId && { categoryId }),
        },
        update: {},
      });
    } catch (dbErr) {
      console.error("Database save failed:", dbErr);
    }
  }

  try {
    await conversionQueue.add("convert", {
      modelId,
      filePath: absPath,
      originalName: fileName,
      ext,
      userId,
      preserveSource: true,
    });
  } catch (err) {
    console.error("Failed to queue conversion:", err);
  }

  res.json({
    success: true,
    data: {
      model_id: modelId,
      original_name: fileName,
      gltf_url: "",
      thumbnail_url: "",
      gltf_size: 0,
      original_size: fileSize,
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

  const page = numericQuery(req.query.page, 1, 1, MAX_MODEL_PAGE);
  const pageSize = numericQuery(req.query.page_size, 20, 1, MAX_MODEL_PAGE_SIZE);
  const search = normalizeSearchParam(req.query.search);
  const format = normalizeSearchParam(req.query.format, 20).toLowerCase();
  const category = normalizeSearchParam(req.query.category, 100);
  const categoryId = normalizeSearchParam(req.query.category_id, 80);
  const sort = enumQuery(req.query.sort, "created_at", ["created_at", "name", "file_size"] as const);
  const order = enumQuery(req.query.order, "desc", ["asc", "desc"] as const);
  const grouped = req.query.grouped === "true";

  // Try Redis cache
  const cacheKey = `cache:models:${page}:${pageSize}:${searchCacheToken(search)}:${format}:${categoryId || category}:${sort}:${order}:${grouped}`;
  const cached = await cacheGet(cacheKey);
  if (cached) { res.json(cached); return; }

  if (prisma) {
    try {
      const where: any = { status: "completed" };
      const andConditions: Record<string, unknown>[] = [];
      const searchCond = modelTextSearchWhere(search);
      if (searchCond) andConditions.push(searchCond);
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

      // When grouped mode, only show: ungrouped models + primary models of each group
      if (grouped) {
        const groupPrimaries = await prisma.modelGroup.findMany({
          select: { primaryId: true },
        });
        const primaryIds = groupPrimaries.map((g: any) => g.primaryId).filter(Boolean);
        andConditions.push({
          OR: [
            { groupId: null },
            { id: { in: primaryIds } },
          ],
        });
      }
      if (andConditions.length) where.AND = andConditions;

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
        include: {
          categoryRef: { select: { name: true } },
          group: { select: { id: true, name: true, primaryId: true, _count: { select: { models: true } } } },
        },
      });

      // If grouped mode, also fetch the group variant counts for items that have groups
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
        drawing_url: m.drawingUrl || null,
        drawing_name: m.drawingName || null,
        drawing_size: m.drawingSize || null,
        group: m.group ? {
          id: m.group.id,
          name: m.group.name,
          is_primary: m.id === m.group.primaryId,
          variant_count: m.group._count.models,
        } : null,
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
      const terms = getSearchTerms(search).map((term) => term.toLowerCase());
      const searchable = [
        m.name,
        m.original_name,
        m.description,
        m.part_number,
        m.category,
        m.dimensions,
        m.format,
        m.original_format,
        m.drawing_name,
      ].map((value) => (value || "").toString().toLowerCase()).join(" ");
      if (!terms.every((term) => searchable.includes(term))) continue;
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

// Preview diagnostics scan (admin only)
router.get("/api/models/preview-diagnostics", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.page_size) || 12));
  const search = (req.query.search as string | undefined)?.trim();
  const filter = normalizePreviewDiagnosticFilter(req.query.status);
  const modelDir = join(config.staticDir, "models");

  try {
    let rows: Array<{
      id: string;
      name?: string | null;
      originalName?: string | null;
      format?: string | null;
      thumbnailUrl?: string | null;
      gltfUrl?: string | null;
      originalSize?: number | null;
      createdAt?: Date | string | null;
      category?: string | null;
    }> = [];

    if (prisma) {
      const where: any = { status: "completed" };
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { originalName: { contains: search, mode: "insensitive" } },
        ];
      }

      const models = await prisma.model.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          originalName: true,
          format: true,
          thumbnailUrl: true,
          gltfUrl: true,
          originalSize: true,
          createdAt: true,
          categoryRef: { select: { name: true } },
        },
      });

      rows = models.map((m: any) => ({
        id: m.id,
        name: m.name,
        originalName: m.originalName,
        format: m.format,
        thumbnailUrl: m.thumbnailUrl,
        gltfUrl: m.gltfUrl,
        originalSize: m.originalSize,
        createdAt: m.createdAt,
        category: m.categoryRef?.name || null,
      }));
    } else {
      const files = readdirSync(METADATA_DIR).filter((f) => f.endsWith(".json")).sort().reverse();
      rows = files
        .map((f) => JSON.parse(readFileSync(join(METADATA_DIR, f), "utf-8")))
        .filter((m) => m.status === "completed")
        .filter((m) => {
          if (!search) return true;
          const q = search.toLowerCase();
          return `${m.name || ""} ${m.original_name || ""}`.toLowerCase().includes(q);
        })
        .map((m) => ({
          id: m.model_id,
          name: m.name || m.original_name,
          originalName: m.original_name,
          format: m.format,
          thumbnailUrl: m.thumbnail_url,
          gltfUrl: m.gltf_url,
          originalSize: m.original_size,
          createdAt: m.created_at,
          category: null,
        }));
    }

    const items = rows.map((m) => {
      const meta = getPreviewMeta(m.id, {
        gltfUrl: m.gltfUrl,
        originalName: m.originalName,
        format: m.format,
      });
      return buildPreviewDiagnosticItem(m, meta);
    });

    const summary = items.reduce(
      (acc, item) => {
        acc[item.preview_status] += 1;
        return acc;
      },
      { total: items.length, ok: 0, warning: 0, invalid: 0, missing: 0, problem: 0 }
    );
    summary.problem = summary.warning + summary.invalid + summary.missing;

    const filtered = items.filter((item) => shouldIncludePreviewDiagnostic(item.preview_status, filter));
    const start = (page - 1) * pageSize;

    res.json({
      summary,
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      page_size: pageSize,
      status: filter,
    });
  } catch (err: any) {
    res.status(500).json({ detail: err?.message || "预览诊断扫描失败" });
  }
});

// Queue preview rebuild jobs for models matching preview diagnostics.
router.post("/api/models/preview-diagnostics/rebuild", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  if (!prisma) {
    res.status(503).json({ detail: "数据库未连接" });
    return;
  }

  const rebuildAll = req.body?.all === true || req.body?.scope === "all";
  const filter = rebuildAll ? "all" : normalizePreviewDiagnosticFilter(req.body?.status || "problem");
  const defaultLimit = rebuildAll ? 5000 : 50;
  const maxLimit = rebuildAll ? 10000 : 100;
  const limit = Math.min(maxLimit, Math.max(1, Number(req.body?.limit) || defaultLimit));
  const requestedIds = Array.isArray(req.body?.modelIds)
    ? req.body.modelIds.map((id: unknown) => String(id)).filter(Boolean).slice(0, limit)
    : [];

  try {
    const where: any = {
      status: "completed",
      ...(requestedIds.length > 0 ? { id: { in: requestedIds } } : {}),
    };

    const models = await prisma.model.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        originalName: true,
        format: true,
        uploadPath: true,
        thumbnailUrl: true,
        gltfUrl: true,
        originalSize: true,
        createdAt: true,
        categoryRef: { select: { name: true } },
      },
    });

    const candidates = models
      .map((m: any) => {
        const meta = getPreviewMeta(m.id, {
          gltfUrl: m.gltfUrl,
          originalName: m.originalName,
          format: m.format,
        });
        return {
          model: m,
          diagnostic: buildPreviewDiagnosticItem({
            id: m.id,
            name: m.name,
            originalName: m.originalName,
            format: m.format,
            thumbnailUrl: m.thumbnailUrl,
            gltfUrl: m.gltfUrl,
            originalSize: m.originalSize,
            createdAt: m.createdAt,
            category: m.categoryRef?.name || null,
          }, meta),
        };
      })
      .filter((entry: { diagnostic: ReturnType<typeof buildPreviewDiagnosticItem> }) => shouldIncludePreviewDiagnostic(entry.diagnostic.preview_status, filter))
      .slice(0, limit);

    let queued = 0;
    let skipped = 0;
    let failed = 0;
    const items: Array<{ model_id: string; name: string; status: string; reason?: string; job_id?: string | number }> = [];

    for (const { model, diagnostic } of candidates) {
      const format = String(model.format || "").toLowerCase();
      if (!format || ["html", "htm"].includes(format)) {
        skipped++;
        items.push({ model_id: model.id, name: model.name || model.originalName, status: "skipped", reason: "不支持的源格式" });
        continue;
      }

      const originalPath = findOriginalModelPath(model);
      if (!originalPath) {
        skipped++;
        items.push({ model_id: model.id, name: model.name || model.originalName, status: "skipped", reason: "缺少原始模型文件" });
        continue;
      }

      try {
        const job = await conversionQueue.add("convert", {
          modelId: model.id,
          filePath: originalPath,
          originalName: model.originalName || `${model.id}.${format}`,
          ext: format,
          userId: req.user!.userId,
          preserveSource: true,
          rebuildReason: diagnostic.preview_status,
        });
        await prisma.model.update({ where: { id: model.id }, data: { status: "queued" } }).catch(() => {});
        queued++;
        items.push({ model_id: model.id, name: model.name || model.originalName, status: "queued", job_id: job.id });
      } catch (err: any) {
        failed++;
        items.push({ model_id: model.id, name: model.name || model.originalName, status: "failed", reason: err?.message || "队列投递失败" });
      }
    }

    await cacheDelByPrefix("cache:models:");
    res.json({
      success: true,
      data: {
        status: filter,
        total_candidates: candidates.length,
        queued,
        skipped,
        failed,
        items,
      },
    });
  } catch (err: any) {
    res.status(500).json({ detail: err?.message || "批量重建预览失败" });
  }
});

// Get model detail (public)
router.get("/api/models/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (prisma) {
    try {
      const m = await prisma.model.findUnique({
        where: { id },
        include: {
          categoryRef: { select: { name: true } },
          group: {
            include: {
              models: {
                select: { id: true, name: true, thumbnailUrl: true, originalName: true, originalSize: true, uploadPath: true, createdAt: true, metadata: true, fileModifiedAt: true },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      });
      if (m) {
        // Get original file date — always try STEP header first for true CAD creation date
        const dbMeta = (m.metadata as Record<string, unknown>) || {};
        let mainFileModifiedAt: string = m.createdAt.toISOString();
        try {
          const mainPath = m.uploadPath && existsSync(m.uploadPath)
            ? m.uploadPath
            : join(config.staticDir, "originals", `${m.id}.${m.format}`);
          if (existsSync(mainPath)) {
            const stepDate = parseStepFileDate(mainPath);
            if (stepDate) {
              mainFileModifiedAt = stepDate.toISOString();
              // Backfill/upsert to dedicated column
              if (!(m as any).fileModifiedAt || (m as any).fileModifiedAt.toISOString() !== stepDate.toISOString()) {
                prisma.model.update({ where: { id: m.id }, data: { fileModifiedAt: stepDate } }).catch(() => {});
              }
            } else if ((m as any).fileModifiedAt) {
              mainFileModifiedAt = (m as any).fileModifiedAt.toISOString();
            } else {
              const stat = await statAsync(mainPath);
              mainFileModifiedAt = stat.mtime.toISOString();
              prisma.model.update({ where: { id: m.id }, data: { fileModifiedAt: stat.mtime } }).catch(() => {});
            }
          } else if ((m as any).fileModifiedAt) {
            mainFileModifiedAt = (m as any).fileModifiedAt.toISOString();
          } else if (dbMeta.originalModifiedAt) {
            mainFileModifiedAt = dbMeta.originalModifiedAt as string;
          }
        } catch { /* keep DB fallback */ }

        // Pre-fetch variant file dates in parallel — priority: DB metadata > fs mtime > DB createdAt
        const variantStats = await Promise.all(
          (m.group?.models ?? []).map(async (v: any) => {
            try {
              if (v.fileModifiedAt) return v.fileModifiedAt.toISOString();
              const vMeta = (v.metadata as Record<string, unknown>) || {};
              if (vMeta.originalModifiedAt) return vMeta.originalModifiedAt as string;
              if (v.uploadPath) {
                const p = v.uploadPath.startsWith("/") ? v.uploadPath : join(process.cwd(), v.uploadPath);
                if (existsSync(p)) {
                  const stat = await statAsync(p);
                  return stat.mtime.toISOString();
                }
              }
            } catch { /* fallback */ }
            return v.createdAt ? v.createdAt.toISOString() : null;
          })
        );

        const groupData = m.group ? {
          id: m.group.id,
          name: m.group.name,
          variants: m.group.models.map((v: any, i: number) => {
            return {
              model_id: v.id,
              name: v.name,
              thumbnail_url: v.thumbnailUrl,
              original_name: v.originalName,
              original_size: v.originalSize,
              is_primary: v.id === m.group.primaryId,
              created_at: v.createdAt,
              file_modified_at: variantStats[i],
            };
          }),
        } : null;

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
          file_modified_at: mainFileModifiedAt,
          drawing_url: m.drawingUrl || null,
          drawing_name: m.drawingName || null,
          drawing_size: m.drawingSize || null,
          preview_meta: getPreviewMeta(m.id, { gltfUrl: m.gltfUrl, originalName: m.originalName, format: m.format }),
          group: groupData,
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
    preview_meta: getPreviewMeta(id, {
      gltfUrl: m.gltf_url as string | null,
      originalName: m.original_name as string | null,
      format: m.format as string | null,
    }),
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

  // Auth: support both Authorization header and ?token= query param
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token as string | undefined;
  const authToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : queryToken;

  // Check if login is required to download
  const requireLogin = await getSetting<boolean>("require_login_download");
  if (requireLogin && !authToken) {
    res.status(401).json({ detail: "需要登录后才能下载" });
    return;
  }

  // Check daily download limit
  const dailyLimit = await getSetting<number>("daily_download_limit");
  if (dailyLimit > 0 && authToken) {
    try {
      const { verifyToken } = await import("../lib/jwt.js");
      const payload = verifyToken(authToken);
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

  let filePath: string | null = null;
  let fileName: string | null = null;
  let fileSize = 0;

  if (prisma) {
    try {
      const m = await prisma.model.findUnique({ where: { id } });
      if (m) {
        const displayName = m.name || m.originalName || id;
        const origExt = m.originalFormat || m.format || "step";
        if (requestedFormat === "original" && m.uploadPath) {
          // uploadPath may be absolute or relative — try direct resolution first,
          // then fall back to {cwd}/static/originals/{id}.{ext}
          const origPath = m.uploadPath.startsWith("/")
            ? m.uploadPath
            : join(process.cwd(), m.uploadPath);
          if (existsSync(origPath)) {
            filePath = origPath;
            fileName = `${displayName}.${origExt}`;
            fileSize = m.originalSize;
          } else {
            const fallbackPath = join(process.cwd(), "static", "originals", `${id}.${origExt}`);
            if (existsSync(fallbackPath)) {
              filePath = fallbackPath;
              fileName = `${displayName}.${origExt}`;
              fileSize = m.originalSize;
            }
          }
        }
        if (!filePath) {
          filePath = findPreviewAssetPath(join(config.staticDir, "models"), id, m.gltfUrl);
          if (filePath) {
            fileName = previewAssetFileName(displayName, filePath);
            fileSize = m.gltfSize;
          }
        }

        // Record download (best effort, skip if no_record=1)
        try {
          const noRecord = req.query.no_record === "1";
          if (!noRecord && authToken) {
            let userId: string | undefined;
            try {
              const { verifyToken } = await import("../lib/jwt.js");
              const payload = verifyToken(authToken);
              userId = payload.userId;
            } catch { /* token invalid */ }
            if (userId) {
              await prisma.download.create({
                data: {
                  userId,
                  modelId: id,
                  format: requestedFormat === "original" ? m.format : getPreviewAssetExtension(filePath || m.gltfUrl),
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
        filePath = resolveFileUrlPath(gltfUrl);
        fileName = (meta.original_name as string)
          ? (meta.original_name as string).replace(/\.[^.]+$/, `.${getPreviewAssetExtension(gltfUrl)}`)
          : previewAssetFileName(id, gltfUrl);
      }
    }
  }

  if (!filePath || !existsSync(filePath)) {
    res.status(404).json({ detail: "文件不存在" });
    return;
  }

  // RFC 5987: filename* for UTF-8, ASCII fallback for filename
  const asciiName = fileName!.replace(/[^\x20-\x7E]/g, "_");
  const utf8Name = encodeURIComponent(fileName!);
  res.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`);
  res.setHeader("Content-Type", "application/octet-stream");
  const { createReadStream } = await import("node:fs");
  const stream = createReadStream(filePath);
  stream.pipe(res);
});

// Delete model requires auth
router.delete("/api/models/:id", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  // Collect format info + group info before deleting from DB
  let origExt = "";
  if (prisma) {
    try {
      const dbModel = await prisma.model.findUnique({
        where: { id },
        select: { format: true, groupId: true, group: { select: { id: true, primaryId: true } } },
      });
      origExt = dbModel?.format || "";

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
          // No remaining variants — delete the group too
          await prisma.modelGroup.delete({ where: { id: dbModel.groupId } }).catch(() => {});
        }
      }
    } catch {}
  }

  // Delete files first
  const m = getMeta(id);
  if (m) {
    origExt = origExt || (m.format as string) || "";
    for (const p of [
      m.upload_path as string,
      join(config.staticDir, "models", `${id}.glb`),
      join(config.staticDir, "models", `${id}.meta.json`),
      join(config.staticDir, "models", `${id}.gltf`),
      join(config.staticDir, "models", `${id}.bin`),
      join(config.staticDir, "thumbnails", `${id}.png`),
      join(config.staticDir, "html-previews", `${id}.html`),
      join(config.staticDir, "html-previews", `${id}.htm`),
      ...(origExt ? [join(config.staticDir, "originals", `${id}.${origExt}`)] : []),
    ]) {
      if (p && existsSync(p)) rmSync(p, { force: true });
    }
  } else {
    // No filesystem metadata, clean up by convention using DB format
    for (const p of [
      join(config.staticDir, "models", `${id}.gltf`),
      join(config.staticDir, "models", `${id}.glb`),
      join(config.staticDir, "models", `${id}.meta.json`),
      join(config.staticDir, "models", `${id}.bin`),
      join(config.staticDir, "thumbnails", `${id}.png`),
      join(config.staticDir, "html-previews", `${id}.html`),
      join(config.staticDir, "html-previews", `${id}.htm`),
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

// Upload drawing (PDF) for a model
router.post("/api/models/:id/drawing", authMiddleware, requireRole("ADMIN"), upload.single("file"), async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const file = req.file;

  if (!file) {
    res.status(400).json({ detail: "没有文件" });
    return;
  }

  if (file.mimetype !== "application/pdf") {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: "仅支持 PDF 格式" });
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

    const drawingDir = join(config.staticDir, "drawings");
    mkdirSync(drawingDir, { recursive: true });
    const drawingPath = join(drawingDir, `${id}.pdf`);
    copyFileSync(file.path, drawingPath);
    rmSync(file.path, { force: true });

    const drawingUrl = `/static/drawings/${id}.pdf`;
    const { size: drawingSize } = statSync(drawingPath);

    await prisma.model.update({ where: { id }, data: { drawingUrl, drawingName: file.originalname, drawingSize } });
    await cacheDelByPrefix("cache:models:");

    res.json({ success: true, data: { model_id: id, drawing_url: drawingUrl } });
  } catch (err: any) {
    rmSync(file.path, { force: true });
    res.status(500).json({ detail: err.message || "上传图纸失败" });
  }
});

// Delete drawing (PDF) for a model
router.delete("/api/models/:id/drawing", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
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

    const drawingPath = join(config.staticDir, "drawings", `${id}.pdf`);
    if (existsSync(drawingPath)) rmSync(drawingPath, { force: true });

    await prisma.model.update({ where: { id }, data: { drawingUrl: null } });
    await cacheDelByPrefix("cache:models:");

    res.json({ success: true, data: { model_id: id, drawing_url: null } });
  } catch (err: any) {
    res.status(500).json({ detail: err.message || "删除图纸失败" });
  }
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

// Replace model source file and re-convert
router.post("/api/models/:id/replace-file", authMiddleware, requireRole("ADMIN"), upload.single("file"), async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const file = req.file;
  if (!file) {
    res.status(400).json({ detail: "没有文件" });
    return;
  }

  const originalName = file.originalname || "unknown.step";
  const ext = await validateModelUpload(file, res);
  if (!ext) return;

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

    // Delete old files
    const origExt = m.originalFormat || m.format;
    for (const p of [
      m.uploadPath,
      join(config.staticDir, "models", `${id}.glb`),
      join(config.staticDir, "models", `${id}.meta.json`),
      join(config.staticDir, "models", `${id}.gltf`),
      join(config.staticDir, "models", `${id}.bin`),
      join(config.staticDir, "thumbnails", `${id}.png`),
      join(config.staticDir, "html-previews", `${id}.html`),
      join(config.staticDir, "html-previews", `${id}.htm`),
      ...(origExt ? [join(config.staticDir, "originals", `${id}.${origExt}`)] : []),
    ]) {
      if (p && existsSync(p)) rmSync(p, { force: true });
    }

    // Save new file as original
    const originalsDir = join(config.staticDir, "originals");
    mkdirSync(originalsDir, { recursive: true });
    const destPath = join(originalsDir, `${id}.${ext}`);
    copyFileSync(file.path, destPath);
    rmSync(file.path, { force: true });

    // Update database — preserve original file modification time: STEP header > client filesystem
    const stepFileDate = parseStepFileDate(destPath);
    const clientLastModified = req.body.lastModified ? Number(req.body.lastModified) : null;
    const fileDate = stepFileDate || (clientLastModified && !isNaN(clientLastModified) ? new Date(clientLastModified) : null);
    const originalModifiedAt = fileDate ? fileDate.toISOString() : null;
    const existingModel = await prisma.model.findUnique({ where: { id }, select: { metadata: true } });
    const existingMeta = (existingModel?.metadata as Record<string, unknown>) || {};

    await prisma.model.update({
      where: { id },
      data: {
        originalName,
        originalFormat: ext,
        originalSize: file.size,
        format: ext,
        uploadPath: destPath,
        status: "processing",
        gltfUrl: "",
        gltfSize: 0,
        thumbnailUrl: null,
        ...(originalModifiedAt && { metadata: { ...existingMeta, originalModifiedAt } }),
        ...(originalModifiedAt && { fileModifiedAt: new Date(originalModifiedAt) }),
      },
    });

    // Update filesystem metadata
    const meta = getMeta(id) || {
      model_id: id,
      created_at: new Date().toISOString(),
      created_by_id: req.user!.userId,
    };
    Object.assign(meta, {
      original_name: originalName,
      original_size: file.size,
      format: ext,
      status: "processing",
      upload_path: destPath,
    });
    saveMeta(id, meta);

    // Enqueue conversion
    try {
      await conversionQueue.add("convert", {
        modelId: id,
        filePath: destPath,
        originalName,
        ext,
        userId: req.user!.userId,
        preserveSource: true,
      });
    } catch (queueErr) {
      console.error("Queue add failed:", queueErr);
      meta.status = "failed";
      meta.error = "conversion_queue_unavailable";
      saveMeta(id, meta);
      await prisma.model.update({
        where: { id },
        data: { status: "failed" },
      }).catch(() => {});
      await cacheDelByPrefix("cache:models:");
      res.status(503).json({ detail: "转换队列暂不可用，请稍后重试" });
      return;
    }

    await cacheDelByPrefix("cache:models:");
    res.json({ success: true, data: { model_id: id, status: "processing" } });
  } catch (err: any) {
    console.error("Replace file failed:", err);
    res.status(500).json({ detail: err.message || "替换文件失败" });
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

    if (["html", "htm"].includes(String(m.format || "").toLowerCase())) {
      res.status(400).json({ detail: "HTML 预览已停用，请上传 STEP/IGES/XT 文件" });
      return;
    }

    const modelDir = join(config.staticDir, "models");
    let gltfSize = m.gltfSize;
    let gltfUrl = m.gltfUrl;
    let previewPath = findPreviewAssetPath(modelDir, m.id, m.gltfUrl);

    // Re-convert from original if available, otherwise just regenerate thumbnail from existing glTF
    if (existsSync(origPath)) {
      const result = m.format === "xt" || m.format === "x_t"
        ? await convertXtToGltf(origPath, modelDir, m.id, m.originalName || `${m.id}.${m.format}`)
        : await convertStepToGltf(origPath, modelDir, m.id, m.originalName || `${m.id}.${m.format}`);
      gltfSize = result.gltfSize;
      gltfUrl = result.gltfUrl;
      previewPath = result.gltfPath;
    }

    // Regenerate thumbnail from current preview asset (GLB for new conversions, glTF for legacy assets)
    let thumbnailUrl = m.thumbnailUrl;
    if (previewPath && existsSync(previewPath)) {
      try {
        const thumb = await generateThumbnail(previewPath, join(config.staticDir, "thumbnails"), m.id);
        thumbnailUrl = thumb.thumbnailUrl;
      } catch { /* non-critical */ }
    }

    // Append timestamp for cache busting
    const ts = Date.now();
    const versionedUrl = thumbnailUrl ? `${thumbnailUrl.split('?')[0]}?t=${ts}` : null;

    // Update DB with versioned URL
    await prisma.model.update({
      where: { id },
      data: {
        ...(gltfUrl !== m.gltfUrl ? { gltfUrl } : {}),
        ...(gltfSize !== m.gltfSize ? { gltfSize } : {}),
        ...(versionedUrl !== m.thumbnailUrl ? { thumbnailUrl: versionedUrl } : {}),
      },
    });

    await cacheDelByPrefix("cache:models:");
    const previewMeta = getPreviewMeta(m.id, {
      gltfUrl,
      originalName: m.originalName,
      format: m.format,
    });

    res.json({
      success: true,
      data: {
        model_id: m.id,
        name: m.name,
        gltf_url: gltfUrl,
        gltf_size: gltfSize,
        thumbnail_url: versionedUrl,
        preview_meta: previewMeta,
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
      select: { id: true, name: true, originalName: true, format: true, uploadPath: true },
    });

    let success = 0, failed = 0;
    const modelDir = join(config.staticDir, "models");
    const thumbDir = join(config.staticDir, "thumbnails");

    for (const m of models) {
      const origPath = m.uploadPath && existsSync(m.uploadPath)
        ? m.uploadPath
        : join(config.staticDir, "originals", `${m.id}.${m.format}`);

      if (!existsSync(origPath)) { failed++; continue; }
      if (["html", "htm"].includes(String(m.format || "").toLowerCase())) { failed++; continue; }

      try {
        const result = m.format === "xt" || m.format === "x_t"
          ? await convertXtToGltf(origPath, modelDir, m.id, m.originalName || `${m.id}.${m.format}`)
          : await convertStepToGltf(origPath, modelDir, m.id, m.originalName || `${m.id}.${m.format}`);

        let thumbnailUrl: string | null = null;
        if (existsSync(result.gltfPath)) {
          try {
            const thumb = await generateThumbnail(result.gltfPath, thumbDir, m.id);
            thumbnailUrl = `${thumb.thumbnailUrl}?t=${Date.now()}`;
          } catch { /* non-critical */ }
        }

        await prisma.model.update({
          where: { id: m.id },
          data: { gltfUrl: result.gltfUrl, gltfSize: result.gltfSize, ...(thumbnailUrl ? { thumbnailUrl } : {}) },
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

    const ext = await validateModelUpload(file, res);
    if (!ext) return;
    const versionNumber = model.currentVersion + 1;

    // Convert file into a browser-ready GLB preview.
    const modelDir = join(config.staticDir, "models");
    let result: { gltfUrl: string; gltfSize: number };
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
