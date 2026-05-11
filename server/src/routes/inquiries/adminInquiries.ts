import type { Prisma } from '@prisma/client';
import { Router, Response } from 'express';
import { getBusinessConfig, labelFor } from '../../lib/businessConfig.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { createNotification } from '../notifications.js';
import { adminOnly, param } from './common.js';

const SALES_ASSIGNMENT_MODES = new Set(['manual', 'default', 'auto', 'region', 'channel']);
const SALES_CHANNELS = new Set(['online', 'offline']);

const salesCandidateSelect = {
  id: true,
  username: true,
  email: true,
  phone: true,
  company: true,
  department: true,
  avatar: true,
  role: true,
} satisfies Prisma.UserSelect;

const inquiryAdminInclude = {
  user: { select: { id: true, username: true, email: true, company: true, phone: true, address: true } },
  salesAssignee: { select: salesCandidateSelect },
  salesAssignedBy: { select: salesCandidateSelect },
  items: {
    select: { id: true, productName: true, modelNo: true, specs: true, qty: true, unit: true, remark: true },
  },
} satisfies Prisma.InquiryInclude;

async function getSalesCandidates() {
  return prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'EDITOR'] } },
    orderBy: [{ role: 'asc' }, { username: 'asc' }],
    select: salesCandidateSelect,
  });
}

async function resolveSalesAssignee(input: { assigneeId?: string | null; mode: string; region?: string | null }) {
  const candidates = await getSalesCandidates();
  if (candidates.length === 0) return null;

  if (input.assigneeId) {
    const selected = candidates.find((candidate) => candidate.id === input.assigneeId);
    if (!selected) return null;
    return selected;
  }

  if (input.mode === 'region' && input.region) {
    const keyword = input.region.trim().toLowerCase();
    const matched = candidates.find((candidate) =>
      [candidate.department, candidate.company, candidate.username].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(keyword),
      ),
    );
    if (matched) return matched;
  }

  if (input.mode === 'auto') {
    const grouped = await prisma.inquiry.groupBy({
      by: ['salesAssigneeId'],
      where: {
        salesAssigneeId: { not: null },
        status: { in: ['submitted', 'quoted', 'accepted'] },
      },
      _count: { _all: true },
    });
    const load = new Map(grouped.map((item) => [item.salesAssigneeId, item._count._all]));
    return [...candidates].sort((a, b) => (load.get(a.id) || 0) - (load.get(b.id) || 0))[0];
  }

  return candidates.find((candidate) => candidate.role === 'EDITOR') || candidates[0];
}

function assignmentModeLabel(mode: string) {
  if (mode === 'auto') return '自动分配';
  if (mode === 'default') return '默认负责人';
  if (mode === 'region') return '按区域分配';
  if (mode === 'channel') return '按交易方式分配';
  return '手动指定';
}

export function createAdminInquiriesRouter() {
  const router = Router();

  router.get('/api/admin/inquiries/sales-candidates', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      res.json({ items: await getSalesCandidates() });
    } catch (err) {
      logger.error({ err }, '[Inquiries] Sales candidates error');
      res.status(500).json({ detail: '获取销售候选人失败' });
    }
  });

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
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

      const where: Prisma.InquiryWhereInput = {};
      if (status && status !== 'all') where.status = status;
      if (search) {
        where.OR = [
          { id: { contains: search, mode: 'insensitive' } },
          { company: { contains: search, mode: 'insensitive' } },
          { contactName: { contains: search, mode: 'insensitive' } },
          { contactPhone: { contains: search, mode: 'insensitive' } },
          { contactAddress: { contains: search, mode: 'insensitive' } },
          { remark: { contains: search, mode: 'insensitive' } },
          { adminRemark: { contains: search, mode: 'insensitive' } },
          {
            user: {
              is: {
                OR: [
                  { username: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                  { company: { contains: search, mode: 'insensitive' } },
                  { phone: { contains: search, mode: 'insensitive' } },
                  { address: { contains: search, mode: 'insensitive' } },
                ],
              },
            },
          },
          {
            salesAssignee: {
              is: {
                OR: [
                  { username: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                  { company: { contains: search, mode: 'insensitive' } },
                  { department: { contains: search, mode: 'insensitive' } },
                  { phone: { contains: search, mode: 'insensitive' } },
                ],
              },
            },
          },
          {
            items: {
              some: {
                OR: [
                  { productName: { contains: search, mode: 'insensitive' } },
                  { modelNo: { contains: search, mode: 'insensitive' } },
                  { remark: { contains: search, mode: 'insensitive' } },
                ],
              },
            },
          },
        ];
      }
      const [total, items] = await Promise.all([
        prisma.inquiry.count({ where }),
        prisma.inquiry.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: inquiryAdminInclude,
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

  router.put('/api/admin/inquiries/:id/sales-assignment', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = param(req, 'id');
      const mode = typeof req.body?.mode === 'string' ? req.body.mode : 'manual';
      if (!SALES_ASSIGNMENT_MODES.has(mode)) {
        res.status(400).json({ detail: '无效的分配模式' });
        return;
      }
      const channel = typeof req.body?.channel === 'string' ? req.body.channel : null;
      if (channel && !SALES_CHANNELS.has(channel)) {
        res.status(400).json({ detail: '无效的交易方式' });
        return;
      }
      const current = await prisma.inquiry.findUnique({
        where: { id },
        select: { id: true, status: true, userId: true },
      });
      if (!current) {
        res.status(404).json({ detail: '询价单不存在' });
        return;
      }
      if (current.status === 'cancelled' || current.status === 'rejected') {
        res.status(400).json({ detail: '已结束的询价单不能转交销售' });
        return;
      }

      const region = typeof req.body?.region === 'string' ? req.body.region.trim() : '';
      const handoffNote =
        typeof req.body?.handoffNote === 'string'
          ? req.body.handoffNote.trim()
          : `${assignmentModeLabel(mode)}，请跟进客户询价需求。`;
      const assignee = await resolveSalesAssignee({
        assigneeId: typeof req.body?.assigneeId === 'string' ? req.body.assigneeId : null,
        mode,
        region,
      });
      if (!assignee) {
        res.status(400).json({ detail: '没有找到可用的业务对接人，请先在用户管理中设置 ADMIN 或 EDITOR 用户' });
        return;
      }

      const updated = await prisma.$transaction(async (tx) => {
        await tx.inquiry.update({
          where: { id },
          data: {
            status: 'accepted',
            salesAssigneeId: assignee.id,
            salesAssignedById: req.user!.userId,
            salesAssignedAt: new Date(),
            salesMode: mode,
            salesChannel: channel,
            salesRegion: region || null,
            salesHandoffNote: handoffNote || null,
          },
        });
        await tx.inquiryMessage.create({
          data: {
            inquiryId: id,
            userId: req.user!.userId,
            isAdmin: true,
            content: [
              `询价单已转交给 ${assignee.username} 跟进。`,
              channel ? `交易方式：${channel === 'offline' ? '线下交易' : '线上交易'}` : '',
              region ? `区域：${region}` : '',
              handoffNote ? `交接说明：${handoffNote}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        });
        return tx.inquiry.findUniqueOrThrow({
          where: { id },
          include: {
            ...inquiryAdminInclude,
            messages: {
              where: { inquiryId: id },
              include: { user: { select: { id: true, username: true, avatar: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        });
      });

      await createNotification({
        userId: current.userId,
        title: '询价单已转销售跟进',
        message: `${assignee.username} 将继续对接您的询价需求`,
        type: 'inquiry',
        relatedId: id,
      }).catch(() => {});
      if (assignee.id !== req.user!.userId) {
        await createNotification({
          userId: assignee.id,
          title: '新的询价对接任务',
          message: `有一份询价单已转交给您跟进`,
          type: 'inquiry',
          relatedId: id,
        }).catch(() => {});
      }

      res.json(updated);
    } catch (err) {
      logger.error({ err }, '[Inquiries] Sales assignment error');
      res.status(500).json({ detail: '转交销售失败' });
    }
  });

  // Delete inquiry
  router.delete('/api/admin/inquiries/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = param(req, 'id');
      const inquiry = await prisma.inquiry.findUnique({ where: { id }, select: { id: true } });
      if (!inquiry) {
        res.status(404).json({ detail: '询价单不存在' });
        return;
      }
      await prisma.$transaction([
        prisma.notification.deleteMany({ where: { type: 'inquiry', relatedId: id } }),
        prisma.inquiry.delete({ where: { id } }),
      ]);
      res.json({ ok: true });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ detail: '询价单不存在' });
        return;
      }
      logger.error({ err }, '[Inquiries] Delete error');
      res.status(500).json({ detail: '删除询价单失败' });
    }
  });

  return router;
}
