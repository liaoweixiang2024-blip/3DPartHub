import { resolve } from 'node:path';
import { fork } from 'node:child_process';
import { rmSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Job } from 'bullmq';
import type { GltfAsset } from '../services/converter.js';
import { config } from '../lib/config.js';
import { createWorker, conversionQueueConfig, normalizeConversionWorkerConcurrency } from '../lib/queue.js';
import { createNotification } from '../routes/notifications.js';
import { cacheDelByPrefix } from '../lib/cache.js';
import { MODEL_STATUS } from '../services/modelStatus.js';
import { logger } from '../lib/logger.js';

type ConversionPipelineResult = {
  result: GltfAsset;
  thumb: {
    thumbnailPath: string;
    thumbnailUrl: string;
  };
};

const conversionRunnerPath = fileURLToPath(new URL('./conversionRunner.js', import.meta.url));

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
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
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
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      logger.info(`[conversion:${job.id}] ${String(chunk).trimEnd()}`);
    });
    child.stderr?.on('data', (chunk) => {
      logger.error(`[conversion:${job.id}] ${String(chunk).trimEnd()}`);
    });
    child.on('message', (message: unknown) => {
      const msg = message as Record<string, any>;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'log' && msg.message) {
        job.log(`[${new Date().toISOString()}] ${msg.message}`).catch(() => {});
      } else if (msg.type === 'progress') {
        const progress = Number(msg.progress);
        if (Number.isFinite(progress)) {
          job.updateProgress(Math.max(0, Math.min(100, Math.round(progress)))).catch(() => {});
        }
      } else if (msg.type === 'result') {
        finish(null, { result: msg.result, thumb: msg.thumbnail });
      } else if (msg.type === 'error') {
        const err = new Error(String(msg.message || '转换失败'));
        if (msg.stack) err.stack = String(msg.stack);
        finish(err);
      }
    });
    child.on('error', (err) => finish(err));
    child.on('exit', (code, signal) => {
      if (settled) return;
      if (timeoutError) {
        finish(timeoutError);
        return;
      }
      finish(new Error(`转换子进程异常退出: ${signal || code || 'unknown'}`));
    });

    child.send({ payload });
  });
}

// Try to import Prisma
let prisma: any = null;
try {
  const mod = await import('../lib/prisma.js');
  prisma = mod.prisma;
} catch {
  /* no db */
}

async function readConfiguredConcurrency() {
  if (!prisma) return conversionQueueConfig.concurrency;
  try {
    const row = await prisma.setting.findUnique({
      where: { key: 'conversion_worker_concurrency' },
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

export const conversionWorker = createWorker(
  async (job) => {
    const { modelId, filePath, originalName, ext, userId, preserveSource = false } = job.data;
    const logStep = async (message: string) => {
      await job.log(`[${new Date().toISOString()}] ${message}`).catch(() => {});
    };

    await logStep(`开始转换: ${originalName} (${ext})`);
    await job.updateProgress(10);

    const initialSourcePath = resolve(filePath);
    let activeSourcePath = initialSourcePath;
    let shouldCleanupInitialSource = !preserveSource;

    try {
      // Update status to processing
      await logStep('更新模型状态为 processing');
      if (prisma) {
        await prisma.model
          .update({
            where: { id: modelId },
            data: { status: MODEL_STATUS.PROCESSING },
          })
          .catch(() => {});
      }

      await job.updateProgress(20);

      if (!existsSync(initialSourcePath)) {
        throw new Error(`源文件不存在: ${filePath}`);
      }

      const originalsDir = resolve(config.staticDir, 'originals');
      mkdirSync(originalsDir, { recursive: true });
      const persistedSourcePath = resolve(originalsDir, `${modelId}.${ext}`);
      if (initialSourcePath !== persistedSourcePath) {
        await logStep(`预先保存原始文件: ${persistedSourcePath}`);
        copyFileSync(initialSourcePath, persistedSourcePath);
        activeSourcePath = persistedSourcePath;
        shouldCleanupInitialSource = !preserveSource;
        try {
          await job.updateData({ ...job.data, filePath: persistedSourcePath, preserveSource: true });
        } catch {
          shouldCleanupInitialSource = false;
          await logStep('updateData 失败，保留原始源文件以防重试需要');
        }
      } else {
        await logStep('源文件已在 originals 目录');
        activeSourcePath = initialSourcePath;
        shouldCleanupInitialSource = false;
      }

      if (prisma) {
        await prisma.model
          .update({
            where: { id: modelId },
            data: { uploadPath: activeSourcePath },
          })
          .catch(() => {});
      }

      await logStep(`启动隔离转换子进程，超时 ${formatDuration(conversionQueueConfig.jobTimeoutMs)}`);
      job.data.filePath = activeSourcePath;
      job.data.preserveSource = true;
      const { result, thumb } = await runConversionPipeline(job);

      // Update database
      await logStep('写入转换结果到数据库');
      if (prisma) {
        await prisma.model.update({
          where: { id: modelId },
          data: {
            status: MODEL_STATUS.COMPLETED,
            gltfUrl: result.gltfUrl,
            gltfSize: result.gltfSize,
            previewMeta: result.previewMeta,
            thumbnailUrl: `${thumb.thumbnailUrl}?t=${Date.now()}`,
          },
        });
      }

      if (shouldCleanupInitialSource && initialSourcePath !== activeSourcePath && existsSync(initialSourcePath)) {
        await logStep('清理临时上传文件');
        rmSync(initialSourcePath, { force: true });
      }

      await job.updateProgress(100);

      // Invalidate model list cache
      await cacheDelByPrefix('cache:models:');

      // Notify user
      await createNotification({
        userId,
        title: '模型转换完成',
        message: `${originalName} 已成功转换，可以预览和下载。`,
        type: 'success',
        relatedId: modelId,
      });

      await logStep(`转换任务完成: ${modelId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '转换失败';
      await logStep(`转换失败: ${message}`);
      if (err instanceof Error && err.stack) {
        await logStep(err.stack);
      }

      // Clean up temp upload file on failure
      if (shouldCleanupInitialSource && initialSourcePath !== activeSourcePath && existsSync(initialSourcePath)) {
        try {
          rmSync(initialSourcePath, { force: true });
        } catch {}
      } else if (!shouldCleanupInitialSource) {
        await logStep('保留原始源文件，跳过失败清理');
      }

      const maxAttempts = job.opts?.attempts || 1;
      const isFinalAttempt = job.attemptsMade >= maxAttempts - 1;

      if (isFinalAttempt && prisma) {
        await prisma.model
          .update({
            where: { id: modelId },
            data: { status: MODEL_STATUS.FAILED },
          })
          .catch(() => {});
        await cacheDelByPrefix('cache:models:');
      }

      if (isFinalAttempt) {
        await createNotification({
          userId,
          title: '模型转换失败',
          message: `${originalName} 转换失败: ${message}`,
          type: 'error',
          relatedId: modelId,
        });
      }

      throw new Error(message);
    }
  },
  { concurrency: initialWorkerConcurrency },
);

let appliedConcurrency = initialWorkerConcurrency;

async function syncWorkerConcurrency() {
  const nextConcurrency = await readConfiguredConcurrency();
  if (nextConcurrency === appliedConcurrency && conversionWorker.concurrency === nextConcurrency) return;
  conversionWorker.concurrency = nextConcurrency;
  appliedConcurrency = nextConcurrency;
  logger.info(`  ⚙️  Conversion worker concurrency set to ${nextConcurrency}`);
}

logger.info(`  ⚙️  Conversion worker concurrency initial: ${initialWorkerConcurrency}`);
const concurrencySyncTimer = setInterval(() => {
  syncWorkerConcurrency().catch((err) => {
    logger.warn({ detail: err?.message || err }, '  ⚠️  Failed to sync conversion worker concurrency');
  });
}, 15_000);
concurrencySyncTimer.unref?.();

conversionWorker.on('completed', (job) => {
  logger.info(`  ✅ Conversion job ${job.id} completed (model: ${job.data.modelId})`);
});

conversionWorker.on('failed', (job, err) => {
  logger.error({ err: err }, `  ❌ Conversion job ${job?.id} failed:`);
});

conversionWorker.on('stalled', (jobId) => {
  logger.warn(`  ⚠️  Conversion job ${jobId} stalled; it will be retried by the queue if allowed`);
});
