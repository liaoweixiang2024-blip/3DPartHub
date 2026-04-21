import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { signAccessToken, signRefreshToken, verifyToken } from "../lib/jwt.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { getSetting } from "../lib/settings.js";
import { generateCaptcha, verifyCaptcha, checkRateLimit, storeEmailCode, verifyEmailCode } from "../lib/captcha.js";
import { sendVerifyCode } from "../lib/email.js";

const router = Router();

// Generate graphical captcha
router.get("/api/auth/captcha", async (_req: Request, res: Response) => {
  try {
    const result = await generateCaptcha();
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

  // Rate limit: 60s per email
  const rateKey = `email_rate:${email}`;
  const allowed = await checkRateLimit(rateKey, 60);
  if (!allowed) {
    res.status(429).json({ detail: "发送太频繁，请60秒后重试" });
    return;
  }

  // Generate 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await storeEmailCode(email, code);

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

  const { username, email, password, emailCode } = req.body;

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

  if (password.length < 8) {
    res.status(400).json({ detail: "密码长度至少8位" });
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ detail: "邮箱格式不正确" });
    return;
  }

  if (username.length < 2 || username.length > 32) {
    res.status(400).json({ detail: "用户名长度应在2-32位之间" });
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
      data: { username, email, passwordHash },
      select: { id: true, username: true, email: true, role: true, createdAt: true },
    });

    const payload = { userId: user.id, role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    res.json({
      user,
      tokens: { accessToken, refreshToken },
    });
  } catch (err) {
    res.status(500).json({ detail: "注册失败" });
  }
});

router.post("/api/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;

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

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        createdAt: user.createdAt,
      },
      tokens: { accessToken, refreshToken },
    });
  } catch {
    res.status(500).json({ detail: "登录失败" });
  }
});

router.post("/api/auth/refresh", (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).json({ detail: "缺少 refresh token" });
    return;
  }

  try {
    const payload = verifyToken(refreshToken);
    const accessToken = signAccessToken({ userId: payload.userId, role: payload.role });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ detail: "refresh token 无效或已过期" });
  }
});

router.get("/api/auth/profile", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, username: true, email: true, role: true, mustChangePassword: true, company: true, phone: true, avatar: true, createdAt: true },
    });
    if (!user) {
      res.status(404).json({ detail: "用户不存在" });
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
  if (!oldPassword || !newPassword) {
    res.status(400).json({ detail: "请输入旧密码和新密码" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ detail: "新密码长度至少8位" });
    return;
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) { res.status(404).json({ detail: "用户不存在" }); return; }
    const valid = await verifyPassword(oldPassword, user.passwordHash);
    if (!valid) { res.status(401).json({ detail: "旧密码错误" }); return; }
    const hash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: req.user!.userId }, data: { passwordHash: hash, mustChangePassword: false } });
    res.json({ message: "密码修改成功" });
  } catch (err) {
    console.error("[password] change failed:", err);
    res.status(500).json({ detail: "密码修改失败" });
  }
});

// GET /api/auth/notification-prefs — get user's notification preferences
router.get("/api/auth/notification-prefs", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { metadata: true },
    });
    const meta = (user?.metadata as Record<string, any>) || {};
    const prefs = meta.notificationPrefs || {
      ticket: true,
      comment: true,
      favorite: true,
      model_conversion: true,
      download: false,
    };
    res.json(prefs);
  } catch {
    res.json({ ticket: true, comment: true, favorite: true, model_conversion: true, download: false });
  }
});

// PUT /api/auth/notification-prefs
router.put("/api/auth/notification-prefs", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const prefs = req.body;
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { metadata: true },
    });
    const meta = ((user?.metadata as Record<string, any>) || {}) as Record<string, any>;
    meta.notificationPrefs = prefs;
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { metadata: meta },
    });
    res.json(prefs);
  } catch {
    res.status(500).json({ detail: "更新通知偏好失败" });
  }
});

// Helper: check if user wants this notification type
export async function userWantsNotification(userId: string, type: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });
    const meta = (user?.metadata as Record<string, any>) || {};
    const prefs = meta.notificationPrefs;
    // If no prefs set, allow all
    if (!prefs) return true;
    return prefs[type] !== false;
  } catch {
    return true;
  }
}

// ---- Admin: User Management ----

function adminGuard(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return false;
  }
  return true;
}

// List users (admin)
router.get("/api/admin/users", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminGuard(req, res)) return;
  try {
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.page_size) || 20;
    const search = req.query.search as string | undefined;

    const where: any = {};
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
  if (!["ADMIN", "EDITOR", "VIEWER"].includes(role)) {
    res.status(400).json({ detail: "无效的角色" });
    return;
  }
  // Prevent self-demotion
  if (req.params.id === req.user!.userId && role !== "ADMIN") {
    res.status(400).json({ detail: "不能修改自己的角色" });
    return;
  }
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: { id: true, username: true, email: true, role: true },
    });
    res.json({ data: user });
  } catch (err: any) {
    if (err.code === "P2025") { res.status(404).json({ detail: "用户不存在" }); return; }
    res.status(500).json({ detail: "修改角色失败" });
  }
});

// Delete user (admin)
router.delete("/api/admin/users/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminGuard(req, res)) return;
  if (req.params.id === req.user!.userId) {
    res.status(400).json({ detail: "不能删除自己" });
    return;
  }
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ message: "用户已删除" });
  } catch (err: any) {
    if (err.code === "P2025") { res.status(404).json({ detail: "用户不存在" }); return; }
    res.status(500).json({ detail: "删除用户失败" });
  }
});

export default router;
