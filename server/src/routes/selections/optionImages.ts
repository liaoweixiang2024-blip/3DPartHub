import { Router, Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, createWriteStream, renameSync, rmSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import multer from "multer";
import { DEFAULT_UPLOAD_POLICY, getBusinessConfig, type UploadPolicy } from "../../lib/businessConfig.js";
import { config } from "../../lib/config.js";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { adminOnly } from "./common.js";

const OPTION_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
const PRODUCT_ASSET_EXTENSIONS: Record<string, string> = {
  ...OPTION_IMAGE_EXTENSIONS,
  "application/pdf": "pdf",
};
const PRODUCT_PDF_MAX_BYTES = 20 * 1024 * 1024;

class MaxBytesExceededError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Remote image exceeds ${maxBytes} bytes`);
    this.name = "MaxBytesExceededError";
  }
}

function normalizeMimeType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() || "";
}

function imageExtFromMimeType(mimeType: string): string | null {
  return OPTION_IMAGE_EXTENSIONS[normalizeMimeType(mimeType)] || null;
}

function productAssetExtFromMimeType(mimeType: string): string | null {
  return PRODUCT_ASSET_EXTENSIONS[normalizeMimeType(mimeType)] || null;
}

function optionImageMaxBytes(uploadPolicy: UploadPolicy): number {
  const configuredMb = Number(uploadPolicy.optionImageMaxSizeMb);
  const fallbackMb = DEFAULT_UPLOAD_POLICY.optionImageMaxSizeMb;
  const maxMb = Number.isFinite(configuredMb) ? configuredMb : fallbackMb;
  return Math.max(1, maxMb) * 1024 * 1024;
}

function optionImageMimeAllowed(mimeType: string, pattern: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized) return false;
  const source = pattern?.trim() || DEFAULT_UPLOAD_POLICY.optionImageMimePattern;
  if (source.length > 200) return false;
  const quantifierNesting = (source.match(/\+/g) || []).length + (source.match(/\*/g) || []).length;
  if (quantifierNesting > 10) return false;
  try {
    return new RegExp(source, "i").test(normalized);
  } catch {
    return new RegExp(DEFAULT_UPLOAD_POLICY.optionImageMimePattern, "i").test(normalized);
  }
}

function cleanupUploadedFile(file: Express.Multer.File | undefined) {
  if (file?.path) rmSync(file.path, { force: true });
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!adminOnly(req, res)) return;
  next();
}

function isBlockedRemoteAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map((part) => Number(part));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }

  if (version === 6) {
    const lower = address.toLowerCase().split("%")[0] || "";
    if (lower.startsWith("::ffff:")) {
      return isBlockedRemoteAddress(lower.slice("::ffff:".length));
    }
    const firstHextet = Number.parseInt(lower.split(":")[0] || "0", 16);
    return (
      lower === "::" ||
      lower === "::1" ||
      (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) ||
      (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
      (firstHextet >= 0xff00 && firstHextet <= 0xffff)
    );
  }

  return false;
}

async function assertAllowedRemoteImageUrl(parsedUrl: URL) {
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("REMOTE_IMAGE_HOST_BLOCKED");
  }

  if (isBlockedRemoteAddress(hostname)) {
    throw new Error("REMOTE_IMAGE_HOST_BLOCKED");
  }

  const addresses = await lookup(hostname, { all: true, verbatim: false });
  if (!addresses.length || addresses.some(({ address }) => isBlockedRemoteAddress(address))) {
    throw new Error("REMOTE_IMAGE_HOST_BLOCKED");
  }
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

// Option image upload config
const optImgDir = join(process.cwd(), "static", "option-images");
if (!existsSync(optImgDir)) mkdirSync(optImgDir, { recursive: true });
const productAssetDir = join(process.cwd(), config.staticDir, "selection-assets");
if (!existsSync(productAssetDir)) mkdirSync(productAssetDir, { recursive: true });

function optionImageUpload(req: AuthRequest, res: Response, next: NextFunction) {
  getBusinessConfig()
    .then(({ uploadPolicy }) => {
      const upload = multer({
        dest: optImgDir,
        limits: { fileSize: optionImageMaxBytes(uploadPolicy) },
      }).single("file");

      upload(req, res, (err) => {
        if (!err) {
          next();
          return;
        }
        const uploadError = err as { code?: string; message?: string };
        if (uploadError.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ detail: `图片不能超过 ${Math.round(optionImageMaxBytes(uploadPolicy) / 1024 / 1024)}MB` });
          return;
        }
        res.status(400).json({ detail: uploadError.message || "上传图片失败" });
      });
    })
    .catch(next);
}

function productAssetUpload(req: AuthRequest, res: Response, next: NextFunction) {
  getBusinessConfig()
    .then(({ uploadPolicy }) => {
      const maxBytes = Math.max(optionImageMaxBytes(uploadPolicy), PRODUCT_PDF_MAX_BYTES);
      const upload = multer({
        dest: productAssetDir,
        limits: { fileSize: maxBytes },
      }).single("file");

      upload(req, res, (err) => {
        if (!err) {
          next();
          return;
        }
        const uploadError = err as { code?: string; message?: string };
        if (uploadError.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ detail: `文件不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB` });
          return;
        }
        res.status(400).json({ detail: uploadError.message || "上传文件失败" });
      });
    })
    .catch(next);
}

export function createSelectionOptionImagesRouter() {
  const router = Router();

  // Upload option image
  router.post("/api/admin/selections/option-image", authMiddleware, requireAdmin, optionImageUpload, async (req: AuthRequest, res: Response) => {
    const file = req.file;
    try {
      if (!file) {
        res.status(400).json({ detail: "请选择图片文件" });
        return;
      }
      const { uploadPolicy } = await getBusinessConfig();
      const maxBytes = optionImageMaxBytes(uploadPolicy);
      const contentType = normalizeMimeType(file.mimetype);
      const ext = imageExtFromMimeType(contentType);
      if (!ext || !optionImageMimeAllowed(contentType, uploadPolicy.optionImageMimePattern)) {
        cleanupUploadedFile(file);
        res.status(400).json({ detail: "上传文件不是支持的图片格式" });
        return;
      }
      if (file.size > maxBytes) {
        cleanupUploadedFile(file);
        res.status(400).json({ detail: `图片不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB` });
        return;
      }
      const filename = `${randomUUID()}.${ext}`;
      renameSync(file.path, join(optImgDir, filename));
      const url = `/static/option-images/${filename}`;
      res.json({ url });
    } catch (err) {
      cleanupUploadedFile(file);
      console.error("[Selections] Upload option image error:", err);
      res.status(500).json({ detail: "上传失败" });
    }
  });

  // Upload product image or PDF spec sheet
  router.post("/api/admin/selections/product-asset", authMiddleware, requireAdmin, productAssetUpload, async (req: AuthRequest, res: Response) => {
    const file = req.file;
    try {
      if (!file) {
        res.status(400).json({ detail: "请选择要上传的图片或 PDF" });
        return;
      }

      const { uploadPolicy } = await getBusinessConfig();
      const contentType = normalizeMimeType(file.mimetype);
      const ext = productAssetExtFromMimeType(contentType);
      const isImage = Boolean(imageExtFromMimeType(contentType));
      const maxBytes = isImage ? optionImageMaxBytes(uploadPolicy) : PRODUCT_PDF_MAX_BYTES;

      if (!ext || (!isImage && contentType !== "application/pdf")) {
        cleanupUploadedFile(file);
        res.status(400).json({ detail: "仅支持图片或 PDF 文件" });
        return;
      }
      if (isImage && !optionImageMimeAllowed(contentType, uploadPolicy.optionImageMimePattern)) {
        cleanupUploadedFile(file);
        res.status(400).json({ detail: "上传文件不是支持的图片格式" });
        return;
      }
      if (file.size > maxBytes) {
        cleanupUploadedFile(file);
        res.status(400).json({ detail: `文件不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB` });
        return;
      }

      const filename = `${randomUUID()}.${ext}`;
      renameSync(file.path, join(productAssetDir, filename));
      res.json({
        url: `/static/selection-assets/${filename}`,
        type: isImage ? "image" : "pdf",
      });
    } catch (err) {
      cleanupUploadedFile(file);
      console.error("[Selections] Upload product asset error:", err);
      res.status(500).json({ detail: "上传失败" });
    }
  });

  // Download remote image as option image
  router.post("/api/admin/selections/option-image-from-url", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string") {
        res.status(400).json({ detail: "请提供图片地址" });
        return;
      }

      // Basic URL validation
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        res.status(400).json({ detail: "图片地址格式无效" });
        return;
      }
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        res.status(400).json({ detail: "仅支持 http/https 协议" });
        return;
      }

      try {
        await assertAllowedRemoteImageUrl(parsedUrl);
      } catch {
        res.status(400).json({ detail: "不允许从本机、内网或保留地址下载图片" });
        return;
      }

      const { uploadPolicy } = await getBusinessConfig();
      const maxBytes = optionImageMaxBytes(uploadPolicy);

      // Fetch remote image
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let filePath: string | null = null;
      let saved = false;
      try {
        const resp = await fetch(parsedUrl, { signal: controller.signal, redirect: "error" });

        if (!resp.ok) {
          res.status(400).json({ detail: `下载图片失败: HTTP ${resp.status}` });
          return;
        }

        const contentType = normalizeMimeType(resp.headers.get("content-type") || "");
        const ext = imageExtFromMimeType(contentType);
        if (!ext || !optionImageMimeAllowed(contentType, uploadPolicy.optionImageMimePattern)) {
          res.status(400).json({ detail: "远程文件不是支持的图片格式" });
          return;
        }

        const contentLength = Number(resp.headers.get("content-length") || 0);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          res.status(400).json({ detail: `图片不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB` });
          return;
        }

        const filename = `${randomUUID()}.${ext}`;
        filePath = join(optImgDir, filename);

        if (!resp.body) throw new Error("EMPTY_REMOTE_IMAGE_BODY");
        await pipeline(resp.body, createMaxBytesTransform(maxBytes), createWriteStream(filePath));
        saved = true;

        const resultUrl = `/static/option-images/${filename}`;
        res.json({ url: resultUrl });
      } finally {
        clearTimeout(timeout);
        if (filePath && !saved) {
          rmSync(filePath, { force: true });
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        res.status(400).json({ detail: "下载图片超时" });
        return;
      }
      if (err instanceof MaxBytesExceededError) {
        res.status(400).json({ detail: `图片不能超过 ${Math.round(err.maxBytes / 1024 / 1024)}MB` });
        return;
      }
      if (err instanceof TypeError) {
        res.status(400).json({ detail: "下载图片失败，请确认地址可访问且没有跳转" });
        return;
      }
      console.error("[Selections] Download option image from URL error:", err);
      res.status(500).json({ detail: "下载图片失败" });
    }
  });

  return router;
}
