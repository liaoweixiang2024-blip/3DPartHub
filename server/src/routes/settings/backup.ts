import { Router, Response } from "express";
import multer from "multer";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  deleteBackup,
  getActiveImportSaveJob,
  getActiveBackupJob,
  getActiveRestoreJob,
  getActiveVerifyJob,
  getBackupArchivePath,
  getBackupHealth,
  getBackupPolicyCheck,
  getBackupStats,
  getImportSaveJob,
  getJob,
  getRestoreJob,
  getVerifyJob,
  listBackups,
  renameBackup,
  startBackupJob,
  startImportSaveJob,
  startRestoreJob,
  startRestoreJobFromFile,
  startVerifyBackupJob,
} from "../../lib/backup.js";
import { config } from "../../lib/config.js";
import { createProtectedResourceToken, consumeProtectedResourceToken } from "../../lib/downloadTokenStore.js";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { adminOnly, asSingleString } from "./common.js";

const managedUploadRoot = resolve(process.cwd(), config.uploadDir);
const managedBackupRoot = resolve(process.cwd(), config.staticDir, "backups");

function getActiveBackupOperation(): { id: string; label: string } | null {
  const backupJob = getActiveBackupJob();
  if (backupJob) return { id: backupJob.id, label: "备份创建" };
  const restoreJob = getActiveRestoreJob();
  if (restoreJob) return { id: restoreJob.id, label: "备份恢复" };
  const verifyJob = getActiveVerifyJob();
  if (verifyJob) return { id: verifyJob.id, label: "备份校验" };
  const importSaveJob = getActiveImportSaveJob();
  if (importSaveJob) return { id: importSaveJob.id, label: "备份导入保存" };
  return null;
}

function blockBackupMutationIfBusy(res: Response): boolean {
  const active = getActiveBackupOperation();
  if (!active) return false;
  res.status(409).json({
    detail: `${active.label}任务正在进行中，请等待完成后再操作备份文件`,
    jobId: active.id,
  });
  return true;
}

function cleanupTempBackupUpload(path: string | undefined) {
  if (!path) return;
  try { rmSync(path, { force: true }); } catch {}
}

const backupUpload = multer({
  dest: "/tmp",
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max for direct upload - larger files must use chunked upload
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith(".tar.gz") || file.originalname.endsWith(".tgz") || file.mimetype === "application/gzip" || file.mimetype === "application/x-gzip") {
      cb(null, true);
    } else {
      cb(new Error("只支持 .tar.gz 格式的备份文件"));
    }
  },
});

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

export function createSettingsBackupRouter() {
  const router = Router();

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

  // Admin: backup policy health and scheduler status
  router.get("/api/settings/backup/health", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const health = await getBackupHealth();
      res.json(health);
    } catch {
      res.status(500).json({ detail: "获取备份健康状态失败" });
    }
  });

  // Admin: run backup policy preflight checks
  router.post("/api/settings/backup/check", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const result = await getBackupPolicyCheck();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ detail: err.message || "备份策略体检失败" });
    }
  });

  // Admin: verify one backup archive without restoring it
  router.post("/api/settings/backup/verify/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const backupId = asSingleString(req.params.id);
    if (!backupId) { res.status(400).json({ detail: "备份参数无效" }); return; }
    try {
      const jobId = startVerifyBackupJob(backupId);
      res.json({ jobId });
    } catch (err: any) {
      const status = err.message?.includes("正在进行中") ? 409 : 400;
      res.status(status).json({
        detail: err.message || "备份校验失败",
        jobId: err.jobId,
      });
    }
  });

  router.get("/api/settings/backup/verify-progress/:jobId", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const jobId = asSingleString(req.params.jobId);
    if (!jobId) { res.status(400).json({ detail: "校验任务参数无效" }); return; }
    const job = getVerifyJob(jobId);
    if (!job) {
      res.status(404).json({ detail: "校验任务不存在，服务器可能已重启" });
      return;
    }
    res.json({ id: job.id, backupId: job.backupId, stage: job.stage, percent: job.percent, message: job.message, error: job.error, result: job.result, logs: job.logs });
  });

  // Admin: list all saved backups
  router.get("/api/settings/backup/list", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    res.json(listBackups());
  });

  // Admin: get the currently running backup job, used to recover progress after refresh
  router.get("/api/settings/backup/active", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const job = getActiveBackupJob();
    if (!job) {
      res.json(null);
      return;
    }
    res.json({ id: job.id, stage: job.stage, percent: job.percent, message: job.message, error: job.error, logs: job.logs });
  });

  // Admin: get active restore/import tasks, used to recover progress after refresh
  router.get("/api/settings/backup/restore-active", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const job = getActiveRestoreJob();
    if (!job) {
      res.json(null);
      return;
    }
    res.json({ id: job.id, stage: job.stage, percent: job.percent, message: job.message, error: job.error, result: job.result, logs: job.logs });
  });

  router.get("/api/settings/backup/import-save-active", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const job = getActiveImportSaveJob();
    if (!job) {
      res.json(null);
      return;
    }
    res.json({ id: job.id, stage: job.stage, percent: job.percent, message: job.message, error: job.error, result: job.result, logs: job.logs });
  });

  router.get("/api/settings/backup/verify-active", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const job = getActiveVerifyJob();
    if (!job) {
      res.json(null);
      return;
    }
    res.json({ id: job.id, backupId: job.backupId, stage: job.stage, percent: job.percent, message: job.message, error: job.error, result: job.result, logs: job.logs });
  });

  // Admin: start backup creation
  router.post("/api/settings/backup/create", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const jobId = startBackupJob();
      res.json({ jobId });
    } catch (err: any) {
      const status = err.message?.includes("正在进行中") ? 409 : 500;
      res.status(status).json({
        detail: err.message || "启动备份失败",
        jobId: err.jobId || getActiveBackupJob()?.id,
      });
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

  // Admin: generate a short-lived download token
  router.post("/api/settings/backup/download-token/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const backupId = asSingleString(req.params.id);
    if (!backupId) { res.status(400).json({ detail: "备份参数无效" }); return; }
    const filePath = getBackupArchivePath(backupId);
    if (!filePath) { res.status(404).json({ detail: "备份文件不存在" }); return; }
    const created = createProtectedResourceToken({
      type: "backup-download",
      resourceId: backupId,
      userId: req.user!.userId,
      role: req.user!.role,
      singleUse: true,
    });
    res.json({
      ...created,
      url: `/api/settings/backup/download/${encodeURIComponent(backupId)}/${encodeURIComponent(created.token)}`,
    });
  });

  // Download backup file using one-time token (no JWT in URL)
  router.get("/api/settings/backup/download/:id/:token", async (req: AuthRequest, res: Response) => {
    const backupId = asSingleString(req.params.id);
    const token = asSingleString(req.params.token);
    if (!backupId || !token) { res.status(400).json({ detail: "下载令牌无效" }); return; }
    const tokenPayload = consumeProtectedResourceToken(token, "backup-download", backupId);
    if (!tokenPayload) {
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
    if (blockBackupMutationIfBusy(res)) return;
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
    if (blockBackupMutationIfBusy(res)) return;
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
      cleanupTempBackupUpload(file.path);
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
      cleanupTempBackupUpload(managedPath);
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
      const jobId = startRestoreJobFromFile(resolved, false); // Don't delete server-local files
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

  // Admin: save uploaded file as backup record (no restore) - async job for large files
  router.post("/api/settings/backup/import-save", authMiddleware, (req: AuthRequest, res: Response, next) => {
    if (!adminOnly(req, res)) return;
    next();
  }, backupUpload.single("file"), async (req: AuthRequest, res: Response) => {
    const file = req.file;
    if (!file) { res.status(400).json({ detail: "请选择备份文件" }); return; }
    try {
      // Return async job - inspection of large archives can be slow
      const jobId = startImportSaveJob(file.path, file.originalname);
      res.json({ jobId });
    } catch (err: any) {
      cleanupTempBackupUpload(file.path);
      const status = err.message?.includes("正在进行中") ? 409 : 500;
      res.status(status).json({ detail: err.message || "启动保存任务失败" });
    }
  });

  // Admin: save chunked upload as backup record (no restore) - async job
  router.post("/api/settings/backup/import-save-chunked", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const managedPath = resolveManagedUploadPath(req.body?.filePath);
    const fileName = req.body?.fileName;
    if (!managedPath) {
      res.status(400).json({ detail: "文件路径无效" });
      return;
    }
    try {
      const jobId = startImportSaveJob(managedPath, fileName || "备份文件");
      res.json({ jobId });
    } catch (err: any) {
      cleanupTempBackupUpload(managedPath);
      const status = err.message?.includes("正在进行中") ? 409 : 500;
      res.status(status).json({ detail: err.message || "启动保存任务失败" });
    }
  });

  return router;
}
