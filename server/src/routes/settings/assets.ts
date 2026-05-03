import { Router, Response } from "express";
import multer from "multer";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../lib/config.js";
import { setSetting } from "../../lib/settings.js";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { adminOnly } from "./common.js";

// Generic image upload directories
const imageDirs: Record<string, string> = {
  watermark_image: join(process.cwd(), config.staticDir, "watermark"),
  site_logo: join(process.cwd(), config.staticDir, "logo"),
  site_icon: join(process.cwd(), config.staticDir, "logo"),
  site_favicon: join(process.cwd(), config.staticDir, "favicon"),
};
for (const dir of Object.values(imageDirs)) {
  mkdirSync(dir, { recursive: true });
}

// Map setting key -> stable filename (without extension, ext comes from upload)
const imageNames: Record<string, string> = {
  watermark_image: "watermark",
  site_logo: "logo",
  site_icon: "icon",
  site_favicon: "favicon",
};

const imageUpload = multer({
  dest: "/tmp/settings-upload",
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("只支持 PNG、JPG、SVG、WEBP、ICO 格式"));
  },
});

export function createSettingsAssetsRouter() {
  const router = Router();

  // Admin: upload image (generic - watermark, logo, favicon)
  router.post("/api/settings/upload-image", authMiddleware, async (req: AuthRequest, res: Response, next) => {
    if (!adminOnly(req, res)) return;
    next();
  }, imageUpload.single("file"), async (req: AuthRequest, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ detail: "请选择图片文件" });
      return;
    }
    const key = req.query.key as string || req.body.key as string;
    const targetDir = imageDirs[key];
    const baseName = imageNames[key];
    if (!targetDir || !baseName) {
      rmSync(file.path, { force: true });
      res.status(400).json({ detail: `不支持的上传类型: ${key}` });
      return;
    }
    const ALLOWED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "svg", "webp", "ico"]);
    const rawExt = (file.originalname?.split(".").pop() || "").toLowerCase();
    const ext = ALLOWED_IMAGE_EXTENSIONS.has(rawExt) ? rawExt : "png";
    const finalName = `${baseName}.${ext}`;
    const finalPath = join(targetDir, finalName);
    // Use copy+rm instead of rename to avoid EXDEV cross-device error in Docker
    copyFileSync(file.path, finalPath);
    rmSync(file.path, { force: true });

    // Build URL path: /static/<subdir>/<filename>
    const dirKey = Object.keys(imageDirs).find(k => imageDirs[k] === targetDir)!;
    const urlSegment = dirKey === "watermark_image" ? "watermark" : (dirKey === "site_logo" || dirKey === "site_icon") ? "logo" : "favicon";
    const imageUrl = `/static/${urlSegment}/${finalName}`;
    await setSetting(key, imageUrl);
    res.json({ url: imageUrl });
  });

  return router;
}
