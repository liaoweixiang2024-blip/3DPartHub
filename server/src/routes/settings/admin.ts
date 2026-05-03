import { Router, Response } from "express";
import { sendTestEmail } from "../../lib/email.js";
import { getAllSettings, setSettings } from "../../lib/settings.js";
import { checkUpdateAvailable } from "../../lib/update.js";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { adminOnly } from "./common.js";

export function createSettingsAdminRouter() {
  const router = Router();

  // Admin: check for updates (version detection only, no auto-update)
  router.get("/api/settings/update/check", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const result = await checkUpdateAvailable();
      res.json(result);
    } catch {
      res.json({ current: "unknown", remote: "unknown", updateAvailable: false });
    }
  });

  // Admin: get all settings
  router.get("/api/settings", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const settings = await getAllSettings();
      if (settings.smtp_pass) settings.smtp_pass = "********";
      res.json(settings);
    } catch {
      res.status(500).json({ detail: "获取设置失败" });
    }
  });

  // Admin: update settings
  router.put("/api/settings", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      await setSettings(req.body);
      const settings = await getAllSettings();
      if (settings.smtp_pass) settings.smtp_pass = "********";
      res.json(settings);
    } catch {
      res.status(500).json({ detail: "更新设置失败" });
    }
  });

  // Admin: send a test email using the saved SMTP settings and email template.
  router.post("/api/settings/email/test", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      res.status(400).json({ detail: "请输入正确的测试收件邮箱" });
      return;
    }
    try {
      await sendTestEmail(to);
      res.json({ message: "测试邮件已发送" });
    } catch (err: any) {
      res.status(500).json({ detail: "测试邮件发送失败" });
    }
  });

  // Admin: get current client IP (for IP whitelist configuration)
  router.get("/api/settings/my-ip", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const forwarded = req.headers["x-forwarded-for"];
    const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim()
      : typeof req.headers["x-real-ip"] === "string" ? req.headers["x-real-ip"]
      : req.ip || req.socket.remoteAddress || "unknown";
    res.json({ ip });
  });

  return router;
}
