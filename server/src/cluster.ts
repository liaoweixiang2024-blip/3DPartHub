import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { logger } from './lib/logger.js';

function workerCount() {
  const configured = Number(process.env.API_WORKERS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(16, Math.max(1, Math.floor(configured)));
  }
  return Math.min(availableParallelism(), 4);
}

if (cluster.isPrimary) {
  const numWorkers = workerCount();
  const cacheWarmupId = `${Date.now()}-${process.pid}`;
  logger.info({ workers: numWorkers, pid: process.pid }, 'Primary forking workers');

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork({
      CACHE_WARMUP_ID: cacheWarmupId,
      CACHE_WARMUP_ENABLED: i === 0 ? '1' : '0',
    });
  }

  // Background workers run only in primary to avoid duplicate job processing
  import('./workers/conversionWorker.js');
  import('./workers/downloadRecorderWorker.js');

  const MAX_RESTARTS = 10;
  const restartingWorkerIds = new Set<number>();
  const workerRestartCounts = new Map<number, number>();

  cluster.on('exit', (worker, code, signal) => {
    if (code === 0 || signal === 'SIGTERM') return;
    const prevCount = workerRestartCounts.get(worker.id) || 0;
    if (prevCount >= MAX_RESTARTS) {
      logger.error({ workerId: worker.id, restarts: MAX_RESTARTS }, 'Worker restart limit reached, exiting');
      process.exit(1);
    }
    const nextCount = prevCount + 1;
    const delay = Math.min(30000, nextCount * 2000);
    logger.error(
      { pid: worker.process.pid, code, signal, attempt: nextCount, maxRestarts: MAX_RESTARTS, delay },
      'Worker died, restarting',
    );
    setTimeout(() => {
      const newWorker = cluster.fork({
        CACHE_WARMUP_ID: cacheWarmupId,
        CACHE_WARMUP_ENABLED: '0',
      });
      restartingWorkerIds.add(newWorker.id);
      workerRestartCounts.set(newWorker.id, nextCount);
    }, delay);
  });

  cluster.on('listening', (worker, address) => {
    logger.info({ pid: worker.process.pid, port: address.port }, 'Worker ready');
    if (restartingWorkerIds.has(worker.id)) {
      restartingWorkerIds.delete(worker.id);
      workerRestartCounts.delete(worker.id);
    }
  });

  // Graceful shutdown — stop accepting new connections, wait for workers to finish
  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated');
    const timeout = setTimeout(() => {
      logger.warn('Forced shutdown after 15s timeout');
      process.exit(1);
    }, 15000);
    for (const id in cluster.workers) {
      const w = cluster.workers[id];
      if (w) w.kill('SIGTERM');
    }
    cluster.on('exit', () => {
      if (Object.keys(cluster.workers || {}).length === 0) {
        clearTimeout(timeout);
        logger.info('All workers stopped, exiting');
        process.exit(0);
      }
    });
  }
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection in primary');
    process.exit(1);
  });

  // Worker memory monitoring — restart workers that exceed the RSS limit
  const WORKER_MEMORY_LIMIT_MB = Number(process.env.WORKER_MEMORY_LIMIT_MB) || 1024;

  // Workers send RSS via IPC every 60s; check against limit here
  const memoryMap = new Map<number, number>();
  cluster.on('message', (worker, message) => {
    if (message && message.type === 'memory' && typeof message.rss === 'number') {
      memoryMap.set(worker.id, message.rss);
      if (message.rss > WORKER_MEMORY_LIMIT_MB * 1024 * 1024) {
        logger.warn(
          { pid: worker.process.pid, rssMB: (message.rss / 1024 / 1024).toFixed(0), limitMB: WORKER_MEMORY_LIMIT_MB },
          'Worker RSS exceeds limit, restarting',
        );
        worker.kill('SIGTERM');
      }
    }
  });
} else {
  // Workers run the Express app only
  import('./main.js');
}
