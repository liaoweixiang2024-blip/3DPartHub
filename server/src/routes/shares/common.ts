import { Response } from "express";
import { verifyProtectedResourceToken } from "../../lib/downloadTokenStore.js";
import type { AuthRequest } from "../../middleware/auth.js";

export const SHARE_ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

export function asSingleString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return undefined;
}

export function adminOnly(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return false;
  }
  return true;
}

export function hasShareAccess(shareId: string, hashedPassword: string | null, accessToken: unknown): boolean {
  if (!hashedPassword) return true;
  const token = asSingleString(accessToken);
  if (!token) return false;
  return Boolean(verifyProtectedResourceToken(token, "share-access", shareId));
}
