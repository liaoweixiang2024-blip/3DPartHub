import cluster from "node:cluster";
import { availableParallelism } from "node:os";

if (cluster.isPrimary) {
  const numWorkers = Math.min(availableParallelism(), 4);
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
