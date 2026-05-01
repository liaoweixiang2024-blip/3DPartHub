import { Router, Request, Response } from "express";
import { randomInt } from "node:crypto";
import { generateCaptcha, verifyCaptcha, checkRateLimit, storeEmailCode, verifyEmailCode } from "../../lib/captcha.js";
import { sendVerifyCode } from "../../lib/email.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/jwt.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { prisma } from "../../lib/prisma.js";
import { getSetting } from "../../lib/settings.js";
import { clearAuthCookies, readCookie, REFRESH_COOKIE, setAuthCookies } from "./cookies.js";

export function createAuthSessionRouter() {
  const router = Router();

  // Generate graphical captcha
  router.get("/api/auth/captcha", async (_req: Request, res: Response) => {
    try {
      const ttlSeconds = await getSetting<number>("security_captcha_ttl_seconds");
      const result = await generateCaptcha(Math.max(60, Math.floor(Number(ttlSeconds) || 300)));
      res.json(result);
    } catch {
      res.status(500).json({ detail: "生成验证码失败" });
    }
  });

  // Send email verification code
  router.post("/api/auth/email-code", async (req: Request, res: Response) => {
    const { email, captchaId, captchaText } = req.body;
    if (!email || !captchaId || !captchaText) {
      res.status(400).json({ detail: "参数不完整" });
      return;
    }

    // Verify graphical captcha
    const captchaOk = await verifyCaptcha(captchaId, captchaText);
    if (!captchaOk) {
      res.status(400).json({ detail: "图形验证码错误或已过期" });
      return;
    }

    const cooldownSeconds = Math.max(10, Math.floor(Number(await getSetting<number>("security_email_code_cooldown_seconds")) || 60));
    const emailCodeTtlSeconds = Math.max(60, Math.floor(Number(await getSetting<number>("security_email_code_ttl_seconds")) || 600));
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
      res.json({ message: "验证码已发送" });
    } catch (err: any) {
      res.status(500).json({ detail: err.message || "邮件发送失败" });
    }
  });

  router.post("/api/auth/register", async (req: Request, res: Response) => {
    // Check if registration is allowed
    const allowRegister = await getSetting<boolean>("allow_register");
    if (!allowRegister) {
      res.status(403).json({ detail: "注册功能已关闭" });
      return;
    }

    const { username, email, password, emailCode, phone, company } = req.body;

    if (!username || !email || !password || !emailCode) {
      res.status(400).json({ detail: "所有字段不能为空" });
      return;
    }

    // Verify email code
    const codeOk = await verifyEmailCode(email, emailCode);
    if (!codeOk) {
      res.status(400).json({ detail: "邮箱验证码错误或已过期" });
      return;
    }

    const passwordMinLength = Math.max(6, Math.floor(Number(await getSetting<number>("security_password_min_length")) || 8));
    const usernameMinLength = Math.max(1, Math.floor(Number(await getSetting<number>("security_username_min_length")) || 2));
    const usernameMaxLength = Math.max(usernameMinLength, Math.floor(Number(await getSetting<number>("security_username_max_length")) || 32));

    if (password.length < passwordMinLength) {
      res.status(400).json({ detail: `密码长度至少${passwordMinLength}位` });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ detail: "邮箱格式不正确" });
      return;
    }

    if (username.length < usernameMinLength || username.length > usernameMaxLength) {
      res.status(400).json({ detail: `用户名长度应在${usernameMinLength}-${usernameMaxLength}位之间` });
      return;
    }

    try {
      const existing = await prisma.user.findFirst({
        where: { OR: [{ username }, { email }] },
      });
      if (existing) {
        res.status(409).json({ detail: "用户名或邮箱已存在" });
        return;
      }

      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: { username, email, passwordHash, phone: phone || null, company: company || null },
        select: { id: true, username: true, email: true, role: true, createdAt: true },
      });

      const payload = { userId: user.id, role: user.role };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);
      setAuthCookies(req, res, accessToken, refreshToken, { rememberMe: true });

      res.json({
        user,
        tokens: { accessToken },
      });
    } catch (err) {
      res.status(500).json({ detail: "注册失败" });
    }
  });

  router.post("/api/auth/login", async (req: Request, res: Response) => {
    const { email, password, rememberMe } = req.body;

    if (!email || !password) {
      res.status(400).json({ detail: "邮箱和密码不能为空" });
      return;
    }

    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        res.status(401).json({ detail: "邮箱或密码错误" });
        return;
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ detail: "邮箱或密码错误" });
        return;
      }

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
      res.status(500).json({ detail: "登录失败" });
    }
  });

  router.post("/api/auth/refresh", async (req: Request, res: Response) => {
    const { refreshToken: bodyRefreshToken } = req.body;
    const refreshToken = bodyRefreshToken || readCookie(req, REFRESH_COOKIE);
    if (!refreshToken) {
      res.status(400).json({ detail: "缺少 refresh token" });
      return;
    }

    try {
      const payload = verifyRefreshToken(refreshToken);
      // Verify user still exists in database
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, role: true },
      });
      if (!user) {
        res.status(401).json({ detail: "用户不存在，请重新登录" });
        return;
      }
      const accessToken = signAccessToken({ userId: user.id, role: user.role });
      setAuthCookies(req, res, accessToken);
      res.json({ accessToken });
    } catch {
      res.status(401).json({ detail: "refresh token 无效或已过期" });
    }
  });

  router.post("/api/auth/logout", (req: Request, res: Response) => {
    clearAuthCookies(req, res);
    res.json({ success: true });
  });

  return router;
}
