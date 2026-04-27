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
  console.log(`\n  ⚙️  Primary ${process.pid} forking ${numWorkers} workers...\n`);

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  // BullMQ worker runs only in primary to avoid duplicate job processing
  import("./workers/conversionWorker.js");

  cluster.on("exit", (worker, code, signal) => {
    console.error(`Worker ${worker.process.pid} died (${code || signal}). Restarting...`);
    cluster.fork();
  });

  cluster.on("listening", (worker, address) => {
    console.log(`  👷 Worker ${worker.process.pid} ready on port ${address.port}`);
  });
} else {
  // Workers run the Express app only
  import("./main.js");
}
