import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type TokenPayload } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

const ACCESS_COOKIE = "access_token";

function readCookie(req: Request, name: string): string | undefined {
  const cookie = req.headers.cookie;
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function getRequestToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return readCookie(req, ACCESS_COOKIE);
}

export function verifyRequestToken(req: Request): TokenPayload | null {
  const token = getRequestToken(req);
  if (!token) return null;
  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

function mayContinueBeforePasswordChange(req: Request): boolean {
  const method = req.method.toUpperCase();
  const path = req.path;
  return (
    (method === "GET" && path === "/api/auth/profile") ||
    (method === "PUT" && path === "/api/auth/password") ||
    path === "/api/auth/logout"
  );
}

export async function getVerifiedRequestUser(req: Request): Promise<{ payload: TokenPayload; mustChangePassword: boolean } | null> {
  const payload = verifyRequestToken(req);
  if (!payload?.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, role: true, mustChangePassword: true },
  });
  if (!user) return null;

  return {
    payload: {
      userId: user.id,
      role: user.role,
      tokenType: payload.tokenType,
    },
    mustChangePassword: user.role === "ADMIN" && user.mustChangePassword,
  };
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  let verified: Awaited<ReturnType<typeof getVerifiedRequestUser>>;
  try {
    verified = await getVerifiedRequestUser(req);
  } catch (err) {
    console.error("[auth] Failed to verify request user:", err);
    res.status(500).json({ detail: "认证服务暂不可用" });
    return;
  }

  if (!verified) {
    res.status(401).json({ detail: "未提供认证令牌" });
    return;
  }

  req.user = verified.payload;
  if (verified.mustChangePassword && !mayContinueBeforePasswordChange(req)) {
    res.status(403).json({
      detail: "首次登录请先修改密码",
      code: "PASSWORD_CHANGE_REQUIRED",
    });
    return;
  }

  next();
}
