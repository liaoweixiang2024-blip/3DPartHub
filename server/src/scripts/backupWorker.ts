import { runBackupWorker } from "../lib/backup.js";

const [jobId, rawSource] = process.argv.slice(2);
const source = rawSource === "scheduled" ? "scheduled" : "manual";

if (!jobId) {
  console.error("[BackupWorker] Missing job id");
  process.exit(1);
}

runBackupWorker(jobId, source)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[BackupWorker #${jobId}] ${err?.message || err}`);
    process.exit(1);
  });
