import { randomInt } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { cacheGet, redis } from '../../lib/cache.js';
import { generateCaptcha, verifyCaptcha, checkRateLimit, storeEmailCode, verifyEmailCode } from '../../lib/captcha.js';
import { sendVerifyCode } from '../../lib/email.js';
import { assessInviteCode, INVITE_REASON_MSG } from '../../lib/inviteCode.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  verifyAccessToken,
  revokeToken,
  revokeRefreshFamily,
  checkAndRevokeRefreshFamily,
  isRefreshFamilyRevoked,
} from '../../lib/jwt.js';
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
import { getRequestToken } from '../../middleware/auth.js';
import { apiLimiter, emailCodeLimiter } from '../../middleware/security.js';
import { clearAuthCookies, readCookie, REFRESH_COOKIE, setAuthCookies } from './cookies.js';

const DUMMY_HASH = '$2a$12$LiVmGbGyGZkP1WQOB7SXOOJ7JqBhDmuOg2WjFwvCSCmXFGpOFHHze';
const LOGIN_FAIL_PREFIX = 'login_fail:';
/** 同一邮箱失败 ≥ 此值后要求图形验证码（不锁号）：真用户输对验证码仍可登录，
 *  陌生人知道邮箱恶意输错密码锁不死账号，只会让该邮箱登录多一步验证码 */
const LOGIN_CAPTCHA_AFTER_FAILS = 5;
/** 保底硬锁：要求验证码后仍持续失败到该值（验证码被 OCR/打码平台破解的迹象），
 *  临时锁号防爆破。阈值远高于验证码阈值——真人忘密码会走重置，
 *  几乎不可能「连续输对 30 次验证码 + 密码全错」。计数窗口同 LOGIN_LOCK_SECONDS，
 *  管理端可随时手动解锁（unlock-login 接口）。 */
const LOGIN_HARD_LOCK_FAILS = 30;
/** 失败计数窗口：首次失败后 15 分钟自动清零（无新失败则不再要求验证码） */
const LOGIN_LOCK_SECONDS = 900;
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

// 按邮箱的失败计数只用于触发图形验证码（见 LOGIN_CAPTCHA_AFTER_FAILS）；
// 硬锁定只按 IP 维度：防跨账号撞库 + 「用受害者邮箱错密码」的定向骚扰只会被
// 攻击者自己的 IP 锁拦住，受害者从任何网络仍可正常登录（多一步验证码而已）。
const LOGIN_FAIL_IP_PREFIX = 'login_fail_ip:';
const LOGIN_IP_MAX_FAILS = 20;
const LOGIN_IP_LOCK_SECONDS = 900;
const LOGIN_UNKNOWN_IP = 'unknown';

async function recordLoginFailureByIp(ip: string): Promise<number> {
  const key = `${LOGIN_FAIL_IP_PREFIX}${ip}`;
  const fails = await redis.incr(key);
  if (fails === 1) await redis.expire(key, LOGIN_IP_LOCK_SECONDS);
  return fails;
}

async function getLoginIpFailureCount(ip: string): Promise<number> {
  const val = await redis.get(`${LOGIN_FAIL_IP_PREFIX}${ip}`);
  return Number(val) || 0;
}

async function clearLoginIpFailures(ip: string): Promise<void> {
  await redis.del(`${LOGIN_FAIL_IP_PREFIX}${ip}`);
}

/** 管理端解锁登录：清空该邮箱（及可选 IP）的登录失败计数，
 *  「账号已临时锁定」与 IP 锁立即解除，无需等 15 分钟计数窗口过期。 */
export async function clearLoginLockState(target: { email?: string; ip?: string }): Promise<void> {
  const keys: string[] = [];
  const normalized = normalizeEmailInput(target.email);
  if (normalized) keys.push(`${LOGIN_FAIL_PREFIX}${normalized}`);
  if (typeof target.ip === 'string' && target.ip.trim() && target.ip.length <= 64) {
    keys.push(`${LOGIN_FAIL_IP_PREFIX}${target.ip.trim()}`);
  }
  if (keys.length) await redis.del(...keys);
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
  router.post('/api/auth/email-code', emailCodeLimiter, async (req: Request, res: Response) => {
    const { email, captchaId, captchaText } = req.body;
    const normalizedEmail = normalizeEmailInput(email);
    if (
      !normalizedEmail ||
      !isValidEmail(normalizedEmail) ||
      typeof captchaId !== 'string' ||
      typeof captchaText !== 'string' ||
      !captchaId ||
      !captchaText
    ) {
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
    const rateKey = `email_rate:${normalizedEmail}`;
    const allowed = await checkRateLimit(rateKey, cooldownSeconds);
    if (!allowed) {
      res.status(429).json({ detail: `发送太频繁，请${cooldownSeconds}秒后重试` });
      return;
    }

    // Generate 6-digit code
    const code = String(randomInt(100000, 1000000));
    await storeEmailCode(normalizedEmail, code, emailCodeTtlSeconds);

    try {
      await sendVerifyCode(normalizedEmail, code, requestSiteUrl(req));
      res.json({ message: '验证码已发送' });
    } catch (err: unknown) {
      await redis.del(`email_code:${normalizedEmail}`);
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

    const { username, email, password, emailCode, phone, company, address, inviteCode } = req.body;
    const normalizedEmail = normalizeEmailInput(email);
    const normalizedPhone = normalizeContactPhoneSetting(phone);

    if (
      typeof username !== 'string' ||
      !username ||
      !normalizedEmail ||
      typeof password !== 'string' ||
      typeof emailCode !== 'string' ||
      !emailCode
    ) {
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

    if (!isValidEmail(normalizedEmail)) {
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

    if (phone !== undefined && !isValidContactPhoneSetting(phone)) {
      res.status(400).json({ detail: CONTACT_PHONE_SETTING_MESSAGE });
      return;
    }

    // Check uniqueness BEFORE consuming email code
    try {
      const existing = await prisma.user.findFirst({
        where: { OR: [{ username }, { email: normalizedEmail }] },
      });
      if (existing) {
        res.status(409).json({ detail: '用户名或邮箱已存在' });
        return;
      }
    } catch {
      res.status(500).json({ detail: '注册失败' });
      return;
    }

    // 邀请码校验：require_invite_code 开启时必须填有效码；一次一码，校验通过后留待创建事务中抢占标记 used
    const requireInvite = (await getSetting<boolean>('require_invite_code')) === true;
    const rawInviteCode = typeof inviteCode === 'string' ? inviteCode.trim() : '';
    let pendingInviteId: string | null = null;
    if (requireInvite) {
      if (!rawInviteCode) {
        res.status(400).json({ detail: '请输入邀请码' });
        return;
      }
      const found = await prisma.inviteCode.findUnique({ where: { code: rawInviteCode } });
      const assessment = assessInviteCode(
        found ? { status: found.status, expiresAt: found.expiresAt, usedById: found.usedById } : null,
        new Date(),
      );
      if (!assessment.ok) {
        res.status(400).json({ detail: INVITE_REASON_MSG[assessment.reason] });
        return;
      }
      pendingInviteId = found!.id;
    }

    const codeOk = await verifyEmailCode(normalizedEmail, emailCode);
    if (!codeOk) {
      res.status(400).json({ detail: '邮箱验证码错误或已过期' });
      return;
    }

    try {
      const passwordHash = await hashPassword(password);
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            username,
            email: normalizedEmail,
            passwordHash,
            phone: normalizedPhone || null,
            company: company || null,
            address: address || null,
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
        // 一次一码：条件更新抢占（仅 usedById 仍为 null 且 active 才生效）。
        // 并发情况下第二个事务 count=0 → 抛错回滚，保证一码只被使用一次。
        if (pendingInviteId) {
          const claimed = await tx.inviteCode.updateMany({
            where: { id: pendingInviteId, usedById: null, status: 'active' },
            data: { status: 'used', usedById: created.id, usedAt: new Date() },
          });
          if (claimed.count === 0) {
            throw new Error('INVITE_CODE_TAKEN');
          }
        }
        return created;
      });

      const payload = { userId: user.id, role: user.role };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken({ ...payload, rememberMe: true });
      setAuthCookies(req, res, accessToken, refreshToken, { rememberMe: true });

      const { canUploadProductWall } = await import('../product-wall/shared.js');
      res.json({
        user: { ...user, canUploadProductWall: await canUploadProductWall({ userId: user.id, role: user.role }) },
        tokens: { accessToken },
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'INVITE_CODE_TAKEN') {
        res.status(400).json({ detail: '邀请码已被使用' });
        return;
      }
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'P2002') {
        res.status(409).json({ detail: '用户名或邮箱已存在' });
        return;
      }
      res.status(500).json({ detail: '注册失败' });
    }
  });

  router.post('/api/auth/login', async (req: Request, res: Response) => {
    const { email, password, rememberMe } = req.body;
    const normalizedEmail = normalizeEmailInput(email);

    if (!normalizedEmail || typeof password !== 'string' || !password) {
      res.status(400).json({ detail: '邮箱和密码不能为空' });
      return;
    }

    const clientIp = req.ip || LOGIN_UNKNOWN_IP;

    try {
      const [failCount, ipFailCount] = await Promise.all([
        getLoginFailureCount(normalizedEmail),
        getLoginIpFailureCount(clientIp),
      ]);
      if (ipFailCount >= LOGIN_IP_MAX_FAILS) {
        res.status(429).json({ detail: '该网络登录失败次数过多，请稍后再试' });
        return;
      }
      // 保底硬锁（见 LOGIN_HARD_LOCK_FAILS 注释）：验证码阶段的持续失败说明验证码
      // 正被破解，此时锁号兜底防爆破；真用户可联系管理员立即解锁
      if (failCount >= LOGIN_HARD_LOCK_FAILS) {
        res.status(429).json({
          detail: '该账号已被临时锁定，请联系管理员解锁或稍后再试',
          code: 'ACCOUNT_LOCKED',
        });
        return;
      }

      // 邮箱维度达到阈值 → 要求图形验证码（不锁号）：爆破方每次尝试都要先过验证码，
      // 真用户输对验证码照常登录——恶意输错密码再也无法把别人账号锁死。
      const captchaRequired = failCount >= LOGIN_CAPTCHA_AFTER_FAILS;
      if (captchaRequired) {
        const { captchaId, captchaText } = (req.body ?? {}) as { captchaId?: unknown; captchaText?: unknown };
        if (typeof captchaId !== 'string' || typeof captchaText !== 'string' || !captchaId || !captchaText) {
          res.status(401).json({
            detail: '该账号登录失败次数较多，请输入图形验证码后重试',
            code: 'CAPTCHA_REQUIRED',
            captchaRequired: true,
          });
          return;
        }
        const captchaOk = await verifyCaptcha(captchaId, captchaText);
        if (!captchaOk) {
          // 验证码错误只计入 IP 计数（不记邮箱：真人手误不该加速阈值），防脚本穷举验证码
          const totalIpFails = await recordLoginFailureByIp(clientIp);
          if (totalIpFails >= LOGIN_IP_MAX_FAILS) {
            res.status(429).json({ detail: '该网络登录失败次数过多，请稍后再试' });
            return;
          }
          res.status(401).json({
            detail: '图形验证码不正确，请重新输入',
            code: 'CAPTCHA_INVALID',
            captchaRequired: true,
          });
          return;
        }
      }

      const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !valid) {
        const [totalFails, totalIpFails] = await Promise.all([
          recordLoginFailure(normalizedEmail),
          recordLoginFailureByIp(clientIp),
        ]);
        if (totalIpFails >= LOGIN_IP_MAX_FAILS) {
          res.status(429).json({ detail: '该网络登录失败次数过多，请稍后再试' });
          return;
        }
        if (totalFails >= LOGIN_HARD_LOCK_FAILS) {
          res.status(429).json({
            detail: '该账号已被临时锁定，请联系管理员解锁或稍后再试',
            code: 'ACCOUNT_LOCKED',
          });
          return;
        }
        // 带 captchaRequired 标记：达到阈值后前端立即在登录表单上出验证码输入
        res.status(401).json({
          detail: '邮箱或密码错误',
          captchaRequired: totalFails >= LOGIN_CAPTCHA_AFTER_FAILS,
        });
        return;
      }

      // 禁用账号禁止登录（admin 在用户管理页禁用后会撤销 token，这里再兜底拦截重新登录）。
      // 必须在清失败计数之前检查——否则攻击者可用禁用账号凭据反复「对密码登录 → 清空 IP 失败计数」
      // 来重置同 IP 的暴破窗口。
      if (user.disabled) {
        res.status(403).json({ detail: '账号已被禁用，请联系管理员' });
        return;
      }

      await clearLoginFailures(normalizedEmail);
      await clearLoginIpFailures(clientIp);

      // 记录最近登录/活跃时间（best-effort，不阻塞登录）
      prisma.user
        .update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastActiveAt: new Date() } })
        .catch(() => {});

      const payload = { userId: user.id, role: user.role };
      const accessToken = signAccessToken(payload);
      const shouldRemember = Boolean(rememberMe);
      const refreshToken = signRefreshToken({ ...payload, rememberMe: shouldRemember });
      setAuthCookies(req, res, accessToken, refreshToken, { rememberMe: shouldRemember });

      const { canUploadProductWall } = await import('../product-wall/shared.js');
      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
          canInvite: user.canInvite,
          company: user.company,
          phone: user.phone,
          department: user.department,
          address: user.address,
          bio: user.bio,
          avatar: user.avatar,
          createdAt: user.createdAt,
          canUploadProductWall: await canUploadProductWall({ userId: user.id, role: user.role }),
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
      // 客户端每次页面加载都会探测式调用本端点（restoreSessionFromCookie），无痕/
      // 未登录访客本就没有 cookie——这是常态而非错误请求，回 400 会在每个匿名
      // 页面加载的控制台打出失败请求。回 204（无会话），客户端按无会话短路。
      res.status(204).end();
      return;
    }

    try {
      const payload = verifyRefreshToken(refreshToken);

      const revokeBefore = await cacheGet<number>(`token_revoke_before:${payload.userId}`);
      if (revokeBefore && payload.iat && payload.iat <= revokeBefore) {
        res.status(401).json({ detail: '会话已失效，请重新登录' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, role: true, disabled: true },
      });
      if (!user) {
        res.status(401).json({ detail: '用户不存在，请重新登录' });
        return;
      }
      // 禁用账号不得通过旧 refresh token 续签（登录入口已拦，这里补齐 refresh 入口）
      if (user.disabled) {
        res.status(403).json({ detail: '账号已被禁用，请联系管理员' });
        return;
      }

      if (payload.familyId) {
        // 登出作废的 family 不得复活——登出语义必须成立
        if (await isRefreshFamilyRevoked(payload.userId, payload.familyId)) {
          res.status(401).json({ detail: 'refresh token 已失效，请重新登录' });
          return;
        }
        // 轮换记账（grace/used 标记），返回值不再参与放行判定
        await checkAndRevokeRefreshFamily(payload.userId, payload.familyId);
      }

      // 无论首次使用、宽限内还是宽限外的重放，一律换发新 family cookie：
      // 「已轮换旧令牌的重放」在真实用户侧是常态而非攻击——强刷掐断上一次
      // 轮换的 Set-Cookie（罐子卡死在已用令牌）、PWA 独立 cookie 罐隔天打开、
      // 设备休眠超过宽限窗，全都长这样；而偷到当前令牌的攻击者在宽限窗内
      // 重放本来就拿到新会话，把宽限外重放判为泄露并全量吊销（revokeAll-
      // TokensBefore 级联）只惩罚合法用户（多设备全部登出），拦不住会看表的
      // 攻击者。真正的泄露处置通道保留：改密 / 密码重置 / 管理员改角色 / 禁用
      // 仍全量顶下线，登出走 revoked 标记。共享同一 cookie 罐的多个标签页自然
      // 收敛到最后一次写入，独立罐（PWA/多浏览器）各走各的新令牌互不干扰。

      const newFamilyId = `fam_${Date.now().toString(36)}`;
      const shouldRemember = payload.rememberMe === true;
      const accessToken = signAccessToken({ userId: user.id, role: user.role });
      const newRefreshToken = signRefreshToken({
        userId: user.id,
        role: user.role,
        familyId: newFamilyId,
        rememberMe: shouldRemember,
      });
      setAuthCookies(req, res, accessToken, newRefreshToken, { rememberMe: shouldRemember });
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
          // 撤销标记必须覆盖 token 剩余寿命（默认 7d）：固定 24h 会让被登出的
          // access token 在标记过期后「复活」，继续有效到自然过期
          const remaining = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 0;
          await revokeToken(payload.userId, payload.iat, Math.max(remaining, 0) + 3600);
        }
      }
    } catch {
      /* best-effort access token revocation on logout */
    }
    try {
      const refreshCookie = readCookie(req, REFRESH_COOKIE);
      if (refreshCookie) {
        const refreshPayload = verifyRefreshToken(refreshCookie);
        if (refreshPayload.familyId) {
          await revokeRefreshFamily(refreshPayload.userId, refreshPayload.familyId);
        }
      }
    } catch {
      /* best-effort refresh token revocation on logout */
    }
    clearAuthCookies(req, res);
    res.json({ success: true });
  });

  return router;
}
