import { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";

export function param(req: { params: Record<string, string | string[]> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

export function adminOnly(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return false;
  }
  return true;
}
