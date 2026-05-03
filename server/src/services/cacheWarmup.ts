import { cacheGetOrSet, cachePing } from "../lib/cache.js";
import { logger } from "../lib/logger.js";

type WarmupPathResult = {
  path: string;
  status: number;
  cache: string | null;
  ms: number;
  error?: string;
};

type WarmupResult = {
  warmedAt: string;
  durationMs: number;
  results: WarmupPathResult[];
};

const STARTUP_WARMUP_PATHS = [
  "/api/settings/public",
  "/api/categories",
  "/api/categories/flat",
  "/api/models?page=1&page_size=20",
  "/api/search?q=&page=1&page_size=20",
  "/api/selections/categories",
] as const;

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

async function fetchWarmupPath(baseUrl: string, path: string, timeoutMs: number): Promise<WarmupPathResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
      headers: { "X-Cache-Warmup": "1" },
    });
    await response.arrayBuffer();
    return {
      path,
      status: response.status,
      cache: response.headers.get("x-cache"),
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      path,
      status: 0,
      cache: null,
      ms: Date.now() - started,
      error: err instanceof Error ? err.name : "Error",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runStartupCacheWarmup(port: number): Promise<WarmupResult> {
  await cachePing().catch(() => {});

  const warmupId = process.env.CACHE_WARMUP_ID || `standalone-${process.pid}`;
  const timeoutMs = intEnv("CACHE_WARMUP_REQUEST_TIMEOUT_MS", 8000, 1000, 60_000);
  const baseUrl = `http://127.0.0.1:${port}`;

  const { value: result, hit } = await cacheGetOrSet<WarmupResult>(
    `cache:warmup:startup:${warmupId}`,
    60,
    async () => {
      const started = Date.now();
      const results: WarmupPathResult[] = [];
      for (const path of STARTUP_WARMUP_PATHS) {
        results.push(await fetchWarmupPath(baseUrl, path, timeoutMs));
      }
      return {
        warmedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        results,
      };
    },
    { lockTtlMs: 30_000, waitTimeoutMs: 250 }
  );

  if (!hit) {
    const ok = result.results.filter((item) => item.status >= 200 && item.status < 300).length;
    const detail = result.results
      .map((item) => `${item.path}:${item.status}${item.cache ? `/${item.cache}` : ""}/${item.ms}ms`)
      .join(" ");
    logger.info(`[cache-warmup] warmed ${ok}/${result.results.length} paths in ${result.durationMs}ms ${detail}`);
  }

  return result;
}

export function scheduleStartupCacheWarmup(port: number): void {
  const delayMs = intEnv("CACHE_WARMUP_DELAY_MS", 1000, 0, 60_000);
  const timer = setTimeout(() => {
    runStartupCacheWarmup(port).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[cache-warmup] failed: ${message}`);
    });
  }, delayMs);
  timer.unref();
}
