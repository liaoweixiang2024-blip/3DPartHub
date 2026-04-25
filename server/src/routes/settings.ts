import { Router, Response } from "express";
import multer from "multer";
import { mkdirSync, existsSync, rmSync, copyFileSync, readFileSync, readdirSync, writeFileSync, statSync } from "fs";
import { join, resolve, sep } from "path";
import { config } from "../lib/config.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { verifyToken } from "../lib/jwt.js";
import { getAllSettings, setSettings, setSetting } from "../lib/settings.js";
import { cacheGet, cacheSet, cacheDel, TTL } from "../lib/cache.js";
import { startBackupJob, getJob, getRestoreJob, startRestoreJob, startRestoreJobFromFile, saveAsBackupRecord, startImportSaveJob, getImportSaveJob, getBackupStats, listBackups, renameBackup, deleteBackup, getBackupArchivePath } from "../lib/backup.js";
import { checkUpdateAvailable, getLocalVersion } from "../lib/update.js";

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

const managedUploadRoot = resolve(process.cwd(), config.uploadDir);
const managedBackupRoot = resolve(process.cwd(), config.staticDir, "backups");

function resolveManagedUploadPath(filePath: unknown): string | null {
  if (typeof filePath !== "string" || !filePath.trim()) return null;
  const resolved = resolve(filePath);
  if (resolved !== managedUploadRoot && !resolved.startsWith(`${managedUploadRoot}${sep}`)) {
    return null;
  }
  return existsSync(resolved) ? resolved : null;
}

function resolveBackupPath(filePath: unknown): string | null {
  if (typeof filePath !== "string" || !filePath.trim()) return null;
  const resolved = resolve(filePath);
  // Only allow files inside backup dir or uploads dir
  const allowed = [managedBackupRoot, managedUploadRoot];
  const ok = allowed.some(root => resolved === root || resolved.startsWith(`${root}${sep}`));
  if (!ok) return null;
  if (!existsSync(resolved)) return null;
  if (!resolved.endsWith(".tar.gz") && !resolved.endsWith(".tgz")) return null;
  return resolved;
}

function asSingleString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return undefined;
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
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max for direct upload — larger files must use chunked upload
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith(".tar.gz") || file.originalname.endsWith(".tgz") || file.mimetype === "application/gzip" || file.mimetype === "application/x-gzip") {
      cb(null, true);
    } else {
      cb(new Error("只支持 .tar.gz 格式的备份文件"));
    }
  },
});
// Admin: check for updates (version detection only, no auto-update)
router.get("/api/settings/update/check", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "ADMIN") { res.status(403).json({ detail: "需要管理员权限" }); return; }
  try {
    const result = await checkUpdateAvailable();
    res.json(result);
  } catch {
    res.json({ current: "unknown", remote: "unknown", updateAvailable: false });
  }
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
  try {
    const jobId = startBackupJob();
    res.json({ jobId });
  } catch (err: any) {
    const status = err.message?.includes("正在进行中") ? 409 : 500;
    res.status(status).json({ detail: err.message || "启动备份失败" });
  }
});

// Admin: poll backup progress
router.get("/api/settings/backup/progress/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const jobId = asSingleString(req.params.id);
  if (!jobId) { res.status(400).json({ detail: "备份任务参数无效" }); return; }
  const job = getJob(jobId);
  if (!job) {
    res.status(404).json({ detail: "备份任务不存在" });
    return;
  }
  res.json({ stage: job.stage, percent: job.percent, message: job.message, error: job.error, logs: job.logs });
});

// Short-lived one-time download tokens — file-based for cross-worker sharing in cluster mode
const DL_TOKEN_DIR = join(resolve(process.cwd(), config.uploadDir), ".download_tokens");
mkdirSync(DL_TOKEN_DIR, { recursive: true });

function writeDownloadToken(token: string, backupId: string) {
  writeFileSync(join(DL_TOKEN_DIR, token), JSON.stringify({ backupId, expires: Date.now() + 5 * 60 * 1000 }));
}
function consumeDownloadToken(token: string): string | null {
  const p = join(DL_TOKEN_DIR, token);
  try {
    const data = JSON.parse(readFileSync(p, "utf-8"));
    rmSync(p, { force: true }); // One-time use
    if (data.expires < Date.now()) return null;
    return data.backupId;
  } catch { return null; }
}
// Clean expired tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  try {
    for (const f of readdirSync(DL_TOKEN_DIR)) {
      try {
        const data = JSON.parse(readFileSync(join(DL_TOKEN_DIR, f), "utf-8"));
        if (data.expires < now) rmSync(join(DL_TOKEN_DIR, f), { force: true });
      } catch { rmSync(join(DL_TOKEN_DIR, f), { force: true }); }
    }
  } catch {}
}, 5 * 60 * 1000);

// Admin: generate a short-lived download token
router.post("/api/settings/backup/download-token/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const backupId = asSingleString(req.params.id);
  if (!backupId) { res.status(400).json({ detail: "备份参数无效" }); return; }
  const filePath = getBackupArchivePath(backupId);
  if (!filePath) { res.status(404).json({ detail: "备份文件不存在" }); return; }
  const token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  writeDownloadToken(token, backupId);
  res.json({ token });
});

// Download backup file using one-time token (no JWT in URL)
router.get("/api/settings/backup/download/:token", async (req: AuthRequest, res: Response) => {
  const token = asSingleString(req.params.token);
  if (!token) { res.status(400).json({ detail: "下载令牌无效" }); return; }
  const backupId = consumeDownloadToken(token);
  if (!backupId) {
    res.status(401).json({ detail: "下载令牌已过期或无效" });
    return;
  }
  const filePath = getBackupArchivePath(backupId);
  if (!filePath) { res.status(404).json({ detail: "备份文件不存在" }); return; }
  res.download(filePath);
});

// Admin: rename a backup
router.put("/api/settings/backup/rename/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const { name } = req.body;
  if (!name) { res.status(400).json({ detail: "名称不能为空" }); return; }
  const backupId = asSingleString(req.params.id);
  if (!backupId) { res.status(400).json({ detail: "备份参数无效" }); return; }
  const record = renameBackup(backupId, name);
  if (!record) { res.status(404).json({ detail: "备份不存在" }); return; }
  res.json(record);
});

// Admin: delete a backup
router.delete("/api/settings/backup/delete/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const backupId = asSingleString(req.params.id);
  if (!backupId) { res.status(400).json({ detail: "备份参数无效" }); return; }
  const ok = deleteBackup(backupId);
  res.json({ success: ok });
});

// Admin: start restore job from a saved backup
router.post("/api/settings/backup/restore/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  try {
    const backupId = asSingleString(req.params.id);
    if (!backupId) { res.status(400).json({ detail: "备份参数无效" }); return; }
    const jobId = startRestoreJob(backupId);
    res.json({ jobId });
  } catch (err: any) {
    const status = err.message?.includes("正在进行中") ? 409 : 500;
    res.status(status).json({ detail: err.message || "启动恢复失败" });
  }
});

// Admin: poll restore progress
router.get("/api/settings/backup/restore-progress/:jobId", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const jobId = asSingleString(req.params.jobId);
  if (!jobId) { res.status(400).json({ detail: "恢复任务参数无效" }); return; }
  const job = getRestoreJob(jobId);
  if (!job) {
    res.status(404).json({ detail: "恢复任务不存在，服务器可能已重启" });
    return;
  }
  res.json({ stage: job.stage, percent: job.percent, message: job.message, error: job.error, result: job.result, logs: job.logs });
});

// Admin: import backup from uploaded file (async)
router.post("/api/settings/backup/import", authMiddleware, (req: AuthRequest, res: Response, next) => {
  if (!adminOnly(req, res)) return;
  next();
}, backupUpload.single("file"), async (req: AuthRequest, res: Response) => {
  const file = req.file;
  if (!file) { res.status(400).json({ detail: "请选择备份文件" }); return; }
  try {
    const jobId = startRestoreJobFromFile(file.path);
    res.json({ jobId });
  } catch (err: any) {
    const status = err.message?.includes("正在进行中") ? 409 : 500;
    res.status(status).json({ detail: err.message || "启动恢复失败" });
  }
});

// Admin: poll import-save progress
router.get("/api/settings/backup/import-save-progress/:jobId", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const jobId = asSingleString(req.params.jobId);
  if (!jobId) { res.status(400).json({ detail: "任务参数无效" }); return; }
  const job = getImportSaveJob(jobId);
  if (!job) {
    res.status(404).json({ detail: "任务不存在" });
    return;
  }
  res.json({ stage: job.stage, percent: job.percent, message: job.message, error: job.error, result: job.result, logs: job.logs });
});

// Admin: import backup from chunked upload (called after chunks are merged)
router.post("/api/settings/backup/import-chunked", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const managedPath = resolveManagedUploadPath(req.body?.filePath);
  if (!managedPath) {
    res.status(400).json({ detail: "文件路径无效" });
    return;
  }
  try {
    const jobId = startRestoreJobFromFile(managedPath);
    res.json({ jobId });
  } catch (err: any) {
    const status = err.message?.includes("正在进行中") ? 409 : 500;
    res.status(status).json({ detail: err.message || "启动恢复失败" });
  }
});

// Admin: import backup from server-local path (no upload needed)
router.post("/api/settings/backup/import-path", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const filePath = req.body?.path;
  const resolved = resolveBackupPath(filePath);
  if (!resolved) {
    res.status(400).json({ detail: "路径无效，仅支持备份目录下的 .tar.gz 文件" });
    return;
  }
  try {
    const jobId = startRestoreJobFromFile(resolved);
    res.json({ jobId });
  } catch (err: any) {
    const status = err.message?.includes("正在进行中") ? 409 : 500;
    res.status(status).json({ detail: err.message || "启动恢复失败" });
  }
});

// Admin: list server-local backup files for import
router.get("/api/settings/backup/server-files", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  try {
    const files: { name: string; path: string; size: number; modifiedAt: string }[] = [];
    for (const dir of [managedBackupRoot, managedUploadRoot]) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".tar.gz") && !entry.name.endsWith(".tgz")) continue;
        const fullPath = join(dir, entry.name);
        const st = statSync(fullPath);
        files.push({ name: entry.name, path: fullPath, size: st.size, modifiedAt: st.mtime.toISOString() });
      }
    }
    files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
    res.json(files);
  } catch {
    res.json([]);
  }
});

// Admin: save uploaded file as backup record (no restore) — async job for large files
router.post("/api/settings/backup/import-save", authMiddleware, (req: AuthRequest, res: Response, next) => {
  if (!adminOnly(req, res)) return;
  next();
}, backupUpload.single("file"), async (req: AuthRequest, res: Response) => {
  const file = req.file;
  if (!file) { res.status(400).json({ detail: "请选择备份文件" }); return; }
  // Return async job — inspection of large archives can be slow
  const jobId = startImportSaveJob(file.path, file.originalname);
  res.json({ jobId });
});

// Admin: save chunked upload as backup record (no restore) — async job
router.post("/api/settings/backup/import-save-chunked", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  const managedPath = resolveManagedUploadPath(req.body?.filePath);
  const fileName = req.body?.fileName;
  if (!managedPath) {
    res.status(400).json({ detail: "文件路径无效" });
    return;
  }
  const jobId = startImportSaveJob(managedPath, fileName || "备份文件");
  res.json({ jobId });
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

// Public: get current version (no auth required, no network requests)
router.get("/api/settings/version", async (_req, res: Response) => {
  try {
    const current = getLocalVersion();
    res.json({ current });
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
      contact_phone: all.contact_phone ?? "",
      contact_address: all.contact_address ?? "",
      footer_links: all.footer_links ?? "",
      footer_copyright: all.footer_copyright ?? "",
      announcement_enabled: all.announcement_enabled ?? false,
      announcement_text: all.announcement_text ?? "",
      announcement_type: all.announcement_type ?? "info",
      announcement_color: all.announcement_color ?? "",
      color_scheme: all.color_scheme ?? "orange",
      color_custom_dark: all.color_custom_dark ?? "{}",
      color_custom_light: all.color_custom_light ?? "{}",
      default_theme: all.default_theme ?? "light",
      auto_theme_enabled: all.auto_theme_enabled ?? false,
      auto_theme_dark_hour: all.auto_theme_dark_hour ?? 20,
      auto_theme_light_hour: all.auto_theme_light_hour ?? 8,
      // 3D Material — default
      mat_default_color: all.mat_default_color ?? "#c8cad0",
      mat_default_metalness: all.mat_default_metalness ?? 0.5,
      mat_default_roughness: all.mat_default_roughness ?? 0.25,
      mat_default_envMapIntensity: all.mat_default_envMapIntensity ?? 1.5,
      // 3D Material — metal
      mat_metal_color: all.mat_metal_color ?? "#f0f0f4",
      mat_metal_metalness: all.mat_metal_metalness ?? 1.0,
      mat_metal_roughness: all.mat_metal_roughness ?? 0.05,
      mat_metal_envMapIntensity: all.mat_metal_envMapIntensity ?? 2.0,
      // 3D Material — plastic
      mat_plastic_color: all.mat_plastic_color ?? "#4499ff",
      mat_plastic_metalness: all.mat_plastic_metalness ?? 0.0,
      mat_plastic_roughness: all.mat_plastic_roughness ?? 0.35,
      mat_plastic_envMapIntensity: all.mat_plastic_envMapIntensity ?? 0.6,
      // 3D Material — glass
      mat_glass_color: all.mat_glass_color ?? "#ffffff",
      mat_glass_metalness: all.mat_glass_metalness ?? 0.0,
      mat_glass_roughness: all.mat_glass_roughness ?? 0.0,
      mat_glass_envMapIntensity: all.mat_glass_envMapIntensity ?? 1.0,
      mat_glass_transmission: all.mat_glass_transmission ?? 0.95,
      mat_glass_ior: all.mat_glass_ior ?? 1.5,
      mat_glass_thickness: all.mat_glass_thickness ?? 0.5,
      // 3D Viewer lighting
      viewer_exposure: all.viewer_exposure ?? 1.2,
      viewer_ambient_intensity: all.viewer_ambient_intensity ?? 0.6,
      viewer_main_light_intensity: all.viewer_main_light_intensity ?? 1.4,
      viewer_fill_light_intensity: all.viewer_fill_light_intensity ?? 0.6,
      viewer_hemisphere_intensity: all.viewer_hemisphere_intensity ?? 0.3,
      viewer_bg_color: all.viewer_bg_color ?? "linear-gradient(180deg, #2a2a3e 0%, #1e2a42 50%, #162040 100%)",
      // Share policy
      share_default_expire_days: all.share_default_expire_days ?? 0,
      share_max_expire_days: all.share_max_expire_days ?? 0,
      share_default_download_limit: all.share_default_download_limit ?? 0,
      share_max_download_limit: all.share_max_download_limit ?? 0,
      share_allow_password: all.share_allow_password ?? true,
      share_allow_custom_expiry: all.share_allow_custom_expiry ?? true,
      share_allow_preview: all.share_allow_preview ?? true,
      // Selection wizard
      selection_page_title: all.selection_page_title ?? "产品选型",
      selection_page_desc: all.selection_page_desc ?? "选择产品大类，逐步筛选出精确型号",
      selection_enable_match: all.selection_enable_match ?? true,
      field_aliases: all.field_aliases ?? "{}",
      quote_template: all.quote_template ?? "",
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
