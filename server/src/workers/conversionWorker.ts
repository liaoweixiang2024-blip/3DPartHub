import { resolve } from "node:path";
import { fork } from "node:child_process";
import { rmSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Job } from "bullmq";
import type { GltfAsset } from "../services/converter.js";
import { config } from "../lib/config.js";
import { createWorker, conversionQueueConfig, normalizeConversionWorkerConcurrency } from "../lib/queue.js";
import { createNotification } from "../routes/notifications.js";
import { cacheDelByPrefix } from "../lib/cache.js";

type ConversionPipelineResult = {
  result: GltfAsset;
  thumb: {
    thumbnailPath: string;
    thumbnailUrl: string;
  };
};

const conversionRunnerPath = fileURLToPath(new URL("./conversionRunner.js", import.meta.url));

function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60000);
  return minutes >= 1 ? `${minutes} 分钟` : `${Math.round(ms / 1000)} 秒`;
}

function runConversionPipeline(job: Job): Promise<ConversionPipelineResult> {
  const payload = {
    modelId: job.data.modelId,
    filePath: job.data.filePath,
    originalName: job.data.originalName,
    ext: job.data.ext,
  };
  const timeoutMs = conversionQueueConfig.jobTimeoutMs;

  return new Promise((resolve, reject) => {
    const child = fork(conversionRunnerPath, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: process.execArgv,
    });
    let settled = false;
    let timeoutError: Error | null = null;
    let timeoutTimer: NodeJS.Timeout;
    let forceKillTimer: NodeJS.Timeout | null = null;

    const finish = (err: Error | null, data?: ConversionPipelineResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      child.removeAllListeners();
      if (err) reject(err);
      else resolve(data!);
    };

    timeoutTimer = setTimeout(() => {
      timeoutError = new Error(`转换超时：超过 ${formatDuration(timeoutMs)} 未完成，已终止转换子进程`);
      job.log(`[${new Date().toISOString()}] ${timeoutError.message}`).catch(() => {});
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      console.log(`[conversion:${job.id}] ${String(chunk).trimEnd()}`);
    });
    child.stderr?.on("data", (chunk) => {
      console.error(`[conversion:${job.id}] ${String(chunk).trimEnd()}`);
    });
    child.on("message", (message: unknown) => {
      const msg = message as Record<string, any>;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "log" && msg.message) {
        job.log(`[${new Date().toISOString()}] ${msg.message}`).catch(() => {});
      } else if (msg.type === "progress") {
        const progress = Number(msg.progress);
        if (Number.isFinite(progress)) {
          job.updateProgress(Math.max(0, Math.min(100, Math.round(progress)))).catch(() => {});
        }
      } else if (msg.type === "result") {
        finish(null, { result: msg.result, thumb: msg.thumbnail });
      } else if (msg.type === "error") {
        const err = new Error(String(msg.message || "转换失败"));
        if (msg.stack) err.stack = String(msg.stack);
        finish(err);
      }
    });
    child.on("error", (err) => finish(err));
    child.on("exit", (code, signal) => {
      if (settled) return;
      if (timeoutError) {
        finish(timeoutError);
        return;
      }
      finish(new Error(`转换子进程异常退出: ${signal || code || "unknown"}`));
    });

    child.send({ payload });
  });
}

// Try to import Prisma
let prisma: any = null;
try {
  const mod = await import("../lib/prisma.js");
  prisma = mod.prisma;
} catch { /* no db */ }

async function readConfiguredConcurrency() {
  if (!prisma) return conversionQueueConfig.concurrency;
  try {
    const row = await prisma.setting.findUnique({
      where: { key: "conversion_worker_concurrency" },
      select: { value: true },
    });
    if (!row?.value) return conversionQueueConfig.concurrency;
    let value: unknown = row.value;
    try {
      value = JSON.parse(row.value);
    } catch {
      // Legacy/plain text setting value.
    }
    return normalizeConversionWorkerConcurrency(value);
  } catch {
    return conversionQueueConfig.concurrency;
  }
}

const initialWorkerConcurrency = await readConfiguredConcurrency();

export const conversionWorker = createWorker(async (job) => {
  const { modelId, filePath, originalName, ext, userId, preserveSource = false } = job.data;
  const logStep = async (message: string) => {
    await job.log(`[${new Date().toISOString()}] ${message}`).catch(() => {});
  };

  await logStep(`开始转换: ${originalName} (${ext})`);
  await job.updateProgress(10);

  try {
    // Update status to processing
    await logStep("更新模型状态为 processing");
    if (prisma) {
      await prisma.model.update({
        where: { id: modelId },
        data: { status: "processing" },
      }).catch(() => {});
    }

    await job.updateProgress(20);

    await logStep(`启动隔离转换子进程，超时 ${formatDuration(conversionQueueConfig.jobTimeoutMs)}`);
    const { result, thumb } = await runConversionPipeline(job);

    // Update database
    await logStep("写入转换结果到数据库");
    if (prisma) {
      await prisma.model.update({
        where: { id: modelId },
        data: {
          status: "completed",
          gltfUrl: result.gltfUrl,
          gltfSize: result.gltfSize,
          thumbnailUrl: `${thumb.thumbnailUrl}?t=${Date.now()}`,
        },
      });
    }

    // Persist original file when the source is a temp upload. Existing originals are kept in place.
    const sourcePath = resolve(filePath);
    if (existsSync(sourcePath)) {
      const originalsDir = resolve(config.staticDir, "originals");
      mkdirSync(originalsDir, { recursive: true });
      const destPath = resolve(originalsDir, `${modelId}.${ext}`);
      if (sourcePath !== destPath) {
        await logStep(`保存原始文件: ${destPath}`);
        copyFileSync(sourcePath, destPath);
      } else {
        await logStep("源文件已在 originals 目录，跳过重复复制");
      }

      // Update DB with original file path
      if (prisma) {
        await prisma.model.update({
          where: { id: modelId },
          data: { uploadPath: destPath },
        }).catch(() => {});
      }

      if (!preserveSource && sourcePath !== destPath) {
        await logStep("清理临时上传文件");
        rmSync(sourcePath, { force: true });
      }
    }

    await job.updateProgress(100);

    // Invalidate model list cache
    await cacheDelByPrefix("cache:models:");

    // Notify user
    await createNotification({
      userId,
      title: "模型转换完成",
      message: `${originalName} 已成功转换，可以预览和下载。`,
      type: "success",
      relatedId: modelId,
    });

    await logStep(`转换任务完成: ${modelId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "转换失败";
    await logStep(`转换失败: ${message}`);
    if (err instanceof Error && err.stack) {
      await logStep(err.stack);
    }

    // Clean up temp upload file on failure
    const sourcePath = resolve(filePath);
    if (!preserveSource && existsSync(sourcePath)) {
      try { rmSync(sourcePath, { force: true }); } catch {}
    } else if (preserveSource) {
      await logStep("保留原始源文件，跳过失败清理");
    }

    if (prisma) {
      await prisma.model.update({
        where: { id: modelId },
        data: { status: "failed" },
      }).catch(() => {});
      await cacheDelByPrefix("cache:models:");
    }

    // Notify user of failure
    await createNotification({
      userId,
      title: "模型转换失败",
      message: `${originalName} 转换失败: ${message}`,
      type: "error",
      relatedId: modelId,
    });

    throw new Error(message);
  }
}, { concurrency: initialWorkerConcurrency });

let appliedConcurrency = initialWorkerConcurrency;

async function syncWorkerConcurrency() {
  const nextConcurrency = await readConfiguredConcurrency();
  if (nextConcurrency === appliedConcurrency && conversionWorker.concurrency === nextConcurrency) return;
  conversionWorker.concurrency = nextConcurrency;
  appliedConcurrency = nextConcurrency;
  console.log(`  ⚙️  Conversion worker concurrency set to ${nextConcurrency}`);
}

console.log(`  ⚙️  Conversion worker concurrency initial: ${initialWorkerConcurrency}`);
const concurrencySyncTimer = setInterval(() => {
  syncWorkerConcurrency().catch((err) => {
    console.warn("  ⚠️  Failed to sync conversion worker concurrency:", err?.message || err);
  });
}, 15_000);
concurrencySyncTimer.unref?.();

conversionWorker.on("completed", (job) => {
  console.log(`  ✅ Conversion job ${job.id} completed (model: ${job.data.modelId})`);
});

conversionWorker.on("failed", (job, err) => {
  console.error(`  ❌ Conversion job ${job?.id} failed:`, err.message);
});

conversionWorker.on("stalled", (jobId) => {
  console.warn(`  ⚠️  Conversion job ${jobId} stalled; it will be retried by the queue if allowed`);
});
