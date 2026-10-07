import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DailyDownloadLimitError,
  recordModelDownload,
  recordQueuedModelDownloads,
  shouldRecordDownloadSynchronously,
  shouldSkipDownloadRecord,
} from './modelDownloadRecorder.js';

function createPrismaMock(existingDownloadCount = 0) {
  const calls: string[] = [];
  const eventCreateArgs: Array<Record<string, unknown>>[] = [];
  const eventCreateManyArgs: Array<{ data: Array<Record<string, unknown>> }> = [];
  const tx = {
    $queryRaw: async () => {
      calls.push('lock');
    },
    download: {
      count: async () => {
        calls.push('count');
        return existingDownloadCount;
      },
      upsert: async () => {
        // 下载历史去重：同用户+模型+格式只留一行（mock 与生产同款调用序列）
        calls.push('download.upsert');
      },
    },
    downloadEvent: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.push('downloadEvent.create');
        eventCreateArgs.push([args.data]);
      },
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        calls.push('downloadEvent.createMany');
        eventCreateManyArgs.push(args);
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
    eventCreateArgs,
    eventCreateManyArgs,
    prisma: {
      $transaction: async (fn: (txArg: typeof tx) => Promise<void>) => {
        calls.push('transaction');
        await fn(tx);
      },
    },
  };
}

test('records an anonymous download event without creating a user history record', async () => {
  const { prisma, calls, eventCreateArgs } = createPrismaMock();

  await recordModelDownload(prisma, {
    modelId: 'm1',
    format: 'glb',
    fileSize: 100,
    dailyLimit: 0,
    noRecord: false,
  });

  assert.deepEqual(calls, ['transaction', 'downloadEvent.create', 'tx.model.update']);
  assert.equal(eventCreateArgs.length, 1);
  assert.deepEqual(eventCreateArgs[0][0], {
    modelId: 'm1',
    userId: null,
    format: 'glb',
    fileSize: 100,
    source: 'model',
    device: 'unknown',
  });
});

test('records authenticated downloads inside a transaction', async () => {
  const { prisma, calls, eventCreateArgs } = createPrismaMock(1);

  await recordModelDownload(prisma, {
    userId: 'u1',
    modelId: 'm1',
    format: 'glb',
    fileSize: 100,
    dailyLimit: 5,
    noRecord: false,
  });

  assert.deepEqual(calls, [
    'transaction',
    'lock',
    'count',
    'download.upsert',
    'downloadEvent.create',
    'tx.model.update',
  ]);
  assert.deepEqual(eventCreateArgs[0][0], {
    modelId: 'm1',
    userId: 'u1',
    format: 'glb',
    fileSize: 100,
    source: 'model',
    device: 'unknown',
  });
});

test('passes source through to the download event', async () => {
  const { prisma, eventCreateArgs } = createPrismaMock();

  await recordModelDownload(prisma, {
    userId: 'u1',
    modelId: 'm1',
    format: 'glb',
    fileSize: 100,
    dailyLimit: 0,
    noRecord: false,
    source: 'favorites',
  });

  assert.equal(eventCreateArgs[0][0].source, 'favorites');
});

test('passes device through to the download event, defaulting to unknown', async () => {
  const mobile = createPrismaMock();
  await recordModelDownload(mobile.prisma, {
    userId: 'u1',
    modelId: 'm1',
    format: 'glb',
    fileSize: 100,
    dailyLimit: 0,
    noRecord: false,
    device: 'mobile',
  });

  assert.equal(mobile.eventCreateArgs[0][0].device, 'mobile');
});

test('still records authenticated download when noRecord is true and daily limit is enabled', async () => {
  const { prisma, calls, eventCreateArgs } = createPrismaMock(1);

  await recordModelDownload(prisma, {
    userId: 'u1',
    modelId: 'm1',
    format: 'glb',
    fileSize: 100,
    dailyLimit: 5,
    noRecord: true,
  });

  // 历史行仍要写（限额计数依赖），但事件流水不写（noRecord=内部重下，不打统计）
  assert.deepEqual(calls, ['transaction', 'lock', 'count', 'download.upsert', 'tx.model.update']);
  assert.equal(eventCreateArgs.length, 0);
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

test('flushes queued records: history deduped, one event per record including anonymous', async () => {
  const { prisma, calls, eventCreateManyArgs } = createPrismaMock();

  await recordQueuedModelDownloads(prisma, [
    { userId: 'u1', modelId: 'm1', format: 'glb', fileSize: 100 },
    { userId: 'u1', modelId: 'm1', format: 'glb', fileSize: 100 },
    { userId: null, modelId: 'm2', format: 'stp', fileSize: 200 },
  ]);

  assert.deepEqual(calls, [
    'transaction',
    'download.upsert',
    'downloadEvent.createMany',
    'tx.model.update',
    'tx.model.update',
  ]);
  assert.equal(eventCreateManyArgs.length, 1);
  assert.equal(eventCreateManyArgs[0].data.length, 3);
  assert.deepEqual(eventCreateManyArgs[0].data[2], {
    modelId: 'm2',
    userId: null,
    format: 'stp',
    fileSize: 200,
    source: 'model',
    device: 'unknown',
  });
});

test('keeps per-record device in queued flushes', async () => {
  const { prisma, eventCreateManyArgs } = createPrismaMock();

  await recordQueuedModelDownloads(prisma, [
    { userId: 'u1', modelId: 'm1', format: 'glb', fileSize: 100, device: 'mobile' },
    { userId: null, modelId: 'm2', format: 'stp', fileSize: 200, device: 'desktop' },
  ]);

  assert.equal(eventCreateManyArgs[0].data[0].device, 'mobile');
  assert.equal(eventCreateManyArgs[0].data[1].device, 'desktop');
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
