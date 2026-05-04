import Redis from 'ioredis';
import { config } from '../lib/config.js';
import type { QueuedModelDownloadRecord } from './modelDownloadRecorder.js';
import { logger } from '../lib/logger.js';

const WAITING_KEY = 'queue:model-download-records:v1';
const PROCESSING_KEY = 'queue:model-download-records:processing:v1';
const MAX_ATTEMPTS = 5;

type ClaimedDownloadRecord = {
  payload: string;
  record: QueuedModelDownloadRecord & {
    attempts?: number;
    queuedAt?: string;
  };
};

let redis: Redis | null = null;

function getRedis() {
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      connectTimeout: 1000,
      commandTimeout: 1000,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 1000);
      },
    });
    redis.on('error', (err) => {
      logger.error({ err: err }, '[download-record-queue] Redis error');
    });
  }
  return redis;
}

function encode(record: QueuedModelDownloadRecord & { attempts?: number; queuedAt?: string }) {
  return JSON.stringify({
    userId: record.userId || null,
    modelId: record.modelId,
    format: record.format,
    fileSize: Number(record.fileSize) || 0,
    attempts: Number(record.attempts) || 0,
    queuedAt: record.queuedAt || new Date().toISOString(),
  });
}

function decode(payload: string): ClaimedDownloadRecord['record'] | null {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (!parsed.modelId || typeof parsed.modelId !== 'string') return null;
    if (!parsed.format || typeof parsed.format !== 'string') return null;
    return {
      userId: typeof parsed.userId === 'string' ? parsed.userId : null,
      modelId: parsed.modelId,
      format: parsed.format,
      fileSize: Number(parsed.fileSize) || 0,
      attempts: Number(parsed.attempts) || 0,
      queuedAt: typeof parsed.queuedAt === 'string' ? parsed.queuedAt : undefined,
    };
  } catch {
    return null;
  }
}

export async function enqueueModelDownloadRecord(record: QueuedModelDownloadRecord): Promise<boolean> {
  try {
    await getRedis().rpush(WAITING_KEY, encode(record));
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ message }, '[download-record-queue] enqueue failed');
    return false;
  }
}

export async function recoverProcessingDownloadRecords(): Promise<void> {
  const client = getRedis();
  const payloads = await client.lrange(PROCESSING_KEY, 0, -1);
  if (payloads.length === 0) return;

  const pipeline = client.pipeline();
  pipeline.del(PROCESSING_KEY);
  pipeline.rpush(WAITING_KEY, ...payloads);
  await pipeline.exec();
  logger.warn(`[download-record-queue] recovered ${payloads.length} processing records`);
}

export async function claimModelDownloadRecordBatch(limit: number): Promise<ClaimedDownloadRecord[]> {
  const client = getRedis();
  const claimed: ClaimedDownloadRecord[] = [];

  for (let i = 0; i < limit; i += 1) {
    const payload = (await client.call('LMOVE', WAITING_KEY, PROCESSING_KEY, 'LEFT', 'RIGHT')) as string | null;
    if (!payload) break;
    const record = decode(payload);
    if (!record) {
      await client.lrem(PROCESSING_KEY, 1, payload);
      continue;
    }
    claimed.push({ payload, record });
  }

  return claimed;
}

export async function ackModelDownloadRecords(records: ClaimedDownloadRecord[]): Promise<void> {
  if (records.length === 0) return;
  const pipeline = getRedis().pipeline();
  for (const item of records) {
    pipeline.lrem(PROCESSING_KEY, 1, item.payload);
  }
  await pipeline.exec();
}

export async function retryModelDownloadRecords(records: ClaimedDownloadRecord[]): Promise<void> {
  if (records.length === 0) return;
  const retryPayloads: string[] = [];
  const pipeline = getRedis().pipeline();

  for (const item of records) {
    pipeline.lrem(PROCESSING_KEY, 1, item.payload);
    const attempts = Number(item.record.attempts) || 0;
    if (attempts + 1 <= MAX_ATTEMPTS) {
      retryPayloads.push(encode({ ...item.record, attempts: attempts + 1 }));
    }
  }

  if (retryPayloads.length > 0) {
    pipeline.rpush(WAITING_KEY, ...retryPayloads);
  }
  await pipeline.exec();
}
