import { Router, Response } from "express";
import { conversionQueue } from "../../lib/queue.js";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";

function param(req: { params: Record<string, string | string[]> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

export function createTaskStatusRouter() {
  const router = Router();

  // Get task status
  router.get("/api/tasks/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    const taskId = param(req, "id");
    try {
      const job = await conversionQueue.getJob(taskId);
      if (!job) {
        res.status(404).json({ detail: "任务不存在" });
        return;
      }
      const ownerId = typeof job.data?.userId === "string" ? job.data.userId : null;
      if (req.user!.role !== "ADMIN" && (!ownerId || ownerId !== req.user!.userId)) {
        res.status(403).json({ detail: "无权查看该任务" });
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

  return router;
}
