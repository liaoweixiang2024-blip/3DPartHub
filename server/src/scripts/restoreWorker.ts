import { runRestoreWorker } from "../lib/backup.js";

const [jobId, mode, target, rawRemoveAfter] = process.argv.slice(2);

if (!jobId || (mode !== "backup" && mode !== "file") || !target) {
  console.error("[RestoreWorker] Missing job id, mode, or target");
  process.exit(1);
}

runRestoreWorker(jobId, mode, target, rawRemoveAfter !== "false")
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[RestoreWorker #${jobId}] ${err?.message || err}`);
    process.exit(1);
  });
