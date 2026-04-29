import { Router, Response } from "express";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";

export function createAuthProfileRouter() {
  const router = Router();

  router.get("/api/auth/profile", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { id: true, username: true, email: true, role: true, mustChangePassword: true, company: true, phone: true, avatar: true, createdAt: true },
      });
      if (!user) {
        res.status(401).json({ detail: "用户不存在，请重新登录" });
        return;
      }
      res.json(user);
    } catch {
      res.status(500).json({ detail: "获取用户信息失败" });
    }
  });

  router.put("/api/auth/profile", authMiddleware, async (req: AuthRequest, res: Response) => {
    const { username, company, phone, avatar } = req.body;

    try {
      // Check username uniqueness if changing
      if (username) {
        const existing = await prisma.user.findFirst({
          where: { username, NOT: { id: req.user!.userId } },
        });
        if (existing) {
          res.status(409).json({ detail: "用户名已被使用" });
          return;
        }
      }

      const user = await prisma.user.update({
        where: { id: req.user!.userId },
        data: {
          ...(username !== undefined && { username }),
          ...(company !== undefined && { company }),
          ...(phone !== undefined && { phone }),
          ...(avatar !== undefined && { avatar }),
        },
        select: { id: true, username: true, email: true, role: true, mustChangePassword: true, company: true, phone: true, avatar: true, createdAt: true },
      });

      res.json(user);
    } catch {
      res.status(500).json({ detail: "更新资料失败" });
    }
  });

  router.put("/api/auth/password", authMiddleware, async (req: AuthRequest, res: Response) => {
    const { oldPassword, newPassword } = req.body;
    if (!newPassword) {
      res.status(400).json({ detail: "请输入新密码" });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ detail: "新密码长度至少8位" });
      return;
    }
    try {
      const userId = req.user!.userId;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        console.error(`[password] user not found: ${userId}`);
        res.status(401).json({ detail: "用户不存在，请重新登录" });
        return;
      }

      if (await verifyPassword(newPassword, user.passwordHash)) {
        res.status(400).json({ detail: "新密码不能与当前密码相同" });
        return;
      }

      if (!user.mustChangePassword) {
        if (!oldPassword) {
          res.status(400).json({ detail: "请输入旧密码" });
          return;
        }
        const valid = await verifyPassword(oldPassword, user.passwordHash);
        if (!valid) { res.status(401).json({ detail: "旧密码错误" }); return; }
      }

      const hash = await hashPassword(newPassword);
      await prisma.user.update({ where: { id: req.user!.userId }, data: { passwordHash: hash, mustChangePassword: false } });
      res.json({ message: "密码修改成功" });
    } catch (err) {
      console.error("[password] change failed:", err);
      res.status(500).json({ detail: "密码修改失败" });
    }
  });

  return router;
}
