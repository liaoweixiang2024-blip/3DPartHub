import { Request, Response, NextFunction } from 'express';
import { cacheGet } from '../lib/cache.js';
import {
  verifyAccessToken,
  isTokenRevoked,
  revokeAllTokensBefore,
  type TokenPayload,
  type VerifiedTokenPayload,
} from '../lib/jwt.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

const ACCESS_COOKIE = 'access_token';

function readCookie(req: Request, name: string): string | undefined {
  const cookie = req.headers.cookie;
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) {
      try {
        return decodeURIComponent(rawValue.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function getRequestToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return readCookie(req, ACCESS_COOKIE);
}

export function verifyRequestToken(req: Request): VerifiedTokenPayload | null {
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
    (method === 'GET' && path === '/api/auth/profile') ||
    (method === 'PUT' && path === '/api/auth/password') ||
    path === '/api/auth/logout'
  );
}

export async function getVerifiedRequestUser(
  req: Request,
): Promise<{ payload: TokenPayload; mustChangePassword: boolean } | null> {
  const payload = verifyRequestToken(req);
  if (!payload?.userId) return null;

  if (payload.iat && (await isTokenRevoked(payload.userId, payload.iat))) return null;

  const revokeBefore = await cacheGet<number>(`token_revoke_before:${payload.userId}`);
  if (revokeBefore && payload.iat && payload.iat < revokeBefore) return null;

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
    mustChangePassword: user.mustChangePassword,
  };
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  let verified: Awaited<ReturnType<typeof getVerifiedRequestUser>>;
  try {
    verified = await getVerifiedRequestUser(req);
  } catch (err) {
    logger.error({ err }, '[auth] Failed to verify request user');
    res.status(500).json({ detail: '认证服务暂不可用' });
    return;
  }

  if (!verified) {
    res.status(401).json({ detail: '未提供认证令牌' });
    return;
  }

  req.user = verified.payload;
  if (verified.mustChangePassword && !mayContinueBeforePasswordChange(req)) {
    res.status(403).json({
      detail: '首次登录请先修改密码',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    return;
  }

  next();
}

export async function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const verified = await getVerifiedRequestUser(req);
    if (verified) {
      req.user = verified.payload;
      if (verified.mustChangePassword && !mayContinueBeforePasswordChange(req)) {
        res.status(403).json({
          detail: '首次登录请先修改密码',
          code: 'PASSWORD_CHANGE_REQUIRED',
        });
        return;
      }
    }
  } catch {
    // Ignore — proceed without auth
  }
  next();
}
