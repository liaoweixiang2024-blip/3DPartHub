import type { Prisma } from '@prisma/client';
import { Response, NextFunction, Request } from 'express';
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
  '/api/settings/backup/check', // detailed backup drill audit is written by the route.
  '/api/settings/backup/progress', // polling
  '/api/settings/backup/restore-progress', // polling
  '/api/settings/backup/import-save-progress', // polling
  '/api/settings/backup/download/', // GET download uses a single-use token; token generation is audited.
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

// 用户自助操作路由（操作者即当事人）：绑定 resourceId 到用户 id，
// 用户编辑弹窗「最近管理操作」因此能展示用户自己的改资料/改密/换绑邮箱。
// 验证码发送（change-email/code）属高频噪声，不纳入
const SELF_SERVICE_PATHS = new Set(['/api/auth/profile', '/api/auth/password', '/api/auth/change-email']);

// Map URL patterns to resource names
function extractResource(path: string): string {
  if (path.includes('/models')) return 'model';
  if (path.includes('/auth/login')) return 'auth';
  if (path.includes('/auth/register')) return 'auth';
  if (path.includes('/auth/logout')) return 'auth';
  // 用户自助操作归入 user 资源（历史行曾是 other，弹窗查询按路径兜底兼容）
  if (SELF_SERVICE_PATHS.has(path.split('?')[0] as string)) return 'user';
  // 选型（含后台 /api/admin/selections 与分享 /api/selection-shares）、图片墙、邀请码、
  // 批量上传（产物是模型）：此前全落 other，日志页只见「其他/创建」无从分辨
  if (path.includes('/selections') || path.includes('/selection-shares')) return 'selection';
  if (path.includes('/product-wall')) return 'product_wall';
  if (path.includes('/invites')) return 'invite';
  if (path.includes('/batch/upload')) return 'model';
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
  if (path.includes('/logout')) return 'logout';
  if (path.includes('/register')) return 'register';
  if (path.includes('/download')) return 'download';
  if (path.includes('/selections/export')) return 'download';
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
        const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : null;
        const pathOnly = path.split('?')[0] as string;
        // 路由显式指定（如管理员创建用户：autoAudit 推不出新用户 id，路由把
        // 创建结果挂 res.locals.auditResourceId，finish 后这里读得到）
        const explicitIdRaw = (_res as { locals?: Record<string, unknown> }).locals?.auditResourceId;
        const explicitId = typeof explicitIdRaw === 'string' && explicitIdRaw ? explicitIdRaw : null;
        // 用户自助操作：操作者即当事人，resourceId 绑到用户 id（resource 保持 auth，
        // 不扰乱审计日志页的资源筛选；弹窗查询侧同时匹配两种 resource）
        const selfId = SELF_SERVICE_PATHS.has(pathOnly) ? (authReq.user?.userId ?? null) : null;
        const resourceId =
          explicitId ||
          params.id ||
          params.modelId ||
          params.catId ||
          params.productId ||
          params.projectId ||
          params.ticketId ||
          params.commentId ||
          params.userId ||
          params.slug ||
          selfId ||
          (typeof body?.id === 'string' || typeof body?.id === 'number' ? String(body.id) : null) ||
          (typeof body?.modelId === 'string' ? body.modelId : null) ||
          null;

        const details: Record<string, Prisma.InputJsonValue> = {
          method: req.method,
          path,
          statusCode: _res.statusCode,
        };

        // 客户端 IP（trust proxy 已配置，取 X-Forwarded-For 首跳）与 UA：
        // 登录成功/失败的安全审计靠这两个字段定位来源
        const clientIp = req.ip;
        if (clientIp) details.ip = clientIp;
        const userAgent = req.headers['user-agent'];
        if (typeof userAgent === 'string' && userAgent) details.ua = userAgent.slice(0, 180);

        // Include relevant body fields (sanitized)
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
            'modelId',
          ]) {
            const value = body[key];
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              // 邮箱归一小写：登录行靠 details.body.email 关联到用户（用户编辑弹窗
              // 「最近登录」按库内小写邮箱匹配），大小写不一致会漏
              safeFields[key] = key === 'email' && typeof value === 'string' ? value.trim().toLowerCase() : value;
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
