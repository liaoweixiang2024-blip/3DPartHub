import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { cacheGet, cacheSet, redis } from "./cache.js";

const JWT_SECRET = config.jwtSecret;
const ACCESS_EXPIRES = config.jwtExpiresIn as jwt.SignOptions["expiresIn"];
const REFRESH_EXPIRES = "30d";

export interface TokenPayload {
  userId: string;
  role: string;
  tokenType?: "access" | "refresh";
}

export type VerifiedTokenPayload = TokenPayload & {
  tokenType: "access" | "refresh";
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
  const key = `token_revoke_before:${userId}`;
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
  await cacheSet(key, "1", ttlSeconds);
}

export async function isRefreshTokenRevoked(userId: string, familyId: string): Promise<boolean> {
  const key = refreshTokenFamilyKey(userId, familyId);
  const val = await cacheGet<string>(key);
  return val === "revoked";
}

export async function checkAndRevokeRefreshFamily(userId: string, familyId: string): Promise<boolean> {
  const key = refreshTokenFamilyKey(userId, familyId);
  const result = await redis.eval(
    `local val = redis.call("GET", KEYS[1])
     if val == "revoked" then return 0 end
     redis.call("SET", KEYS[1], "revoked", "EX", ARGV[1])
     return 1`,
    1,
    key,
    String(31 * 24 * 3600),
  );
  return result === 1;
}

export async function revokeRefreshFamily(userId: string, familyId: string): Promise<void> {
  const key = refreshTokenFamilyKey(userId, familyId);
  await cacheSet(key, "revoked", 31 * 24 * 3600);
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign({ userId: payload.userId, role: payload.role, tokenType: "access" }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
}

export function signRefreshToken(payload: TokenPayload & { familyId?: string }): string {
  return jwt.sign({ userId: payload.userId, role: payload.role, tokenType: "refresh", familyId: payload.familyId || `fam_${Date.now().toString(36)}` }, JWT_SECRET, { expiresIn: REFRESH_EXPIRES });
}

export function verifyToken(token: string): VerifiedTokenPayload {
  const payload = jwt.verify(token, JWT_SECRET) as VerifiedTokenPayload;
  if (payload.tokenType !== "access" && payload.tokenType !== "refresh") {
    throw new Error("Invalid token type");
  }
  return payload;
}

export function verifyAccessToken(token: string): VerifiedTokenPayload {
  const payload = verifyToken(token);
  if (payload.tokenType !== "access") throw new Error("Invalid access token");
  return payload;
}

export function verifyRefreshToken(token: string): VerifiedTokenPayload {
  const payload = verifyToken(token);
  if (payload.tokenType !== "refresh") throw new Error("Invalid refresh token");
  return payload;
}
