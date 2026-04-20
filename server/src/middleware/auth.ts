import { Request, Response, NextFunction } from "express";
import { verifyToken, type TokenPayload } from "../lib/jwt.js";

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ detail: "未提供认证令牌" });
    return;
  }

  const token = header.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ detail: "令牌无效或已过期" });
  }
}
