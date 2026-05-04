import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DailyDownloadLimitError,
  recordModelDownload,
  shouldRecordDownloadSynchronously,
  shouldSkipDownloadRecord,
} from './modelDownloadRecorder.js';

function createPrismaMock(existingDownloadCount = 0) {
  const calls: string[] = [];
  const tx = {
    $queryRaw: async () => {
      calls.push('lock');
    },
    download: {
      count: async () => {
        calls.push('count');
        return existingDownloadCount;
      },
      create: async () => {
        calls.push('download.create');
      },
    },
    model: {
      update: async () => {
        calls.push('tx.model.update');
      },
    },
  };
  return {
    calls,
    prisma: {
      model: {
        update: async () => {
          calls.push('model.update');
        },
      },
      $transaction: async (fn: (txArg: typeof tx) => Promise<void>) => {
        calls.push('transaction');
        await fn(tx);
      },
    },
  };
}

test('increments anonymous model download count without creating a download record', async () => {
  const { prisma, calls } = createPrismaMock();

  await recordModelDownload(prisma, {
    modelId: 'm1',
    format: 'glb',
    fileSize: 100,
    dailyLimit: 0,
    noRecord: false,
  });

  assert.deepEqual(calls, ['model.update']);
});

test('records authenticated downloads inside a transaction', async () => {
  const { prisma, calls } = createPrismaMock(1);

  await recordModelDownload(prisma, {
    userId: 'u1',
    modelId: 'm1',
    format: 'glb',
    fileSize: 100,
    dailyLimit: 5,
    noRecord: false,
  });

  assert.deepEqual(calls, ['transaction', 'lock', 'count', 'download.create', 'tx.model.update']);
});

test('still records authenticated download when noRecord is true and daily limit is enabled', async () => {
  const { prisma, calls } = createPrismaMock(1);

  await recordModelDownload(prisma, {
    userId: 'u1',
    modelId: 'm1',
    format: 'glb',
    fileSize: 100,
    dailyLimit: 5,
    noRecord: true,
  });

  assert.deepEqual(calls, ['transaction', 'lock', 'count', 'download.create', 'tx.model.update']);
});

test('skips authenticated download record when noRecord is true and no daily limit is configured', async () => {
  const { prisma, calls } = createPrismaMock(0);

  await recordModelDownload(prisma, {
    userId: 'u1',
    modelId: 'm1',
    format: 'glb',
    fileSize: 100,
    dailyLimit: 0,
    noRecord: true,
  });

  assert.deepEqual(calls, []);
});

test('classifies async-safe records without daily limit', () => {
  const options = {
    userId: 'u1',
    modelId: 'm1',
    format: 'glb',
    fileSize: 100,
    dailyLimit: 0,
    noRecord: false,
  };

  assert.equal(shouldRecordDownloadSynchronously(options), false);
  assert.equal(shouldSkipDownloadRecord(options), false);
});

test('keeps daily limit records synchronous', () => {
  const options = {
    userId: 'u1',
    modelId: 'm1',
    format: 'glb',
    fileSize: 100,
    dailyLimit: 5,
    noRecord: false,
  };

  assert.equal(shouldRecordDownloadSynchronously(options), true);
});

test('throws when daily download limit is reached', async () => {
  const { prisma, calls } = createPrismaMock(5);

  await assert.rejects(
    () =>
      recordModelDownload(prisma, {
        userId: 'u1',
        modelId: 'm1',
        format: 'glb',
        fileSize: 100,
        dailyLimit: 5,
        noRecord: false,
      }),
    DailyDownloadLimitError,
  );
  assert.deepEqual(calls, ['transaction', 'lock', 'count']);
});
