import { Router, Response } from 'express';
import { getBusinessConfig, labelFor } from '../../lib/businessConfig.js';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { createNotification } from '../notifications.js';
import { adminOnly, param } from './common.js';
import { logger } from '../../lib/logger.js';

export function createAdminInquiriesRouter() {
  const router = Router();

  // List all inquiries
  router.get('/api/admin/inquiries', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const { pageSizePolicy } = await getBusinessConfig();
      const pageSize = Math.min(
        pageSizePolicy.inquiryAdminMax,
        Math.max(1, Number(req.query.page_size) || pageSizePolicy.inquiryAdminDefault),
      );
      const status = req.query.status as string | undefined;

      const where = status && status !== 'all' ? { status } : {};
      const [total, items] = await Promise.all([
        prisma.inquiry.count({ where }),
        prisma.inquiry.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            user: { select: { id: true, username: true, email: true, company: true } },
            items: { select: { id: true, productName: true, modelNo: true, qty: true, unit: true, remark: true } },
          },
        }),
      ]);
      res.json({ total, page, pageSize, items });
    } catch (err) {
      logger.error({ err }, '[Inquiries] Admin list error');
      res.status(500).json({ detail: '获取询价单列表失败' });
    }
  });

  // Update inquiry status
  router.put('/api/admin/inquiries/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = param(req, 'id');
      const { status } = req.body;
      const { inquiryStatuses } = await getBusinessConfig();
      const statusValues = inquiryStatuses.filter((item) => item.value !== 'draft').map((item) => item.value);
      if (!statusValues.includes(status)) {
        res.status(400).json({ detail: '无效状态' });
        return;
      }
      const current = await prisma.inquiry.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!current) {
        res.status(404).json({ detail: '询价单不存在' });
        return;
      }
      if (status === current.status) {
        res.json(current);
        return;
      }
      const transitions: Record<string, string[]> = {
        draft: ['quoted', 'rejected'],
        submitted: ['quoted', 'rejected'],
        quoted: ['accepted', 'rejected'],
        accepted: [],
        rejected: [],
        cancelled: [],
      };
      const nextStatuses = transitions[current.status] || [];
      if (!nextStatuses.includes(status)) {
        res.status(400).json({ detail: '当前状态不支持该操作' });
        return;
      }
      const updated = await prisma.inquiry.update({
        where: { id },
        data: { status },
      });

      await createNotification({
        userId: updated.userId,
        title: '询价单状态更新',
        message: `您的询价单状态已更新为「${labelFor(inquiryStatuses, status)}」`,
        type: 'inquiry',
        relatedId: id,
      }).catch(() => {});

      res.json(updated);
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ detail: '询价单不存在' });
        return;
      }
      logger.error({ err }, '[Inquiries] Status update error');
      res.status(500).json({ detail: '更新状态失败' });
    }
  });

  return router;
}
