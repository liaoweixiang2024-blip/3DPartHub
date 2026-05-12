import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  createWriteStream,
  writeFileSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { isIP } from 'node:net';
import { basename, join, resolve, sep } from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  ProductWallCategory as ProductWallCategoryRow,
  ProductWallImage as ProductWallImageRow,
} from '@prisma/client';
import AdmZip from 'adm-zip';
import { Image, createCanvas, loadImage } from 'canvas';
import { Response, type NextFunction } from 'express';
import multer from 'multer';
import { createExtractorFromData } from 'node-unrar-js';
import { getBusinessConfig } from '../../lib/businessConfig.js';
import { config } from '../../lib/config.js';
import { badRequest } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { getSetting } from '../../lib/settings.js';
import { type AuthRequest } from '../../middleware/auth.js';

// ── Types ───────────────────────────────────────────────────

export type ProductWallKind = string;
export type ProductWallStatus = 'pending' | 'approved' | 'rejected';

export type ProductWallCategoryItem = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProductWallItem = {
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

// ── Constants ───────────────────────────────────────────────

export const PRODUCT_WALL_DIR = join(process.cwd(), config.staticDir, 'product-wall');
const PRODUCT_WALL_PREVIEW_DIR = join(PRODUCT_WALL_DIR, 'previews');
const FALLBACK_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MULTER_MAX_IMAGE_FILES = 200;
const PRODUCT_WALL_PREVIEW_MAX_WIDTH = 640;
const PRODUCT_WALL_PREVIEW_JPEG_QUALITY = 0.76;
const PRODUCT_WALL_PREVIEW_BACKFILL_LIMIT = 80;
const PRODUCT_WALL_PREVIEW_BACKFILL_BATCH_SIZE = 12;
const PRODUCT_WALL_PREVIEW_BACKFILL_DELAY_MS = 300;
const PRODUCT_WALL_PREVIEW_MIN_SOURCE_BYTES = 768 * 1024;
const DEFAULT_PRODUCT_WALL_CATEGORIES: ProductWallKind[] = ['公司产品', '使用案例', '客户案例', '海报'];
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};
const IMAGE_FILE_EXTENSIONS: Record<string, string> = {
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.gif': 'gif',
  '.webp': 'webp',
  '.svg': 'svg',
};

mkdirSync(PRODUCT_WALL_DIR, { recursive: true });
mkdirSync(PRODUCT_WALL_PREVIEW_DIR, { recursive: true });

// ── Error class ─────────────────────────────────────────────

export class MaxBytesExceededError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Remote image exceeds ${maxBytes} bytes`);
  }
}

// ── Helpers: MIME / filename ────────────────────────────────

function normalizeMimeType(value: string) {
  return value.split(';')[0]?.trim().toLowerCase() || '';
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
  return (
    type === 'application/zip' ||
    type === 'application/x-zip-compressed' ||
    file.originalname.toLowerCase().endsWith('.zip')
  );
}

function isRarUpload(file: Express.Multer.File) {
  const type = normalizeMimeType(file.mimetype);
  return (
    type === 'application/vnd.rar' ||
    type === 'application/x-rar-compressed' ||
    file.originalname.toLowerCase().endsWith('.rar')
  );
}

// ── Middleware ───────────────────────────────────────────────

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ detail: '需要管理员权限' });
    return;
  }
  next();
}

// ── Helpers: parsing ────────────────────────────────────────

export function parseTags(value: unknown, fallbackTitle = ''): string[] {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  const tags = Array.from(
    new Set(
      raw
        .split(/[,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
  if (tags.length) return tags.slice(0, 20);
  return fallbackTitle
    .split(/[\s_\-—]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function normalizeKind(value: unknown): ProductWallKind {
  const text = String(value || '')
    .trim()
    .slice(0, 24);
  return text || DEFAULT_PRODUCT_WALL_CATEGORIES[0];
}

export function normalizeStatus(value: unknown): ProductWallStatus {
  return value === 'pending' || value === 'rejected' ? value : 'approved';
}

function basenameFromUploadName(value: string) {
  const normalized = value.replace(/\\/g, '/');
  const leaf = normalized.split('/').filter(Boolean).pop() || normalized;
  try {
    return decodeURIComponent(leaf);
  } catch {
    return leaf;
  }
}

function decodeLatin1Bytes(value: string, encoding: string) {
  try {
    return new TextDecoder(encoding).decode(Buffer.from(value, 'latin1'));
  } catch {
    return '';
  }
}

function filenameQualityScore(value: string) {
  if (!value) return -1000;
  const cjkCount = (value.match(/[㐀-鿿]/g) || []).length;
  const readableCount = (value.match(/[a-zA-Z0-9_\-\s()[\]（）【】.]/g) || []).length;
  const replacementCount = (value.match(/�/g) || []).length;
  const controlCount = (value.match(/[\x00-\x1f\x7f-\x9f]/g) || []).length;
  const mojibakeCount = (value.match(/[ÃÂâäåæçèéêëìíîïðñòóôõöùúûüýÿ¤¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿╔╗╚╝╠╣╦╩╬═║]/g) || [])
    .length;
  return cjkCount * 12 + readableCount - replacementCount * 50 - controlCount * 20 - mojibakeCount * 6;
}

function fixMojibakeFilename(value: string) {
  const candidates = [
    value,
    decodeLatin1Bytes(value, 'utf-8'),
    decodeLatin1Bytes(value, 'gbk'),
    decodeLatin1Bytes(value, 'gb18030'),
  ].filter(Boolean);
  return candidates.reduce(
    (best, item) => (filenameQualityScore(item) > filenameQualityScore(best) ? item : best),
    value,
  );
}

export function safeTitle(value: unknown, fallback = '产品图片') {
  const normalize = (input: unknown) =>
    fixMojibakeFilename(basenameFromUploadName(String(input || '')))
      .replace(/\.[^.]+$/, '')
      .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
      .trim();
  const text = normalize(value) || normalize(fallback) || '产品图片';
  return text.slice(0, 80);
}

export function safeDescription(value: unknown) {
  return String(value || '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    .trim()
    .slice(0, 500);
}

export function requirePublicUploadMeta(req: AuthRequest, res: Response, files?: Express.Multer.File[]) {
  if (req.user?.role === 'ADMIN') return true;
  const title = safeTitle(req.body?.title, '');
  const description = safeDescription(req.body?.description);
  if (title && description) return true;
  if (files?.length) {
    for (const file of files) rmSync(file.path, { force: true });
  }
  res.status(400).json({ detail: title ? '请填写图片描述' : '请填写图片标题' });
  return false;
}

function tagsFromJson(value: unknown, fallbackTitle: string) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : parseTags(value, fallbackTitle);
}

// ── Mappers ─────────────────────────────────────────────────

export function toProductWallItem(row: ProductWallImageRow): ProductWallItem {
  const previewImage = resolveProductWallPreviewImageUrl(row);
  return {
    id: row.id,
    title: row.title,
    description: row.description || undefined,
    kind: normalizeKind(row.kind),
    image: row.imageUrl,
    previewImage,
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

export function toProductWallCategory(row: ProductWallCategoryRow): ProductWallCategoryItem {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Seed / data init ────────────────────────────────────────

async function ensureCategorySeed() {
  const categoryCount = await prisma.productWallCategory.count();
  if (categoryCount > 0) return;
  await prisma.productWallCategory.createMany({
    data: DEFAULT_PRODUCT_WALL_CATEGORIES.map((name, index) => ({ name, sortOrder: index })),
    skipDuplicates: true,
  });
}

export async function ensureProductWallData() {
  await ensureCategorySeed();
}

// ── Sort order ──────────────────────────────────────────────

async function nextSortOrder() {
  const result = await prisma.productWallImage.aggregate({ _max: { sortOrder: true } });
  return (result._max.sortOrder ?? -1) + 1;
}

// ── Remote image security ───────────────────────────────────

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
    const [a, b] = address.split('.').map((part) => Number(part));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase().split('%')[0] || '';
    if (lower.startsWith('::ffff:')) return isBlockedRemoteAddress(lower.slice('::ffff:'.length));
    const firstHextet = Number.parseInt(lower.split(':')[0] || '0', 16);
    return lower === '::' || lower === '::1' || (firstHextet >= 0xfc00 && firstHextet <= 0xffff);
  }
  return false;
}

async function assertAllowedRemoteImageUrl(parsedUrl: URL) {
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || isBlockedRemoteAddress(hostname)) {
    throw new Error('REMOTE_IMAGE_HOST_BLOCKED');
  }
  const addresses = await lookup(hostname, { all: true, verbatim: false });
  if (!addresses.length || addresses.some(({ address }) => isBlockedRemoteAddress(address))) {
    throw new Error('REMOTE_IMAGE_HOST_BLOCKED');
  }
}

// ── Path helpers ────────────────────────────────────────────

function productWallRelativePathFromUrl(url?: string | null) {
  if (!url?.startsWith('/static/product-wall/')) return null;
  const cleanUrl = url.split(/[?#]/)[0] || '';
  const rawRelativePath = cleanUrl.slice('/static/product-wall/'.length).replace(/\\/g, '/');
  if (!rawRelativePath) return null;
  try {
    const relativePath = rawRelativePath
      .split('/')
      .map((part) => decodeURIComponent(part))
      .join('/');
    const parts = relativePath.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) return null;
    return relativePath;
  } catch {
    return null;
  }
}

function productWallLocalPathFromUrl(url?: string | null) {
  const relativePath = productWallRelativePathFromUrl(url);
  if (!relativePath) return null;
  const filePath = resolve(PRODUCT_WALL_DIR, relativePath);
  const root = resolve(process.cwd(), config.staticDir, 'product-wall');
  if (filePath === root || !filePath.startsWith(`${root}${sep}`)) return null;
  return filePath;
}

export function removeManagedImage(url?: string | null) {
  const filePath = productWallLocalPathFromUrl(url);
  if (!filePath) return;
  rmSync(filePath, { force: true });
}

function productWallPreviewUrlFromImageUrl(url?: string | null) {
  const relativePath = productWallRelativePathFromUrl(url);
  if (!relativePath || relativePath.startsWith('previews/')) return null;
  const leaf = basename(relativePath).replace(/\.[^.]+$/, '') || randomUUID();
  const safeLeaf = leaf.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || randomUUID();
  return `/static/product-wall/previews/${safeLeaf}.jpg`;
}

function resolveProductWallPreviewImageUrl(row: ProductWallImageRow) {
  if (row.previewImageUrl) return row.previewImageUrl;
  const deterministicPreviewUrl = productWallPreviewUrlFromImageUrl(row.imageUrl);
  const deterministicPreviewPath = productWallLocalPathFromUrl(deterministicPreviewUrl);
  if (deterministicPreviewPath && existsSync(deterministicPreviewPath)) return deterministicPreviewUrl || row.imageUrl;
  return row.imageUrl;
}

// ── Preview backfill ────────────────────────────────────────

const previewBackfillInFlight = new Set<string>();
const previewBackfillQueue = new Map<string, ProductWallImageRow>();
let previewBackfillScheduled = false;

function shouldBackfillProductWallPreview(row: ProductWallImageRow) {
  return row.imageUrl.startsWith('/static/product-wall/') && !row.previewImageUrl;
}

async function markProductWallPreviewAsOriginal(row: ProductWallImageRow): Promise<ProductWallImageRow> {
  try {
    return await prisma.productWallImage.update({
      where: { id: row.id },
      data: { previewImageUrl: row.imageUrl },
    });
  } catch {
    return { ...row, previewImageUrl: row.imageUrl } as ProductWallImageRow;
  }
}

async function ensureProductWallPreview(row: ProductWallImageRow): Promise<ProductWallImageRow> {
  if (!shouldBackfillProductWallPreview(row)) return row;
  if (previewBackfillInFlight.has(row.id)) return row;
  const sourcePath = productWallLocalPathFromUrl(row.imageUrl);
  if (!sourcePath) return row;

  let sourceSize = 0;
  try {
    sourceSize = statSync(sourcePath).size;
  } catch {
    return row;
  }
  if (sourceSize < PRODUCT_WALL_PREVIEW_MIN_SOURCE_BYTES) return markProductWallPreviewAsOriginal(row);

  previewBackfillInFlight.add(row.id);
  try {
    const previewUrl = await generatePreviewImage(sourcePath, row.imageUrl);
    if (!previewUrl || previewUrl === row.imageUrl) {
      return markProductWallPreviewAsOriginal(row);
    }
    try {
      return await prisma.productWallImage.update({
        where: { id: row.id },
        data: { previewImageUrl: previewUrl },
      });
    } catch {
      return { ...row, previewImageUrl: previewUrl } as ProductWallImageRow;
    }
  } catch {
    return row;
  } finally {
    previewBackfillInFlight.delete(row.id);
  }
}

function scheduleProductWallPreviewBackfill() {
  if (previewBackfillScheduled || !previewBackfillQueue.size) return;
  previewBackfillScheduled = true;
  const timer = setTimeout(() => {
    previewBackfillScheduled = false;
    void flushProductWallPreviewBackfillQueue();
  }, PRODUCT_WALL_PREVIEW_BACKFILL_DELAY_MS);
  timer.unref?.();
}

async function flushProductWallPreviewBackfillQueue() {
  const batch = Array.from(previewBackfillQueue.values()).slice(0, PRODUCT_WALL_PREVIEW_BACKFILL_BATCH_SIZE);
  for (const row of batch) previewBackfillQueue.delete(row.id);
  for (const row of batch) await ensureProductWallPreview(row);
  scheduleProductWallPreviewBackfill();
}

export function queueProductWallPreviewBackfill(rows: ProductWallImageRow[]) {
  const candidates = rows.filter(shouldBackfillProductWallPreview).slice(0, PRODUCT_WALL_PREVIEW_BACKFILL_LIMIT);
  if (!candidates.length) return;

  for (const row of candidates) {
    if (previewBackfillInFlight.has(row.id) || previewBackfillQueue.has(row.id)) continue;
    previewBackfillQueue.set(row.id, row);
  }
  scheduleProductWallPreviewBackfill();
}

// ── Upload policy ───────────────────────────────────────────

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']);

export const imageUpload = multer({
  dest: PRODUCT_WALL_DIR,
  limits: { fileSize: 200 * 1024 * 1024, files: MULTER_MAX_IMAGE_FILES },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的图片格式: ${file.mimetype}`));
    }
  },
});

export async function getProductWallUploadPolicy() {
  const { uploadPolicy } = await getBusinessConfig();
  const maxImageMb = Math.max(1, Number(await getSetting<number>('product_wall_max_image_mb')) || 50);
  const maxBatch = Math.max(1, Number(await getSetting<number>('product_wall_max_batch_count')) || 50);
  const maxSizeMb = Math.max(1, Math.min(maxImageMb, Math.floor(Number(uploadPolicy.productWallImageMaxSizeMb) || 8)));
  const maxFiles = Math.max(1, Math.min(maxBatch, Math.floor(Number(uploadPolicy.productWallUploadMaxFiles) || 20)));
  return { maxSizeMb, maxBytes: maxSizeMb * 1024 * 1024, maxFiles };
}

export async function validateProductWallUploadFiles(files: Express.Multer.File[]) {
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

// ── Image ratio ─────────────────────────────────────────────

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
    if (buffer.length > 20 * 1024 * 1024) return '4 / 5';
    const image = new Image();
    image.src = buffer;
    if (!image.width || !image.height) return '4 / 5';
    const width = Math.max(1, Math.round(image.width));
    const height = Math.max(1, Math.round(image.height));
    return `${width} / ${height}`;
  } catch {
    return '4 / 5';
  }
}

function imageRatioFromPath(path: string) {
  return imageRatioFromBuffer(readFileSync(path));
}

// ── Preview generation ──────────────────────────────────────

async function generatePreviewImage(
  sourcePath: string,
  sourceImageUrl?: string,
  maxWidth = PRODUCT_WALL_PREVIEW_MAX_WIDTH,
): Promise<string | null> {
  try {
    const previewUrl =
      productWallPreviewUrlFromImageUrl(sourceImageUrl) || `/static/product-wall/previews/${randomUUID()}.jpg`;
    const previewPath = productWallLocalPathFromUrl(previewUrl);
    if (!previewPath) return null;
    if (existsSync(previewPath)) return previewUrl;

    const image = await loadImage(sourcePath);
    const sourceSize = statSync(sourcePath).size;
    if (image.width <= maxWidth && sourceSize < PRODUCT_WALL_PREVIEW_MIN_SOURCE_BYTES) return null;

    const width = Math.min(maxWidth, Math.max(1, Math.round(image.width)));
    const scale = width / image.width;
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    writeFileSync(previewPath, canvas.toBuffer('image/jpeg', { quality: PRODUCT_WALL_PREVIEW_JPEG_QUALITY }));
    return previewUrl;
  } catch {
    return null;
  }
}

// ── Collect uploaded images ─────────────────────────────────

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
        throw badRequest('压缩包读取失败，请上传 zip 格式文件');
      }
      try {
        const maxZipExtract = Math.max(1, Number(await getSetting<number>('product_wall_max_zip_extract')) || 100);
        const MAX_SINGLE_IMAGE_BYTES = 50 * 1024 * 1024;
        for (const entry of zip.getEntries()) {
          if (images.length >= maxZipExtract) break;
          if (entry.isDirectory || entry.entryName.startsWith('__MACOSX/')) continue;
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
        const data = archiveBuffer.buffer.slice(
          archiveBuffer.byteOffset,
          archiveBuffer.byteOffset + archiveBuffer.byteLength,
        );
        const extractor = await createExtractorFromData({ data });
        const extracted = extractor.extract({
          files: (header) => !header.flags.directory && Boolean(imageExtFromFilename(header.name)),
        });
        const maxRarExtract = Math.max(1, Number(await getSetting<number>('product_wall_max_zip_extract')) || 100);
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
        throw badRequest('rar 压缩包读取失败，请确认文件未损坏且未加密');
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

// ── Create items from upload ────────────────────────────────

export async function createItemsFromUploadedFiles(
  req: AuthRequest,
  files: Express.Multer.File[],
  status: ProductWallStatus,
) {
  const images = await collectProductWallUploadImages(files);
  const startSortOrder = await nextSortOrder();
  const created: ProductWallItem[] = [];
  for (const image of images) {
    const filename = `${randomUUID()}.${image.ext}`;
    const targetPath = join(PRODUCT_WALL_DIR, filename);
    if (image.sourcePath) renameSync(image.sourcePath, targetPath);
    else if (image.buffer) writeFileSync(targetPath, image.buffer);
    const imageUrl = `/static/product-wall/${filename}`;
    const previewUrl = (await generatePreviewImage(targetPath, imageUrl)) || imageUrl;
    const title = safeTitle(req.body?.title, image.title || '产品图片');
    const description = safeDescription(req.body?.description);
    const row: ProductWallImageRow = await prisma.productWallImage.create({
      data: {
        title,
        description: description || null,
        kind: normalizeKind(req.body?.kind),
        imageUrl,
        previewImageUrl: previewUrl,
        ratio: image.ratio || '4 / 5',
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

// ── Create item from remote URL ─────────────────────────────

export async function createItemFromRemoteUrl(req: AuthRequest, res: Response, status: ProductWallStatus) {
  let filePath = '';
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      res.status(400).json({ detail: '请提供图片地址' });
      return;
    }
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      res.status(400).json({ detail: '仅支持 http/https 图片地址' });
      return;
    }
    await assertAllowedRemoteImageUrl(parsedUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(parsedUrl, { signal: controller.signal, redirect: 'error' });
      if (!resp.ok || !resp.body) {
        res.status(400).json({ detail: `下载图片失败: HTTP ${resp.status}` });
        return;
      }
      const ext = imageExtFromMimeType(resp.headers.get('content-type') || '');
      if (!ext) {
        res.status(400).json({ detail: '远程文件不是支持的图片格式' });
        return;
      }
      const filename = `${randomUUID()}.${ext}`;
      filePath = join(PRODUCT_WALL_DIR, filename);
      const { maxBytes } = await getProductWallUploadPolicy();
      await pipeline(
        resp.body,
        createMaxBytesTransform(maxBytes || FALLBACK_MAX_IMAGE_BYTES),
        createWriteStream(filePath),
      );
      const imageUrl = `/static/product-wall/${filename}`;
      const previewUrl = (await generatePreviewImage(filePath, imageUrl)) || imageUrl;
      const title = safeTitle(req.body?.title || parsedUrl.pathname.split('/').pop(), '链接图片');
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
    if (err.name === 'AbortError') {
      res.status(400).json({ detail: '下载图片超时' });
      return;
    }
    if (err instanceof MaxBytesExceededError) {
      res.status(400).json({ detail: `图片不能超过 ${Math.round(err.maxBytes / 1024 / 1024)}MB` });
      return;
    }
    res.status(400).json({ detail: '下载图片失败，请确认地址可访问且不是内网地址' });
  }
}
