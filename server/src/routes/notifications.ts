import { Router, Response } from 'express';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { userWantsNotification } from './auth.js';

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
    const where = { userId: req.user!.userId };

    const [total, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    res.json({ data: notifications, total, page, page_size: pageSize });
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

// Internal helper: create notification (not exposed as API route)
export async function createNotification(params: {
  userId: string;
  title: string;
  message: string;
  type?: string;
  relatedId?: string;
}) {
  if (!prisma) return null;
  try {
    // Check user preference before sending
    const notificationType = params.type || 'info';
    const wantsIt = await userWantsNotification(params.userId, notificationType);
    if (!wantsIt) return null;

    return await prisma.notification.create({
      data: {
        userId: params.userId,
        title: params.title,
        message: params.message,
        type: notificationType,
        relatedId: params.relatedId || null,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to create notification');
    return null;
  }
}

export default router;
