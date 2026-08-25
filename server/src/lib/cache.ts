import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger({ component: 'cache' });

const KEY_PREFIX = (process.env.REDIS_KEY_PREFIX || process.env.NODE_ENV || 'dev') + ':';

function pk(key: string): string {
  return KEY_PREFIX + key;
}

/** 带 Redis key 前缀（cacheGet/cacheSet 均走此前缀；用 redis 原生命令如 eval 时必须复用，否则写入读不到） */
export function prefixedRedisKey(key: string): string {
  return pk(key);
}

export const redis = new Redis(config.redisUrl, {
  connectTimeout: 2000,
  commandTimeout: 1000,
  maxRetriesPerRequest: 0,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 200, 2000);
  },
});

let available = false;
redis.on('ready', () => {
  available = true;
});
redis.on('error', (err) => {
  if (available) log.error({ err }, 'Redis error');
  available = false;
});
redis.on('close', () => {
  available = false;
});

export const TTL = {
  CATEGORIES: 600, // 10 min
  SETTINGS_PUBLIC: 60, // 1 min — config changes should propagate quickly
  MODELS_LIST: 300, // 5 min
  MODELS_SEARCH: 60, // 1 min — keep search fresh while absorbing bursts
  MODEL_DETAIL: 300, // 5 min
  MODEL_MATCH_INDEX: 600, // 10 min — model changes actively clear cache:models:
  SELECTION_CATEGORIES: 600, // 10 min
  SELECTION_PRODUCTS: 600, // 10 min — admin changes actively clear cache:selections:
} as const;

/**
 * 把后台设置的 TTL 值（秒）归一为可用值：非数 → fallback；0 表示关闭缓存（cacheSet/cacheGetOrSet
 * 见 0 即跳过）；上限 86400（1 天）。供各缓存调用点把硬编码 TTL.X 换成可配置值。
 */
export function resolveCacheTtl(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(86400, Math.max(0, parsed));
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!available) return null;
  try {
    const raw = await redis.get(pk(key));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Transient per-command failure (timeout / OOM / parse). Don't disable the
    // whole cache layer on one bad command — the connection is likely fine and
    // the next call should still try. Real connection outages are handled by the
    // ready/error/close handlers, which are the authoritative availability signal.
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return;
  if (!available) return;
  try {
    await redis.set(pk(key), JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Transient failure — skip this write, don't kill the cache layer.
  }
}

type CacheLoadResult<T> = {
  value: T;
  hit: boolean;
};

const inFlightLoads = new Map<string, Promise<unknown>>();
const IN_FLIGHT_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadOnce<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = inFlightLoads.get(key);
  if (existing) return existing as Promise<T>;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = Promise.race([
    load(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`cache load timeout: ${key}`)), IN_FLIGHT_TIMEOUT_MS);
    }),
  ]).finally(() => {
    clearTimeout(timer);
    if (inFlightLoads.get(key) === pending) inFlightLoads.delete(key);
  });
  inFlightLoads.set(key, pending);
  return pending;
}

async function ensureAvailable(): Promise<boolean> {
  if (available) return true;
  try {
    await cachePing();
    return true;
  } catch {
    return false;
  }
}

async function releaseLock(lockKey: string, token: string): Promise<void> {
  await redis.eval(
    `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
    `,
    1,
    lockKey,
    token,
  );
}

export async function cacheGetOrSet<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  options: { lockTtlMs?: number; waitTimeoutMs?: number; pollMs?: number } = {},
): Promise<CacheLoadResult<T>> {
  if (ttlSeconds <= 0) {
    return { value: await loadOnce(key, load), hit: false };
  }

  const cached = await cacheGet<T>(key);
  if (cached !== null) return { value: cached, hit: true };

  if (!(await ensureAvailable())) {
    return { value: await loadOnce(key, load), hit: false };
  }

  const lockKey = pk(`lock:${key}`);
  const token = randomUUID();
  const lockTtlMs = options.lockTtlMs ?? 5000;
  const waitTimeoutMs = options.waitTimeoutMs ?? 1500;
  const pollMs = options.pollMs ?? 25;

  try {
    const locked = await redis.set(lockKey, token, 'PX', lockTtlMs, 'NX');
    if (locked === 'OK') {
      try {
        const value = await loadOnce(key, load);
        await cacheSet(key, value, ttlSeconds);
        return { value, hit: false };
      } finally {
        await releaseLock(lockKey, token).catch(() => {});
      }
    }

    const deadline = Date.now() + waitTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      const shared = await cacheGet<T>(key);
      if (shared !== null) return { value: shared, hit: true };
    }
  } catch {
    // Transient lock/set failure — fall through to serving uncached; don't kill the cache layer.
  }

  return { value: await loadOnce(key, load), hit: false };
}

export async function cacheDel(key: string): Promise<void> {
  if (!available) return;
  try {
    await redis.del(pk(key));
  } catch {
    // Transient failure — skip this delete, don't kill the cache layer.
  }
}

export async function cacheDelByPrefix(prefix: string): Promise<void> {
  if (!available) return;
  try {
    const stream = redis.scanStream({ match: pk(prefix) + '*', count: 100 });
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (keys: string[]) => {
        if (keys.length === 0) return;
        stream.pause();
        redis
          .del(...keys)
          .then(() => stream.resume())
          .catch(reject);
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
  } catch {
    // Transient scan/delete failure — don't kill the cache layer.
  }
}

export function cacheIsAvailable(): boolean {
  return available;
}

export async function cachePing(): Promise<void> {
  await redis.ping();
  available = true;
}
