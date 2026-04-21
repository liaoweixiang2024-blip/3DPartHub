import { Router, Response } from "express";
import multer from "multer";
import { mkdirSync, existsSync, rmSync, copyFileSync } from "fs";
import { join } from "path";
import { config } from "../lib/config.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { verifyToken } from "../lib/jwt.js";
import { getAllSettings, setSettings, setSetting } from "../lib/settings.js";
import { cacheGet, cacheSet, cacheDel, TTL } from "../lib/cache.js";
import { startBackupJob, getJob, getRestoreJob, startRestoreJob, startRestoreJobFromFile, saveAsBackupRecord, getBackupStats, listBackups, renameBackup, deleteBackup, getBackupArchivePath } from "../lib/backup.js";
import { checkUpdateAvailable, startUpdateJob, getUpdateJob } from "../lib/update.js";

const router = Router();

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

// Map setting key → stable filename (without extension, ext comes from upload)
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

const backupUpload = multer({
  dest: "/tmp",
  limits: { fileSize: 50 * 1024 * 1024 * 1024 }, // 50GB max for backup
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith(".tar.gz") || file.originalname.endsWith(".tgz") || file.mimetype === "application/gzip" || file.mimetype === "application/x-gzip") {
      cb(null, true);
    } else {
      cb(new Error("只支持 .tar.gz 格式的备份文件"));
    }
  },
});
// Admin: check for updates
router.get("/api/settings/update/check", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "ADMIN") { res.status(403).json({ detail: "需要管理员权限" }); return; }
  try {
    const result = checkUpdateAvailable();
    res.json(result);
  } catch {
    res.json({ current: "unknown", remote: "unknown", updateAvailable: false });
  }
});

// Admin: start update
router.post("/api/settings/update/run", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "ADMIN") { res.status(403).json({ detail: "需要管理员权限" }); return; }
  try {
    const jobId = startUpdateJob();
    res.json({ jobId });
  } catch (err: any) {
    res.status(500).json({ detail: `启动更新失败: ${err.message}` });
  }
});

// Admin: poll update progress
router.get("/api/settings/update/progress/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "ADMIN") { res.status(403).json({ detail: "需要管理员权限" }); return; }
  const job = getUpdateJob(req.params.id);
  if (!job) { res.status(404).json({ detail: "更新任务不存在" }); return; }
  res.json({ stage: job.stage, percent: job.percent, message: job.message, error: job.error, logs: job.logs });
});

function adminOnly(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return false;
  }
  return true;
}

// Admin: get backup stats
router.get("/api/settings/backup/stats", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  try {
    const stats = await getBackupStats();
    res.json(stats);
  } catch {
    res.status(500).json({ detail: "获取备份信息失败" });
  }
});

// Admin: list all saved backups
router.get("/api/settings/backup/list", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  res.json(listBackups());
});

// Admin: start backup creation
router.post("/api/settings/backup/create", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const jobId = startBackupJob();
  res.json({ jobId });
});

// Admin: poll backup progress
router.get("/api/settings/backup/progress/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ detail: "备份任务不存在" });
    return;
  }
  res.json({ stage: job.stage, percent: job.percent, message: job.message, error: job.error, logs: job.logs });
});

// Admin: poll restore progress
router.get("/api/settings/restore/progress/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const job = getRestoreJob(req.params.id);
  if (!job) {
    res.status(404).json({ detail: "恢复任务不存在" });
    return;
  }
  res.json({ stage: job.stage, percent: job.percent, message: job.message, error: job.error, logs: job.logs, result: job.result });
});

// Admin: download a backup file (supports ?token= for browser direct download)
router.get("/api/settings/backup/download/:id", async (req: AuthRequest, res: Response) => {
  const token = req.headers.authorization?.slice(7) || req.query.token;
  if (!token) { res.status(401).json({ detail: "未提供认证令牌" }); return; }
  try {
    req.user = verifyToken(token) as AuthRequest["user"];
  } catch {
    res.status(401).json({ detail: "令牌无效或已过期" });
    return;
  }
  if (req.user?.role !== "ADMIN") { res.status(403).json({ detail: "需要管理员权限" }); return; }
  const filePath = getBackupArchivePath(req.params.id);
  if (!filePath) {
    res.status(404).json({ detail: "备份文件不存在" });
    return;
  }
  res.download(filePath);
});

// Admin: rename a backup
router.put("/api/settings/backup/rename/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const { name } = req.body;
  if (!name) { res.status(400).json({ detail: "名称不能为空" }); return; }
  const record = renameBackup(req.params.id, name);
  if (!record) { res.status(404).json({ detail: "备份不存在" }); return; }
  res.json(record);
});

// Admin: delete a backup
router.delete("/api/settings/backup/delete/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const ok = deleteBackup(req.params.id);
  res.json({ success: ok });
});

// Admin: start restore job from a saved backup
router.post("/api/settings/backup/restore/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  try {
    const jobId = startRestoreJob(req.params.id);
    res.json({ jobId });
  } catch (err: any) {
    res.status(500).json({ detail: `启动恢复失败: ${err.message}` });
  }
});

// Admin: poll restore progress
router.get("/api/settings/backup/restore-progress/:jobId", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const job = getRestoreJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ detail: "恢复任务不存在，服务器可能已重启" });
    return;
  }
  res.json({ stage: job.stage, percent: job.percent, message: job.message, error: job.error, result: job.result });
});

// Admin: import backup from uploaded file (async)
router.post("/api/settings/backup/import", authMiddleware, (req: AuthRequest, res: Response, next) => {
  if (!adminOnly(req, res)) return;
  next();
}, backupUpload.single("file"), async (req: AuthRequest, res: Response) => {
  const file = req.file;
  if (!file) { res.status(400).json({ detail: "请选择备份文件" }); return; }
  // Start async restore job from the uploaded file
  const jobId = startRestoreJobFromFile(file.path);
  res.json({ jobId });
});

// Admin: import backup from chunked upload (called after chunks are merged)
router.post("/api/settings/backup/import-chunked", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const { filePath } = req.body;
  if (!filePath || !existsSync(filePath)) {
    res.status(400).json({ detail: "文件路径无效" });
    return;
  }
  const jobId = startRestoreJobFromFile(filePath);
  res.json({ jobId });
});

// Admin: save uploaded file as backup record (no restore)
router.post("/api/settings/backup/import-save", authMiddleware, (req: AuthRequest, res: Response, next) => {
  if (!adminOnly(req, res)) return;
  next();
}, backupUpload.single("file"), async (req: AuthRequest, res: Response) => {
  const file = req.file;
  if (!file) { res.status(400).json({ detail: "请选择备份文件" }); return; }
  try {
    const record = saveAsBackupRecord(file.path, file.originalname);
    res.json(record);
  } catch (err: any) {
    if (existsSync(file.path)) rmSync(file.path, { force: true });
    res.status(500).json({ detail: `保存备份失败: ${err.message}` });
  }
});

// Admin: save chunked upload as backup record (no restore)
router.post("/api/settings/backup/import-save-chunked", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const { filePath, fileName } = req.body;
  if (!filePath || !existsSync(filePath)) {
    res.status(400).json({ detail: "文件路径无效" });
    return;
  }
  try {
    const record = saveAsBackupRecord(filePath, fileName || "备份文件");
    res.json(record);
  } catch (err: any) {
    res.status(500).json({ detail: `保存备份失败: ${err.message}` });
  }
});

// Admin: get all settings
router.get("/api/settings", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return;
  }
  try {
    const settings = await getAllSettings();
    res.json(settings);
  } catch {
    res.status(500).json({ detail: "获取设置失败" });
  }
});

// Admin: update settings
router.put("/api/settings", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return;
  }
  try {
    await setSettings(req.body);
    const settings = await getAllSettings();
    res.json(settings);
  } catch {
    res.status(500).json({ detail: "更新设置失败" });
  }
});

// Admin: upload image (generic — watermark, logo, favicon)
router.post("/api/settings/upload-image", authMiddleware, async (req: AuthRequest, res: Response, next) => {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return;
  }
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
  const ext = file.originalname?.split(".").pop() || "png";
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

// Public: get current version (no auth required)
router.get("/api/settings/version", async (_req, res: Response) => {
  try {
    const result = checkUpdateAvailable();
    res.json({ current: result.current });
  } catch {
    res.json({ current: "unknown" });
  }
});

// Public: get non-sensitive settings
router.get("/api/settings/public", async (_req, res: Response) => {
  // Prevent browser/CDN caching of config — always revalidate
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  try {
    const cached = await cacheGet<Record<string, unknown>>("cache:settings:public");
    if (cached) { res.json(cached); return; }
    const all = await getAllSettings();
    const result = {
      allow_register: all.allow_register ?? true,
      require_login_download: all.require_login_download ?? false,
      require_login_browse: all.require_login_browse ?? false,
      allow_comments: all.allow_comments ?? true,
      show_watermark: all.show_watermark ?? false,
      watermark_text: all.watermark_text ?? "3DPartHub",
      watermark_image: all.watermark_image ?? "",
      site_title: all.site_title ?? "3DPartHub",
      site_browser_title: all.site_browser_title ?? "",
      site_logo: all.site_logo ?? "/static/logo/logo.svg",
      site_icon: all.site_icon ?? "/static/logo/icon.svg",
      site_favicon: all.site_favicon ?? "/favicon.svg",
      site_logo_display: all.site_logo_display ?? "logo_and_title",
      site_description: all.site_description ?? "",
      site_keywords: all.site_keywords ?? "",
      contact_email: all.contact_email ?? "",
      footer_links: all.footer_links ?? "",
      footer_copyright: all.footer_copyright ?? "",
      announcement_enabled: all.announcement_enabled ?? false,
      announcement_text: all.announcement_text ?? "",
      announcement_type: all.announcement_type ?? "info",
      announcement_color: all.announcement_color ?? "",
      color_scheme: all.color_scheme ?? "orange",
      color_custom_dark: all.color_custom_dark ?? "{}",
      color_custom_light: all.color_custom_light ?? "{}",
      default_theme: all.default_theme ?? "dark",
      auto_theme_enabled: all.auto_theme_enabled ?? false,
      auto_theme_dark_hour: all.auto_theme_dark_hour ?? 20,
      auto_theme_light_hour: all.auto_theme_light_hour ?? 8,
    };
    await cacheSet("cache:settings:public", result, TTL.SETTINGS_PUBLIC);
    res.json(result);
  } catch {
    res.json({
      allow_register: true,
      require_login_download: false,
      require_login_browse: false,
      allow_comments: true,
      show_watermark: false,
      watermark_image: "",
    });
  }
});

export default router;
