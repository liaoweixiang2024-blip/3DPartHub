import jwt from "jsonwebtoken";
import { config } from "./config.js";

const JWT_SECRET = config.jwtSecret;
const ACCESS_EXPIRES = "24h";
const REFRESH_EXPIRES = "30d";

export interface TokenPayload {
  userId: string;
  role: string;
  tokenType?: "access" | "refresh";
}

export type VerifiedTokenPayload = TokenPayload & {
  tokenType: "access" | "refresh";
};

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign({ userId: payload.userId, role: payload.role, tokenType: "access" }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign({ userId: payload.userId, role: payload.role, tokenType: "refresh" }, JWT_SECRET, { expiresIn: REFRESH_EXPIRES });
}

export function verifyToken(token: string): VerifiedTokenPayload {
  const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
  if (payload.tokenType !== "access" && payload.tokenType !== "refresh") {
    throw new Error("Invalid token type");
  }
  return payload as VerifiedTokenPayload;
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
