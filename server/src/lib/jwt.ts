import jwt from 'jsonwebtoken';
import { cacheGet, cacheSet, prefixedRedisKey, redis } from './cache.js';
import { config } from './config.js';

const JWT_SECRET = config.jwtSecret;
const ACCESS_EXPIRES = config.jwtExpiresIn as jwt.SignOptions['expiresIn'];
const REFRESH_EXPIRES = '30d';
// 旧 refresh token 在轮换后仍可用的宽限窗口：多标签页/PWA 窗口并发加载时
// 共享同一份 cookie，后到的请求拿旧 token 重放不是攻击。30s 覆盖页面并发
// 加载窗口，同时仍远小于 token TTL，真复用攻击最多也只多活 30 秒。
export const REFRESH_REUSE_GRACE_SECONDS = 30;

export interface TokenPayload {
  userId: string;
  role: string;
  tokenType?: 'access' | 'refresh';
  rememberMe?: boolean;
}

export type VerifiedTokenPayload = TokenPayload & {
  tokenType: 'access' | 'refresh';
  iat: number;
  jti?: string;
  familyId?: string;
};

function tokenBlacklistKey(userId: string, iat: number) {
  return `token_blacklist:${userId}:${iat}`;
}

function refreshTokenFamilyKey(userId: string, familyId: string) {
  return `refresh_family:${userId}:${familyId}`;
}

export async function isTokenRevoked(userId: string, iat: number): Promise<boolean> {
  const key = tokenBlacklistKey(userId, iat);
  const val = await cacheGet<string>(key);
  return val !== null;
}

export async function revokeAllTokensBefore(userId: string, beforeIat: number): Promise<void> {
  // 读方（auth.ts 的 cacheGet）带 Redis key 前缀，这里 eval 直写也必须带同一前缀，
  // 否则键永远读不到，「改角色/禁用即顶下线」会静默失效
  const key = prefixedRedisKey(`token_revoke_before:${userId}`);
  const ttl = 30 * 24 * 3600;
  await redis.eval(
    `local current = tonumber(redis.call("GET", KEYS[1]))
     if current and current >= tonumber(ARGV[1]) then return 0 end
     redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
     return 1`,
    1,
    key,
    String(beforeIat),
    String(ttl),
  );
}

export async function revokeToken(userId: string, iat: number, ttlSeconds = 30 * 24 * 3600): Promise<void> {
  const key = tokenBlacklistKey(userId, iat);
  await cacheSet(key, '1', ttlSeconds);
}

export async function isRefreshTokenRevoked(userId: string, familyId: string): Promise<boolean> {
  const key = refreshTokenFamilyKey(userId, familyId);
  const val = await cacheGet<string>(key);
  return val === 'revoked';
}

export interface RefreshRotationResult {
  ok: boolean;
  /** true = 该 family 之前已在宽限窗口内轮换过一次（并发重放，非攻击） */
  usedBefore: boolean;
}

export async function checkAndRevokeRefreshFamily(userId: string, familyId: string): Promise<RefreshRotationResult> {
  // 同 revokeAllTokensBefore：eval 直写必须带 key 前缀，与读方 cacheGet 一致
  const key = prefixedRedisKey(refreshTokenFamilyKey(userId, familyId));
  try {
    const result = await redis.eval(
      `local val = redis.call("GET", KEYS[1])
       if val == "revoked" then return 0 end
       if val == "grace" then return 2 end
       redis.call("SET", KEYS[1], "grace", "EX", ARGV[1])
       return 1`,
      1,
      key,
      String(REFRESH_REUSE_GRACE_SECONDS),
    );
    // Lua 返回值：0 = family 已吊销（宽限外的重放）；1 = 首次轮换；2 = 宽限窗口内并发重放
    if (result === 0) return { ok: false, usedBefore: false };
    if (result === 2) return { ok: true, usedBefore: true };
    return { ok: true, usedBefore: false };
  } catch {
    // Redis 瞬时抖动（commandTimeout 仅 1s）不该把用户顶下线。
    // 此处 fail-open：按首次轮换放行。写不进宽限标记意味着窗口外的
    // 二次重放也拦不住一次，但 Redis 恢复后即恢复完整检测。
    return { ok: true, usedBefore: false };
  }
}

export async function revokeRefreshFamily(userId: string, familyId: string): Promise<void> {
  const key = refreshTokenFamilyKey(userId, familyId);
  await cacheSet(key, 'revoked', 31 * 24 * 3600);
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign({ userId: payload.userId, role: payload.role, tokenType: 'access' }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: ACCESS_EXPIRES,
  });
}

export function signRefreshToken(payload: TokenPayload & { familyId?: string }): string {
  return jwt.sign(
    {
      userId: payload.userId,
      role: payload.role,
      tokenType: 'refresh',
      familyId: payload.familyId || `fam_${Date.now().toString(36)}`,
      rememberMe: payload.rememberMe === true,
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: REFRESH_EXPIRES },
  );
}

export function verifyToken(token: string): VerifiedTokenPayload {
  // 显式固定算法：拒绝任何非 HS256 的 token（jsonwebtoken v9 已防 alg=none，这里再显式收窄）
  const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as VerifiedTokenPayload;
  if (payload.tokenType !== 'access' && payload.tokenType !== 'refresh') {
    throw new Error('Invalid token type');
  }
  return payload;
}

export function verifyAccessToken(token: string): VerifiedTokenPayload {
  const payload = verifyToken(token);
  if (payload.tokenType !== 'access') throw new Error('Invalid access token');
  return payload;
}

export function verifyRefreshToken(token: string): VerifiedTokenPayload {
  const payload = verifyToken(token);
  if (payload.tokenType !== 'refresh') throw new Error('Invalid refresh token');
  return payload;
}
