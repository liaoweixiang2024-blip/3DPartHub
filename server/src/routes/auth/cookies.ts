import { Request, Response, type CookieOptions } from "express";

const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";
const ACCESS_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function requestIsHttps(req: Request): boolean {
  return req.secure || req.headers["x-forwarded-proto"] === "https" || process.env.AUTH_COOKIE_SECURE === "true";
}

function authCookieOptions(req: Request, maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsHttps(req),
    path: "/",
    maxAge,
  };
}

export function setAuthCookies(req: Request, res: Response, accessToken: string, refreshToken?: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, authCookieOptions(req, ACCESS_COOKIE_MAX_AGE_MS));
  if (refreshToken) {
    res.cookie(REFRESH_COOKIE, refreshToken, authCookieOptions(req, REFRESH_COOKIE_MAX_AGE_MS));
  }
}

export function clearAuthCookies(req: Request, res: Response): void {
  const base: CookieOptions = { path: "/", sameSite: "lax", secure: requestIsHttps(req) };
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}

export function readCookie(req: Request, name: string): string | undefined {
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

export { REFRESH_COOKIE };
