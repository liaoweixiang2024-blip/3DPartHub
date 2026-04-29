import { runVerifyBackupWorker } from "../lib/backup.js";

const [jobId, backupId] = process.argv.slice(2);

if (!jobId || !backupId) {
  console.error("[VerifyBackupWorker] Missing job id or backup id");
  process.exit(1);
}

runVerifyBackupWorker(jobId, backupId)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[VerifyBackupWorker #${jobId}] ${err?.message || err}`);
    process.exit(1);
  });
