import { Router, Response, type NextFunction } from "express";
import AdmZip from "adm-zip";
import { Image, createCanvas, loadImage } from "canvas";
import { createExtractorFromData } from "node-unrar-js";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdirSync, renameSync, rmSync, createWriteStream, writeFileSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { basename, join, resolve, sep } from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ProductWallCategory as ProductWallCategoryRow, ProductWallImage as ProductWallImageRow } from "@prisma/client";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { getBusinessConfig } from "../lib/businessConfig.js";
import { getSetting } from "../lib/settings.js";
import { badRequest } from "../lib/http.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";

type ProductWallKind = string;
type ProductWallStatus = "pending" | "approved" | "rejected";

type ProductWallCategoryItem = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type ProductWallItem = {
  id: string;
  title: string;
  description?: string;
  kind: ProductWallKind;
  image: string;
  previewImage?: string;
  ratio: string;
  tags: string[];
  sortOrder: number;
  createdAt: string;
  status: ProductWallStatus;
  uploaderId?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectReason?: string;
};

const PRODUCT_WALL_DIR = join(process.cwd(), config.staticDir, "product-wall");
const FALLBACK_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MULTER_MAX_IMAGE_FILES = 200;
const DEFAULT_PRODUCT_WALL_CATEGORIES: ProductWallKind[] = ["公司产品", "使用案例", "客户案例", "海报"];
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
const IMAGE_FILE_EXTENSIONS: Record<string, string> = {
  ".png": "png",
  ".jpg": "jpg",
  ".jpeg": "jpg",
  ".gif": "gif",
  ".webp": "webp",
  ".svg": "svg",
};

mkdirSync(PRODUCT_WALL_DIR, { recursive: true });

class MaxBytesExceededError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Remote image exceeds ${maxBytes} bytes`);
  }
}

function normalizeMimeType(value: string) {
  return value.split(";")[0]?.trim().toLowerCase() || "";
}

function imageExtFromMimeType(value: string) {
  return IMAGE_EXTENSIONS[normalizeMimeType(value)] || null;
}

function imageExtFromFilename(value: string) {
  const match = value.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? IMAGE_FILE_EXTENSIONS[match[0]] || null : null;
}

function isZipUpload(file: Express.Multer.File) {
  const type = normalizeMimeType(file.mimetype);
  return type === "application/zip" || type === "application/x-zip-compressed" || file.originalname.toLowerCase().endsWith(".zip");
}

function isRarUpload(file: Express.Multer.File) {
  const type = normalizeMimeType(file.mimetype);
  return type === "application/vnd.rar" || type === "application/x-rar-compressed" || file.originalname.toLowerCase().endsWith(".rar");
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return;
  }
  next();
}

function parseTags(value: unknown, fallbackTitle = ""): string[] {
  const raw = Array.isArray(value) ? value.join(",") : String(value || "");
  const tags = Array.from(new Set(raw.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean)));
  if (tags.length) return tags.slice(0, 20);
  return fallbackTitle.split(/[\s_\-—]+/).map((item) => item.trim()).filter(Boolean).slice(0, 6);
}

function normalizeKind(value: unknown): ProductWallKind {
  const text = String(value || "").trim().slice(0, 24);
  return text || DEFAULT_PRODUCT_WALL_CATEGORIES[0];
}

function normalizeStatus(value: unknown): ProductWallStatus {
  return value === "pending" || value === "rejected" ? value : "approved";
}

function basenameFromUploadName(value: string) {
  const normalized = value.replace(/\\/g, "/");
  const leaf = normalized.split("/").filter(Boolean).pop() || normalized;
  try {
    return decodeURIComponent(leaf);
  } catch {
    return leaf;
  }
}

function decodeLatin1Bytes(value: string, encoding: string) {
  try {
    return new TextDecoder(encoding).decode(Buffer.from(value, "latin1"));
  } catch {
    return "";
  }
}

function filenameQualityScore(value: string) {
  if (!value) return -1000;
  const cjkCount = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const readableCount = (value.match(/[a-zA-Z0-9_\-\s()[\]（）【】.]/g) || []).length;
  const replacementCount = (value.match(/\uFFFD/g) || []).length;
  const controlCount = (value.match(/[\u0000-\u001f\u007f-\u009f]/g) || []).length;
  const mojibakeCount = (value.match(/[ÃÂâäåæçèéêëìíîïðñòóôõöùúûüýÿ¤¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿╔╗╚╝╠╣╦╩╬═║]/g) || []).length;
  return cjkCount * 12 + readableCount - replacementCount * 50 - controlCount * 20 - mojibakeCount * 6;
}

function fixMojibakeFilename(value: string) {
  const candidates = [
    value,
    decodeLatin1Bytes(value, "utf-8"),
    decodeLatin1Bytes(value, "gbk"),
    decodeLatin1Bytes(value, "gb18030"),
  ].filter(Boolean);
  return candidates.reduce((best, item) => (
    filenameQualityScore(item) > filenameQualityScore(best) ? item : best
  ), value);
}

function safeTitle(value: unknown, fallback = "产品图片") {
  const normalize = (input: unknown) => fixMojibakeFilename(basenameFromUploadName(String(input || "")))
    .replace(/\.[^.]+$/, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();
  const text = normalize(value) || normalize(fallback) || "产品图片";
  return text.slice(0, 80);
}

function safeDescription(value: unknown) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim()
    .slice(0, 500);
}

function requirePublicUploadMeta(req: AuthRequest, res: Response, files?: Express.Multer.File[]) {
  if (req.user?.role === "ADMIN") return true;
  const title = safeTitle(req.body?.title, "");
  const description = safeDescription(req.body?.description);
  if (title && description) return true;
  if (files?.length) {
    for (const file of files) rmSync(file.path, { force: true });
  }
  res.status(400).json({ detail: title ? "请填写图片描述" : "请填写图片标题" });
  return false;
}

function tagsFromJson(value: unknown, fallbackTitle: string) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : parseTags(value, fallbackTitle);
}

function toProductWallItem(row: ProductWallImageRow): ProductWallItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description || undefined,
    kind: normalizeKind(row.kind),
    image: row.imageUrl,
    previewImage: row.previewImageUrl || row.imageUrl,
    ratio: row.ratio,
    tags: tagsFromJson(row.tags, row.title),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    status: normalizeStatus(row.status),
    uploaderId: row.uploaderId || undefined,
    reviewedAt: row.reviewedAt?.toISOString(),
    reviewedBy: row.reviewedById || undefined,
    rejectReason: row.rejectReason || undefined,
  };
}

function toProductWallCategory(row: ProductWallCategoryRow): ProductWallCategoryItem {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function ensureCategorySeed() {
  const categoryCount = await prisma.productWallCategory.count();
  if (categoryCount > 0) return;
  await prisma.productWallCategory.createMany({
    data: DEFAULT_PRODUCT_WALL_CATEGORIES.map((name, index) => ({ name, sortOrder: index })),
    skipDuplicates: true,
  });
}

let productWallSchemaReady: Promise<void> | null = null;

async function ensureProductWallSchema() {
  productWallSchemaReady ||= (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "product_wall_images" (
        "id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "kind" TEXT NOT NULL DEFAULT '公司产品',
        "image_url" TEXT NOT NULL,
        "preview_image_url" TEXT,
        "ratio" TEXT NOT NULL DEFAULT '4 / 5',
        "tags" JSONB,
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "uploader_id" TEXT,
        "reviewed_at" TIMESTAMP(3),
        "reviewed_by_id" TEXT,
        "reject_reason" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "product_wall_images_pkey" PRIMARY KEY ("id")
      )`,
      `ALTER TABLE "product_wall_images" ADD COLUMN IF NOT EXISTS "description" TEXT`,
      `CREATE INDEX IF NOT EXISTS "product_wall_images_status_idx" ON "product_wall_images"("status")`,
      `CREATE INDEX IF NOT EXISTS "product_wall_images_kind_idx" ON "product_wall_images"("kind")`,
      `CREATE INDEX IF NOT EXISTS "product_wall_images_sort_order_idx" ON "product_wall_images"("sort_order")`,
      `CREATE INDEX IF NOT EXISTS "product_wall_images_created_at_idx" ON "product_wall_images"("created_at")`,
      `CREATE INDEX IF NOT EXISTS "product_wall_images_uploader_id_idx" ON "product_wall_images"("uploader_id")`,
      `CREATE INDEX IF NOT EXISTS "product_wall_images_status_kind_sort_order_idx" ON "product_wall_images"("status", "kind", "sort_order")`,
      `CREATE TABLE IF NOT EXISTS "product_wall_categories" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "product_wall_categories_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "product_wall_categories_name_key" ON "product_wall_categories"("name")`,
      `CREATE INDEX IF NOT EXISTS "product_wall_categories_sort_order_idx" ON "product_wall_categories"("sort_order")`,
      `CREATE TABLE IF NOT EXISTS "product_wall_image_favorites" (
        "id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "image_id" TEXT NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "product_wall_image_favorites_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "product_wall_image_favorites_userId_imageId_key" ON "product_wall_image_favorites"("user_id", "image_id")`,
      `CREATE INDEX IF NOT EXISTS "product_wall_image_favorites_userId_idx" ON "product_wall_image_favorites"("user_id")`,
    ];
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }
  })().catch((error) => {
    productWallSchemaReady = null;
    throw error;
  });
  return productWallSchemaReady;
}

async function ensureProductWallData() {
  await ensureProductWallSchema();
  await ensureCategorySeed();
}

async function nextSortOrder() {
  const result = await prisma.productWallImage.aggregate({ _max: { sortOrder: true } });
  return (result._max.sortOrder ?? -1) + 1;
}

function createMaxBytesTransform(maxBytes: number) {
  let bytesRead = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      bytesRead += chunk.length;
      if (bytesRead > maxBytes) {
        callback(new MaxBytesExceededError(maxBytes));
        return;
      }
      callback(null, chunk);
    },
  });
}

function isBlockedRemoteAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map((part) => Number(part));
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (version === 6) {
    const lower = address.toLowerCase().split("%")[0] || "";
    if (lower.startsWith("::ffff:")) return isBlockedRemoteAddress(lower.slice("::ffff:".length));
    const firstHextet = Number.parseInt(lower.split(":")[0] || "0", 16);
    return lower === "::" || lower === "::1" || (firstHextet >= 0xfc00 && firstHextet <= 0xffff);
  }
  return false;
}

async function assertAllowedRemoteImageUrl(parsedUrl: URL) {
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || isBlockedRemoteAddress(hostname)) {
    throw new Error("REMOTE_IMAGE_HOST_BLOCKED");
  }
  const addresses = await lookup(hostname, { all: true, verbatim: false });
  if (!addresses.length || addresses.some(({ address }) => isBlockedRemoteAddress(address))) {
    throw new Error("REMOTE_IMAGE_HOST_BLOCKED");
  }
}

function removeManagedImage(url?: string | null) {
  if (!url?.startsWith("/static/product-wall/")) return;
  const filePath = resolve(process.cwd(), config.staticDir, "product-wall", basename(url));
  const root = resolve(process.cwd(), config.staticDir, "product-wall");
  if (filePath === root || !filePath.startsWith(`${root}${sep}`)) return;
  rmSync(filePath, { force: true });
}

const imageUpload = multer({
  dest: PRODUCT_WALL_DIR,
  limits: { fileSize: 200 * 1024 * 1024, files: MULTER_MAX_IMAGE_FILES },
});

async function getProductWallUploadPolicy() {
  const { uploadPolicy } = await getBusinessConfig();
  const maxImageMb = Math.max(1, Number(await getSetting<number>("product_wall_max_image_mb")) || 50);
  const maxBatch = Math.max(1, Number(await getSetting<number>("product_wall_max_batch_count")) || 50);
  const maxSizeMb = Math.max(1, Math.min(maxImageMb, Math.floor(Number(uploadPolicy.productWallImageMaxSizeMb) || 8)));
  const maxFiles = Math.max(1, Math.min(maxBatch, Math.floor(Number(uploadPolicy.productWallUploadMaxFiles) || 20)));
  return { maxSizeMb, maxBytes: maxSizeMb * 1024 * 1024, maxFiles };
}

async function validateProductWallUploadFiles(files: Express.Multer.File[]) {
  const policy = await getProductWallUploadPolicy();
  if (files.length > policy.maxFiles) {
    for (const file of files) rmSync(file.path, { force: true });
    throw badRequest(`单次最多上传 ${policy.maxFiles} 张图片`);
  }
  const oversized = files.find((file) => file.size > policy.maxBytes);
  if (oversized) {
    for (const file of files) rmSync(file.path, { force: true });
    throw badRequest(`单张图片不能超过 ${policy.maxSizeMb}MB`);
  }
}

type PendingProductWallImage = {
  title: string;
  ext: string;
  size: number;
  ratio?: string;
  sourcePath?: string;
  buffer?: Buffer;
};

function cleanupPendingImages(images: PendingProductWallImage[]) {
  for (const image of images) {
    if (image.sourcePath) rmSync(image.sourcePath, { force: true });
  }
}

function imageRatioFromBuffer(buffer: Buffer) {
  try {
    if (buffer.length > 20 * 1024 * 1024) return "4 / 5";
    const image = new Image();
    image.src = buffer;
    if (!image.width || !image.height) return "4 / 5";
    const width = Math.max(1, Math.round(image.width));
    const height = Math.max(1, Math.round(image.height));
    return `${width} / ${height}`;
  } catch {
    return "4 / 5";
  }
}

function imageRatioFromPath(path: string) {
  return imageRatioFromBuffer(readFileSync(path));
}

async function generatePreviewImage(sourcePath: string, maxWidth = 400): Promise<string | null> {
  try {
    const image = await loadImage(sourcePath);
    if (image.width <= maxWidth) return null;
    const scale = maxWidth / image.width;
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(maxWidth, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, maxWidth, height);
    const previewFilename = `preview_${randomUUID()}.jpg`;
    const previewPath = join(PRODUCT_WALL_DIR, previewFilename);
    writeFileSync(previewPath, canvas.toBuffer("image/jpeg", { quality: 0.75 }));
    return `/static/product-wall/${previewFilename}`;
  } catch {
    return null;
  }
}

async function collectProductWallUploadImages(files: Express.Multer.File[]) {
  const policy = await getProductWallUploadPolicy();
  const images: PendingProductWallImage[] = [];
  const canAddImage = (size: number) => {
    if (images.length >= policy.maxFiles) {
      return false;
    }
    if (size > policy.maxBytes) {
      return false;
    }
    return true;
  };

  for (const file of files) {
    if (isZipUpload(file)) {
      let zip: AdmZip;
      try {
        zip = new AdmZip(file.path);
      } catch {
        cleanupPendingImages(images);
        for (const item of files) rmSync(item.path, { force: true });
        throw badRequest("压缩包读取失败，请上传 zip 格式文件");
      }
      try {
        const maxZipExtract = Math.max(1, Number(await getSetting<number>("product_wall_max_zip_extract")) || 100);
        const MAX_SINGLE_IMAGE_BYTES = 50 * 1024 * 1024;
        for (const entry of zip.getEntries()) {
          if (images.length >= maxZipExtract) break;
          if (entry.isDirectory || entry.entryName.startsWith("__MACOSX/")) continue;
          const ext = imageExtFromFilename(entry.entryName);
          if (!ext) continue;
          const declaredSize = entry.header.size;
          if (declaredSize > MAX_SINGLE_IMAGE_BYTES) continue;
          const buffer = entry.getData();
          if (!buffer.length) continue;
          if (buffer.length > MAX_SINGLE_IMAGE_BYTES) continue;
          if (!canAddImage(buffer.length)) continue;
          images.push({
            title: basename(entry.entryName),
            ext,
            size: buffer.length,
            ratio: imageRatioFromBuffer(buffer),
            buffer,
          });
        }
      } finally {
        rmSync(file.path, { force: true });
      }
      continue;
    }

    if (isRarUpload(file)) {
      try {
        const archiveBuffer = readFileSync(file.path);
        const data = archiveBuffer.buffer.slice(archiveBuffer.byteOffset, archiveBuffer.byteOffset + archiveBuffer.byteLength);
        const extractor = await createExtractorFromData({ data });
        const extracted = extractor.extract({
          files: (header) => !header.flags.directory && Boolean(imageExtFromFilename(header.name)),
        });
        const maxRarExtract = Math.max(1, Number(await getSetting<number>("product_wall_max_zip_extract")) || 100);
        for (const item of extracted.files) {
          if (images.length >= maxRarExtract) break;
          const ext = imageExtFromFilename(item.fileHeader.name);
          const content = item.extraction;
          if (!ext || !content?.length) continue;
          if (!canAddImage(content.byteLength)) continue;
          images.push({
            title: basename(item.fileHeader.name),
            ext,
            size: content.byteLength,
            ratio: imageRatioFromBuffer(Buffer.from(content)),
            buffer: Buffer.from(content),
          });
        }
      } catch {
        cleanupPendingImages(images);
        for (const item of files) rmSync(item.path, { force: true });
        throw badRequest("rar 压缩包读取失败，请确认文件未损坏且未加密");
      } finally {
        rmSync(file.path, { force: true });
      }
      continue;
    }

    const ext = imageExtFromMimeType(file.mimetype) || imageExtFromFilename(file.originalname);
    if (!ext) {
      rmSync(file.path, { force: true });
      continue;
    }
    if (!canAddImage(file.size)) {
      rmSync(file.path, { force: true });
      continue;
    }
    images.push({
      title: file.originalname,
      ext,
      size: file.size,
      ratio: imageRatioFromPath(file.path),
      sourcePath: file.path,
    });
  }

  return images;
}

async function createItemsFromUploadedFiles(req: AuthRequest, files: Express.Multer.File[], status: ProductWallStatus) {
  const images = await collectProductWallUploadImages(files);
  const startSortOrder = await nextSortOrder();
  const created: ProductWallItem[] = [];
  for (const image of images) {
    const filename = `${randomUUID()}.${image.ext}`;
    const targetPath = join(PRODUCT_WALL_DIR, filename);
    if (image.sourcePath) renameSync(image.sourcePath, targetPath);
    else if (image.buffer) writeFileSync(targetPath, image.buffer);
    const imageUrl = `/static/product-wall/${filename}`;
    const previewUrl = (await generatePreviewImage(targetPath)) || imageUrl;
    const title = safeTitle(req.body?.title, image.title || "产品图片");
    const description = safeDescription(req.body?.description);
    const row: ProductWallImageRow = await prisma.productWallImage.create({
      data: {
        title,
        description: description || null,
        kind: normalizeKind(req.body?.kind),
        imageUrl,
        previewImageUrl: previewUrl,
        ratio: image.ratio || "4 / 5",
        tags: parseTags(req.body?.tags, title),
        sortOrder: startSortOrder + created.length,
        status,
        uploaderId: req.user?.userId,
      },
    });
    created.push(toProductWallItem(row));
  }
  return created;
}

async function createItemFromRemoteUrl(req: AuthRequest, res: Response, status: ProductWallStatus) {
  let filePath = "";
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      res.status(400).json({ detail: "请提供图片地址" });
      return;
    }
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      res.status(400).json({ detail: "仅支持 http/https 图片地址" });
      return;
    }
    await assertAllowedRemoteImageUrl(parsedUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(parsedUrl, { signal: controller.signal, redirect: "error" });
      if (!resp.ok || !resp.body) {
        res.status(400).json({ detail: `下载图片失败: HTTP ${resp.status}` });
        return;
      }
      const ext = imageExtFromMimeType(resp.headers.get("content-type") || "");
      if (!ext) {
        res.status(400).json({ detail: "远程文件不是支持的图片格式" });
        return;
      }
      const filename = `${randomUUID()}.${ext}`;
      filePath = join(PRODUCT_WALL_DIR, filename);
      const { maxBytes } = await getProductWallUploadPolicy();
      await pipeline(resp.body, createMaxBytesTransform(maxBytes || FALLBACK_MAX_IMAGE_BYTES), createWriteStream(filePath));
      const imageUrl = `/static/product-wall/${filename}`;
      const previewUrl = (await generatePreviewImage(filePath)) || imageUrl;
      const title = safeTitle(req.body?.title || parsedUrl.pathname.split("/").pop(), "链接图片");
      const description = safeDescription(req.body?.description);
      const item = await prisma.productWallImage.create({
        data: {
          title,
          description: description || null,
          kind: normalizeKind(req.body?.kind),
          imageUrl,
          previewImageUrl: previewUrl,
          ratio: imageRatioFromPath(filePath),
          tags: parseTags(req.body?.tags, title),
          sortOrder: await nextSortOrder(),
          status,
          uploaderId: req.user?.userId,
        },
      });
      res.json({ item: toProductWallItem(item) });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    if (filePath) rmSync(filePath, { force: true });
    if (err.name === "AbortError") {
      res.status(400).json({ detail: "下载图片超时" });
      return;
    }
    if (err instanceof MaxBytesExceededError) {
      res.status(400).json({ detail: `图片不能超过 ${Math.round(err.maxBytes / 1024 / 1024)}MB` });
      return;
    }
    res.status(400).json({ detail: "下载图片失败，请确认地址可访问且不是内网地址" });
  }
}

export default function productWallRouter() {
  const router = Router();

  router.get("/api/product-wall/categories", async (_req, res, next) => {
    try {
      await ensureProductWallData();
      const rows = await prisma.productWallCategory.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      res.json(rows.map(toProductWallCategory));
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/product-wall", async (req, res, next) => {
    try {
      await ensureProductWallData();
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50));
      const where = { status: "approved" };
      const [rows, total] = await Promise.all([
        prisma.productWallImage.findMany({
          where,
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.productWallImage.count({ where }),
      ]);
      res.json({ items: rows.map(toProductWallItem), total, page, page_size: pageSize });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/admin/product-wall", authMiddleware, requireAdmin, async (_req, res, next) => {
    try {
      await ensureProductWallData();
      const rows = await prisma.productWallImage.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      res.json(rows.map(toProductWallItem));
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/admin/product-wall/categories", authMiddleware, requireAdmin, async (_req, res, next) => {
    try {
      await ensureProductWallData();
      const rows = await prisma.productWallCategory.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      res.json(rows.map(toProductWallCategory));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/admin/product-wall/categories", authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next) => {
    try {
      const name = normalizeKind(req.body?.name);
      const maxSort = await prisma.productWallCategory.aggregate({ _max: { sortOrder: true } });
      const row = await prisma.productWallCategory.create({
        data: { name, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 },
      }).catch(() => null);
      if (!row) {
        res.status(409).json({ detail: "分类名称已存在" });
        return;
      }
      res.json(toProductWallCategory(row));
    } catch (err) {
      next(err);
    }
  });

  router.put("/api/admin/product-wall/categories/:id", authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next) => {
    try {
      const id = String(req.params.id);
      const existing = await prisma.productWallCategory.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ detail: "分类不存在" });
        return;
      }
      const nextName = req.body?.name !== undefined ? normalizeKind(req.body.name) : existing.name;
      const sortOrder = Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : existing.sortOrder;
      const row = await prisma.$transaction(async (tx) => {
        const updated = await tx.productWallCategory.update({
          where: { id },
          data: { name: nextName, sortOrder },
        });
        if (nextName !== existing.name) {
          await tx.productWallImage.updateMany({
            where: { kind: existing.name },
            data: { kind: nextName },
          });
        }
        return updated;
      }).catch(() => null);
      if (!row) {
        res.status(409).json({ detail: "分类名称已存在" });
        return;
      }
      res.json(toProductWallCategory(row));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/api/admin/product-wall/categories/:id", authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next) => {
    try {
      const id = String(req.params.id);
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.productWallCategory.findUnique({ where: { id } });
        if (!existing) throw Object.assign(new Error("NOT_FOUND"), { statusCode: 404 });
        const imageCount = await tx.productWallImage.count({ where: { kind: existing.name } });
        if (imageCount > 0) throw Object.assign(new Error(`分类下还有 ${imageCount} 张图片，请先移动或删除图片`), { statusCode: 409 });
        const categoryCount = await tx.productWallCategory.count();
        if (categoryCount <= 1) throw Object.assign(new Error("至少保留一个分类"), { statusCode: 400 });
        await tx.productWallCategory.delete({ where: { id } });
        return true;
      });
      res.json({ ok: true });
    } catch (err: any) {
      if (err?.statusCode) {
        res.status(err.statusCode).json({ detail: err.message });
        return;
      }
      next(err);
    }
  });

  router.post("/api/product-wall/upload", authMiddleware, imageUpload.array("files", MULTER_MAX_IMAGE_FILES), async (req: AuthRequest, res: Response, next) => {
    try {
      const files = (req.files || []) as Express.Multer.File[];
      if (!files.length) {
        res.status(400).json({ detail: "请选择图片、文件夹或 zip/rar 压缩包" });
        return;
      }
      await validateProductWallUploadFiles(files);
      if (!requirePublicUploadMeta(req, res, files)) return;
      const created = await createItemsFromUploadedFiles(req, files, req.user?.role === "ADMIN" ? "approved" : "pending");
      if (!created.length) {
        res.status(400).json({ detail: "没有识别到可上传的图片" });
        return;
      }
      res.json({ items: created });
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/admin/product-wall/upload", authMiddleware, requireAdmin, imageUpload.array("files", MULTER_MAX_IMAGE_FILES), async (req: AuthRequest, res: Response, next) => {
    try {
      const files = (req.files || []) as Express.Multer.File[];
      if (!files.length) {
        res.status(400).json({ detail: "请选择图片、文件夹或 zip/rar 压缩包" });
        return;
      }
      await validateProductWallUploadFiles(files);
      const created = await createItemsFromUploadedFiles(req, files, "approved");
      if (!created.length) {
        res.status(400).json({ detail: "没有识别到可上传的图片" });
        return;
      }
      res.json({ items: created });
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/product-wall/from-url", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!requirePublicUploadMeta(req, res)) return;
    await createItemFromRemoteUrl(req, res, req.user?.role === "ADMIN" ? "approved" : "pending");
  });

  router.post("/api/admin/product-wall/from-url", authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
    await createItemFromRemoteUrl(req, res, "approved");
  });

  router.patch("/api/admin/product-wall/:id/review", authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next) => {
    try {
      const id = String(req.params.id);
      const rawStatus = req.body?.status;
      if (rawStatus !== "approved" && rawStatus !== "rejected") {
        res.status(400).json({ detail: "状态只能是 approved 或 rejected" });
        return;
      }
      const status: ProductWallStatus = rawStatus;
      const item = await prisma.productWallImage.update({
        where: { id },
        data: {
          status,
          reviewedAt: new Date(),
          reviewedById: req.user?.userId,
          rejectReason: status === "rejected" ? safeTitle(req.body?.rejectReason, "未通过审核") : null,
        },
      }).catch(() => null);
      if (!item) {
        res.status(404).json({ detail: "图片不存在" });
        return;
      }
      res.json(toProductWallItem(item));
    } catch (err) {
      next(err);
    }
  });

  router.put("/api/admin/product-wall/:id", authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next) => {
    try {
      const id = String(req.params.id);
      const existing = await prisma.productWallImage.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ detail: "图片不存在" });
        return;
      }
      const item = await prisma.productWallImage.update({
        where: { id },
        data: {
          title: req.body?.title !== undefined ? safeTitle(req.body.title, existing.title) : undefined,
          description: req.body?.description !== undefined ? (safeDescription(req.body.description) || null) : undefined,
          kind: req.body?.kind !== undefined ? normalizeKind(req.body.kind) : undefined,
          tags: req.body?.tags !== undefined ? parseTags(req.body.tags, existing.title) : undefined,
          sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Math.min(2147483647, Math.max(-2147483648, Math.trunc(Number(req.body?.sortOrder) || 0))) : undefined,
        },
      });
      res.json(toProductWallItem(item));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/admin/product-wall/batch-delete", authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next) => {
    try {
      const ids: string[] = Array.isArray(req.body?.ids) ? Array.from(new Set(req.body.ids.map((id: unknown) => String(id)))) : [];
      if (!ids.length) {
        res.status(400).json({ detail: "请选择要删除的图片" });
        return;
      }
      if (ids.length > 200) {
        res.status(400).json({ detail: "单次最多删除 200 张图片" });
        return;
      }
      const targets = await prisma.productWallImage.findMany({ where: { id: { in: ids } } });
      await prisma.productWallImage.deleteMany({ where: { id: { in: ids } } });
      for (const item of targets) {
        removeManagedImage(item.imageUrl);
        removeManagedImage(item.previewImageUrl);
      }
      res.json({ ok: true, deleted: targets.length });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/api/admin/product-wall/:id", authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next) => {
    try {
      const id = String(req.params.id);
      const target = await prisma.productWallImage.findUnique({ where: { id } });
      if (!target) {
        res.status(404).json({ detail: "图片不存在" });
        return;
      }
      await prisma.productWallImage.delete({ where: { id } });
      removeManagedImage(target.imageUrl);
      removeManagedImage(target.previewImageUrl);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ── 收藏 ──────────────────────────────────────────────────

  router.get("/api/product-wall/favorites", authMiddleware, async (req: AuthRequest, res: Response, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) { res.status(401).json({ detail: "请先登录" }); return; }
      const rows = await prisma.productWallImageFavorite.findMany({
        where: { userId },
        select: { imageId: true },
      });
      res.json(rows.map((r) => r.imageId));
    } catch (err) { next(err); }
  });

  router.post("/api/product-wall/:id/favorite", authMiddleware, async (req: AuthRequest, res: Response, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) { res.status(401).json({ detail: "请先登录" }); return; }
      const imageId = String(req.params.id);
      const image = await prisma.productWallImage.findUnique({ where: { id: imageId } });
      if (!image) { res.status(404).json({ detail: "图片不存在" }); return; }
      await prisma.productWallImageFavorite.upsert({
        where: { userId_imageId: { userId, imageId } },
        update: {},
        create: { userId, imageId },
      });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.delete("/api/product-wall/:id/favorite", authMiddleware, async (req: AuthRequest, res: Response, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) { res.status(401).json({ detail: "请先登录" }); return; }
      const imageId = String(req.params.id);
      await prisma.productWallImageFavorite.deleteMany({
        where: { userId, imageId },
      });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  return router;
}
