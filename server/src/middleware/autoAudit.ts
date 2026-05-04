import { Response, NextFunction, Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { AuthRequest } from './auth.js';

/**
 * Auto-audit middleware — applied globally, records mutation operations.
 * Only logs POST/PUT/DELETE/PATCH on /api/* routes.
 * Skips noisy paths like task polling, message refresh, etc.
 */
const SKIP_PREFIXES = [
  '/api/health',
  '/api/tasks?', // GET task status, not mutations
  '/api/settings/backup/progress', // polling
  '/api/settings/backup/restore-progress', // polling
  '/api/settings/backup/restore-progress', // polling
  '/api/settings/backup/import-save-progress', // polling
  '/api/settings/backup/download/', // one-time token download, logged separately
  '/api/settings/backup/download-token/', // token generation, logged as backup_download
  '/api/downloads/model-token', // short-lived browser download token generation
  '/api/settings/update/progress', // polling
  '/api/notifications', // GET polling
  '/api/audit', // don't audit the audit log itself
  '/api/auth/refresh', // token refresh noise
  '/api/settings/version', // public version check
  '/api/settings/public', // public settings read
];

const ACTION_MAP: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

// Map URL patterns to resource names
function extractResource(path: string): string {
  if (path.includes('/models')) return 'model';
  if (path.includes('/auth/login')) return 'auth';
  if (path.includes('/auth/register')) return 'auth';
  if (path.includes('/users')) return 'user';
  if (path.includes('/categories')) return 'category';
  if (path.includes('/comments')) return 'comment';
  if (path.includes('/favorites')) return 'favorite';
  if (path.includes('/tickets')) return 'ticket';
  if (path.includes('/tasks') && !path.includes('/tickets')) return 'ticket';
  if (path.includes('/settings/backup')) return 'backup';
  if (path.includes('/settings/update')) return 'backup';
  if (path.includes('/settings')) return 'settings';
  if (path.includes('/shares')) return 'share';
  if (path.includes('/projects')) return 'project';
  if (path.includes('/download')) return 'download';
  return 'other';
}

// Refine action based on URL
function refineAction(method: string, path: string): string {
  if (path.includes('/upload') || path.includes('/reconvert')) return 'upload';
  if (path.includes('/login')) return 'login';
  if (path.includes('/register')) return 'register';
  if (path.includes('/download')) return 'download';
  if (path.includes('/favorite') && method === 'POST') return 'favorite';
  if (path.includes('/favorite') && method === 'DELETE') return 'unfavorite';
  if (path.includes('/comment')) return 'comment';
  if (path.includes('/settings') && method === 'PUT') return 'settings_update';
  if (path.includes('/tickets') && path.includes('/messages')) return 'ticket_reply';
  if (path.includes('/tickets') && method === 'PUT') return 'ticket_status';
  if (path.includes('/tasks') && method === 'POST' && !path.includes('/tickets')) return 'ticket_create';
  // Backup-related actions
  if (path.includes('/settings/backup/create') && method === 'POST') return 'backup_create';
  if (path.includes('/settings/backup/restore/') && method === 'POST') return 'backup_restore';
  if (path.includes('/settings/backup/import-chunked') && method === 'POST') return 'backup_import_restore';
  if (path.includes('/settings/backup/import') && method === 'POST') return 'backup_import_restore';
  if (path.includes('/settings/backup/import-save-chunked') && method === 'POST') return 'backup_import_save';
  if (path.includes('/settings/backup/import-save') && method === 'POST') return 'backup_import_save';
  if (path.includes('/settings/backup/delete/') && method === 'DELETE') return 'backup_delete';
  if (path.includes('/settings/backup/download-token/') && method === 'POST') return 'backup_download';
  if (path.includes('/settings/backup/rename/') && method === 'PUT') return 'backup_rename';
  if (path.includes('/settings/update/run') && method === 'POST') return 'system_update';
  return ACTION_MAP[method] || method.toLowerCase();
}

export function autoAudit(req: Request, _res: Response, next: NextFunction) {
  const path = req.originalUrl || req.path;

  // Only audit mutation methods on /api routes
  if (!path.startsWith('/api/') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }

  // Skip noisy paths
  if (SKIP_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    next();
    return;
  }

  const action = refineAction(req.method, path);
  const resource = extractResource(path);

  // Attach a listener to log after response
  _res.once('finish', () => {
    if (_res.statusCode >= 500) return;

    setImmediate(async () => {
      try {
        const authReq = req as AuthRequest;
        const userId = authReq.user?.userId || null;
        const params = req.params || {};
        const resourceId =
          params.id ||
          params.modelId ||
          params.catId ||
          params.productId ||
          params.projectId ||
          params.ticketId ||
          params.commentId ||
          params.userId ||
          params.slug ||
          (req.body as any)?.id ||
          null;

        const details: Record<string, Prisma.InputJsonValue> = {
          method: req.method,
          path,
          statusCode: _res.statusCode,
        };

        // Include relevant body fields (sanitized)
        const body = req.body as Record<string, unknown>;
        if (body && typeof body === 'object') {
          const safeFields: Record<string, Prisma.InputJsonValue> = {};
          for (const key of [
            'name',
            'status',
            'classification',
            'description',
            'role',
            'email',
            'username',
            'format',
            'title',
          ]) {
            const value = body[key];
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              safeFields[key] = value;
            }
          }
          if (Object.keys(safeFields).length > 0) {
            details.body = safeFields as Prisma.InputJsonObject;
          }
        }

        await prisma.auditLog.create({
          data: {
            userId,
            action,
            resource,
            resourceId: resourceId as string | null,
            details: details as Prisma.InputJsonObject,
          },
        });
      } catch {
        // Best-effort logging
      }
    });
  });

  next();
}
