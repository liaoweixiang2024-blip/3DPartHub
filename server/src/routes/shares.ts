import { Router, Response } from "express";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";

const router = Router();

function param(req: { params: Record<string, string | string[]> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

// Generate share link
router.post("/api/models/:id/share", authMiddleware, async (req: AuthRequest, res: Response) => {
  const modelId = param(req, "id");
  const { password, expiresInHours } = req.body;

  try {
    const model = await prisma.model.findUnique({ where: { id: modelId } });
    if (!model) {
      res.status(404).json({ detail: "模型不存在" });
      return;
    }

    const token = randomUUID().replace(/-/g, "");
    const expiresAt = expiresInHours
      ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
      : null;

    const shareLink = await prisma.shareLink.create({
      data: {
        modelId,
        token,
        password: password || null,
        expiresAt,
        createdById: req.user!.userId,
      },
    });

    res.json({
      id: shareLink.id,
      token: shareLink.token,
      url: `/share/${shareLink.token}`,
      expiresAt: shareLink.expiresAt,
      hasPassword: !!shareLink.password,
    });
  } catch {
    res.status(500).json({ detail: "生成分享链接失败" });
  }
});

// Access shared model (no auth required)
router.get("/api/share/:token", async (req, res: Response) => {
  const { token } = req.params;
  const { password } = req.query;

  try {
    const share = await prisma.shareLink.findUnique({ where: { token } });
    if (!share) {
      res.status(404).json({ detail: "分享链接不存在" });
      return;
    }

    if (share.expiresAt && share.expiresAt < new Date()) {
      res.status(410).json({ detail: "分享链接已过期" });
      return;
    }

    if (share.password && share.password !== password) {
      res.status(403).json({ detail: "密码错误" });
      return;
    }

    const model = await prisma.model.findUnique({
      where: { id: share.modelId },
      select: {
        id: true, name: true, originalName: true, format: true,
        gltfUrl: true, thumbnailUrl: true, gltfSize: true, originalSize: true,
        description: true, category: true, dimensions: true,
      },
    });

    if (!model) {
      res.status(404).json({ detail: "模型不存在" });
      return;
    }

    res.json({ model, shareInfo: { expiresAt: share.expiresAt } });
  } catch {
    res.status(500).json({ detail: "访问失败" });
  }
});

// List user's share links for a model
router.get("/api/models/:id/shares", authMiddleware, async (req: AuthRequest, res: Response) => {
  const modelId = param(req, "id");
  try {
    const shares = await prisma.shareLink.findMany({
      where: { modelId, createdById: req.user!.userId },
      orderBy: { createdAt: "desc" },
    });
    res.json(shares);
  } catch {
    res.status(500).json({ detail: "获取分享列表失败" });
  }
});

// Revoke share link
router.delete("/api/shares/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const id = param(req, "id");
  try {
    const share = await prisma.shareLink.findUnique({ where: { id } });
    if (!share) {
      res.status(404).json({ detail: "分享链接不存在" });
      return;
    }
    if (share.createdById !== req.user!.userId) {
      res.status(403).json({ detail: "无权操作" });
      return;
    }
    await prisma.shareLink.delete({ where: { id } });
    res.json({ message: "分享链接已撤销" });
  } catch {
    res.status(500).json({ detail: "撤销失败" });
  }
});

export default router;
