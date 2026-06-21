import type { Request } from 'express';
import rateLimit, { ipKeyGenerator, type Options, type Store } from 'express-rate-limit';
import helmet from 'helmet';
import { redis } from '../lib/cache.js';
import { logger } from '../lib/logger.js';
import { getCachedSettings } from '../lib/settings.js';
import { getVerifiedRequestUser, verifyRequestToken, type AuthRequest } from './auth.js';

class RedisRateLimitStore implements Store {
  prefix: string;
  localKeys = false;
  private windowMs = 60_000;

  constructor(prefix: string) {
    this.prefix = `rate-limit:${prefix}:`;
  }

  init(options: Options) {
    this.windowMs = Number(options.windowMs) || this.windowMs;
  }

  private key(key: string) {
    return `${this.prefix}${key}`;
  }

  async increment(key: string) {
    const redisKey = this.key(key);
    const [hitsRaw, ttlRaw] = (await redis.eval(
      `
      local hits = redis.call("INCR", KEYS[1])
      local ttl = redis.call("PTTL", KEYS[1])
      if ttl < 0 then
        redis.call("PEXPIRE", KEYS[1], ARGV[1])
        ttl = tonumber(ARGV[1])
      end
      return { hits, ttl }
      `,
      1,
      redisKey,
      String(this.windowMs),
    )) as [number | string, number | string];

    const totalHits = Number(hitsRaw) || 1;
    const ttl = Math.max(0, Number(ttlRaw) || this.windowMs);
    return {
      totalHits,
      resetTime: new Date(Date.now() + ttl),
    };
  }

  async decrement(key: string) {
    const redisKey = this.key(key);
    const exists = await redis.exists(redisKey);
    if (exists) await redis.decr(redisKey);
  }

  async resetKey(key: string) {
    await redis.del(this.key(key));
  }

  async resetAll() {
    const pattern = `${this.prefix}*`;
    await redis.eval(
      `
      local cursor = '0'
      repeat
        local result = redis.call('SCAN', cursor, 'MATCH', ARGV[1], 'COUNT', 200)
        cursor = result[1]
        local keys = result[2]
        if #keys > 0 then
          redis.call('DEL', unpack(keys))
        end
      until cursor == '0'
      `,
      0,
      pattern,
    );
  }

  async shutdown() {
    // shared connection — do not disconnect
  }
}

type LimiterOptions = Partial<Options> & {
  skipAuthenticatedAdmin?: boolean;
};

async function shouldSkipForAuthenticatedAdmin(req: Request) {
  if ((req as AuthRequest).user?.role === 'ADMIN') return true;

  const tokenPayload = verifyRequestToken(req);
  if (tokenPayload?.role !== 'ADMIN') return false;

  try {
    const verified = await getVerifiedRequestUser(req);
    if (verified?.payload.role !== 'ADMIN' || verified.mustChangePassword) return false;
    (req as AuthRequest).user = verified.payload;
    return true;
  } catch (err) {
    logger.error({ err }, '[rate-limit] Failed to verify admin bypass');
    return false;
  }
}

function createLimiter(prefix: string, options: LimiterOptions) {
  const { skipAuthenticatedAdmin = false, skip, ...rateLimitOptions } = options;

  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: false,
    store: new RedisRateLimitStore(prefix),
    ...rateLimitOptions,
    skip: async (req, res) => {
      if (skipAuthenticatedAdmin && (await shouldSkipForAuthenticatedAdmin(req))) return true;
      return skip ? Boolean(await skip(req, res)) : false;
    },
  });
}

function userOrIpKey(req: Request) {
  const userId = (req as AuthRequest).user?.userId;
  if (userId) return `user:${userId}`;
  return req.ip ? `ip:${ipKeyGenerator(req.ip)}` : 'ip:unknown';
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

const TEMP_PREVIEW_UPLOAD_LIMIT_PER_HOUR = intEnv('TEMP_PREVIEW_UPLOAD_LIMIT_PER_HOUR', 20, 1, 200);

/**
 * 动态读取 API 限流上限：每请求读最新 `api_rate_limit` 设置（接通后台配置），
 * 空/无效回退 5000，钳到 1–100000。之前 apiLimiter 硬编码 5000，设置被忽略。
 */
function resolveApiRateLimit(): number {
  const raw = Number(getCachedSettings().api_rate_limit);
  if (!Number.isFinite(raw) || raw <= 0) return 5000;
  return Math.min(100000, Math.max(1, Math.floor(raw)));
}

// Rate limiting configurations
export const apiLimiter = createLimiter('api', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: resolveApiRateLimit,
  max: resolveApiRateLimit,
  skipAuthenticatedAdmin: true,
  message: { success: false, message: '请求过于频繁，请稍后再试' },
});

export const uploadLimiter = createLimiter('upload', {
  windowMs: 60 * 60 * 1000,
  limit: 200,
  max: 200,
  skipAuthenticatedAdmin: true,
  message: { success: false, message: '上传次数超出限制' },
});

export const tempPreviewUploadLimiter = createLimiter('temp-preview-upload', {
  windowMs: 60 * 60 * 1000,
  limit: TEMP_PREVIEW_UPLOAD_LIMIT_PER_HOUR,
  max: TEMP_PREVIEW_UPLOAD_LIMIT_PER_HOUR,
  keyGenerator: userOrIpKey,
  message: { detail: '临时看图上传过于频繁，请稍后再试' },
});

export const authLimiter = createLimiter('auth', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 50,
  max: 50,
  message: { success: false, message: '登录尝试过多，请稍后再试' },
});

export const searchLimiter = createLimiter('search', {
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 600,
  max: 600,
  skipAuthenticatedAdmin: true,
  message: { success: false, message: '搜索请求过于频繁，请稍后再试' },
});

export const refreshLimiter = createLimiter('refresh', {
  windowMs: 15 * 60 * 1000,
  limit: 100,
  max: 100,
  message: { success: false, message: '令牌刷新过于频繁，请重新登录' },
});

export const tokenGenLimiter = createLimiter('token-gen', {
  windowMs: 5 * 60 * 1000,
  limit: 100,
  max: 100,
  skipAuthenticatedAdmin: true,
  message: { success: false, message: '下载请求过于频繁，请稍后再试' },
});

export const mutationLimiter = createLimiter('mutation', {
  windowMs: 15 * 60 * 1000,
  limit: 500,
  max: 500,
  skipAuthenticatedAdmin: true,
  message: { success: false, message: '操作过于频繁，请稍后再试' },
});

export const demandSubmissionLimiter = createLimiter('demand-submission', {
  windowMs: 10 * 60 * 1000,
  limit: 8,
  max: 8,
  keyGenerator: userOrIpKey,
  skipAuthenticatedAdmin: true,
  message: { success: false, message: '提交过于频繁，请稍后再试' },
});

export const conversationMessageLimiter = createLimiter('conversation-message', {
  windowMs: 60 * 1000,
  limit: 30,
  max: 30,
  keyGenerator: userOrIpKey,
  skipAuthenticatedAdmin: true,
  message: { success: false, message: '发送过于频繁，请稍后再试' },
});

export const conversationAttachmentLimiter = createLimiter('conversation-attachment', {
  windowMs: 60 * 60 * 1000,
  limit: 60,
  max: 60,
  keyGenerator: userOrIpKey,
  skipAuthenticatedAdmin: true,
  message: { success: false, message: '附件上传过于频繁，请稍后再试' },
});

// Helmet security configuration
const isDev = process.env.NODE_ENV !== 'production';

export const securityHeaders = helmet({
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'base-uri': ["'self'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'self'"],
      'form-action': ["'self'"],
      'script-src': [
        "'self'",
        // Vite HMR needs unsafe-inline in dev; production bundles are file-based
        ...(isDev ? ["'unsafe-inline'"] : []),
        "'wasm-unsafe-eval'",
        'blob:',
      ],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'worker-src': ["'self'", 'blob:'],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
});
