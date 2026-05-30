import { closeSync, existsSync, openSync, readSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import type { Prisma } from '@prisma/client';
import { Router, Response } from 'express';
import multer from 'multer';
import { sendAcceleratedFile } from '../../lib/acceleratedDownload.js';
import {
  deleteBackup,
  getActiveImportSaveJob,
  getActiveBackupJob,
  getActiveRestoreJob,
  getActiveVerifyJob,
  getBackupArchivePath,
  getBackupEncryptionStatus,
  getBackupHealth,
  getBackupPolicyCheck,
  getBackupStats,
  getImportSaveJob,
  getJob,
  getRestoreJob,
  getVerifyJob,
  listBackups,
  normalizeBackupScope,
  renameBackup,
  isEncryptedBackupArchiveFile,
  startBackupJob,
  startImportSaveJob,
  startRestoreJob,
  startRestoreJobFromFile,
  startVerifyBackupJob,
} from '../../lib/backup.js';
import { config } from '../../lib/config.js';
import { createProtectedResourceToken, consumeProtectedResourceToken } from '../../lib/downloadTokenStore.js';
import { getErrorMessage } from '../../lib/http.js';
import { createLogger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { requestSiteUrl } from '../../lib/requestSiteUrl.js';
import { BACKUP_DIRECT_UPLOAD_MAX_BYTES } from '../../lib/uploadLimits.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { createNotification } from '../notifications.js';
import { adminOnly, asSingleString } from './common.js';

const log = createLogger({ component: 'settings-backup' });

const managedUploadRoot = resolve(process.cwd(), config.uploadDir);
const managedBackupRoot = resolve(process.cwd(), config.staticDir, 'backups');

const SAFE_BACKUP_ID_RE = /^[a-zA-Z0-9_\-.:]+$/;
const IMPORT_RESTORE_CONFIRM_VALUE = 'RESTORE_IMPORT';
const BACKUP_POLICY_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function validateBackupId(id: string | null | undefined): string | null {
  if (!id || !SAFE_BACKUP_ID_RE.test(id) || id.includes('..')) return null;
  return id;
}

function readDangerousConfirm(req: AuthRequest): string {
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = asSingleString(body?.confirm);
  if (fromBody) return fromBody;
  return req.get('x-danger-confirm') || '';
}

function requireDangerousConfirm(req: AuthRequest, res: Response, expected: string, label: string): boolean {
  if (readDangerousConfirm(req) === expected) return true;
  res.status(400).json({ detail: `${label}需要二次确认，请刷新页面后重试` });
  return false;
}

function backupPolicyAlertRelatedId(result: Awaited<ReturnType<typeof getBackupPolicyCheck>>): string {
  const keys = [...result.report.blockers, ...result.report.warnings]
    .map((item) => item.key)
    .sort()
    .join(',');
  return `backup-policy:${result.report.riskLevel}:${keys || 'ok'}`;
}

async function notifyAdminsAboutBackupPolicy(
  result: Awaited<ReturnType<typeof getBackupPolicyCheck>>,
  siteUrl?: string,
) {
  if (result.report.riskLevel === 'low') return;
  const relatedId = backupPolicyAlertRelatedId(result);
  const since = new Date(Date.now() - BACKUP_POLICY_ALERT_COOLDOWN_MS);
  try {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    await Promise.all(
      admins.map(async (admin) => {
        const exists = await prisma.notification.findFirst({
          where: {
            userId: admin.id,
            type: 'backup',
            relatedId,
            createdAt: { gte: since },
          },
          select: { id: true },
        });
        if (exists) return null;
        return createNotification({
          userId: admin.id,
          title: result.report.riskLevel === 'high' ? '备份体检发现高风险' : '备份体检需要关注',
          message: result.report.summary,
          type: 'backup',
          audience: 'admin',
          relatedId,
          siteUrl,
          emailTemplateKey: 'backup_policy_alert',
          emailVars: {
            riskLevel: result.report.riskLevel === 'high' ? '高风险' : '中风险',
            summary: result.report.summary,
          },
        });
      }),
    );
  } catch (err) {
    log.warn({ err }, 'Failed to create backup policy alert notifications');
  }
}

async function recordBackupPolicyCheckAudit(
  req: AuthRequest,
  result: Awaited<ReturnType<typeof getBackupPolicyCheck>>,
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.userId || null,
        action: 'backup_policy_check',
        resource: 'backup',
        resourceId: null,
        details: {
          method: req.method,
          path: req.originalUrl || req.path,
          status: result.status,
          riskLevel: result.report.riskLevel,
          summary: result.report.summary,
          blockers: result.report.blockers,
          warnings: result.report.warnings,
          nextActions: result.report.nextActions,
          estimatedBackupSizeText: result.estimatedBackupSizeText,
          checkedAt: result.checkedAt,
        } as unknown as Prisma.InputJsonObject,
      },
    });
  } catch (err) {
    log.warn({ err }, 'Failed to write backup policy check audit log');
  }
}

function getActiveBackupOperation(): { id: string; label: string } | null {
  const backupJob = getActiveBackupJob();
  if (backupJob) return { id: backupJob.id, label: '备份创建' };
  const restoreJob = getActiveRestoreJob();
  if (restoreJob) return { id: restoreJob.id, label: '备份恢复' };
  const verifyJob = getActiveVerifyJob();
  if (verifyJob) return { id: verifyJob.id, label: '备份校验' };
  const importSaveJob = getActiveImportSaveJob();
  if (importSaveJob) return { id: importSaveJob.id, label: '备份导入保存' };
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
  try {
    rmSync(path, { force: true });
  } catch (err) {
    log.warn({ err, path }, 'Failed to clean up temporary backup upload');
  }
}

function hasGzipMagic(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(2);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return bytesRead === 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  } finally {
    closeSync(fd);
  }
}

function isBackupArchiveFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.tar.gz') || lower.endsWith('.tgz');
}

function validateBackupArchiveUpload(path: string, res: Response, options: { cleanup?: boolean } = {}): boolean {
  try {
    const st = statSync(path);
    if (st.size <= 0) {
      if (options.cleanup) cleanupTempBackupUpload(path);
      res.status(400).json({ detail: '备份文件为空，请重新选择有效的备份文件' });
      return false;
    }
    if (!hasGzipMagic(path) && !isEncryptedBackupArchiveFile(path)) {
      if (options.cleanup) cleanupTempBackupUpload(path);
      res.status(400).json({ detail: '备份文件内容无效，请上传有效的 .tar.gz / .tgz 文件' });
      return false;
    }
    return true;
  } catch {
    if (options.cleanup) cleanupTempBackupUpload(path);
    res.status(400).json({ detail: '备份文件无法读取，请重新上传' });
    return false;
  }
}

const backupUpload = multer({
  dest: '/tmp',
  limits: { fileSize: BACKUP_DIRECT_UPLOAD_MAX_BYTES }, // Larger backups use the chunked restore/import flow.
  fileFilter: (_req, file, cb) => {
    if (
      isBackupArchiveFilename(file.originalname) ||
      file.mimetype === 'application/gzip' ||
      file.mimetype === 'application/x-gzip'
    ) {
      cb(null, true);
    } else {
      cb(new Error('只支持 .tar.gz / .tgz 格式的备份文件'));
    }
  },
});

function resolveManagedUploadPath(filePath: unknown): string | null {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;
  const resolved = resolve(filePath);
  if (resolved !== managedUploadRoot && !resolved.startsWith(`${managedUploadRoot}${sep}`)) {
    return null;
  }
  return existsSync(resolved) ? resolved : null;
}

function resolveBackupPath(filePath: unknown): string | null {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;
  const resolved = resolve(filePath);
  // Only allow files inside backup dir or uploads dir
  const allowed = [managedBackupRoot, managedUploadRoot];
  const ok = allowed.some((root) => resolved === root || resolved.startsWith(`${root}${sep}`));
  if (!ok) return null;
  if (!existsSync(resolved)) return null;
  if (!isBackupArchiveFilename(resolved)) return null;
  return resolved;
}

export function createSettingsBackupRouter() {
  const router = Router();

  // Admin: get backup stats
  router.get('/api/settings/backup/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const stats = await getBackupStats();
      res.json(stats);
    } catch {
      res.status(500).json({ detail: '获取备份信息失败' });
    }
  });

  // Admin: backup encryption status. Secrets stay in server environment variables.
  router.get('/api/settings/backup/encryption', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    res.json(getBackupEncryptionStatus());
  });

  // Admin: backup policy health and scheduler status
  router.get('/api/settings/backup/health', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const health = await getBackupHealth();
      res.json(health);
    } catch {
      res.status(500).json({ detail: '获取备份健康状态失败' });
    }
  });

  // Admin: run backup policy preflight checks
  router.post('/api/settings/backup/check', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const result = await getBackupPolicyCheck();
      await recordBackupPolicyCheckAudit(req, result);
      await notifyAdminsAboutBackupPolicy(result, requestSiteUrl(req));
      res.json(result);
    } catch (err: unknown) {
      log.error({ err }, 'Policy check failed');
      res.status(500).json({ detail: '备份策略体检失败' });
    }
  });

  // Admin: verify one backup archive without restoring it
  router.post('/api/settings/backup/verify/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const backupId = validateBackupId(asSingleString(req.params.id));
    if (!backupId) {
      res.status(400).json({ detail: '备份参数无效' });
      return;
    }
    try {
      const jobId = startVerifyBackupJob(backupId, req.user!.userId);
      res.json({ jobId });
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      const isBusy = msg.includes('正在进行中') || msg.includes('locked');
      log.error({ err }, 'Verify failed');
      res.status(isBusy ? 409 : 400).json({
        detail: isBusy ? '任务正在进行中' : '备份校验失败',
        jobId: err instanceof Error && 'jobId' in err ? (err as Error & { jobId?: string }).jobId : undefined,
      });
    }
  });

  router.get('/api/settings/backup/verify-progress/:jobId', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const jobId = asSingleString(req.params.jobId);
    if (!jobId) {
      res.status(400).json({ detail: '校验任务参数无效' });
      return;
    }
    const job = getVerifyJob(jobId);
    if (!job) {
      res.status(404).json({ detail: '校验任务不存在，服务器可能已重启' });
      return;
    }
    res.json({
      id: job.id,
      backupId: job.backupId,
      stage: job.stage,
      percent: job.percent,
      message: job.message,
      error: job.error,
      result: job.result,
      logs: job.logs,
    });
  });

  // Admin: list all saved backups
  router.get('/api/settings/backup/list', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      res.json(listBackups());
    } catch (err) {
      log.error({ err }, 'Failed to list backups');
      res.status(500).json({ detail: '获取备份列表失败' });
    }
  });

  // Admin: get the currently running backup job, used to recover progress after refresh
  router.get('/api/settings/backup/active', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const job = getActiveBackupJob();
    if (!job) {
      res.json(null);
      return;
    }
    res.json({
      id: job.id,
      stage: job.stage,
      percent: job.percent,
      message: job.message,
      error: job.error,
      scope: job.scope,
      logs: job.logs,
    });
  });

  // Admin: get active restore/import tasks, used to recover progress after refresh
  router.get('/api/settings/backup/restore-active', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const job = getActiveRestoreJob();
    if (!job) {
      res.json(null);
      return;
    }
    res.json({
      id: job.id,
      stage: job.stage,
      percent: job.percent,
      message: job.message,
      error: job.error,
      result: job.result,
      logs: job.logs,
    });
  });

  router.get('/api/settings/backup/import-save-active', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const job = getActiveImportSaveJob();
    if (!job) {
      res.json(null);
      return;
    }
    res.json({
      id: job.id,
      stage: job.stage,
      percent: job.percent,
      message: job.message,
      error: job.error,
      result: job.result,
      logs: job.logs,
    });
  });

  router.get('/api/settings/backup/verify-active', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const job = getActiveVerifyJob();
    if (!job) {
      res.json(null);
      return;
    }
    res.json({
      id: job.id,
      backupId: job.backupId,
      stage: job.stage,
      percent: job.percent,
      message: job.message,
      error: job.error,
      result: job.result,
      logs: job.logs,
    });
  });

  // Admin: start backup creation
  router.post('/api/settings/backup/create', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const jobId = startBackupJob(normalizeBackupScope(req.body?.scope));
      res.json({ jobId });
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      const isBusy = msg.includes('正在进行中') || msg.includes('locked');
      log.error({ err }, 'Backup create failed');
      res.status(isBusy ? 409 : 500).json({
        detail: isBusy ? '任务正在进行中' : '启动备份失败',
        jobId:
          (err instanceof Error && 'jobId' in err ? (err as Error & { jobId?: string }).jobId : undefined) ||
          getActiveBackupJob()?.id,
      });
    }
  });

  // Admin: poll backup progress
  router.get('/api/settings/backup/progress/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const jobId = validateBackupId(asSingleString(req.params.id));
    if (!jobId) {
      res.status(400).json({ detail: '备份任务参数无效' });
      return;
    }
    const job = getJob(jobId);
    if (!job) {
      res.status(404).json({ detail: '备份任务不存在' });
      return;
    }
    res.json({
      stage: job.stage,
      percent: job.percent,
      message: job.message,
      error: job.error,
      scope: job.scope,
      logs: job.logs,
    });
  });

  // Admin: generate a short-lived download token
  router.post('/api/settings/backup/download-token/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const backupId = validateBackupId(asSingleString(req.params.id));
    if (!backupId) {
      res.status(400).json({ detail: '备份参数无效' });
      return;
    }
    const filePath = getBackupArchivePath(backupId);
    if (!filePath) {
      res.status(404).json({ detail: '备份文件不存在' });
      return;
    }
    const created = createProtectedResourceToken({
      type: 'backup-download',
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
  router.get('/api/settings/backup/download/:id/:token', async (req: AuthRequest, res: Response) => {
    const backupId = validateBackupId(asSingleString(req.params.id));
    const token = asSingleString(req.params.token);
    if (!backupId || !token) {
      res.status(400).json({ detail: '下载令牌无效' });
      return;
    }
    const tokenPayload = consumeProtectedResourceToken(token, 'backup-download', backupId);
    if (!tokenPayload) {
      res.status(401).json({ detail: '下载令牌已过期或无效' });
      return;
    }
    const filePath = getBackupArchivePath(backupId);
    if (!filePath) {
      res.status(404).json({ detail: '备份文件不存在' });
      return;
    }
    sendAcceleratedFile(req, res, {
      filePath,
      fileName: basename(filePath),
      contentType: 'application/gzip',
      disposition: 'attachment',
      cacheControl: 'private, no-store',
    });
  });

  // Admin: rename a backup
  router.put('/api/settings/backup/rename/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    if (blockBackupMutationIfBusy(res)) return;
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ detail: '名称不能为空' });
      return;
    }
    const backupId = validateBackupId(asSingleString(req.params.id));
    if (!backupId) {
      res.status(400).json({ detail: '备份参数无效' });
      return;
    }
    const record = renameBackup(backupId, name);
    if (!record) {
      res.status(404).json({ detail: '备份不存在' });
      return;
    }
    res.json(record);
  });

  // Admin: delete a backup
  router.delete('/api/settings/backup/delete/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    if (blockBackupMutationIfBusy(res)) return;
    const backupId = validateBackupId(asSingleString(req.params.id));
    if (!backupId) {
      res.status(400).json({ detail: '备份参数无效' });
      return;
    }
    if (!requireDangerousConfirm(req, res, backupId, '删除备份')) return;
    try {
      const ok = deleteBackup(backupId);
      if (!ok) {
        res.status(404).json({ detail: '备份不存在' });
        return;
      }
      res.json({ success: true });
    } catch (err: unknown) {
      log.error({ err, backupId }, 'Delete backup failed');
      res.status(500).json({ detail: getErrorMessage(err) || '删除备份失败，请检查备份目录权限' });
    }
  });

  // Admin: start restore job from a saved backup
  router.post('/api/settings/backup/restore/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const backupId = validateBackupId(asSingleString(req.params.id));
      if (!backupId) {
        res.status(400).json({ detail: '备份参数无效' });
        return;
      }
      if (!requireDangerousConfirm(req, res, backupId, '恢复备份')) return;
      const jobId = startRestoreJob(backupId, req.user!.userId);
      res.json({ jobId });
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      const isBusy = msg.includes('正在进行中') || msg.includes('locked');
      log.error({ err }, 'Restore failed');
      res.status(isBusy ? 409 : 500).json({ detail: isBusy ? '任务正在进行中' : '启动恢复失败' });
    }
  });

  // Admin: poll restore progress
  router.get(
    '/api/settings/backup/restore-progress/:jobId',
    authMiddleware,
    async (req: AuthRequest, res: Response) => {
      if (!adminOnly(req, res)) return;
      const jobId = asSingleString(req.params.jobId);
      if (!jobId) {
        res.status(400).json({ detail: '恢复任务参数无效' });
        return;
      }
      const job = getRestoreJob(jobId);
      if (!job) {
        res.status(404).json({ detail: '恢复任务不存在，服务器可能已重启' });
        return;
      }
      res.json({
        stage: job.stage,
        percent: job.percent,
        message: job.message,
        error: job.error,
        result: job.result,
        logs: job.logs,
      });
    },
  );

  // Admin: import backup from uploaded file (async)
  router.post(
    '/api/settings/backup/import',
    authMiddleware,
    (req: AuthRequest, res: Response, next) => {
      if (!adminOnly(req, res)) return;
      if (!requireDangerousConfirm(req, res, IMPORT_RESTORE_CONFIRM_VALUE, '导入并恢复备份')) return;
      next();
    },
    backupUpload.single('file'),
    async (req: AuthRequest, res: Response) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({ detail: '请选择备份文件' });
        return;
      }
      try {
        if (!validateBackupArchiveUpload(file.path, res, { cleanup: true })) return;
        const jobId = startRestoreJobFromFile(file.path, true, req.user!.userId);
        res.json({ jobId });
      } catch (err: unknown) {
        cleanupTempBackupUpload(file.path);
        const msg = getErrorMessage(err);
        const isBusy = msg.includes('正在进行中') || msg.includes('locked');
        log.error({ err }, 'Import failed');
        res.status(isBusy ? 409 : 500).json({ detail: isBusy ? '任务正在进行中' : '启动恢复失败' });
      }
    },
  );

  // Admin: poll import-save progress
  router.get(
    '/api/settings/backup/import-save-progress/:jobId',
    authMiddleware,
    async (req: AuthRequest, res: Response) => {
      if (!adminOnly(req, res)) return;
      const jobId = asSingleString(req.params.jobId);
      if (!jobId) {
        res.status(400).json({ detail: '任务参数无效' });
        return;
      }
      const job = getImportSaveJob(jobId);
      if (!job) {
        res.status(404).json({ detail: '任务不存在' });
        return;
      }
      res.json({
        stage: job.stage,
        percent: job.percent,
        message: job.message,
        error: job.error,
        result: job.result,
        logs: job.logs,
      });
    },
  );

  // Admin: import backup from chunked upload (called after chunks are merged)
  router.post('/api/settings/backup/import-chunked', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const managedPath = resolveManagedUploadPath(req.body?.filePath);
    if (!managedPath) {
      res.status(400).json({ detail: '文件路径无效' });
      return;
    }
    if (!requireDangerousConfirm(req, res, IMPORT_RESTORE_CONFIRM_VALUE, '导入并恢复备份')) return;
    try {
      if (!validateBackupArchiveUpload(managedPath, res, { cleanup: true })) return;
      const jobId = startRestoreJobFromFile(managedPath, true, req.user!.userId);
      res.json({ jobId });
    } catch (err: unknown) {
      cleanupTempBackupUpload(managedPath);
      const msg = getErrorMessage(err);
      const isBusy = msg.includes('正在进行中') || msg.includes('locked');
      log.error({ err }, 'Chunked import failed');
      res.status(isBusy ? 409 : 500).json({ detail: isBusy ? '任务正在进行中' : '启动恢复失败' });
    }
  });

  // Admin: import backup from server-local path (no upload needed)
  router.post('/api/settings/backup/import-path', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const filePath = req.body?.path;
    const resolved = resolveBackupPath(filePath);
    if (!resolved) {
      res.status(400).json({ detail: '路径无效，仅支持备份目录下的 .tar.gz / .tgz 文件' });
      return;
    }
    if (!requireDangerousConfirm(req, res, IMPORT_RESTORE_CONFIRM_VALUE, '导入并恢复备份')) return;
    try {
      if (!validateBackupArchiveUpload(resolved, res)) return;
      const jobId = startRestoreJobFromFile(resolved, false, req.user!.userId); // Don't delete server-local files
      res.json({ jobId });
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      const isBusy = msg.includes('正在进行中') || msg.includes('locked');
      log.error({ err }, 'Path import failed');
      res.status(isBusy ? 409 : 500).json({ detail: isBusy ? '任务正在进行中' : '启动恢复失败' });
    }
  });

  // Admin: list server-local backup files for import
  router.get('/api/settings/backup/server-files', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const files: { name: string; path: string; size: number; modifiedAt: string }[] = [];
      for (const dir of [managedBackupRoot, managedUploadRoot]) {
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          if (!isBackupArchiveFilename(entry.name)) continue;
          const fullPath = join(dir, entry.name);
          const st = statSync(fullPath);
          files.push({ name: entry.name, path: fullPath, size: st.size, modifiedAt: st.mtime.toISOString() });
        }
      }
      files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
      res.json(files);
    } catch (err) {
      log.warn({ err }, 'Failed to list server-local backup files');
      res.json([]);
    }
  });

  // Admin: save uploaded file as backup record (no restore) - async job for large files
  router.post(
    '/api/settings/backup/import-save',
    authMiddleware,
    (req: AuthRequest, res: Response, next) => {
      if (!adminOnly(req, res)) return;
      next();
    },
    backupUpload.single('file'),
    async (req: AuthRequest, res: Response) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({ detail: '请选择备份文件' });
        return;
      }
      try {
        // Return async job - inspection of large archives can be slow
        if (!validateBackupArchiveUpload(file.path, res, { cleanup: true })) return;
        const jobId = startImportSaveJob(file.path, file.originalname);
        res.json({ jobId });
      } catch (err: unknown) {
        cleanupTempBackupUpload(file.path);
        const msg = getErrorMessage(err);
        const isBusy = msg.includes('正在进行中') || msg.includes('locked');
        log.error({ err }, 'Import-save failed');
        res.status(isBusy ? 409 : 500).json({ detail: isBusy ? '任务正在进行中' : '启动保存任务失败' });
      }
    },
  );

  // Admin: save chunked upload as backup record (no restore) - async job
  router.post('/api/settings/backup/import-save-chunked', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const managedPath = resolveManagedUploadPath(req.body?.filePath);
    const fileName = req.body?.fileName;
    if (!managedPath) {
      res.status(400).json({ detail: '文件路径无效' });
      return;
    }
    try {
      if (!validateBackupArchiveUpload(managedPath, res, { cleanup: true })) return;
      const jobId = startImportSaveJob(managedPath, fileName || '备份文件');
      res.json({ jobId });
    } catch (err: unknown) {
      cleanupTempBackupUpload(managedPath);
      const msg = getErrorMessage(err);
      const isBusy = msg.includes('正在进行中') || msg.includes('locked');
      log.error({ err }, 'Chunked import-save failed');
      res.status(isBusy ? 409 : 500).json({ detail: isBusy ? '任务正在进行中' : '启动保存任务失败' });
    }
  });

  return router;
}
