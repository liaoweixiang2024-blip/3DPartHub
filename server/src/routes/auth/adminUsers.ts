import { Router, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { getBusinessConfig } from "../../lib/businessConfig.js";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { revokeAllTokensBefore } from "../../lib/jwt.js";

function adminGuard(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return false;
  }
  return true;
}

function routeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function queryRole(value: unknown): "ADMIN" | "EDITOR" | "VIEWER" | undefined {
  const role = Array.isArray(value) ? value[0] : value;
  return role === "ADMIN" || role === "EDITOR" || role === "VIEWER" ? role : undefined;
}

export function createAdminUsersRouter() {
  const router = Router();

  router.get("/api/admin/users/stats", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminGuard(req, res)) return;
    try {
      const [total, roleGroups, active] = await Promise.all([
        prisma.user.count(),
        prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
        prisma.user.count({
          where: {
            OR: [
              { downloads: { some: {} } },
              { favorites: { some: {} } },
            ],
          },
        }),
      ]);
      const roleCounts = Object.fromEntries(roleGroups.map((item) => [item.role, item._count._all]));
      res.json({
        total,
        admin: roleCounts.ADMIN || 0,
        editor: roleCounts.EDITOR || 0,
        viewer: roleCounts.VIEWER || 0,
        active,
      });
    } catch {
      res.status(500).json({ detail: "获取用户统计失败" });
    }
  });

  // List users (admin)
  router.get("/api/admin/users", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminGuard(req, res)) return;
    try {
      const { pageSizePolicy } = await getBusinessConfig();
      const defaultPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.adminUserDefault) || 20));
      const maxPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.adminUserMax) || 100));
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(maxPageSize, Math.max(1, Number(req.query.page_size) || defaultPageSize));
      const search = req.query.search as string | undefined;
      const role = queryRole(req.query.role);

      const where: any = {};
      if (role) where.role = role;
      if (search) {
        where.OR = [
          { username: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { company: { contains: search, mode: "insensitive" } },
        ];
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true, username: true, email: true, role: true,
            company: true, phone: true, avatar: true, createdAt: true,
            _count: { select: { downloads: true, favorites: true } },
          },
        }),
        prisma.user.count({ where }),
      ]);

      res.json({ total, items: users, page, pageSize });
    } catch {
      res.status(500).json({ detail: "获取用户列表失败" });
    }
  });

  // Update user role (admin)
  router.put("/api/admin/users/:id/role", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminGuard(req, res)) return;
    const { role } = req.body;
    const userId = routeParam(req.params.id);
    if (!userId) { res.status(400).json({ detail: "用户参数无效" }); return; }
    if (!["ADMIN", "EDITOR", "VIEWER"].includes(role)) {
      res.status(400).json({ detail: "无效的角色" });
      return;
    }
    // Prevent self-demotion
    if (userId === req.user!.userId && role !== "ADMIN") {
      res.status(400).json({ detail: "不能修改自己的角色" });
      return;
    }
    try {
      const user = await prisma.$transaction(async (tx: any) => {
        const current = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
        if (!current) throw Object.assign(new Error("NOT_FOUND"), { code: "P2025" });
        if (current.role === "ADMIN" && role !== "ADMIN") {
          const adminCount = await tx.user.count({ where: { role: "ADMIN" } });
          if (adminCount <= 1) throw Object.assign(new Error("LAST_ADMIN"), { code: "LAST_ADMIN" });
        }
        return tx.user.update({
          where: { id: userId },
          data: { role },
          select: { id: true, username: true, email: true, role: true },
        });
      });
      await revokeAllTokensBefore(userId, Math.floor(Date.now() / 1000));
      res.json({ data: user });
    } catch (err: any) {
      if (err.code === "P2025") { res.status(404).json({ detail: "用户不存在" }); return; }
      if (err.code === "LAST_ADMIN") { res.status(400).json({ detail: "不能移除最后一个管理员" }); return; }
      res.status(500).json({ detail: "修改角色失败" });
    }
  });

  // Delete user (admin)
  router.delete("/api/admin/users/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminGuard(req, res)) return;
    const userId = routeParam(req.params.id);
    if (!userId) { res.status(400).json({ detail: "用户参数无效" }); return; }
    if (userId === req.user!.userId) {
      res.status(400).json({ detail: "不能删除自己" });
      return;
    }
    try {
      const { revokeAllTokensBefore } = await import("../../lib/jwt.js");
      await revokeAllTokensBefore(userId, Math.floor(Date.now() / 1000)).catch(() => {});
      await prisma.user.delete({ where: { id: userId } });
      res.json({ message: "用户已删除" });
    } catch (err: any) {
      if (err.code === "P2025") { res.status(404).json({ detail: "用户不存在" }); return; }
      res.status(500).json({ detail: "删除用户失败" });
    }
  });

  return router;
}
