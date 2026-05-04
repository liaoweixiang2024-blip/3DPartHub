import { Router, Response } from 'express';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { asyncHandler } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { optionalString, paginationQuery } from '../lib/requestValidation.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = Router();

// Query audit logs (admin only)
router.get(
  '/api/audit',
  authMiddleware,
  requireRole('ADMIN'),
  asyncHandler<AuthRequest>(async (req, res: Response) => {
    const resource = optionalString(req.query.resource, { maxLength: 80 });
    const action = optionalString(req.query.action, { maxLength: 80 });
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

    const where: any = {};
    if (resource) where.resource = resource;
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

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
