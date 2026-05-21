import { runBackupWorker, type BackupScope } from '../lib/backup.js';

const [jobId, rawSource, rawScope] = process.argv.slice(2);
const source = rawSource === 'scheduled' ? 'scheduled' : 'manual';

if (!jobId) {
  console.error('[BackupWorker] Missing job id');
  process.exit(1);
}

runBackupWorker(jobId, source, rawScope as BackupScope)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[BackupWorker #${jobId}] ${err?.message || err}`);
    process.exit(1);
  });
