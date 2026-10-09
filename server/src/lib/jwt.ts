import jwt from 'jsonwebtoken';
import { cacheGet, cacheSet, prefixedRedisKey, redis } from './cache.js';
import { config } from './config.js';

const JWT_SECRET = config.jwtSecret;
const ACCESS_EXPIRES = config.jwtExpiresIn as jwt.SignOptions['expiresIn'];
const REFRESH_EXPIRES = '30d';
// 宽限窗口 = 「轮换响应被强刷/断网掐断、Set-Cookie 丢失后，cookie 罐还能自愈」
// 的时间。每次宽限命中都会换发新 cookie（见 session.ts），只要窗口内发生任意
// 一次刷新，卡死在已用令牌上的罐子即复活；窗口外重放仍按疑似泄露吊销全 family。
// 30s 挡不住「强刷一次 → 隔一分钟再回来」的真实节奏，放宽到 120s。
export const REFRESH_REUSE_GRACE_SECONDS = 120;
// 「该 family 已被轮换过」的终态标记寿命。必须 ≥ refresh token 有效期（30d），
// 否则标记先于 token 过期消失，旧 token 重放会被误判为首次轮换而重新签发——
// 偷到的历史 refresh cookie 等 31 秒重放即可与受害者会话永久并行（安全洞）。
export const REFRESH_USED_TTL_SECONDS = 31 * 24 * 3600;

export interface TokenPayload {
  userId: string;
  role: string;
  tokenType?: 'access' | 'refresh';
  rememberMe?: boolean;
}

export type VerifiedTokenPayload = TokenPayload & {
  tokenType: 'access' | 'refresh';
  iat: number;
  /** 标准 JWT 过期时间戳（秒），签发时由 jsonwebtoken 注入 */
  exp?: number;
  jti?: string;
  familyId?: string;
};

function tokenBlacklistKey(userId: string, iat: number) {
  return `token_blacklist:${userId}:${iat}`;
}

function refreshTokenFamilyKey(userId: string, familyId: string) {
  return `refresh_family:${userId}:${familyId}`;
}

/** family 终态标记：已被轮换/登出，活到 refresh token 自然过期 */
function refreshTokenFamilyUsedKey(userId: string, familyId: string) {
  return `refresh_family_used:${userId}:${familyId}`;
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
  const key = refreshTokenFamilyUsedKey(userId, familyId);
  const val = await cacheGet<string>(key);
  return val === '1';
}

export interface RefreshRotationResult {
  ok: boolean;
  /** true = 该 family 之前已在宽限窗口内轮换过一次（并发重放，非攻击） */
  usedBefore: boolean;
}

export async function checkAndRevokeRefreshFamily(userId: string, familyId: string): Promise<RefreshRotationResult> {
  // 同 revokeAllTokensBefore：eval 直写必须带 key 前缀，与读方 cacheGet 一致
  // 双 key 设计：KEYS[1]=grace（30s 并发宽限标记）、KEYS[2]=used（终态标记，活过 token 寿命）。
  // grace 在窗口内自然过期，之后只剩 used —— 重放不再被误判为首次轮换。
  const graceKey = prefixedRedisKey(refreshTokenFamilyKey(userId, familyId));
  const usedKey = prefixedRedisKey(refreshTokenFamilyUsedKey(userId, familyId));
  try {
    const result = await redis.eval(
      `local grace = redis.call("GET", KEYS[1])
       if grace == "grace" then return 2 end
       local used = redis.call("GET", KEYS[2])
       if used == "1" then return 0 end
       redis.call("SET", KEYS[1], "grace", "EX", ARGV[1])
       redis.call("SET", KEYS[2], "1", "EX", ARGV[2])
       return 1`,
      2,
      graceKey,
      usedKey,
      String(REFRESH_REUSE_GRACE_SECONDS),
      String(REFRESH_USED_TTL_SECONDS),
    );
    // Lua 返回值：0 = family 已轮换/吊销（宽限外的重放，按泄露处理）；1 = 首次轮换；2 = 宽限窗口内并发重放
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
  // 登出：写终态标记并清掉宽限标记（有 used 无 grace → 重放一律判 0）
  const graceKey = prefixedRedisKey(refreshTokenFamilyKey(userId, familyId));
  const usedKey = prefixedRedisKey(refreshTokenFamilyUsedKey(userId, familyId));
  await redis.eval(
    `redis.call("SET", KEYS[1], "1", "EX", ARGV[1])
     redis.call("DEL", KEYS[2])`,
    2,
    usedKey,
    graceKey,
    String(REFRESH_USED_TTL_SECONDS),
  );
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
