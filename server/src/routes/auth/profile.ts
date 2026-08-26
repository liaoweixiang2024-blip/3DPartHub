import { randomInt } from 'node:crypto';
import { Router, Response } from 'express';
import { cacheDel, redis } from '../../lib/cache.js';
import { checkRateLimit, storeEmailCode, verifyEmailCode } from '../../lib/captcha.js';
import { sendChangeEmailCode } from '../../lib/email.js';
import { revokeAllTokensBefore, signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { requestSiteUrl } from '../../lib/requestSiteUrl.js';
import {
  CONTACT_PHONE_SETTING_MESSAGE,
  getSetting,
  isValidContactPhoneSetting,
  normalizeContactPhoneSetting,
} from '../../lib/settings.js';
import { authMiddleware, getRequestToken, type AuthRequest } from '../../middleware/auth.js';
import { emailCodeLimiter } from '../../middleware/security.js';
import { readCookie, REFRESH_COOKIE, setAuthCookies } from './cookies.js';

const MAX_EMAIL_LENGTH = 254;

function normalizeEmailInput(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH) return null;
  return email;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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
          canInvite: true,
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
    const normalizedPhone = phone !== undefined ? normalizeContactPhoneSetting(phone) : undefined;

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
    if (phone !== undefined && !isValidContactPhoneSetting(phone)) {
      res.status(400).json({ detail: CONTACT_PHONE_SETTING_MESSAGE });
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
          ...(phone !== undefined && { phone: normalizedPhone || null }),
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
          canInvite: true,
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
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'P2002') {
        res.status(409).json({ detail: '用户名已被使用' });
        return;
      }
      res.status(500).json({ detail: '更新资料失败' });
    }
  });

  // ===== 换绑邮箱：两步验证（旧邮箱验证码 → 新邮箱验证码）=====
  // 邮箱是登录凭证，与普通资料不同：必须证明「能收到旧邮箱邮件」（防盗号改绑）+「新邮箱真实可用」（防占别人邮箱）

  // 发送换绑验证码：target = 'old'（验证当前邮箱）| 'new'（验证新邮箱）
  router.post(
    '/api/auth/change-email/code',
    authMiddleware,
    emailCodeLimiter,
    async (req: AuthRequest, res: Response) => {
      const target = req.body?.target === 'new' ? 'new' : 'old';
      const newEmail = normalizeEmailInput(req.body?.newEmail);

      if (target === 'new') {
        if (!newEmail || !isValidEmail(newEmail)) {
          res.status(400).json({ detail: '新邮箱格式无效' });
          return;
        }
        const existing = await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } });
        if (existing) {
          res.status(409).json({ detail: '该邮箱已被其他账号使用' });
          return;
        }
      }

      try {
        const user = await prisma.user.findUnique({
          where: { id: req.user!.userId },
          select: { email: true },
        });
        if (!user?.email) {
          res.status(400).json({ detail: '当前账号没有绑定邮箱' });
          return;
        }
        const toEmail = target === 'new' ? newEmail! : user.email;

        // 独立冷却（与注册验证码分开计数），key 不带前缀与 captcha.ts 现状保持一致
        const cooldownSeconds = Math.max(
          10,
          Math.floor(Number(await getSetting<number>('security_email_code_cooldown_seconds')) || 60),
        );
        const ttlSeconds = Math.max(
          60,
          Math.floor(Number(await getSetting<number>('security_email_code_ttl_seconds')) || 600),
        );
        const allowed = await checkRateLimit(`change_email_rate:${req.user!.userId}:${target}`, cooldownSeconds);
        if (!allowed) {
          res.status(429).json({ detail: `发送太频繁，请${cooldownSeconds}秒后重试` });
          return;
        }

        const code = String(randomInt(100000, 1000000));
        await storeEmailCode(`change_email:${toEmail}`, code, ttlSeconds);
        await sendChangeEmailCode(toEmail, code, requestSiteUrl(req));
        res.json({ message: '验证码已发送' });
      } catch (err) {
        logger.error({ err }, '[auth] Change-email code send failed');
        res.status(500).json({ detail: '邮件发送失败' });
      }
    },
  );

  // 执行换绑：需同时提供旧邮箱验证码 + 新邮箱验证码
  router.post('/api/auth/change-email', authMiddleware, async (req: AuthRequest, res: Response) => {
    const oldCode = typeof req.body?.oldCode === 'string' ? req.body.oldCode.trim() : '';
    const newCode = typeof req.body?.newCode === 'string' ? req.body.newCode.trim() : '';
    const newEmail = normalizeEmailInput(req.body?.newEmail);

    if (!oldCode || !newCode || !newEmail || !isValidEmail(newEmail)) {
      res.status(400).json({ detail: '参数不完整或新邮箱格式无效' });
      return;
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { id: true, email: true },
      });
      if (!user?.email) {
        res.status(400).json({ detail: '当前账号没有绑定邮箱' });
        return;
      }

      const existing = await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } });
      if (existing) {
        res.status(409).json({ detail: '该邮箱已被其他账号使用' });
        return;
      }

      // 双向验证：旧邮箱证明账号所有权，新邮箱证明新地址可达
      const oldOk = await verifyEmailCode(`change_email:${user.email}`, oldCode);
      if (!oldOk) {
        res.status(400).json({ detail: '当前邮箱验证码错误或已过期' });
        return;
      }
      const newOk = await verifyEmailCode(`change_email:${newEmail}`, newCode);
      if (!newOk) {
        res.status(400).json({ detail: '新邮箱验证码错误或已过期' });
        return;
      }

      // 换绑成功：清理两个验证码（verifyEmailCode 已各消费一个，此处清残留冷却键非必需，仅兜底）
      await prisma.user.update({
        where: { id: user.id },
        data: { email: newEmail },
      });
      // 邮箱是登录凭证的一部分：换绑后作废旧令牌强制重新登录，防旧会话残留
      await revokeAllTokensBefore(user.id, Math.floor(Date.now() / 1000) + 1);
      await cacheDel(`auth:user:${user.id}`).catch(() => {});
      redis.del(`change_email_rate:${user.id}:old`).catch(() => {});
      redis.del(`change_email_rate:${user.id}:new`).catch(() => {});

      res.json({ message: '邮箱已更换，请重新登录' });
    } catch (err) {
      logger.error({ err }, '[auth] Change-email failed');
      res.status(500).json({ detail: '更换邮箱失败' });
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
      const updatedUser = await prisma.user.update({
        where: { id: req.user!.userId },
        data: { passwordHash: hash, mustChangePassword: false },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          mustChangePassword: true,
          canInvite: true,
          company: true,
          phone: true,
          department: true,
          address: true,
          bio: true,
          avatar: true,
          createdAt: true,
        },
      });
      await cacheDel(`auth:user:${req.user!.userId}`).catch((err) => {
        logger.warn({ err, userId: req.user!.userId }, '[password] Failed to clear auth user cache');
      });

      if (req.user) {
        try {
          await revokeAllTokensBefore(req.user.userId, Math.floor(Date.now() / 1000));
        } catch (err) {
          logger.error({ err }, '[profile] Failed to revoke tokens after password change');
        }
        const newPayload = { userId: req.user.userId, role: req.user.role };
        let shouldRemember = false;
        const refreshCookie = readCookie(req, REFRESH_COOKIE);
        if (refreshCookie) {
          try {
            shouldRemember = verifyRefreshToken(refreshCookie).rememberMe === true;
          } catch {
            shouldRemember = false;
          }
        }
        const newAccess = signAccessToken(newPayload);
        const newRefresh = signRefreshToken({ ...newPayload, rememberMe: shouldRemember });
        setAuthCookies(req, res, newAccess, newRefresh, { rememberMe: shouldRemember });
        res.json({ message: '密码修改成功', user: updatedUser, tokens: { accessToken: newAccess } });
      } else {
        res.json({ message: '密码修改成功，请重新登录', user: updatedUser });
      }
    } catch (err) {
      logger.error({ err }, '[password] change failed');
      res.status(500).json({ detail: '密码修改失败' });
    }
  });

  return router;
}
