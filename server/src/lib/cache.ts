import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger({ component: "cache" });

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
redis.on("ready", () => { available = true; });
redis.on("error", (err) => {
  if (available) log.error({ err }, "Redis error");
  available = false;
});
redis.on("close", () => { available = false; });

export const TTL = {
  CATEGORIES: 600,      // 10 min
  SETTINGS_PUBLIC: 60,  // 1 min — config changes should propagate quickly
  MODELS_LIST: 300,     // 5 min
  MODELS_SEARCH: 60,    // 1 min — keep search fresh while absorbing bursts
  MODEL_DETAIL: 300,     // 5 min
  MODEL_MATCH_INDEX: 600, // 10 min — model changes actively clear cache:models:
  SELECTION_CATEGORIES: 600, // 10 min
  SELECTION_PRODUCTS: 600, // 10 min — admin changes actively clear cache:selections:
} as const;

function markUnavailable() {
  available = false;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!available) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    markUnavailable();
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!available) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    markUnavailable();
  }
}

type CacheLoadResult<T> = {
  value: T;
  hit: boolean;
};

const inFlightLoads = new Map<string, Promise<unknown>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadOnce<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = inFlightLoads.get(key);
  if (existing) return existing as Promise<T>;

  const pending = load().finally(() => {
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
    token
  );
}

export async function cacheGetOrSet<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  options: { lockTtlMs?: number; waitTimeoutMs?: number; pollMs?: number } = {}
): Promise<CacheLoadResult<T>> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return { value: cached, hit: true };

  if (!(await ensureAvailable())) {
    return { value: await loadOnce(key, load), hit: false };
  }

  const lockKey = `lock:${key}`;
  const token = randomUUID();
  const lockTtlMs = options.lockTtlMs ?? 5000;
  const waitTimeoutMs = options.waitTimeoutMs ?? 1500;
  const pollMs = options.pollMs ?? 25;

  try {
    const locked = await redis.set(lockKey, token, "PX", lockTtlMs, "NX");
    if (locked === "OK") {
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
    markUnavailable();
  }

  return { value: await loadOnce(key, load), hit: false };
}

export async function cacheDel(key: string): Promise<void> {
  if (!available) return;
  try {
    await redis.del(key);
  } catch {
    markUnavailable();
  }
}

export async function cacheDelByPrefix(prefix: string): Promise<void> {
  if (!available) return;
  try {
    // Use SCAN instead of KEYS to avoid blocking Redis on large key sets
    const stream = redis.scanStream({ match: prefix + "*", count: 100 });
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (keys: string[]) => {
        if (keys.length === 0) return;
        stream.pause();
        redis.del(...keys)
          .then(() => stream.resume())
          .catch(reject);
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });
  } catch {
    markUnavailable();
  }
}

export function cacheIsAvailable(): boolean {
  return available;
}

export async function cachePing(): Promise<void> {
  await redis.ping();
  available = true;
}
