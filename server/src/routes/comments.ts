import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { getSetting } from "../lib/settings.js";
import { createNotification } from "./notifications.js";

const router = Router();

function param(req: { params: Record<string, string | string[]> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

// List comments for a model
router.get("/api/models/:id/comments", async (req, res: Response) => {
  const modelId = param(req, "id");
  try {
    const comments = await prisma.comment.findMany({
      where: { modelId },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(comments);
  } catch {
    res.status(500).json({ detail: "获取评论失败" });
  }
});

// Add comment (with optional 3D position)
router.post("/api/models/:id/comments", authMiddleware, async (req: AuthRequest, res: Response) => {
  const allowComments = await getSetting<boolean>("allow_comments");
  if (!allowComments) {
    res.status(403).json({ detail: "评论功能已关闭" });
    return;
  }
  const modelId = param(req, "id");
  const { content, position3d } = req.body;

  if (!content) {
    res.status(400).json({ detail: "评论内容不能为空" });
    return;
  }

  try {
    const comment = await prisma.comment.create({
      data: {
        modelId,
        userId: req.user!.userId,
        content,
        position3d: position3d || null,
      },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
      },
    });
    // Notify model owner about new comment (skip if commenting on own model)
    if (prisma) {
      try {
        const model = await prisma.model.findUnique({ where: { id: modelId }, select: { createdById: true, name: true } });
        if (model && model.createdById !== req.user!.userId) {
          await createNotification({
            userId: model.createdById,
            title: "新评论",
            message: `${req.user!.username || "用户"} 评论了模型「${model.name}」`,
            type: "comment",
            relatedId: modelId,
          });
        }
      } catch {}
    }
    res.json(comment);
  } catch {
    res.status(500).json({ detail: "添加评论失败" });
  }
});

// Delete comment (own comment or admin)
router.delete("/api/models/:id/comments/:commentId", authMiddleware, async (req: AuthRequest, res: Response) => {
  const commentId = param(req, "commentId");
  try {
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) {
      res.status(404).json({ detail: "评论不存在" });
      return;
    }
    // Allow if comment owner or admin
    if (comment.userId !== req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ detail: "只能删除自己的评论" });
      return;
    }
    await prisma.comment.delete({ where: { id: commentId } });
    res.json({ message: "评论已删除" });
  } catch {
    res.status(500).json({ detail: "删除评论失败" });
  }
});

export default router;
