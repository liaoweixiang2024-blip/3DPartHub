import Redis from "ioredis";
import { config } from "./config.js";

const redis = new Redis(config.redisUrl, {
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
  if (available) console.error("[cache] Redis error:", err.message);
  available = false;
});
redis.on("close", () => { available = false; });

export const TTL = {
  CATEGORIES: 600,      // 10 min
  SETTINGS_PUBLIC: 60,  // 1 min — config changes should propagate quickly
  MODELS_LIST: 120,     // 2 min
  MODEL_DETAIL: 60,     // 1 min — avoid repeated DB + file-stat work on hot models
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
    const batches: string[][] = [];
    stream.on("data", (keys: string[]) => {
      if (keys.length > 0) batches.push(keys);
    });
    await new Promise<void>((resolve, reject) => {
      stream.on("end", async () => {
        for (const batch of batches) {
          await redis.del(...batch);
        }
        resolve();
      });
      stream.on("error", reject);
    });
  } catch {
    markUnavailable();
  }
}
