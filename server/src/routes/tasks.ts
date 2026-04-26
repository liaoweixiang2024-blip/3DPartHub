import { Router, Response } from "express";
import multer from "multer";
import { join, extname } from "path";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, rmSync } from "fs";
import { prisma } from "../lib/prisma.js";
import { conversionQueue } from "../lib/queue.js";
import { config } from "../lib/config.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { createNotification } from "./notifications.js";
import { getBusinessConfig, labelFor, DEFAULT_UPLOAD_POLICY } from "../lib/businessConfig.js";

const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = join(process.cwd(), config.staticDir, "ticket-attachments");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      cb(null, `${randomUUID().slice(0, 12)}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".step", ".stp", ".iges", ".igs", ".stl"];
    const ext = extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("仅支持 jpg/png/gif/webp 格式"));
  },
});

const router = Router();

function param(req: { params: Record<string, string | string[]> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

// Get task status
router.get("/api/tasks/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const taskId = param(req, "id");
  try {
    const job = await conversionQueue.getJob(taskId);
    if (!job) {
      res.status(404).json({ detail: "任务不存在" });
      return;
    }

    const state = await job.getState();
    const progress = job.progress as number || 0;

    res.json({
      id: job.id,
      state,
      progress,
      modelId: job.data.modelId,
      result: state === "completed" ? {
        gltf_url: job.returnvalue?.gltfUrl,
        thumbnail_url: job.returnvalue?.thumbnailUrl,
      } : null,
      error: state === "failed" ? job.failedReason : null,
    });
  } catch {
    res.status(500).json({ detail: "获取任务状态失败" });
  }
});

// Create support ticket
router.post("/api/tasks", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { basePart, classification, description } = req.body;

  if (!description || !description.trim()) {
    res.status(400).json({ detail: "问题描述不能为空" });
    return;
  }

  try {
    const { ticketClassifications } = await getBusinessConfig();
    const enabledClassifications = ticketClassifications.filter((item) => item.enabled !== false).map((item) => item.value);
    const normalizedClassification = enabledClassifications.includes(classification) ? classification : enabledClassifications[0] || "dimension";
    const ticket = await prisma.supportTicket.create({
      data: {
        userId: req.user!.userId,
        basePart: basePart || null,
        classification: normalizedClassification,
        description: description.trim(),
      },
    });
    res.json({ id: ticket.id, status: ticket.status });
  } catch {
    res.status(500).json({ detail: "创建工单失败" });
  }
});

// List recent tasks for user
router.get("/api/tasks", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const jobs = await conversionQueue.getJobs(["active", "waiting", "completed", "failed"], 0, 20);
    const tasks = jobs
      .filter((j) => j.data?.userId === req.user!.userId)
      .map((j) => ({
        id: j.id,
        state: "unknown",
        progress: j.progress as number || 0,
        modelId: j.data?.modelId,
        createdAt: j.timestamp,
      }));
    res.json(tasks);
  } catch {
    res.json([]);
  }
});

// User: list own support tickets
router.get("/api/my-tickets", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) { res.json([]); return; }
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(tickets);
  } catch {
    res.json([]);
  }
});

// Admin: list all support tickets
router.get("/api/tickets", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) { res.json([]); return; }
    const tickets = await prisma.supportTicket.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { username: true, email: true, avatar: true } } },
    });
    res.json(tickets);
  } catch {
    res.json([]);
  }
});

// Get single ticket (owner or admin)
router.get("/api/tickets/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const ticketId = param(req, "id");
  try {
    if (!prisma) { res.status(404).json({ detail: "工单不存在" }); return; }
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { user: { select: { username: true, email: true, avatar: true } } },
    });
    if (!ticket) { res.status(404).json({ detail: "工单不存在" }); return; }
    if (ticket.userId !== req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ detail: "无权访问" }); return;
    }
    res.json(ticket);
  } catch {
    res.status(500).json({ detail: "获取工单失败" });
  }
});

// Admin: update ticket status
router.put("/api/tickets/:id", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    if (!prisma) { res.status(500).json({ error: "DB unavailable" }); return; }
    const { status } = req.body;
    const { ticketStatuses, ticketClassifications } = await getBusinessConfig();
    if (!ticketStatuses.some((item) => item.value === status)) {
      res.status(400).json({ detail: "无效状态" });
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
      title: "工单状态更新",
      message: `您的工单「${labelFor(ticketClassifications, ticket.classification)}」状态已更新为「${labelFor(ticketStatuses, status)}」`,
      type: "ticket",
      relatedId: ticket.id,
    }).catch(() => {});
    res.json(ticket);
  } catch {
    res.status(500).json({ error: "更新失败" });
  }
});

// Get ticket messages (ticket owner or admin)
router.get("/api/tickets/:id/messages", authMiddleware, async (req: AuthRequest, res: Response) => {
  const ticketId = param(req, "id");
  try {
    if (!prisma) { res.json([]); return; }
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) { res.status(404).json({ detail: "工单不存在" }); return; }
    if (ticket.userId !== req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ detail: "无权访问" }); return;
    }
    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId },
      include: { user: { select: { id: true, username: true, avatar: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json(messages);
  } catch {
    res.status(500).json({ detail: "获取消息失败" });
  }
});

// Send ticket message (ticket owner or admin)
router.post("/api/tickets/:id/messages", authMiddleware, async (req: AuthRequest, res: Response) => {
  const ticketId = param(req, "id");
  const { content, attachment } = req.body;
  if ((!content || !content.trim()) && !attachment) {
    res.status(400).json({ detail: "消息内容不能为空" }); return;
  }
  try {
    if (!prisma) { res.status(500).json({ detail: "DB unavailable" }); return; }
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) { res.status(404).json({ detail: "工单不存在" }); return; }
    if (ticket.userId !== req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ detail: "无权操作" }); return;
    }
    const isAdmin = req.user!.role === "ADMIN";
    const { ticketStatuses, ticketClassifications } = await getBusinessConfig();
    // Status flow: admin reply → waiting_user, user reply → in_progress
    let newStatus: string | null = null;
    if (isAdmin) {
      newStatus = "waiting_user"; // Admin replied, waiting for user
    } else {
      newStatus = "in_progress"; // User replied, needs admin attention
    }
    if (newStatus && !ticketStatuses.some((item) => item.value === newStatus)) newStatus = null;
    if (newStatus && ticket.status !== newStatus) {
      await prisma.supportTicket.update({ where: { id: ticketId }, data: { status: newStatus } });
    }
    const message = await prisma.ticketMessage.create({
      data: {
        ticketId,
        userId: req.user!.userId,
        content: content?.trim() || "",
        attachment: attachment || null,
        isAdmin,
      },
      include: { user: { select: { id: true, username: true, avatar: true } } },
    });
    // Send notification to user when admin replies
    if (isAdmin) {
      await createNotification({
        userId: ticket.userId,
        title: "工单回复",
        message: `管理员回复了您的工单「${labelFor(ticketClassifications, ticket.classification)}」`,
        type: "ticket",
        relatedId: ticketId,
      }).catch(() => {});
    }
    // Notify admins when user replies
    if (!isAdmin) {
      try {
        const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
        for (const admin of admins) {
          await createNotification({
            userId: admin.id,
            title: "工单新回复",
            message: `用户回复了工单「${labelFor(ticketClassifications, ticket.classification)}」`,
            type: "ticket",
            relatedId: ticketId,
          });
        }
      } catch {}
    }
    res.json(message);
  } catch {
    res.status(500).json({ detail: "发送消息失败" });
  }
});

// Upload attachment for ticket message
router.post("/api/tickets/:id/messages/upload", authMiddleware, attachmentUpload.single("file"), async (req: AuthRequest, res: Response) => {
  const ticketId = param(req, "id");
  try {
    if (!req.file) { res.status(400).json({ detail: "请选择文件" }); return; }
    const { uploadPolicy } = await getBusinessConfig();
    const maxBytes = Math.max(1, uploadPolicy.ticketAttachmentMaxSizeMb || DEFAULT_UPLOAD_POLICY.ticketAttachmentMaxSizeMb) * 1024 * 1024;
    const ext = extname(req.file.originalname).toLowerCase();
    const allowed = (uploadPolicy.ticketAttachmentExts || DEFAULT_UPLOAD_POLICY.ticketAttachmentExts).map((item) => item.toLowerCase());
    if (req.file.size > maxBytes || !allowed.includes(ext)) {
      rmSync(req.file.path, { force: true });
      res.status(400).json({ detail: `附件仅支持 ${allowed.join("/")}，最大 ${Math.round(maxBytes / 1024 / 1024)}MB` });
      return;
    }
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) { res.status(404).json({ detail: "工单不存在" }); return; }
    if (ticket.userId !== req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ detail: "无权操作" }); return;
    }
    const attachmentUrl = `/static/ticket-attachments/${req.file.filename}`;
    res.json({ url: attachmentUrl });
  } catch {
    res.status(500).json({ detail: "上传失败" });
  }
});

export default router;
