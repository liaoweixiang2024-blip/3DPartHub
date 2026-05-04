import { randomInt } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { cacheGet } from '../../lib/cache.js';
import {
  generateCaptcha,
  verifyCaptcha,
  checkRateLimit,
  storeEmailCode,
  verifyEmailCode,
  redis,
} from '../../lib/captcha.js';
import { sendVerifyCode } from '../../lib/email.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  verifyAccessToken,
  revokeToken,
  revokeRefreshFamily,
  checkAndRevokeRefreshFamily,
  revokeAllTokensBefore,
} from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { getSetting } from '../../lib/settings.js';
import { getRequestToken } from '../../middleware/auth.js';
import { apiLimiter } from '../../middleware/security.js';
import { clearAuthCookies, readCookie, REFRESH_COOKIE, setAuthCookies } from './cookies.js';

const DUMMY_HASH = '$2a$12$LiVmGbGyGZkP1WQOB7SXOOJ7JqBhDmuOg2WjFwvCSCmXFGpOFHHze';
const LOGIN_FAIL_PREFIX = 'login_fail:';
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_SECONDS = 900;

async function recordLoginFailure(email: string): Promise<number> {
  const key = `${LOGIN_FAIL_PREFIX}${email.toLowerCase()}`;
  const fails = await redis.incr(key);
  if (fails === 1) await redis.expire(key, LOGIN_LOCK_SECONDS);
  return fails;
}

async function clearLoginFailures(email: string): Promise<void> {
  await redis.del(`${LOGIN_FAIL_PREFIX}${email.toLowerCase()}`);
}

async function getLoginFailureCount(email: string): Promise<number> {
  const val = await redis.get(`${LOGIN_FAIL_PREFIX}${email.toLowerCase()}`);
  return Number(val) || 0;
}

export function createAuthSessionRouter() {
  const router = Router();

  // Generate graphical captcha
  router.get('/api/auth/captcha', apiLimiter, async (_req: Request, res: Response) => {
    try {
      const ttlSeconds = await getSetting<number>('security_captcha_ttl_seconds');
      const result = await generateCaptcha(Math.max(60, Math.floor(Number(ttlSeconds) || 300)));
      res.json(result);
    } catch {
      res.status(500).json({ detail: '生成验证码失败' });
    }
  });

  // Send email verification code
  router.post('/api/auth/email-code', async (req: Request, res: Response) => {
    const { email, captchaId, captchaText } = req.body;
    if (!email || !captchaId || !captchaText) {
      res.status(400).json({ detail: '参数不完整' });
      return;
    }

    // Verify graphical captcha
    const captchaOk = await verifyCaptcha(captchaId, captchaText);
    if (!captchaOk) {
      res.status(400).json({ detail: '图形验证码错误或已过期' });
      return;
    }

    const cooldownSeconds = Math.max(
      10,
      Math.floor(Number(await getSetting<number>('security_email_code_cooldown_seconds')) || 60),
    );
    const emailCodeTtlSeconds = Math.max(
      60,
      Math.floor(Number(await getSetting<number>('security_email_code_ttl_seconds')) || 600),
    );
    const rateKey = `email_rate:${email}`;
    const allowed = await checkRateLimit(rateKey, cooldownSeconds);
    if (!allowed) {
      res.status(429).json({ detail: `发送太频繁，请${cooldownSeconds}秒后重试` });
      return;
    }

    // Generate 6-digit code
    const code = String(randomInt(100000, 1000000));
    await storeEmailCode(email, code, emailCodeTtlSeconds);

    try {
      await sendVerifyCode(email, code);
      res.json({ message: '验证码已发送' });
    } catch (err: any) {
      await redis.del(`email_code:${email}`);
      logger.error({ err: err }, '[auth] Email send failed');
      res.status(500).json({ detail: '邮件发送失败' });
    }
  });

  router.post('/api/auth/register', apiLimiter, async (req: Request, res: Response) => {
    // Check if registration is allowed
    const allowRegister = await getSetting<boolean>('allow_register');
    if (!allowRegister) {
      res.status(403).json({ detail: '注册功能已关闭' });
      return;
    }

    const { username, email, password, emailCode, phone, company } = req.body;

    if (!username || !email || !password || !emailCode) {
      res.status(400).json({ detail: '所有字段不能为空' });
      return;
    }

    const passwordMinLength = Math.max(
      6,
      Math.floor(Number(await getSetting<number>('security_password_min_length')) || 8),
    );
    const usernameMinLength = Math.max(
      1,
      Math.floor(Number(await getSetting<number>('security_username_min_length')) || 2),
    );
    const usernameMaxLength = Math.max(
      usernameMinLength,
      Math.floor(Number(await getSetting<number>('security_username_max_length')) || 32),
    );

    if (password.length < passwordMinLength || password.length > 128) {
      res.status(400).json({ detail: `密码长度应在${passwordMinLength}-128位之间` });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ detail: '邮箱格式不正确' });
      return;
    }

    if (username.length < usernameMinLength || username.length > usernameMaxLength) {
      res.status(400).json({ detail: `用户名长度应在${usernameMinLength}-${usernameMaxLength}位之间` });
      return;
    }

    if (!/^[\p{L}\p{N}_\-.]+$/u.test(username)) {
      res.status(400).json({ detail: '用户名只能包含字母、数字、下划线、连字符和点' });
      return;
    }

    // Check uniqueness BEFORE consuming email code
    try {
      const existing = await prisma.user.findFirst({
        where: { OR: [{ username }, { email: email.toLowerCase() }] },
      });
      if (existing) {
        res.status(409).json({ detail: '用户名或邮箱已存在' });
        return;
      }
    } catch {
      res.status(500).json({ detail: '注册失败' });
      return;
    }

    const codeOk = await verifyEmailCode(email, emailCode);
    if (!codeOk) {
      res.status(400).json({ detail: '邮箱验证码错误或已过期' });
      return;
    }

    try {
      const passwordHash = await hashPassword(password);
      const normalizedEmail = email.toLowerCase();
      const user = await prisma.user.create({
        data: { username, email: normalizedEmail, passwordHash, phone: phone || null, company: company || null },
        select: { id: true, username: true, email: true, role: true, mustChangePassword: true, createdAt: true },
      });

      const payload = { userId: user.id, role: user.role };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);
      setAuthCookies(req, res, accessToken, refreshToken, { rememberMe: true });

      res.json({
        user,
        tokens: { accessToken },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        res.status(409).json({ detail: '用户名或邮箱已存在' });
        return;
      }
      res.status(500).json({ detail: '注册失败' });
    }
  });

  router.post('/api/auth/login', async (req: Request, res: Response) => {
    const { email, password, rememberMe } = req.body;

    if (!email || !password) {
      res.status(400).json({ detail: '邮箱和密码不能为空' });
      return;
    }

    try {
      const failCount = await getLoginFailureCount(email);
      if (failCount >= LOGIN_MAX_FAILS) {
        res.status(429).json({ detail: `登录失败次数过多，请${Math.ceil(LOGIN_LOCK_SECONDS / 60)}分钟后重试` });
        return;
      }

      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !valid) {
        const totalFails = await recordLoginFailure(email);
        if (totalFails >= LOGIN_MAX_FAILS) {
          res.status(429).json({ detail: `登录失败次数过多，请${Math.ceil(LOGIN_LOCK_SECONDS / 60)}分钟后重试` });
        } else {
          res.status(401).json({ detail: '邮箱或密码错误' });
        }
        return;
      }

      await clearLoginFailures(email);

      const payload = { userId: user.id, role: user.role };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);
      setAuthCookies(req, res, accessToken, refreshToken, { rememberMe: Boolean(rememberMe) });

      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
          createdAt: user.createdAt,
        },
        tokens: { accessToken },
      });
    } catch {
      res.status(500).json({ detail: '登录失败' });
    }
  });

  router.post('/api/auth/refresh', async (req: Request, res: Response) => {
    const refreshToken = readCookie(req, REFRESH_COOKIE);
    if (!refreshToken) {
      res.status(400).json({ detail: '缺少 refresh token' });
      return;
    }

    try {
      const payload = verifyRefreshToken(refreshToken);

      const revokeBefore = await cacheGet<number>(`token_revoke_before:${payload.userId}`);
      if (revokeBefore && payload.iat && payload.iat < revokeBefore) {
        res.status(401).json({ detail: '会话已失效，请重新登录' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, role: true },
      });
      if (!user) {
        res.status(401).json({ detail: '用户不存在，请重新登录' });
        return;
      }

      if (payload.familyId) {
        const notRevoked = await checkAndRevokeRefreshFamily(payload.userId, payload.familyId);
        if (!notRevoked) {
          await revokeAllTokensBefore(payload.userId, Math.floor(Date.now() / 1000));
          res.status(401).json({ detail: 'refresh token 已失效，请重新登录' });
          return;
        }
      }

      const newFamilyId = `fam_${Date.now().toString(36)}`;
      const accessToken = signAccessToken({ userId: user.id, role: user.role });
      const newRefreshToken = signRefreshToken({ userId: user.id, role: user.role, familyId: newFamilyId });
      setAuthCookies(req, res, accessToken, newRefreshToken);
      res.json({ accessToken });
    } catch {
      res.status(401).json({ detail: 'refresh token 无效或已过期' });
    }
  });

  router.post('/api/auth/logout', async (req: Request, res: Response) => {
    try {
      const token = getRequestToken(req);
      if (token) {
        const payload = verifyAccessToken(token);
        if (payload.iat) {
          await revokeToken(payload.userId, payload.iat, 24 * 3600);
        }
      }
    } catch {}
    try {
      const refreshCookie = readCookie(req, REFRESH_COOKIE);
      if (refreshCookie) {
        const refreshPayload = verifyRefreshToken(refreshCookie);
        if (refreshPayload.familyId) {
          await revokeRefreshFamily(refreshPayload.userId, refreshPayload.familyId);
        }
      }
    } catch {}
    clearAuthCookies(req, res);
    res.json({ success: true });
  });

  return router;
}
