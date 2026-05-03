import { Router, Response } from "express";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import { cacheIsAvailable, cachePing } from "../lib/cache.js";
import { conversionQueue } from "../lib/queue.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";

const router = Router();

type HealthState = "ok" | "degraded" | "error";

async function withTimeout<T>(task: Promise<T>, timeoutMs = 1200): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function check(name: string, task: () => Promise<unknown>) {
  const startedAt = Date.now();
  try {
    const details = await withTimeout(Promise.resolve().then(task));
    return { name, status: "ok" as HealthState, latency_ms: Date.now() - startedAt, details };
  } catch (err) {
    const message = err instanceof Error ? err.message : "检查失败";
    return { name, status: "error" as HealthState, latency_ms: Date.now() - startedAt, error: message };
  }
}

async function checkWritableDir(name: string, dir: string) {
  await mkdir(dir, { recursive: true });
  const probePath = join(dir, `.health-${randomUUID()}.tmp`);
  await writeFile(probePath, "ok");
  await unlink(probePath);
  return { dir };
}

router.get("/api/health", (_req, res: Response) => {
  res.json({ status: "ok" });
});

// Readiness probe — checks core dependencies (DB + Redis) are available
router.get("/api/health/ready", async (_req, res: Response) => {
  try {
    const checks = await Promise.all([
      withTimeout(prisma.$queryRaw`SELECT 1`.then(() => true), 2000),
      withTimeout(cachePing().then(() => true), 2000),
    ]);
    if (checks.every(Boolean)) {
      res.json({ status: "ready" });
    } else {
      res.status(503).json({ status: "not_ready", checks: { database: checks[0], redis: checks[1] } });
    }
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
});

// Liveness probe — lightweight check that the process isn't hung
router.get("/api/health/live", (_req, res: Response) => {
  const mem = process.memoryUsage();
  res.json({
    status: "alive",
    uptime_seconds: Math.floor(process.uptime()),
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
    },
  });
});

router.get("/api/health/deep", authMiddleware, requireRole("ADMIN"), async (_req, res: Response) => {
  const checks = await Promise.all([
    check("database", async () => {
      await prisma.$queryRaw`SELECT 1`;
      return { connected: true };
    }),
    check("redis", async () => {
      await cachePing();
      return { connected: true, cache_ready: cacheIsAvailable() };
    }),
    check("conversion_queue", async () => {
      const counts = await conversionQueue.getJobCounts("waiting", "active", "delayed", "failed");
      return counts;
    }),
    check("upload_dir", () => checkWritableDir("upload_dir", config.uploadDir)),
    check("static_dir", () => checkWritableDir("static_dir", config.staticDir)),
  ]);

  const hasError = checks.some((item) => item.status === "error");
  res.status(hasError ? 503 : 200).json({
    status: hasError ? "degraded" : "ok",
    service: "model-converter",
    timestamp: new Date().toISOString(),
    checks,
  });
});

export default router;
