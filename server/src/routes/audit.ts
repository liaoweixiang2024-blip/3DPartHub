import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";

const router = Router();

// Query audit logs (admin only)
router.get("/api/audit", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const resource = req.query.resource as string | undefined;
  const action = req.query.action as string | undefined;
  const userId = req.query.userId as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 50));

  try {
    const where: any = {};
    if (resource) where.resource = resource;
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const total = await prisma.auditLog.count({ where });
    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * size,
      take: size,
    });

    // Resolve userId → username
    const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))] as string[];
    const users = userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.username]));

    const items = logs.map((l) => ({
      id: l.id,
      userId: l.userId,
      username: l.userId ? (userMap.get(l.userId) || l.userId) : null,
      action: l.action,
      resource: l.resource,
      resourceId: l.resourceId,
      details: l.details,
      createdAt: l.createdAt,
    }));

    res.json({ total, items, page, page_size: size });
  } catch {
    res.status(500).json({ detail: "查询审计日志失败" });
  }
});

export default router;
