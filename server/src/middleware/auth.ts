import { Request, Response, NextFunction } from "express";
import { verifyToken, type TokenPayload } from "../lib/jwt.js";

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return firstString(value[0]);
  return undefined;
}

export function getRequestToken(req: Request, options: { allowQueryToken?: boolean } = {}): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  if (!options.allowQueryToken) return undefined;
  return firstString(req.query.token);
}

export function verifyRequestToken(
  req: Request,
  options: { allowQueryToken?: boolean } = {}
): TokenPayload | null {
  const token = getRequestToken(req, options);
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const payload = verifyRequestToken(req);
  if (!payload) {
    res.status(401).json({ detail: "未提供认证令牌" });
    return;
  }

  req.user = payload;
  next();
}
