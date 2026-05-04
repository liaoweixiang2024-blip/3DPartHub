import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { createNotification } from '../notifications.js';
import { param } from './common.js';
import { logger } from '../../lib/logger.js';

export function createUserInquiriesRouter() {
  const router = Router();

  // Create inquiry
  router.post('/api/inquiries', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { items, remark, company, contactName, contactPhone } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ detail: '至少需要一个询价项目' });
        return;
      }
      if (items.length > 100) {
        res.status(400).json({ detail: '单个询价单最多包含 100 个项目' });
        return;
      }

      // Resolve product names/specs from productId
      const productIds = items.map((i: any) => i.productId).filter(Boolean) as string[];
      const products =
        productIds.length > 0
          ? await prisma.selectionProduct.findMany({
              where: { id: { in: productIds } },
              select: { id: true, name: true, modelNo: true, specs: true, unit: true },
            })
          : [];
      const productMap = new Map(products.map((p) => [p.id, p]));

      const inquiry = await prisma.inquiry.create({
        data: {
          userId: req.user!.userId,
          status: 'submitted',
          remark: remark || null,
          company: company || null,
          contactName: contactName || null,
          contactPhone: contactPhone || null,
          items: {
            create: items.map((item: any) => {
              const product = item.productId ? productMap.get(item.productId) : null;
              return {
                productId: item.productId || null,
                productName: product?.name || item.productName || '未知产品',
                modelNo: product?.modelNo || item.modelNo || null,
                specs: product?.specs || item.specs || null,
                unit: product?.unit || item.unit || '个',
                qty: item.qty ?? 1,
                remark: item.remark || null,
              };
            }),
          },
        },
        include: { items: true },
      });

      // Notify admins
      try {
        const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
        await Promise.all(
          admins.map((admin: any) =>
            createNotification({
              userId: admin.id,
              title: '新询价单',
              message: `用户提交了一份新的询价单，包含 ${inquiry.items.length} 个产品`,
              type: 'inquiry',
              relatedId: inquiry.id,
            }).catch(() => {}),
          ),
        );
      } catch {}

      res.status(201).json(inquiry);
    } catch (err) {
      logger.error({ err }, '[Inquiries] Create error');
      res.status(500).json({ detail: '创建询价单失败' });
    }
  });

  // List my inquiries
  router.get('/api/inquiries', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));
      const [inquiries, total] = await Promise.all([
        prisma.inquiry.findMany({
          where: { userId: req.user!.userId },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            items: { select: { id: true, productName: true, modelNo: true, qty: true, unit: true, remark: true } },
          },
        }),
        prisma.inquiry.count({ where: { userId: req.user!.userId } }),
      ]);
      res.json({ items: inquiries, total, page, page_size: pageSize });
    } catch (err) {
      logger.error({ err }, '[Inquiries] List error');
      res.status(500).json({ detail: '获取询价单列表失败' });
    }
  });

  // Get inquiry detail
  router.get('/api/inquiries/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const id = param(req, 'id');
      const inquiry = await prisma.inquiry.findUnique({
        where: { id },
        include: {
          items: true,
          messages: {
            include: { user: { select: { id: true, username: true, avatar: true } } },
            orderBy: { createdAt: 'asc' },
          },
          user: { select: { id: true, username: true, email: true, avatar: true, company: true, phone: true } },
        },
      });
      if (!inquiry) {
        res.status(404).json({ detail: '询价单不存在' });
        return;
      }
      if (inquiry.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
        res.status(403).json({ detail: '无权访问' });
        return;
      }
      res.json(inquiry);
    } catch (err) {
      logger.error({ err }, '[Inquiries] Get error');
      res.status(500).json({ detail: '获取询价单详情失败' });
    }
  });

  // Cancel inquiry
  router.put('/api/inquiries/:id/cancel', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const id = param(req, 'id');
      const inquiry = await prisma.inquiry.findUnique({ where: { id } });
      if (!inquiry) {
        res.status(404).json({ detail: '询价单不存在' });
        return;
      }
      if (inquiry.userId !== req.user!.userId) {
        res.status(403).json({ detail: '无权操作' });
        return;
      }
      if (inquiry.status !== 'submitted' && inquiry.status !== 'draft') {
        res.status(400).json({ detail: '当前状态无法取消' });
        return;
      }
      const updated = await prisma.inquiry.update({
        where: { id },
        data: { status: 'cancelled' },
      });
      res.json(updated);
    } catch (err) {
      logger.error({ err }, '[Inquiries] Cancel error');
      res.status(500).json({ detail: '取消询价单失败' });
    }
  });

  // Send message
  router.post('/api/inquiries/:id/messages', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const id = param(req, 'id');
      const { content, attachment } = req.body;
      if ((!content || !content.trim()) && !attachment) {
        res.status(400).json({ detail: '消息内容不能为空' });
        return;
      }

      const inquiry = await prisma.inquiry.findUnique({ where: { id } });
      if (!inquiry) {
        res.status(404).json({ detail: '询价单不存在' });
        return;
      }
      if (inquiry.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
        res.status(403).json({ detail: '无权操作' });
        return;
      }

      const isAdmin = req.user!.role === 'ADMIN';
      const message = await prisma.inquiryMessage.create({
        data: {
          inquiryId: id,
          userId: req.user!.userId,
          content: content?.trim() || '',
          attachment: attachment || null,
          isAdmin,
        },
        include: { user: { select: { id: true, username: true, avatar: true } } },
      });

      // Notify the other party
      try {
        const targetUserId = isAdmin ? inquiry.userId : null;
        if (isAdmin) {
          await createNotification({
            userId: targetUserId!,
            title: '询价单回复',
            message: `管理员回复了您的询价单`,
            type: 'inquiry',
            relatedId: id,
          });
        } else {
          const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
          for (const admin of admins) {
            await createNotification({
              userId: admin.id,
              title: '询价单新回复',
              message: `用户回复了询价单`,
              type: 'inquiry',
              relatedId: id,
            });
          }
        }
      } catch {}

      res.json(message);
    } catch (err) {
      logger.error({ err }, '[Inquiries] Message error');
      res.status(500).json({ detail: '发送消息失败' });
    }
  });

  return router;
}
