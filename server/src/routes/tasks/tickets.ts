import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { NextFunction, Router, Response } from 'express';
import multer from 'multer';
import { sendAcceleratedFile } from '../../lib/acceleratedDownload.js';
import { getBusinessConfig, labelFor } from '../../lib/businessConfig.js';
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
  lowQualitySubmissionReason,
} from '../../lib/submissionGuards.js';
import { ticketAttachmentExts, ticketAttachmentMaxBytes, ticketAttachmentMaxSizeMb } from '../../lib/uploadLimits.js';
import { authMiddleware, verifyRequestToken, type AuthRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import {
  conversationAttachmentLimiter,
  conversationMessageLimiter,
  demandSubmissionLimiter,
} from '../../middleware/security.js';
import { createNotification } from '../notifications.js';

function createTicketAttachmentUpload(maxBytes: number) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = join(process.cwd(), config.staticDir, 'ticket-attachments');
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
      if (ext) cb(null, true);
      else cb(new Error('文件必须包含扩展名'));
    },
  });
}

async function ticketAttachmentUpload(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { uploadPolicy } = await getBusinessConfig();
    const maxMb = ticketAttachmentMaxSizeMb(uploadPolicy);
    createTicketAttachmentUpload(ticketAttachmentMaxBytes(uploadPolicy)).single('file')(req, res, (err) => {
      if (!err) {
        next();
        return;
      }
      if ((err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ detail: `附件不能超过 ${maxMb}MB` });
        return;
      }
      next(err);
    });
  } catch (err) {
    next(err);
  }
}

function param(req: { params: Record<string, string | string[]> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

function ticketAttachmentFileName(attachment: string | null | undefined): string | null {
  if (!attachment) return null;
  const fileName = basename(attachment.split(/[?#]/)[0]);
  if (!fileName || fileName === '.' || fileName === '..') return null;
  return fileName;
}

function ticketAttachmentResourceId(ticketId: string, fileName: string): string {
  return `${ticketId}:${fileName}`;
}

function ticketAttachmentUrl(ticketId: string, attachment: string | null | undefined, token?: string): string | null {
  const fileName = ticketAttachmentFileName(attachment);
  if (!fileName) return null;
  const params = token ? `?download_token=${encodeURIComponent(token)}` : '';
  return `/api/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(fileName)}${params}`;
}

function createTicketAttachmentUrl(
  ticketId: string,
  attachment: string | null | undefined,
  user: { userId: string; role: string },
): string | null {
  const fileName = ticketAttachmentFileName(attachment);
  if (!fileName) return null;
  const created = createProtectedResourceToken({
    type: 'ticket-attachment',
    resourceId: ticketAttachmentResourceId(ticketId, fileName),
    userId: user.userId,
    role: user.role,
    singleUse: false,
  });
  return ticketAttachmentUrl(ticketId, fileName, created.token);
}

function normalizeTicketAttachmentInput(ticketId: string, attachment: unknown): string | null {
  if (typeof attachment !== 'string' || !attachment.trim()) return null;
  if (
    !attachment.startsWith(`/api/tickets/${ticketId}/attachments/`) &&
    !attachment.startsWith('/static/ticket-attachments/')
  ) {
    return null;
  }
  return ticketAttachmentUrl(ticketId, attachment);
}

export function createSupportTicketRouter() {
  const router = Router();

  // Create support ticket
  router.post('/api/tasks', authMiddleware, demandSubmissionLimiter, async (req: AuthRequest, res: Response) => {
    const { basePart, classification, description } = req.body;
    const cleanDescription = cleanUserText(description);
    const cleanBasePart = cleanUserText(basePart, 120);

    if (!cleanDescription) {
      res.status(400).json({ detail: '问题描述不能为空' });
      return;
    }
    const qualityReason = lowQualitySubmissionReason(cleanDescription, '问题描述');
    if (qualityReason) {
      res.status(400).json({ detail: qualityReason });
      return;
    }

    try {
      const { ticketClassifications } = await getBusinessConfig();
      const enabledClassifications = ticketClassifications
        .filter((item) => item.enabled !== false)
        .map((item) => item.value);
      const normalizedClassification = enabledClassifications.includes(classification)
        ? classification
        : enabledClassifications[0] || 'dimension';
      const duplicate = await prisma.supportTicket.findFirst({
        where: {
          userId: req.user!.userId,
          basePart: cleanBasePart || null,
          classification: normalizedClassification,
          description: cleanDescription,
          createdAt: { gte: duplicateSince(DEMAND_DUPLICATE_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (duplicate) {
        res.status(409).json({ detail: '类似需求已提交，请在原工单中补充说明' });
        return;
      }
      const ticket = await prisma.supportTicket.create({
        data: {
          userId: req.user!.userId,
          basePart: cleanBasePart || null,
          classification: normalizedClassification,
          description: cleanDescription,
        },
        include: { user: { select: { username: true, email: true } } },
      });
      const ticketTitle = labelFor(ticketClassifications, ticket.classification);
      await createNotification({
        userId: ticket.userId,
        title: '工单已创建',
        message: `您的工单「${ticketTitle}」已进入处理队列`,
        type: 'ticket',
        audience: 'user',
        relatedId: ticket.id,
        siteUrl: requestSiteUrl(req),
        emailTemplateKey: 'ticket_created',
        emailVars: { username: ticket.user.username, ticketTitle },
      }).catch(() => {});
      try {
        const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
        await Promise.all(
          admins.map((admin) =>
            createNotification({
              userId: admin.id,
              title: '新工单',
              message: `${ticket.user.username} 提交了新的工单「${ticketTitle}」`,
              type: 'ticket',
              audience: 'admin',
              relatedId: ticket.id,
              siteUrl: requestSiteUrl(req),
              emailTemplateKey: 'ticket_admin_new',
              emailVars: { username: ticket.user.username, ticketTitle },
            }).catch(() => {}),
          ),
        );
      } catch {
        /* best-effort admin notification */
      }
      res.json({ id: ticket.id, status: ticket.status });
    } catch {
      res.status(500).json({ detail: '创建工单失败' });
    }
  });

  // User: list own support tickets
  router.get('/api/my-tickets', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      if (!prisma) {
        res.json([]);
        return;
      }
      const { pageSizePolicy } = await getBusinessConfig();
      const ticketListMax = Math.max(1, Math.floor(Number(pageSizePolicy.ticketListMax) || 50));
      const tickets = await prisma.supportTicket.findMany({
        where: { userId: req.user!.userId },
        orderBy: { createdAt: 'desc' },
        take: ticketListMax,
      });
      res.json(tickets);
    } catch {
      res.json([]);
    }
  });

  // Admin: list all support tickets
  router.get('/api/tickets', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
    try {
      if (!prisma) {
        res.json([]);
        return;
      }
      const { pageSizePolicy } = await getBusinessConfig();
      const ticketListMax = Math.max(1, Math.floor(Number(pageSizePolicy.ticketListMax) || 50));
      const page = Math.max(1, Number(req.query.page) || 1);
      const skip = (page - 1) * ticketListMax;
      const tickets = await prisma.supportTicket.findMany({
        orderBy: { createdAt: 'desc' },
        take: ticketListMax,
        skip,
        include: { user: { select: { username: true, email: true, avatar: true } } },
      });
      res.json(tickets);
    } catch {
      res.json([]);
    }
  });

  // Get single ticket (owner or admin)
  router.get('/api/tickets/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    const ticketId = param(req, 'id');
    try {
      if (!prisma) {
        res.status(404).json({ detail: '工单不存在' });
        return;
      }
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        include: { user: { select: { username: true, email: true, avatar: true } } },
      });
      if (!ticket) {
        res.status(404).json({ detail: '工单不存在' });
        return;
      }
      if (ticket.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
        res.status(403).json({ detail: '无权访问' });
        return;
      }
      res.json(ticket);
    } catch {
      res.status(500).json({ detail: '获取工单失败' });
    }
  });

  // Admin: update ticket status
  router.put('/api/tickets/:id', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
    try {
      if (!prisma) {
        res.status(500).json({ error: 'DB unavailable' });
        return;
      }
      const { status } = req.body;
      const { ticketStatuses, ticketClassifications } = await getBusinessConfig();
      if (!ticketStatuses.some((item) => item.value === status)) {
        res.status(400).json({ detail: '无效状态' });
        return;
      }
      const ticket = await prisma.supportTicket.update({
        where: { id: req.params.id as string },
        data: { status },
        include: { user: { select: { username: true } } },
      });
      // Notify user about status change
      await createNotification({
        userId: ticket.userId,
        title: '工单状态更新',
        message: `您的工单「${labelFor(ticketClassifications, ticket.classification)}」状态已更新为「${labelFor(ticketStatuses, status)}」`,
        type: 'ticket',
        audience: 'user',
        relatedId: ticket.id,
        siteUrl: requestSiteUrl(req),
        emailTemplateKey: 'ticket_status_changed',
        emailVars: {
          username: ticket.user.username,
          ticketTitle: labelFor(ticketClassifications, ticket.classification),
          statusLabel: labelFor(ticketStatuses, status),
        },
      }).catch(() => {});
      res.json(ticket);
    } catch {
      res.status(500).json({ error: '更新失败' });
    }
  });

  // Admin: delete ticket and its messages
  router.delete('/api/tickets/:id', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
    const ticketId = param(req, 'id');
    try {
      if (!prisma) {
        res.status(500).json({ detail: 'DB unavailable' });
        return;
      }
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        include: { messages: { select: { attachment: true } } },
      });
      if (!ticket) {
        res.status(404).json({ detail: '工单不存在' });
        return;
      }

      const attachmentNames = Array.from(
        new Set(
          ticket.messages
            .map((message: { attachment: string | null }) => ticketAttachmentFileName(message.attachment))
            .filter((fileName): fileName is string => Boolean(fileName)),
        ),
      );

      await prisma.$transaction([
        prisma.notification.deleteMany({ where: { type: 'ticket', relatedId: ticketId } }),
        prisma.supportTicket.delete({ where: { id: ticketId } }),
      ]);

      for (const fileName of attachmentNames) {
        const filePath = join(process.cwd(), config.staticDir, 'ticket-attachments', fileName);
        try {
          rmSync(filePath, { force: true });
        } catch (err) {
          logger.warn({ err, filePath }, '[Tickets] Attachment cleanup failed');
        }
      }

      res.json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'P2025') {
        res.status(404).json({ detail: '工单不存在' });
        return;
      }
      res.status(500).json({ detail: '删除工单失败' });
    }
  });

  // Get ticket messages (ticket owner or admin)
  router.get('/api/tickets/:id/messages', authMiddleware, async (req: AuthRequest, res: Response) => {
    const ticketId = param(req, 'id');
    try {
      if (!prisma) {
        res.json([]);
        return;
      }
      const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
      if (!ticket) {
        res.status(404).json({ detail: '工单不存在' });
        return;
      }
      if (ticket.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
        res.status(403).json({ detail: '无权操作' });
        return;
      }
      const messages = await prisma.ticketMessage.findMany({
        where: { ticketId },
        include: { user: { select: { id: true, username: true, avatar: true } } },
        orderBy: { createdAt: 'asc' },
      });
      res.json(
        messages.map((message) => ({
          ...message,
          attachment: createTicketAttachmentUrl(ticketId, message.attachment, req.user!),
        })),
      );
    } catch {
      res.status(500).json({ detail: '获取消息失败' });
    }
  });

  router.get('/api/tickets/:id/attachments/:file', async (req, res: Response) => {
    const ticketId = param(req, 'id');
    const fileName = basename(String(req.params.file || ''));
    if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(fileName)) {
      res.status(400).json({ detail: '附件参数无效' });
      return;
    }

    const queryToken = optionalString(req.query.download_token, { maxLength: 160 });
    const tokenPayload = queryToken
      ? verifyProtectedResourceToken(queryToken, 'ticket-attachment', ticketAttachmentResourceId(ticketId, fileName))
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
      const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
      if (!ticket) {
        res.status(404).json({ detail: '工单不存在' });
        return;
      }
      if (ticket.userId !== user.userId && user.role !== 'ADMIN') {
        res.status(403).json({ detail: '无权访问' });
        return;
      }

      const filePath = join(process.cwd(), config.staticDir, 'ticket-attachments', fileName);
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
    } catch {
      res.status(500).json({ detail: '读取附件失败' });
    }
  });

  // Send ticket message (ticket owner or admin)
  router.post(
    '/api/tickets/:id/messages',
    authMiddleware,
    conversationMessageLimiter,
    async (req: AuthRequest, res: Response) => {
      const ticketId = param(req, 'id');
      const { content, attachment } = req.body;
      const normalizedAttachment = normalizeTicketAttachmentInput(ticketId, attachment);
      const cleanContent = cleanUserText(content);
      if (!cleanContent && !normalizedAttachment) {
        res.status(400).json({ detail: '消息内容不能为空' });
        return;
      }
      try {
        if (!prisma) {
          res.status(500).json({ detail: 'DB unavailable' });
          return;
        }
        const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
        if (!ticket) {
          res.status(404).json({ detail: '工单不存在' });
          return;
        }
        if (ticket.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
          res.status(403).json({ detail: '无权操作' });
          return;
        }
        const isAdmin = req.user!.role === 'ADMIN';
        const { ticketStatuses, ticketClassifications } = await getBusinessConfig();
        const terminalStatuses = new Set(['closed', 'resolved']);
        if (terminalStatuses.has(ticket.status)) {
          res.status(400).json({ detail: '该工单已关闭，无法发送消息' });
          return;
        }
        if (cleanContent && !normalizedAttachment) {
          const duplicateMessage = await prisma.ticketMessage.findFirst({
            where: {
              ticketId,
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
        let newStatus: string | null = null;
        if (isAdmin) {
          newStatus = 'waiting_user';
        } else {
          newStatus = 'in_progress';
        }
        if (newStatus && !ticketStatuses.some((item) => item.value === newStatus)) newStatus = null;
        if (newStatus && ticket.status !== newStatus) {
          const updated = await prisma.supportTicket.updateMany({
            where: { id: ticketId, status: { notIn: [...terminalStatuses] } },
            data: { status: newStatus },
          });
          if (updated.count === 0) {
            res.status(400).json({ detail: '该工单已关闭，无法发送消息' });
            return;
          }
        }
        const message = await prisma.ticketMessage.create({
          data: {
            ticketId,
            userId: req.user!.userId,
            content: cleanContent,
            attachment: normalizedAttachment,
            isAdmin,
          },
          include: { user: { select: { id: true, username: true, avatar: true } } },
        });
        // Send notification to user when admin replies
        if (isAdmin) {
          const ticketTitle = labelFor(ticketClassifications, ticket.classification);
          await createNotification({
            userId: ticket.userId,
            title: '工单回复',
            message: `管理员回复了您的工单「${ticketTitle}」`,
            type: 'ticket',
            audience: 'user',
            relatedId: ticketId,
            siteUrl: requestSiteUrl(req),
            emailTemplateKey: 'ticket_replied',
            emailVars: { ticketTitle, replyPreview: cleanContent.slice(0, 120) },
          }).catch(() => {});
        }
        // Notify admins when user replies
        if (!isAdmin) {
          try {
            const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
            const ticketTitle = labelFor(ticketClassifications, ticket.classification);
            await Promise.all(
              admins.map((admin) =>
                createNotification({
                  userId: admin.id,
                  title: '工单新回复',
                  message: `用户回复了工单「${ticketTitle}」`,
                  type: 'ticket',
                  audience: 'admin',
                  relatedId: ticketId,
                  siteUrl: requestSiteUrl(req),
                  emailTemplateKey: 'ticket_admin_replied',
                  emailVars: {
                    username: message.user.username,
                    ticketTitle,
                    replyPreview: cleanContent.slice(0, 120),
                  },
                }).catch(() => {}),
              ),
            );
          } catch {
            /* best-effort admin notification */
          }
        }
        res.json({
          ...message,
          attachment: createTicketAttachmentUrl(ticketId, message.attachment, req.user!),
        });
      } catch {
        res.status(500).json({ detail: '发送消息失败' });
      }
    },
  );

  // Upload attachment for ticket message
  router.post(
    '/api/tickets/:id/messages/upload',
    authMiddleware,
    conversationAttachmentLimiter,
    ticketAttachmentUpload,
    async (req: AuthRequest, res: Response) => {
      const ticketId = param(req, 'id');
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
        const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
        if (!ticket) {
          rmSync(req.file.path, { force: true });
          res.status(404).json({ detail: '工单不存在' });
          return;
        }
        if (ticket.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
          rmSync(req.file.path, { force: true });
          res.status(403).json({ detail: '无权操作' });
          return;
        }
        if (['closed', 'resolved'].includes(ticket.status)) {
          rmSync(req.file.path, { force: true });
          res.status(400).json({ detail: '该工单已关闭，无法上传附件' });
          return;
        }
        const attachmentUrl = createTicketAttachmentUrl(ticketId, req.file.filename, req.user!);
        res.json({ url: attachmentUrl });
      } catch {
        if (req.file?.path) rmSync(req.file.path, { force: true });
        res.status(500).json({ detail: '上传失败' });
      }
    },
  );

  return router;
}
