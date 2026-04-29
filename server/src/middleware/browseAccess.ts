import type { Request, Response } from "express";
import { getSetting } from "../lib/settings.js";
import { getVerifiedRequestUser, type AuthRequest } from "./auth.js";

export async function requireBrowseAccess(req: Request, res: Response): Promise<boolean> {
  const requireLogin = await getSetting<boolean>("require_login_browse");
  if (!requireLogin) return true;

  let verified: Awaited<ReturnType<typeof getVerifiedRequestUser>>;
  try {
    verified = await getVerifiedRequestUser(req);
  } catch (err) {
    console.error("[browse] Failed to verify request user:", err);
    res.status(500).json({ detail: "认证服务暂不可用" });
    return false;
  }

  if (!verified) {
    res.status(401).json({ detail: "需要登录后才能浏览模型" });
    return false;
  }
  if (verified.mustChangePassword) {
    res.status(403).json({ detail: "首次登录请先修改密码", code: "PASSWORD_CHANGE_REQUIRED" });
    return false;
  }

  (req as AuthRequest).user = verified.payload;

  return true;
}
