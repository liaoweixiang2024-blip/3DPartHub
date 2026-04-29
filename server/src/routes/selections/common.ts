import { Response } from "express";
import { cacheDelByPrefix } from "../../lib/cache.js";
import type { AuthRequest } from "../../middleware/auth.js";

export function adminOnly(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return false;
  }
  return true;
}

export function asSingleString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return undefined;
}

export function isValidGroupImageFit(value: unknown): value is "cover" | "contain" | null {
  return value === "cover" || value === "contain" || value === null;
}

export async function invalidateSelectionCache() {
  await cacheDelByPrefix("cache:selections:");
}
