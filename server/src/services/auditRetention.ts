import { createLogger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { getSetting } from '../lib/settings.js';

export const DEFAULT_AUDIT_RETENTION_DAYS = 365;

const log = createLogger({ component: 'audit-retention' });
const AUDIT_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
let schedulerStarted = false;

export interface AuditRetentionPreview {
  retentionDays: number;
  enabled: boolean;
  cutoffAt: string | null;
  deleteCount: number;
}

export interface AuditRetentionCleanupResult {
  retentionDays: number;
  enabled: boolean;
  cutoffAt: string | null;
  deleted: number;
}

interface CleanupAuditLogsOptions {
  audit?: boolean;
  logZeroResult?: boolean;
  method?: string;
  path?: string;
  retentionDays?: unknown;
  source?: 'manual' | 'scheduled';
  userId?: string | null;
}

export function normalizeAuditRetentionDays(value: unknown) {
  const days = Math.floor(Number(value));
  if (!Number.isFinite(days)) return DEFAULT_AUDIT_RETENTION_DAYS;
  return Math.max(0, days);
}

export async function getAuditRetentionDays() {
  return normalizeAuditRetentionDays(await getSetting<number>('audit_log_retention_days'));
}

export function getAuditRetentionCutoff(retentionDays: number) {
  if (retentionDays <= 0) return null;
  const cutoffAt = new Date();
  cutoffAt.setDate(cutoffAt.getDate() - retentionDays);
  return cutoffAt;
}

export async function getAuditRetentionPreview(): Promise<AuditRetentionPreview> {
  const retentionDays = await getAuditRetentionDays();
  const cutoffAt = getAuditRetentionCutoff(retentionDays);
  const deleteCount = cutoffAt ? await prisma.auditLog.count({ where: { createdAt: { lt: cutoffAt } } }) : 0;

  return {
    retentionDays,
    enabled: retentionDays > 0,
    cutoffAt: cutoffAt?.toISOString() || null,
    deleteCount,
  };
}

export async function cleanupAuditLogsByRetention(
  options: CleanupAuditLogsOptions = {},
): Promise<AuditRetentionCleanupResult> {
  const retentionDays =
    options.retentionDays === undefined
      ? await getAuditRetentionDays()
      : normalizeAuditRetentionDays(options.retentionDays);
  const cutoffAt = getAuditRetentionCutoff(retentionDays);

  if (!cutoffAt) {
    return { retentionDays, enabled: false, cutoffAt: null, deleted: 0 };
  }

  const result = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoffAt } } });
  const shouldWriteAuditLog = options.audit !== false && (options.logZeroResult || result.count > 0);

  if (shouldWriteAuditLog) {
    await prisma.auditLog.create({
      data: {
        userId: options.userId || null,
        action: 'audit_cleanup',
        resource: 'audit',
        resourceId: null,
        details: {
          method: options.method || 'SYSTEM',
          path: options.path || 'audit-retention-scheduler',
          statusCode: 200,
          body: {
            retentionDays,
            cutoffAt: cutoffAt.toISOString(),
            deleted: result.count,
            source: options.source || 'manual',
          },
        },
      },
    });
  }

  return {
    retentionDays,
    enabled: true,
    cutoffAt: cutoffAt.toISOString(),
    deleted: result.count,
  };
}

export function startAuditRetentionScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const run = async () => {
    try {
      const result = await cleanupAuditLogsByRetention({
        audit: true,
        logZeroResult: false,
        source: 'scheduled',
      });
      if (result.deleted > 0) {
        log.info(
          { deleted: result.deleted, cutoffAt: result.cutoffAt, retentionDays: result.retentionDays },
          'Audit retention cleanup completed',
        );
      }
    } catch (err) {
      log.warn({ err }, 'Audit retention cleanup failed');
    }
  };

  const startupTimer = setTimeout(run, 60_000);
  startupTimer.unref?.();
  const interval = setInterval(run, AUDIT_RETENTION_INTERVAL_MS);
  interval.unref?.();
}
