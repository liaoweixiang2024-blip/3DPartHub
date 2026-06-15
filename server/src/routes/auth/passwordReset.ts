import { randomBytes } from 'node:crypto';
import { Router, Request, Response } from 'express';
import {
  verifyCaptcha,
  checkRateLimit,
  storePasswordResetToken,
  consumePasswordResetToken,
} from '../../lib/captcha.js';
import { sendPasswordResetEmail } from '../../lib/email.js';
import { logger } from '../../lib/logger.js';
import { hashPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { requestSiteUrl } from '../../lib/requestSiteUrl.js';
import { getSetting } from '../../lib/settings.js';
import { apiLimiter } from '../../middleware/security.js';

const MAX_EMAIL_LENGTH = 254;
const RESET_TOKEN_TTL_SECONDS = 1800; // 30 分钟
const RATE_COOLDOWN_SECONDS = 60;

function normalizeEmailInput(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH) return null;
  return email;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Replicates the password-strength rules used by PUT /api/auth/password. */
function validateNewPassword(newPassword: string, minLength: number): string | null {
  if (typeof newPassword !== 'string' || newPassword.length < minLength || newPassword.length > 128) {
    return `密码长度应在${minLength}-128 位之间`;
  }
  const hasLetter = /[a-zA-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSymbol = /[^a-zA-Z0-9]/.test(newPassword);
  if (Number(hasLetter) + Number(hasNumber) + Number(hasSymbol) < 2) {
    return '密码需包含字母、数字和特殊字符中的至少两种';
  }
  return null;
}

export function createPasswordResetRouter() {
  const router = Router();

  // Request a password-reset email. Always returns the same generic success
  // whether or not the email is registered, to prevent account enumeration.
  router.post('/api/auth/forgot-password', apiLimiter, async (req: Request, res: Response) => {
    const { email, captchaId, captchaText } = req.body ?? {};
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

    // Verify graphical captcha (prevents automated email bombing).
    const captchaOk = await verifyCaptcha(captchaId, captchaText);
    if (!captchaOk) {
      res.status(400).json({ detail: '图形验证码错误或已过期' });
      return;
    }

    // Per-email cooldown.
    const cooldownSeconds = Math.max(10, RATE_COOLDOWN_SECONDS);
    const allowed = await checkRateLimit(`pwreset_rate:${normalizedEmail}`, cooldownSeconds);
    if (!allowed) {
      res.status(429).json({ detail: `请求太频繁，请${cooldownSeconds}秒后重试` });
      return;
    }

    // Look up the user — but respond identically whether or not found.
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
    if (user) {
      const token = randomBytes(32).toString('hex');
      await storePasswordResetToken(token, user.id, RESET_TOKEN_TTL_SECONDS);
      try {
        await sendPasswordResetEmail(normalizedEmail, token, requestSiteUrl(req));
      } catch (err: unknown) {
        await consumePasswordResetToken(token).catch(() => {});
        logger.error({ err: err }, '[password-reset] Email send failed');
        res.status(500).json({ detail: '邮件发送失败，请检查邮件服务配置或稍后重试' });
        return;
      }
    }

    res.json({ message: '如果该邮箱已注册，重置邮件已发送' });
  });

  // Set a new password using a single-use reset token.
  router.post('/api/auth/reset-password', apiLimiter, async (req: Request, res: Response) => {
    const { token, newPassword } = req.body ?? {};
    if (typeof token !== 'string' || !token || typeof newPassword !== 'string' || !newPassword) {
      res.status(400).json({ detail: '参数不完整' });
      return;
    }

    const userId = await consumePasswordResetToken(token);
    if (!userId) {
      res.status(400).json({ detail: '重置链接无效或已过期，请重新申请' });
      return;
    }

    const passwordMinLength = Math.max(
      6,
      Math.floor(Number(await getSetting<number>('security_password_min_length')) || 8),
    );
    const strengthError = validateNewPassword(newPassword, passwordMinLength);
    if (strengthError) {
      res.status(400).json({ detail: strengthError });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });

    res.json({ message: '密码重置成功' });
  });

  return router;
}
