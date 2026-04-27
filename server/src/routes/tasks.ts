import { Router, Response } from "express";
import type { JobType } from "bullmq";
import multer from "multer";
import { basename, join, extname } from "path";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, rmSync } from "fs";
import { prisma } from "../lib/prisma.js";
import { conversionQueue, conversionQueueConfig } from "../lib/queue.js";
import { config } from "../lib/config.js";
import { cacheDelByPrefix } from "../lib/cache.js";
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

function numericQuery(value: unknown, fallback: number, min: number, max: number) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function numericProgress(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function bodyStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean).slice(0, limit);
}

function normalizeCleanType(value: unknown): "completed" | "failed" {
  return String(value || "").toLowerCase() === "failed" ? "failed" : "completed";
}

function isPreviewRebuildJob(job: { name?: string; data?: any }) {
  return job.name === "convert" && Boolean(job.data?.rebuildReason);
}

const queueStates = ["waiting", "active", "delayed", "completed", "failed", "paused", "prioritized", "waiting-children"] as const;
type QueueStateFilter = typeof queueStates[number] | "all";

function normalizeQueueState(value: unknown): QueueStateFilter {
  const raw = String(Array.isArray(value) ? value[0] : value || "all").toLowerCase();
  return raw !== "all" && queueStates.includes(raw as typeof queueStates[number])
    ? raw as typeof queueStates[number]
    : "all";
}

function activeDurationMs(state: string, processedOn?: number | null) {
  if (state !== "active" || !processedOn) return 0;
  return Math.max(0, Date.now() - processedOn);
}

// Admin: inspect conversion queue health and recent jobs.
router.get("/api/tasks/conversion-queue", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const limit = numericQuery(req.query.limit, 12, 1, 50);
    const stateFilter = normalizeQueueState(req.query.state);
    const counts = await conversionQueue.getJobCounts("waiting", "active", "delayed", "completed", "failed", "paused");
    const completedModelCount = await prisma.model.count({ where: { status: "completed" } }).catch(() => counts.completed || 0);
    const queueCounts = {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      delayed: counts.delayed || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      paused: counts.paused || 0,
      prioritized: counts.prioritized || 0,
      "waiting-children": counts["waiting-children"] || 0,
    };
    const jobStates: JobType[] = stateFilter === "all"
      ? ["active", "waiting", "delayed", "failed", "completed"]
      : [stateFilter];
    const jobs = await conversionQueue.getJobs(jobStates, 0, limit - 1);
    const items = await Promise.all(jobs.map(async (job) => {
      const state = await job.getState();
      const activeMs = activeDurationMs(state, job.processedOn);
      return {
        id: String(job.id),
        name: job.name,
        state,
        progress: numericProgress(job.progress),
        model_id: job.data?.modelId || null,
        model_name: job.data?.originalName || job.data?.modelId || "未命名模型",
        original_name: job.data?.originalName || null,
        ext: job.data?.ext || null,
        rebuild_reason: job.data?.rebuildReason || null,
        attempts_made: job.attemptsMade,
        failed_reason: state === "failed" ? job.failedReason || null : null,
        timestamp: job.timestamp || null,
        processed_on: job.processedOn || null,
        finished_on: job.finishedOn || null,
        active_ms: activeMs,
        is_stale: activeMs > conversionQueueConfig.staleMs,
      };
    }));

    res.json({
      counts: {
        waiting: queueCounts.waiting,
        active: queueCounts.active,
        delayed: queueCounts.delayed,
        completed: completedModelCount,
        failed: queueCounts.failed,
        paused: queueCounts.paused,
      },
      queue_counts: queueCounts,
      items,
      total: stateFilter === "all" ? items.length : queueCounts[stateFilter] || items.length,
      filter_state: stateFilter,
      generated_at: new Date().toISOString(),
    });
  } catch {
    res.status(500).json({ detail: "获取转换队列失败" });
  }
});

// Admin: retry failed conversion jobs without rebuilding job payloads manually.
router.post("/api/tasks/conversion-queue/retry-failed", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const limit = numericQuery(req.body?.limit, 25, 1, 100);
    const requestedIds = bodyStringArray(req.body?.jobIds, limit);
    const jobs = requestedIds.length ? [] : await conversionQueue.getJobs(["failed"], 0, limit - 1);
    for (const id of requestedIds) {
      const job = await conversionQueue.getJob(id);
      if (job) jobs.push(job);
    }

    let retried = 0;
    let skipped = 0;
    let failed = 0;
    const items: Array<{ id: string; model_id: string | null; status: "retried" | "skipped" | "failed"; reason?: string }> = [];

    for (const job of jobs) {
      const state = await job.getState();
      if (state !== "failed") {
        skipped++;
        items.push({ id: String(job.id), model_id: job.data?.modelId || null, status: "skipped", reason: `当前状态为 ${state}` });
        continue;
      }

      try {
        await job.retry("failed");
        if (prisma && job.data?.modelId) {
          await prisma.model.update({ where: { id: job.data.modelId }, data: { status: "queued" } }).catch(() => {});
        }
        retried++;
        items.push({ id: String(job.id), model_id: job.data?.modelId || null, status: "retried" });
      } catch (err: any) {
        failed++;
        items.push({ id: String(job.id), model_id: job.data?.modelId || null, status: "failed", reason: err?.message || "重试失败" });
      }
    }

    if (retried > 0) await cacheDelByPrefix("cache:models:");
    res.json({ retried, skipped, failed, items });
  } catch (err: any) {
    res.status(500).json({ detail: err?.message || "重试失败任务失败" });
  }
});

// Admin: cancel queued preview rebuild jobs. Active jobs are not force-killed so
// the converter cannot leave partially written preview assets behind.
router.post("/api/tasks/conversion-queue/cancel-rebuilds", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const limit = numericQuery(req.body?.limit, 1000, 1, 10000);
    const jobStates: JobType[] = ["waiting", "delayed", "prioritized", "waiting-children", "paused"];
    const jobs = await conversionQueue.getJobs(jobStates, 0, limit - 1);
    const activeJobs = await conversionQueue.getJobs(["active"], 0, Math.min(limit, 1000) - 1);
    const active = activeJobs.filter(isPreviewRebuildJob).length;

    let cancelled = 0;
    let skipped = 0;
    let failed = 0;
    const modelIds: string[] = [];
    const items: Array<{ id: string; model_id: string | null; status: "cancelled" | "skipped" | "failed"; reason?: string }> = [];

    for (const job of jobs) {
      if (!isPreviewRebuildJob(job)) {
        skipped++;
        continue;
      }

      const state = await job.getState();
      if (state === "active") {
        skipped++;
        items.push({ id: String(job.id), model_id: job.data?.modelId || null, status: "skipped", reason: "任务正在处理，无法安全取消" });
        continue;
      }

      try {
        await job.remove();
        cancelled++;
        if (job.data?.modelId) modelIds.push(String(job.data.modelId));
        items.push({ id: String(job.id), model_id: job.data?.modelId || null, status: "cancelled" });
      } catch (err: any) {
        failed++;
        items.push({ id: String(job.id), model_id: job.data?.modelId || null, status: "failed", reason: err?.message || "取消失败" });
      }
    }

    if (modelIds.length > 0 && prisma) {
      await prisma.model.updateMany({
        where: { id: { in: Array.from(new Set(modelIds)) }, status: "queued" },
        data: { status: "completed" },
      }).catch(() => {});
      await cacheDelByPrefix("cache:models:");
    }

    res.json({ cancelled, skipped, failed, active, items });
  } catch (err: any) {
    res.status(500).json({ detail: err?.message || "取消预览重建任务失败" });
  }
});

// Admin: clean old queue records. This only removes BullMQ job records, not model files.
router.post("/api/tasks/conversion-queue/clean", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const type = normalizeCleanType(req.body?.type);
    const graceMs = numericQuery(req.body?.graceMs, 0, 0, 30 * 24 * 60 * 60 * 1000);
    const limit = numericQuery(req.body?.limit, 100, 1, 1000);
    const jobIds = await conversionQueue.clean(graceMs, limit, type);
    res.json({ type, cleaned: jobIds.length, job_ids: jobIds });
  } catch (err: any) {
    res.status(500).json({ detail: err?.message || "清理转换队列失败" });
  }
});

// Admin: inspect one conversion job with logs and failure details.
router.get("/api/tasks/conversion-queue/:id", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const taskId = param(req, "id");
  try {
    const job = await conversionQueue.getJob(taskId);
    if (!job) {
      res.status(404).json({ detail: "任务不存在" });
      return;
    }

    const state = await job.getState();
    const activeMs = activeDurationMs(state, job.processedOn);
    const logLimit = numericQuery(req.query.logLimit, 100, 1, 500);
    const logResult = await conversionQueue.getJobLogs(String(job.id), 0, logLimit - 1, true).catch(() => ({ logs: [], count: 0 }));
    const sourcePath = typeof job.data?.filePath === "string" ? job.data.filePath : null;
    const model = prisma && job.data?.modelId
      ? await prisma.model.findUnique({
          where: { id: job.data.modelId },
          select: {
            id: true,
            name: true,
            status: true,
            originalName: true,
            format: true,
            gltfUrl: true,
            thumbnailUrl: true,
            updatedAt: true,
          },
        }).catch(() => null)
      : null;

    res.json({
      id: String(job.id),
      name: job.name,
      state,
      progress: numericProgress(job.progress),
      attempts_made: job.attemptsMade,
      failed_reason: state === "failed" ? job.failedReason || null : null,
      stacktrace: Array.isArray(job.stacktrace) ? job.stacktrace : [],
      timestamp: job.timestamp || null,
      processed_on: job.processedOn || null,
      finished_on: job.finishedOn || null,
      active_ms: activeMs,
      is_stale: activeMs > conversionQueueConfig.staleMs,
      model_id: job.data?.modelId || null,
      model,
      data: {
        model_id: job.data?.modelId || null,
        original_name: job.data?.originalName || null,
        ext: job.data?.ext || null,
        preserve_source: Boolean(job.data?.preserveSource),
        rebuild_reason: job.data?.rebuildReason || null,
        source_path: sourcePath,
        source_name: sourcePath ? basename(sourcePath) : null,
        source_exists: sourcePath ? existsSync(sourcePath) : null,
      },
      result: job.returnvalue || null,
      logs: logResult.logs,
      log_count: logResult.count,
    });
  } catch (err: any) {
    res.status(500).json({ detail: err?.message || "获取转换任务详情失败" });
  }
});

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
