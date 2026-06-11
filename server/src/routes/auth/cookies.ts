import { Request, Response, type CookieOptions } from 'express';

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';
const ACCESS_COOKIE_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function requestIsHttps(req: Request): boolean {
  // Only trust req.secure (TLS termination at app level) or explicit env override.
  // Do NOT trust x-forwarded-proto from the client — only trusted proxies set it.
  return req.secure || process.env.AUTH_COOKIE_SECURE === 'true';
}

function authCookieOptions(req: Request, maxAge?: number): CookieOptions {
  const options: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: requestIsHttps(req),
    path: '/',
  };
  if (maxAge) options.maxAge = maxAge;
  return options;
}

export function setAuthCookies(
  req: Request,
  res: Response,
  accessToken: string,
  refreshToken?: string,
  options: { rememberMe?: boolean; persistRefresh?: boolean } = {},
): void {
  const persistent = options.rememberMe || options.persistRefresh;
  res.cookie(ACCESS_COOKIE, accessToken, authCookieOptions(req, persistent ? ACCESS_COOKIE_MAX_AGE_MS : undefined));
  if (refreshToken) {
    res.cookie(
      REFRESH_COOKIE,
      refreshToken,
      authCookieOptions(req, persistent ? REFRESH_COOKIE_MAX_AGE_MS : undefined),
    );
  }
}

export function clearAuthCookies(req: Request, res: Response): void {
  const base: CookieOptions = { path: '/', sameSite: 'lax', secure: requestIsHttps(req) };
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}

export function readCookie(req: Request, name: string): string | undefined {
  const cookie = req.headers.cookie;
  if (!cookie) return undefined;
  // Take the last occurrence if multiple cookies with the same name exist,
  // matching browser behavior where later cookies override earlier ones.
  let lastValue: string | undefined;
  for (const part of cookie.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) {
      try {
        lastValue = decodeURIComponent(rawValue.join('='));
      } catch {
        // skip malformed value
      }
    }
  }
  return lastValue;
}

export { REFRESH_COOKIE };
