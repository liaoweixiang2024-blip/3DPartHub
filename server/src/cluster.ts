import cluster from "node:cluster";
import { availableParallelism } from "node:os";

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
  console.log(`\n  ⚙️  Primary ${process.pid} forking ${numWorkers} workers...\n`);

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork({
      CACHE_WARMUP_ID: cacheWarmupId,
      CACHE_WARMUP_ENABLED: i === 0 ? "1" : "0",
    });
  }

  // Background workers run only in primary to avoid duplicate job processing
  import("./workers/conversionWorker.js");
  import("./workers/downloadRecorderWorker.js");

  const MAX_RESTARTS = 10;
  const restartingWorkerIds = new Set<number>();
  const workerRestartCounts = new Map<number, number>();

  cluster.on("exit", (worker, code, signal) => {
    if (code === 0 || signal === "SIGTERM") return;
    const prevCount = workerRestartCounts.get(worker.id) || 0;
    if (prevCount >= MAX_RESTARTS) {
      console.error(`Worker ${worker.id} restart limit (${MAX_RESTARTS}) reached. Exiting.`);
      process.exit(1);
    }
    const nextCount = prevCount + 1;
    const delay = Math.min(30000, nextCount * 2000);
    console.error(`Worker ${worker.process.pid} died (${code || signal}). Restarting in ${delay}ms (attempt ${nextCount}/${MAX_RESTARTS})...`);
    setTimeout(() => {
      const newWorker = cluster.fork({
        CACHE_WARMUP_ID: cacheWarmupId,
        CACHE_WARMUP_ENABLED: "0",
      });
      restartingWorkerIds.add(newWorker.id);
      workerRestartCounts.set(newWorker.id, nextCount);
    }, delay);
  });

  cluster.on("listening", (worker, address) => {
    console.log(`  👷 Worker ${worker.process.pid} ready on port ${address.port}`);
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
    console.log(`\n  ⏹  ${signal} received, shutting down gracefully...`);
    const timeout = setTimeout(() => {
      console.log("  ⏹  Forced shutdown after 15s");
      process.exit(1);
    }, 15000);
    for (const id in cluster.workers) {
      const w = cluster.workers[id];
      if (w) w.kill("SIGTERM");
    }
    cluster.on("exit", () => {
      if (Object.keys(cluster.workers || {}).length === 0) {
        clearTimeout(timeout);
        console.log("  ⏹  All workers stopped.");
        process.exit(0);
      }
    });
  }
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
} else {
  // Workers run the Express app only
  import("./main.js");
}
