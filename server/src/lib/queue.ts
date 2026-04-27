import { Queue, Worker, type Job } from "bullmq";
import { config } from "./config.js";

function numberEnv(key: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[key]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export const CONVERSION_WORKER_MIN_CONCURRENCY = 1;
export const CONVERSION_WORKER_MAX_CONCURRENCY = 8;

export const conversionQueueConfig = {
  concurrency: numberEnv("CONVERSION_WORKER_CONCURRENCY", 1, CONVERSION_WORKER_MIN_CONCURRENCY, CONVERSION_WORKER_MAX_CONCURRENCY),
  jobTimeoutMs: numberEnv("CONVERSION_JOB_TIMEOUT_MS", 15 * 60 * 1000, 60 * 1000, 6 * 60 * 60 * 1000),
  staleMs: numberEnv("CONVERSION_STALE_MS", 10 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
  lockDurationMs: numberEnv("CONVERSION_LOCK_DURATION_MS", 10 * 60 * 1000, 30 * 1000, 60 * 60 * 1000),
  stalledIntervalMs: numberEnv("CONVERSION_STALLED_INTERVAL_MS", 60 * 1000, 10 * 1000, 30 * 60 * 1000),
  maxStalledCount: numberEnv("CONVERSION_MAX_STALLED_COUNT", 3, 0, 20),
  maxStartedAttempts: numberEnv("CONVERSION_MAX_STARTED_ATTEMPTS", 0, 0, 100),
  completedKeep: numberEnv("CONVERSION_QUEUE_COMPLETED_KEEP", 100, 10, 10000),
  failedKeep: numberEnv("CONVERSION_QUEUE_FAILED_KEEP", 50, 10, 10000),
};

export function normalizeConversionWorkerConcurrency(value: unknown, fallback = conversionQueueConfig.concurrency) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(
    CONVERSION_WORKER_MAX_CONCURRENCY,
    Math.max(CONVERSION_WORKER_MIN_CONCURRENCY, Math.floor(parsed))
  );
}

const connection = {
  host: config.redisUrl.replace("redis://", "").split(":")[0] || "localhost",
  port: Number(config.redisUrl.replace("redis://", "").split(":")[1]) || 6379,
};

export const conversionQueue = new Queue("model-conversion", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: conversionQueueConfig.completedKeep },
    removeOnFail: { count: conversionQueueConfig.failedKeep },
  },
});

export function createWorker(processor: (job: Job) => Promise<void>, options: { concurrency?: number } = {}) {
  const startedAttemptsLimit = conversionQueueConfig.maxStartedAttempts > 0
    ? { maxStartedAttempts: conversionQueueConfig.maxStartedAttempts }
    : {};

  return new Worker("model-conversion", processor, {
    connection,
    concurrency: normalizeConversionWorkerConcurrency(options.concurrency),
    lockDuration: conversionQueueConfig.lockDurationMs,
    maxStalledCount: conversionQueueConfig.maxStalledCount,
    stalledInterval: conversionQueueConfig.stalledIntervalMs,
    ...startedAttemptsLimit,
  });
}
