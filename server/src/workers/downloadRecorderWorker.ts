import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import {
  ackModelDownloadRecords,
  claimModelDownloadRecordBatch,
  recoverProcessingDownloadRecords,
  retryModelDownloadRecords,
} from '../services/modelDownloadQueue.js';
import { recordQueuedModelDownloads } from '../services/modelDownloadRecorder.js';

const BATCH_SIZE = Math.min(5000, Math.max(50, Number(process.env.DOWNLOAD_RECORD_BATCH_SIZE) || 500));
const POLL_MS = Math.min(10_000, Math.max(250, Number(process.env.DOWNLOAD_RECORD_FLUSH_MS) || 1000));

let running = false;

async function flushOnce() {
  if (running) return;
  running = true;
  try {
    while (true) {
      const claimed = await claimModelDownloadRecordBatch(BATCH_SIZE);
      if (claimed.length === 0) break;

      try {
        await recordQueuedModelDownloads(
          prisma,
          claimed.map((item) => item.record),
        );
        await ackModelDownloadRecords(claimed);
      } catch (err) {
        await retryModelDownloadRecords(claimed).catch((retryErr) => {
          logger.error({ retryErr }, '[download-recorder] retry queue failed');
        });
        logger.error({ err }, '[download-recorder] flush failed');
        break;
      }

      if (claimed.length < BATCH_SIZE) break;
    }
  } catch (err) {
    logger.error({ err }, '[download-recorder] worker tick failed');
  } finally {
    running = false;
  }
}

await recoverProcessingDownloadRecords().catch((err) => {
  logger.error({ err }, '[download-recorder] recover failed');
});

logger.info(`  ⚙️  Download recorder async flush: batch=${BATCH_SIZE}, interval=${POLL_MS}ms`);

const timer = setInterval(() => {
  flushOnce().catch((err) => {
    logger.error({ err }, '[download-recorder] scheduled flush failed');
  });
}, POLL_MS);
timer.unref?.();

flushOnce().catch((err) => {
  logger.error({ err }, '[download-recorder] initial flush failed');
});
