import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { NextFunction, Router, Response } from 'express';
import multer from 'multer';
import { sendAcceleratedFile } from '../../lib/acceleratedDownload.js';
import { getBusinessConfig } from '../../lib/businessConfig.js';
import { config } from '../../lib/config.js';
import { createProtectedResourceToken, verifyProtectedResourceToken } from '../../lib/downloadTokenStore.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { requestSiteUrl } from '../../lib/requestSiteUrl.js';
import { optionalString } from '../../lib/requestValidation.js';
import {
  DEMAND_DUPLICATE_WINDOW_MS,
  MESSAGE_DUPLICATE_WINDOW_MS,
  cleanUserText,
  duplicateSince,
  stableStringify,
} from '../../lib/submissionGuards.js';
import { ticketAttachmentExts, ticketAttachmentMaxBytes, ticketAttachmentMaxSizeMb } from '../../lib/uploadLimits.js';
import { authMiddleware, verifyRequestToken, type AuthRequest } from '../../middleware/auth.js';
import {
  conversationAttachmentLimiter,
  conversationMessageLimiter,
  demandSubmissionLimiter,
} from '../../middleware/security.js';
import { createNotification } from '../notifications.js';
import { param } from './common.js';

function inquiryCode(id: string) {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

function createInquiryAttachmentUpload(maxBytes: number, allowedExts: string[]) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = join(process.cwd(), config.staticDir, 'inquiry-attachments');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        cb(null, `${randomUUID().slice(0, 12)}${ext}`);
      },
    }),
    limits: { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      if (!ext) {
        cb(new Error('文件必须包含扩展名'));
        return;
      }
      // 强制扩展名白名单（复用 ticketAttachmentExts，默认仅图片），杜绝 .html/.svg 等可执行类型
      if (!allowedExts.includes(ext)) {
        cb(new Error(`不支持的附件类型，仅支持：${allowedExts.join('、')}`));
        return;
      }
      cb(null, true);
    },
  });
}

async function inquiryAttachmentUpload(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { uploadPolicy } = await getBusinessConfig();
    const maxMb = ticketAttachmentMaxSizeMb(uploadPolicy);
    const allowedExts = ticketAttachmentExts(uploadPolicy);
    createInquiryAttachmentUpload(ticketAttachmentMaxBytes(uploadPolicy), allowedExts).single('file')(
      req,
      res,
      (err) => {
        if (!err) {
          next();
          return;
        }
        if ((err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ detail: `附件不能超过 ${maxMb}MB` });
          return;
        }
        // fileFilter 拒绝（扩展名不在白名单）等客户端可纠正的错误，返回 400 + 友好提示
        res.status(400).json({ detail: err instanceof Error ? err.message : '附件校验失败' });
      },
    );
  } catch (err) {
    next(err);
  }
}

type NormalizedCreateInquiryItem = {
  productId: string | null;
  productName: string;
  modelNo: string | null;
  specs: Record<string, string> | null;
  unit: string;
  qty: number;
  remark: string | null;
};

function normalizeSpecs(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [cleanUserText(key, 80), cleanUserText(item, 300)] as const)
    .filter(([key, item]) => key && item)
    .slice(0, 80);
  return entries.length ? Object.fromEntries(entries) : null;
}

function inquiryItemSignature(items: NormalizedCreateInquiryItem[]) {
  return stableStringify(
    items
      .map((item) => ({
        productId: item.productId || '',
        productName: item.productName,
        modelNo: item.modelNo || '',
        specs: item.specs || {},
        unit: item.unit,
        qty: item.qty,
        remark: item.remark || '',
      }))
      .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
  );
}

function inquiryAttachmentFileName(attachment: string | null | undefined): string | null {
  if (!attachment) return null;
  const fileName = basename(attachment.split(/[?#]/)[0]);
  if (!fileName || fileName === '.' || fileName === '..') return null;
  return fileName;
}

function inquiryAttachmentResourceId(inquiryId: string, fileName: string): string {
  return `${inquiryId}:${fileName}`;
}

function inquiryAttachmentUrl(inquiryId: string, attachment: string | null | undefined, token?: string): string | null {
  const fileName = inquiryAttachmentFileName(attachment);
  if (!fileName) return null;
  const params = token ? `?download_token=${encodeURIComponent(token)}` : '';
  return `/api/inquiries/${encodeURIComponent(inquiryId)}/attachments/${encodeURIComponent(fileName)}${params}`;
}

function createInquiryAttachmentUrl(
  inquiryId: string,
  attachment: string | null | undefined,
  user: { userId: string; role: string },
): string | null {
  const fileName = inquiryAttachmentFileName(attachment);
  if (!fileName) return null;
  const created = createProtectedResourceToken({
    type: 'inquiry-attachment',
    resourceId: inquiryAttachmentResourceId(inquiryId, fileName),
    userId: user.userId,
    role: user.role,
    singleUse: false,
  });
  return inquiryAttachmentUrl(inquiryId, fileName, created.token);
}

function normalizeInquiryAttachmentInput(inquiryId: string, attachment: unknown): string | null {
  if (typeof attachment !== 'string' || !attachment.trim()) return null;
  if (
    !attachment.startsWith(`/api/inquiries/${inquiryId}/attachments/`) &&
    !attachment.startsWith('/static/inquiry-attachments/')
  ) {
    return null;
  }
  return inquiryAttachmentUrl(inquiryId, attachment);
}

function serializeInquiryDetail<
  T extends { id: string; messages?: Array<{ inquiryId?: string | null; attachment: string | null }> },
>(inquiry: T, user: { userId: string; role: string }): T {
  return {
    ...inquiry,
    messages: inquiry.messages
      ?.filter((message) => message.inquiryId === inquiry.id)
      .map((message) => ({
        ...message,
        attachment: createInquiryAttachmentUrl(inquiry.id, message.attachment, user),
      })),
  };
}

function inquiryDetailInclude(inquiryId: string) {
  return {
    items: true,
    messages: {
      where: { inquiryId },
      include: { user: { select: { id: true, username: true, avatar: true } } },
      orderBy: { createdAt: 'asc' as const },
    },
    user: {
      select: { id: true, username: true, email: true, avatar: true, company: true, phone: true, address: true },
    },
    salesAssignee: {
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        company: true,
        phone: true,
        department: true,
        role: true,
      },
    },
    salesAssignedBy: {
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        company: true,
        phone: true,
        department: true,
        role: true,
      },
    },
  };
}

export function createUserInquiriesRouter() {
  const router = Router();

  // Create inquiry
  router.post('/api/inquiries', authMiddleware, demandSubmissionLimiter, async (req: AuthRequest, res: Response) => {
    try {
      const { items, remark, company, contactName, contactPhone, contactAddress } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ detail: '至少需要一个询价项目' });
        return;
      }
      if (items.length > 100) {
        res.status(400).json({ detail: '单个询价单最多包含 100 个项目' });
        return;
      }
      const requestItems = items as Array<Record<string, unknown>>;

      const currentUser = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { username: true, company: true, phone: true, address: true },
      });
      const finalContactName = cleanUserText(contactName, 80) || currentUser?.username || '';
      const finalContactPhone = cleanUserText(contactPhone, 80) || currentUser?.phone || '';
      const finalContactAddress = cleanUserText(contactAddress, 300) || currentUser?.address || '';
      const finalCompany = cleanUserText(company, 120) || currentUser?.company || '';

      if (!finalContactName || !finalContactPhone || !finalContactAddress) {
        res.status(400).json({ detail: '请先完善联系人、联系电话和联系地址，便于业务人员对接询价' });
        return;
      }

      // Resolve product names/specs from productId
      const productIds = requestItems
        .map((item) => (typeof item.productId === 'string' ? item.productId : ''))
        .filter(Boolean);
      const products =
        productIds.length > 0
          ? await prisma.selectionProduct.findMany({
              where: { id: { in: productIds } },
              select: { id: true, name: true, modelNo: true, specs: true, unit: true },
            })
          : [];
      const productMap = new Map(products.map((p) => [p.id, p]));
      const normalizedItems: NormalizedCreateInquiryItem[] = requestItems.map((item) => {
        const productId = typeof item.productId === 'string' ? item.productId : '';
        const product = productId ? productMap.get(productId) : null;
        const specs = normalizeSpecs(item.specs) || normalizeSpecs(product?.specs);
        return {
          productId: productId || null,
          productName: cleanUserText(item.productName, 200) || product?.name || '未知产品',
          modelNo: cleanUserText(item.modelNo, 200) || product?.modelNo || null,
          specs,
          unit: cleanUserText(item.unit, 20) || product?.unit || '个',
          qty: Math.max(1, Math.min(999999, Math.floor(Number(item.qty) || 1))),
          remark: cleanUserText(item.remark, 500) || null,
        };
      });
      const createItems = normalizedItems.map((item) => ({
        ...item,
        specs: item.specs ?? undefined,
      }));
      const incomingSignature = inquiryItemSignature(normalizedItems);
      const recentInquiries = await prisma.inquiry.findMany({
        where: {
          userId: req.user!.userId,
          status: { not: 'cancelled' },
          createdAt: { gte: duplicateSince(DEMAND_DUPLICATE_WINDOW_MS) },
        },
        select: {
          remark: true,
          items: {
            select: {
              productId: true,
              productName: true,
              modelNo: true,
              specs: true,
              unit: true,
              qty: true,
              remark: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      const incomingRemark = cleanUserText(remark, 1000) || null;
      const duplicate = recentInquiries.some((recent) => {
        const recentSignature = inquiryItemSignature(
          recent.items.map((item) => ({
            productId: item.productId || null,
            productName: item.productName,
            modelNo: item.modelNo || null,
            specs: normalizeSpecs(item.specs),
            unit: item.unit || '个',
            qty: item.qty,
            remark: item.remark || null,
          })),
        );
        return (recent.remark || null) === incomingRemark && recentSignature === incomingSignature;
      });
      if (duplicate) {
        res.status(409).json({ detail: '类似询价单已提交，请在原询价单中补充说明' });
        return;
      }

      const inquiry = await prisma.inquiry.create({
        data: {
          userId: req.user!.userId,
          status: 'submitted',
          remark: incomingRemark,
          company: finalCompany || null,
          contactName: finalContactName,
          contactPhone: finalContactPhone,
          contactAddress: finalContactAddress,
          items: {
            create: createItems,
          },
        },
        include: { items: true, user: { select: { username: true, email: true } } },
      });

      const code = inquiryCode(inquiry.id);
      await createNotification({
        userId: inquiry.userId,
        title: '询价已提交',
        message: `您的询价单 ${code} 已提交`,
        type: 'inquiry',
        audience: 'user',
        relatedId: inquiry.id,
        siteUrl: requestSiteUrl(req),
        emailTemplateKey: 'inquiry_submitted',
        emailVars: { username: finalContactName || inquiry.user.username, inquiryNo: code },
      }).catch(() => {});

      // Notify admins
      try {
        const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
        await Promise.all(
          admins.map((admin) =>
            createNotification({
              userId: admin.id,
              title: '新询价单',
              message: `用户提交了一份新的询价单，包含 ${inquiry.items.length} 个产品`,
              type: 'inquiry',
              audience: 'admin',
              relatedId: inquiry.id,
              siteUrl: requestSiteUrl(req),
              emailTemplateKey: 'inquiry_admin_new',
              emailVars: {
                username: finalContactName || inquiry.user.username,
                inquiryNo: code,
                itemCount: inquiry.items.length,
              },
            }).catch(() => {}),
          ),
        );
      } catch (err) {
        logger.warn({ err }, '[Inquiries] Admin notification failed');
      }

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
        include: inquiryDetailInclude(id),
      });
      if (!inquiry) {
        res.status(404).json({ detail: '询价单不存在' });
        return;
      }
      if (inquiry.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
        res.status(403).json({ detail: '无权访问' });
        return;
      }
      res.json(serializeInquiryDetail(inquiry, req.user!));
    } catch (err) {
      logger.error({ err }, '[Inquiries] Get error');
      res.status(500).json({ detail: '获取询价单详情失败' });
    }
  });

  // Update inquiry items before the inquiry is finalized
  router.put('/api/inquiries/:id/items', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const id = param(req, 'id');
      const incoming: unknown[] = Array.isArray(req.body?.items) ? req.body.items : [];
      if (incoming.length === 0) {
        res.status(400).json({ detail: '至少需要保留一个询价产品' });
        return;
      }
      if (incoming.length > 100) {
        res.status(400).json({ detail: '单个询价单最多包含 100 个项目' });
        return;
      }

      const inquiry = await prisma.inquiry.findUnique({
        where: { id },
        include: { items: { select: { id: true } } },
      });
      if (!inquiry) {
        res.status(404).json({ detail: '询价单不存在' });
        return;
      }

      const isOwner = inquiry.userId === req.user!.userId;
      const isAdmin = req.user!.role === 'ADMIN';
      if (!isOwner && !isAdmin) {
        res.status(403).json({ detail: '无权操作' });
        return;
      }

      const editableStatuses = isAdmin ? ['submitted', 'quoted'] : ['draft'];
      if (!editableStatuses.includes(inquiry.status)) {
        res.status(400).json({ detail: '当前状态无法编辑询价产品' });
        return;
      }

      const existingIds = new Set(inquiry.items.map((item) => item.id));
      const seenIds = new Set<string>();
      type NormalizedInquiryItemUpdate = { id: string; qty: number; remark: string };
      const items = incoming.map((item): NormalizedInquiryItemUpdate | null => {
        const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const itemId = typeof row.id === 'string' ? row.id : '';
        if (!itemId || !existingIds.has(itemId) || seenIds.has(itemId)) {
          return null;
        }
        seenIds.add(itemId);
        const qty = Math.max(1, Math.min(999999, Math.floor(Number(row.qty) || 1)));
        const remark = typeof row.remark === 'string' ? row.remark.trim().slice(0, 500) : '';
        return { id: itemId, qty, remark };
      });

      if (items.some((item: NormalizedInquiryItemUpdate | null) => !item) || items.length !== incoming.length) {
        res.status(400).json({ detail: '询价产品数据不正确' });
        return;
      }

      const normalizedItems = items as NormalizedInquiryItemUpdate[];
      const keepIds = normalizedItems.map((item) => item.id);
      const updated = await prisma.$transaction(async (tx) => {
        await tx.inquiryItem.deleteMany({
          where: { inquiryId: id, id: { notIn: keepIds } },
        });
        await Promise.all(
          normalizedItems.map((item) =>
            tx.inquiryItem.update({
              where: { id: item.id },
              data: { qty: item.qty, remark: item.remark || null },
            }),
          ),
        );
        const updatedInquiry = await tx.inquiry.update({
          where: { id },
          data: { updatedAt: new Date() },
          include: inquiryDetailInclude(id),
        });
        return updatedInquiry;
      });

      res.json(serializeInquiryDetail(updated, req.user!));
    } catch (err) {
      logger.error({ err }, '[Inquiries] Update items error');
      res.status(500).json({ detail: '更新询价产品失败' });
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

  router.get('/api/inquiries/:id/attachments/:file', async (req, res: Response) => {
    const inquiryId = param(req, 'id');
    const fileName = basename(String(req.params.file || ''));
    if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(fileName)) {
      res.status(400).json({ detail: '附件参数无效' });
      return;
    }

    const queryToken = optionalString(req.query.download_token, { maxLength: 160 });
    const tokenPayload = queryToken
      ? verifyProtectedResourceToken(queryToken, 'inquiry-attachment', inquiryAttachmentResourceId(inquiryId, fileName))
      : null;
    if (queryToken && !tokenPayload) {
      res.status(401).json({ detail: '附件访问令牌无效或已过期' });
      return;
    }

    const user = tokenPayload || verifyRequestToken(req);
    if (!user) {
      res.status(401).json({ detail: '需要登录后才能查看附件' });
      return;
    }

    try {
      const inquiry = await prisma.inquiry.findUnique({ where: { id: inquiryId } });
      if (!inquiry) {
        res.status(404).json({ detail: '询价单不存在' });
        return;
      }
      if (inquiry.userId !== user.userId && user.role !== 'ADMIN') {
        res.status(403).json({ detail: '无权访问' });
        return;
      }

      const filePath = join(process.cwd(), config.staticDir, 'inquiry-attachments', fileName);
      if (!existsSync(filePath)) {
        res.status(404).json({ detail: '附件不存在' });
        return;
      }

      sendAcceleratedFile(req, res, {
        filePath,
        fileName,
        disposition: 'inline',
        cacheControl: 'private, max-age=300',
      });
    } catch (err) {
      logger.error({ err }, '[Inquiries] Attachment read error');
      res.status(500).json({ detail: '读取附件失败' });
    }
  });

  // Send message
  router.post(
    '/api/inquiries/:id/messages',
    authMiddleware,
    conversationMessageLimiter,
    async (req: AuthRequest, res: Response) => {
      try {
        const id = param(req, 'id');
        const { content, attachment } = req.body;
        const normalizedAttachment = normalizeInquiryAttachmentInput(id, attachment);
        const cleanContent = cleanUserText(content);
        if (!cleanContent && !normalizedAttachment) {
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
        if (['cancelled', 'draft', 'rejected'].includes(inquiry.status)) {
          res.status(400).json({ detail: '当前询价已结束，无法发送消息' });
          return;
        }

        const isAdmin = req.user!.role === 'ADMIN';
        if (cleanContent && !normalizedAttachment) {
          const duplicateMessage = await prisma.inquiryMessage.findFirst({
            where: {
              inquiryId: id,
              userId: req.user!.userId,
              content: cleanContent,
              createdAt: { gte: duplicateSince(MESSAGE_DUPLICATE_WINDOW_MS) },
            },
            select: { id: true },
          });
          if (duplicateMessage) {
            res.status(409).json({ detail: '相同内容刚刚已发送，请勿重复提交' });
            return;
          }
        }
        const message = await prisma.inquiryMessage.create({
          data: {
            inquiryId: id,
            userId: req.user!.userId,
            content: cleanContent,
            attachment: normalizedAttachment,
            isAdmin,
          },
          include: { user: { select: { id: true, username: true, avatar: true } } },
        });

        // Notify the other party
        try {
          const targetUserId = isAdmin ? inquiry.userId : null;
          if (isAdmin) {
            const code = inquiryCode(id);
            await createNotification({
              userId: targetUserId!,
              title: '询价单回复',
              message: `管理员回复了您的询价单 ${code}`,
              type: 'inquiry',
              audience: 'user',
              relatedId: id,
              siteUrl: requestSiteUrl(req),
              emailTemplateKey: 'inquiry_replied',
              emailVars: { inquiryNo: code, replyPreview: cleanContent.slice(0, 120) },
            });
          } else {
            const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
            const code = inquiryCode(id);
            for (const admin of admins) {
              await createNotification({
                userId: admin.id,
                title: '询价单新回复',
                message: `用户回复了询价单 ${code}`,
                type: 'inquiry',
                audience: 'admin',
                relatedId: id,
                siteUrl: requestSiteUrl(req),
                emailTemplateKey: 'inquiry_admin_replied',
                emailVars: {
                  username: message.user.username,
                  inquiryNo: code,
                  replyPreview: cleanContent.slice(0, 120),
                },
              });
            }
          }
        } catch (err) {
          logger.warn({ err }, '[Inquiries] User notification failed');
        }

        res.json({
          ...message,
          attachment: createInquiryAttachmentUrl(id, message.attachment, req.user!),
        });
      } catch (err) {
        logger.error({ err }, '[Inquiries] Message error');
        res.status(500).json({ detail: '发送消息失败' });
      }
    },
  );

  router.post(
    '/api/inquiries/:id/messages/upload',
    authMiddleware,
    conversationAttachmentLimiter,
    inquiryAttachmentUpload,
    async (req: AuthRequest, res: Response) => {
      const id = param(req, 'id');
      try {
        if (!req.file) {
          res.status(400).json({ detail: '请选择文件' });
          return;
        }
        const { uploadPolicy } = await getBusinessConfig();
        const maxMb = ticketAttachmentMaxSizeMb(uploadPolicy);
        const maxBytes = ticketAttachmentMaxBytes(uploadPolicy);
        const allowed = ticketAttachmentExts(uploadPolicy);
        const ext = extname(req.file.originalname).toLowerCase();
        if (req.file.size > maxBytes || !allowed.includes(ext)) {
          rmSync(req.file.path, { force: true });
          res.status(400).json({ detail: `附件仅支持 ${allowed.join('/')}，最大 ${maxMb}MB` });
          return;
        }

        const inquiry = await prisma.inquiry.findUnique({ where: { id } });
        if (!inquiry) {
          rmSync(req.file.path, { force: true });
          res.status(404).json({ detail: '询价单不存在' });
          return;
        }
        if (inquiry.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
          rmSync(req.file.path, { force: true });
          res.status(403).json({ detail: '无权操作' });
          return;
        }
        if (['cancelled', 'draft', 'rejected'].includes(inquiry.status)) {
          rmSync(req.file.path, { force: true });
          res.status(400).json({ detail: '当前询价已结束，无法上传附件' });
          return;
        }

        const attachmentUrl = createInquiryAttachmentUrl(id, req.file.filename, req.user!);
        res.json({ url: attachmentUrl });
      } catch (err) {
        logger.error({ err }, '[Inquiries] Upload attachment error');
        if (req.file?.path) rmSync(req.file.path, { force: true });
        res.status(500).json({ detail: '上传失败' });
      }
    },
  );

  return router;
}
