import { Router, Response } from 'express';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { createNotification, getBusinessNotificationActionPath } from '../lib/notificationDelivery.js';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';

const router = Router();

// Get unread notification count
router.get('/api/notifications/unread-count', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) {
      res.json({ count: 0 });
      return;
    }
    const count = await prisma.notification.count({
      where: { userId: req.user!.userId, read: false },
    });
    res.json({ count });
  } catch {
    res.json({ count: 0 });
  }
});

// List notifications
router.get('/api/notifications', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) {
      res.json({ data: [] });
      return;
    }
    const { pageSizePolicy } = await getBusinessConfig();
    const defaultPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.notificationDefault) || 20));
    const maxPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.notificationMax) || 100));
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(maxPageSize, Math.max(1, Number(req.query.page_size) || defaultPageSize));
    // 可选筛选：read=unread|read；type=通知类型（ticket/inquiry/favorite/download/...）
    const readFilter = req.query.read;
    const typeFilter = typeof req.query.type === 'string' && req.query.type.trim() ? req.query.type.trim() : null;
    const where: { userId: string; read?: boolean; type?: string } = { userId: req.user!.userId };
    if (readFilter === 'unread') where.read = false;
    else if (readFilter === 'read') where.read = true;
    if (typeFilter) where.type = typeFilter;

    const [total, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const audience = req.user?.role === 'ADMIN' ? 'admin' : 'user';

    // relatedId 存在性校验：关联的模型/工单/询价可能已被删除，
    // 失效通知不再下发 actionPath（前端不显示「查看详情」，避免点进空白页）
    const modelIds = Array.from(
      new Set(
        notifications
          .filter(
            (n) =>
              n.relatedId &&
              ['favorite', 'download', 'model_conversion', 'success', 'error', 'comment'].includes(n.type),
          )
          .map((n) => n.relatedId as string),
      ),
    );
    const ticketIds = Array.from(
      new Set(notifications.filter((n) => n.relatedId && n.type === 'ticket').map((n) => n.relatedId as string)),
    );
    const inquiryIds = Array.from(
      new Set(notifications.filter((n) => n.relatedId && n.type === 'inquiry').map((n) => n.relatedId as string)),
    );
    const [existingModels, existingTickets, existingInquiries] = await Promise.all([
      modelIds.length ? prisma.model.findMany({ where: { id: { in: modelIds } }, select: { id: true } }) : [],
      ticketIds.length ? prisma.supportTicket.findMany({ where: { id: { in: ticketIds } }, select: { id: true } }) : [],
      inquiryIds.length ? prisma.inquiry.findMany({ where: { id: { in: inquiryIds } }, select: { id: true } }) : [],
    ]);
    const validIds = new Set<string>([
      ...existingModels.map((r: { id: string }) => r.id),
      ...existingTickets.map((r: { id: string }) => r.id),
      ...existingInquiries.map((r: { id: string }) => r.id),
    ]);

    res.json({
      data: notifications.map((notification) => {
        const relatedAlive =
          !notification.relatedId || notification.type === 'backup' || validIds.has(notification.relatedId as string);
        return {
          ...notification,
          actionPath: relatedAlive
            ? getBusinessNotificationActionPath({
                type: notification.type,
                relatedId: notification.relatedId,
                audience,
              })
            : null,
        };
      }),
      total,
      page,
      page_size: pageSize,
    });
  } catch {
    res.json({ data: [], total: 0 });
  }
});

// Mark one as read
router.put('/api/notifications/:id/read', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) {
      res.status(503).json({ detail: 'DB unavailable' });
      return;
    }
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id as string, userId: req.user!.userId },
      data: { read: true },
    });
    if (result.count === 0) {
      res.status(404).json({ detail: '通知不存在' });
      return;
    }
    res.json({ success: true });
  } catch {
    res.status(404).json({ detail: '通知不存在' });
  }
});

// Mark all as read
router.put('/api/notifications/read-all', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) {
      res.json({ count: 0 });
      return;
    }
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.userId, read: false },
      data: { read: true },
    });
    res.json({ count: result.count });
  } catch {
    res.status(500).json({ detail: '操作失败' });
  }
});

// Batch mark specific notifications as read
router.put('/api/notifications/batch-read', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) {
      res.json({ count: 0 });
      return;
    }
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000) {
      res.status(400).json({ detail: 'ids 必须是非空数组且不超过 1000' });
      return;
    }
    const result = await prisma.notification.updateMany({
      where: { id: { in: ids }, userId: req.user!.userId },
      data: { read: true },
    });
    res.json({ count: result.count });
  } catch {
    res.status(500).json({ detail: '操作失败' });
  }
});

// Batch delete specific notifications
router.delete('/api/notifications/batch', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) {
      res.json({ count: 0 });
      return;
    }
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000) {
      res.status(400).json({ detail: 'ids 必须是非空数组且不超过 1000' });
      return;
    }
    const result = await prisma.notification.deleteMany({
      where: { id: { in: ids }, userId: req.user!.userId },
    });
    res.json({ count: result.count });
  } catch {
    res.status(500).json({ detail: '删除失败' });
  }
});

// Delete single notification
router.delete('/api/notifications/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) {
      res.status(503).json({ detail: 'DB unavailable' });
      return;
    }
    const notification = await prisma.notification.findUnique({ where: { id: req.params.id as string } });
    if (!notification) {
      res.status(404).json({ detail: '通知不存在' });
      return;
    }
    if (notification.userId !== req.user!.userId) {
      res.status(403).json({ detail: '无权操作' });
      return;
    }
    await prisma.notification.delete({ where: { id: req.params.id as string } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ detail: '删除失败' });
  }
});

// Delete all read notifications
router.delete('/api/notifications/read/clear', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) {
      res.json({ count: 0 });
      return;
    }
    const result = await prisma.notification.deleteMany({
      where: { userId: req.user!.userId, read: true },
    });
    res.json({ count: result.count });
  } catch {
    res.status(500).json({ detail: '清除失败' });
  }
});

export { createNotification };

export default router;
