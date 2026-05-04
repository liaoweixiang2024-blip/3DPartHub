import { Router, Response } from 'express';
import { revokeToken, revokeAllTokensBefore, signAccessToken, signRefreshToken } from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { getSetting } from '../../lib/settings.js';
import { authMiddleware, getRequestToken, type AuthRequest } from '../../middleware/auth.js';
import { setAuthCookies } from './cookies.js';

export function createAuthProfileRouter() {
  const router = Router();

  router.get('/api/auth/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          mustChangePassword: true,
          company: true,
          phone: true,
          department: true,
          address: true,
          bio: true,
          avatar: true,
          createdAt: true,
        },
      });
      if (!user) {
        res.status(401).json({ detail: '用户不存在，请重新登录' });
        return;
      }
      res.json(user);
    } catch {
      res.status(500).json({ detail: '获取用户信息失败' });
    }
  });

  router.put('/api/auth/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
    const { username, company, phone, department, address, bio, avatar } = req.body;

    if (username !== undefined) {
      if (typeof username !== 'string' || username.trim().length === 0) {
        res.status(400).json({ detail: '用户名不能为空' });
        return;
      }
      const usernameMinLength = Math.max(
        1,
        Math.floor(Number(await getSetting<number>('security_username_min_length')) || 2),
      );
      const usernameMaxLength = Math.max(
        usernameMinLength,
        Math.floor(Number(await getSetting<number>('security_username_max_length')) || 32),
      );
      if (username.length < usernameMinLength || username.length > usernameMaxLength) {
        res.status(400).json({ detail: `用户名长度应在${usernameMinLength}-${usernameMaxLength}位之间` });
        return;
      }
      if (!/^[\p{L}\p{N}_\-.]+$/u.test(username)) {
        res.status(400).json({ detail: '用户名只能包含字母、数字、下划线、连字符和点' });
        return;
      }
    }
    if (avatar !== undefined) {
      if (typeof avatar !== 'string' || avatar.length > 500) {
        res.status(400).json({ detail: '头像格式无效' });
        return;
      }
      if (avatar && !/^\/(static|api)\//.test(avatar) && !/^https?:\/\//i.test(avatar)) {
        res.status(400).json({ detail: '头像 URL 格式无效' });
        return;
      }
    }
    if (bio !== undefined && typeof bio === 'string' && bio.length > 500) {
      res.status(400).json({ detail: '个人简介不能超过500字' });
      return;
    }

    try {
      // Check username uniqueness if changing
      if (username) {
        const existing = await prisma.user.findFirst({
          where: { username, NOT: { id: req.user!.userId } },
        });
        if (existing) {
          res.status(409).json({ detail: '用户名已被使用' });
          return;
        }
      }

      const user = await prisma.user.update({
        where: { id: req.user!.userId },
        data: {
          ...(username !== undefined && { username }),
          ...(company !== undefined && { company }),
          ...(phone !== undefined && { phone }),
          ...(department !== undefined && { department }),
          ...(address !== undefined && { address }),
          ...(bio !== undefined && { bio }),
          ...(avatar !== undefined && { avatar }),
        },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          mustChangePassword: true,
          company: true,
          phone: true,
          department: true,
          address: true,
          bio: true,
          avatar: true,
          createdAt: true,
        },
      });

      res.json(user);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        res.status(409).json({ detail: '用户名已被使用' });
        return;
      }
      res.status(500).json({ detail: '更新资料失败' });
    }
  });

  router.put('/api/auth/password', authMiddleware, async (req: AuthRequest, res: Response) => {
    const { oldPassword, newPassword } = req.body;
    if (!newPassword) {
      res.status(400).json({ detail: '请输入新密码' });
      return;
    }
    const passwordMinLength = Math.max(
      6,
      Math.floor(Number(await getSetting<number>('security_password_min_length')) || 8),
    );
    if (newPassword.length < passwordMinLength || newPassword.length > 128) {
      res.status(400).json({ detail: `新密码长度应在${passwordMinLength}-128位之间` });
      return;
    }
    // Password complexity: must contain at least two of letter/number/symbol
    const hasLetter = /[a-zA-Z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const hasSymbol = /[^a-zA-Z0-9]/.test(newPassword);
    if (Number(hasLetter) + Number(hasNumber) + Number(hasSymbol) < 2) {
      res.status(400).json({ detail: '新密码需包含字母、数字和特殊字符中的至少两种' });
      return;
    }
    try {
      const userId = req.user!.userId;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(401).json({ detail: '用户不存在，请重新登录' });
        return;
      }

      if (await verifyPassword(newPassword, user.passwordHash)) {
        res.status(400).json({ detail: '新密码不能与当前密码相同' });
        return;
      }

      if (!user.mustChangePassword) {
        if (!oldPassword) {
          res.status(400).json({ detail: '请输入旧密码' });
          return;
        }
        const valid = await verifyPassword(oldPassword, user.passwordHash);
        if (!valid) {
          res.status(401).json({ detail: '旧密码错误' });
          return;
        }
      } else {
        if (!oldPassword) {
          const token = getRequestToken(req);
          if (token) {
            try {
              const { verifyAccessToken } = await import('../../lib/jwt.js');
              const payload = verifyAccessToken(token);
              const age = Date.now() / 1000 - (payload.iat || 0);
              if (age > 300) {
                res
                  .status(403)
                  .json({ detail: '首次修改密码请在登录后5分钟内完成，请重新登录', code: 'PASSWORD_CHANGE_REQUIRED' });
                return;
              }
            } catch {
              res.status(403).json({ detail: '无法验证登录时间', code: 'PASSWORD_CHANGE_REQUIRED' });
              return;
            }
          } else {
            res.status(403).json({ detail: '无法验证登录时间', code: 'PASSWORD_CHANGE_REQUIRED' });
            return;
          }
        } else {
          const valid = await verifyPassword(oldPassword, user.passwordHash);
          if (!valid) {
            res.status(401).json({ detail: '旧密码错误' });
            return;
          }
        }
      }

      const hash = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: req.user!.userId },
        data: { passwordHash: hash, mustChangePassword: false },
      });

      if (req.user) {
        try {
          await revokeAllTokensBefore(req.user.userId, Math.floor(Date.now() / 1000));
        } catch (err) {
          logger.error({ err }, '[profile] Failed to revoke tokens after password change');
        }
        const newPayload = { userId: req.user.userId, role: req.user.role };
        const newAccess = signAccessToken(newPayload);
        const newRefresh = signRefreshToken(newPayload);
        setAuthCookies(req, res, newAccess, newRefresh, {});
        res.json({ message: '密码修改成功' });
      } else {
        res.json({ message: '密码修改成功，请重新登录' });
      }
    } catch (err) {
      logger.error({ err }, '[password] change failed');
      res.status(500).json({ detail: '密码修改失败' });
    }
  });

  return router;
}
