import { Router, Response } from 'express';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { asyncHandler } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { optionalString, paginationQuery } from '../lib/requestValidation.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { cleanupAuditLogsByRetention, getAuditRetentionPreview } from '../services/auditRetention.js';

const router = Router();

const ACTION_GROUPS: Record<string, string[]> = {
  create: ['create', 'upload', 'register', 'favorite', 'comment', 'ticket_create', 'backup_create'],
  update: ['update'],
  delete: ['delete', 'unfavorite', 'backup_delete'],
  login: ['login'],
  download: ['download', 'backup_download'],
  ticket: ['ticket_create', 'ticket_reply', 'ticket_status'],
  settings: [
    'settings_update',
    'backup_create',
    'backup_restore',
    'backup_import_restore',
    'backup_import_save',
    'backup_delete',
    'backup_download',
    'backup_rename',
    'system_update',
    'audit_cleanup',
  ],
};

type AuditWhereInput = {
  resource?: string;
  search?: string;
  userId?: string;
  from?: string;
  to?: string;
};

async function buildAuditSearchFilter(search: string): Promise<any | null> {
  if (!search) return null;
  const matchedUsers = await prisma.user.findMany({
    where: {
      OR: [
        { id: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
    take: 200,
  });
  const userIds = matchedUsers.map((user) => user.id);
  const or: any[] = [
    { id: { contains: search, mode: 'insensitive' } },
    { action: { contains: search, mode: 'insensitive' } },
    { resource: { contains: search, mode: 'insensitive' } },
    { resourceId: { contains: search, mode: 'insensitive' } },
    { details: { path: ['path'], string_contains: search } },
    { details: { path: ['body', 'name'], string_contains: search } },
    { details: { path: ['body', 'title'], string_contains: search } },
    { details: { path: ['body', 'status'], string_contains: search } },
    { details: { path: ['body', 'description'], string_contains: search } },
    { details: { path: ['body', 'classification'], string_contains: search } },
    { details: { path: ['body', 'email'], string_contains: search } },
    { details: { path: ['body', 'username'], string_contains: search } },
    { details: { path: ['body', 'format'], string_contains: search } },
    { details: { path: ['body', 'role'], string_contains: search } },
  ];
  if (/^\d+$/.test(search)) {
    or.push({ details: { path: ['statusCode'], equals: Number(search) } });
  }
  if (userIds.length > 0) {
    or.push({ userId: { in: userIds } });
  }
  return { OR: or };
}

async function buildAuditWhere({ resource, search = '', userId, from, to }: AuditWhereInput) {
  const where: any = {};
  if (resource) where.resource = resource;
  if (userId) where.userId = userId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }
  const searchFilter = await buildAuditSearchFilter(search);
  if (searchFilter) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), searchFilter];
  }
  return where;
}

// Audit log retention policy preview (admin only)
router.get(
  '/api/audit/retention',
  authMiddleware,
  requireRole('ADMIN'),
  asyncHandler<AuthRequest>(async (_req, res: Response) => {
    res.json(await getAuditRetentionPreview());
  }),
);

// Cleanup audit logs according to the retention policy (admin only)
router.post(
  '/api/audit/retention/cleanup',
  authMiddleware,
  requireRole('ADMIN'),
  asyncHandler<AuthRequest>(async (req, res: Response) => {
    const retentionDays =
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'retentionDays') ? req.body.retentionDays : undefined;
    const result = await cleanupAuditLogsByRetention({
      logZeroResult: true,
      method: 'POST',
      path: req.originalUrl || req.path,
      retentionDays,
      source: 'manual',
      userId: req.user?.userId || null,
    });
    res.json(result);
  }),
);

// Audit log grouped counts (admin only)
router.get(
  '/api/audit/stats',
  authMiddleware,
  requireRole('ADMIN'),
  asyncHandler<AuthRequest>(async (req, res: Response) => {
    const resource = optionalString(req.query.resource, { maxLength: 80 });
    const search = optionalString(req.query.search, { maxLength: 160 })?.trim() || '';
    const userId = optionalString(req.query.userId, { maxLength: 160 });
    const from = optionalString(req.query.from, { maxLength: 40 });
    const to = optionalString(req.query.to, { maxLength: 40 });
    const where = await buildAuditWhere({ resource, search, userId, from, to });
    const grouped = await prisma.auditLog.groupBy({
      by: ['action'],
      where,
      _count: { _all: true },
    });
    const actionCounts = new Map(grouped.map((item) => [item.action, item._count._all]));
    const total = grouped.reduce((sum, item) => sum + item._count._all, 0);
    const actionGroups = Object.fromEntries(
      Object.entries(ACTION_GROUPS).map(([key, actions]) => [
        key,
        actions.reduce((sum, action) => sum + (actionCounts.get(action) || 0), 0),
      ]),
    );

    res.json({
      total,
      actionGroups: {
        all: total,
        ...actionGroups,
      },
    });
  }),
);

// Query audit logs (admin only)
router.get(
  '/api/audit',
  authMiddleware,
  requireRole('ADMIN'),
  asyncHandler<AuthRequest>(async (req, res: Response) => {
    const resource = optionalString(req.query.resource, { maxLength: 80 });
    const action = optionalString(req.query.action, { maxLength: 80 });
    const actionGroup = optionalString(req.query.actionGroup, { maxLength: 80 });
    const search = optionalString(req.query.search, { maxLength: 160 })?.trim() || '';
    const userId = optionalString(req.query.userId, { maxLength: 160 });
    const from = optionalString(req.query.from, { maxLength: 40 });
    const to = optionalString(req.query.to, { maxLength: 40 });
    const { pageSizePolicy } = await getBusinessConfig();
    const defaultPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.auditDefault) || 50));
    const maxPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.auditMax) || 100));
    const { page, pageSize, skip, take } = paginationQuery(req.query, {
      pageSizeKey: 'size',
      defaultPageSize,
      maxPageSize,
    });

    const where = await buildAuditWhere({ resource, search, userId, from, to });
    if (actionGroup && ACTION_GROUPS[actionGroup]) where.action = { in: ACTION_GROUPS[actionGroup] };
    else if (action) where.action = action;

    const total = await prisma.auditLog.count({ where });
    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });

    // Resolve userId -> username
    const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))] as string[];
    const users =
      userIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
        : [];
    const userMap = new Map(users.map((u) => [u.id, u.username]));

    const items = logs.map((l) => ({
      id: l.id,
      userId: l.userId,
      username: l.userId ? userMap.get(l.userId) || l.userId : null,
      action: l.action,
      resource: l.resource,
      resourceId: l.resourceId,
      details: l.details,
      createdAt: l.createdAt,
    }));

    res.json({ total, items, page, page_size: pageSize });
  }),
);

export default router;
