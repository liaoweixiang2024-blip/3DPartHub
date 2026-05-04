import rateLimit, { type Options, type Store } from 'express-rate-limit';
import helmet from 'helmet';
import Redis from 'ioredis';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

class RedisRateLimitStore implements Store {
  prefix: string;
  localKeys = false;
  private windowMs = 60_000;
  private redis: Redis;

  constructor(prefix: string) {
    this.prefix = `rate-limit:${prefix}:`;
    this.redis = new Redis(config.redisUrl, {
      connectTimeout: 2000,
      commandTimeout: 1000,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });
    this.redis.on('error', (err) => {
      logger.error({ err, prefix }, 'Rate limit Redis error');
    });
  }

  init(options: Options) {
    this.windowMs = Number(options.windowMs) || this.windowMs;
  }

  private key(key: string) {
    return `${this.prefix}${key}`;
  }

  async increment(key: string) {
    const redisKey = this.key(key);
    const [hitsRaw, ttlRaw] = (await this.redis.eval(
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
    const exists = await this.redis.exists(redisKey);
    if (exists) await this.redis.decr(redisKey);
  }

  async resetKey(key: string) {
    await this.redis.del(this.key(key));
  }

  async resetAll() {
    const stream = this.redis.scanStream({ match: `${this.prefix}*`, count: 100 });
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (keys: string[]) => {
        if (keys.length === 0) return;
        stream.pause();
        this.redis
          .del(...keys)
          .then(() => stream.resume())
          .catch(reject);
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
  }

  async shutdown() {
    this.redis.disconnect();
  }
}

function createLimiter(prefix: string, options: Partial<Options>) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: false,
    store: new RedisRateLimitStore(prefix),
    ...options,
  });
}

// Rate limiting configurations
export const apiLimiter = createLimiter('api', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5000,
  max: 5000,
  message: { success: false, message: '请求过于频繁，请稍后再试' },
});

export const uploadLimiter = createLimiter('upload', {
  windowMs: 60 * 60 * 1000,
  limit: 200,
  max: 200,
  message: { success: false, message: '上传次数超出限制' },
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
  message: { success: false, message: '下载请求过于频繁，请稍后再试' },
});

export const mutationLimiter = createLimiter('mutation', {
  windowMs: 15 * 60 * 1000,
  limit: 500,
  max: 500,
  message: { success: false, message: '操作过于频繁，请稍后再试' },
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
