import { runImportSaveWorker } from '../lib/backup.js';

const [jobId, archivePath, originalName] = process.argv.slice(2);

if (!jobId || !archivePath || !originalName) {
  console.error('[ImportSaveWorker] Missing job id, archive path, or original name');
  process.exit(1);
}

runImportSaveWorker(jobId, archivePath, originalName)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[ImportSaveWorker #${jobId}] ${err?.message || err}`);
    process.exit(1);
  });
