import type { Prisma, PrismaClient } from '@prisma/client';

export class DailyDownloadLimitError extends Error {
  constructor(readonly limit: number) {
    super(`每日下载次数已达上限 (${limit} 次)`);
  }
}

type DownloadRecorderPrisma = Pick<PrismaClient, '$transaction' | 'model' | 'download'>;
type DownloadRecorderTransaction = Prisma.TransactionClient;

export type ModelDownloadRecordOptions = {
  userId?: string | null;
  modelId: string;
  format: string;
  fileSize: number;
  dailyLimit: number;
  noRecord: boolean;
};

export type QueuedModelDownloadRecord = {
  userId?: string | null;
  modelId: string;
  format: string;
  fileSize: number;
};

export function shouldRecordDownloadSynchronously(options: ModelDownloadRecordOptions): boolean {
  return Boolean(options.userId && options.dailyLimit > 0);
}

export function shouldSkipDownloadRecord(options: ModelDownloadRecordOptions): boolean {
  return options.noRecord && options.dailyLimit <= 0;
}

export async function recordModelDownload(prisma: DownloadRecorderPrisma, options: ModelDownloadRecordOptions) {
  const { userId, modelId, format, fileSize, dailyLimit, noRecord } = options;
  if (shouldSkipDownloadRecord(options)) return;

  if (!userId) {
    await prisma.model.update({
      where: { id: modelId },
      data: { downloadCount: { increment: 1 } },
    });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  await prisma.$transaction(async (tx: DownloadRecorderTransaction) => {
    if (dailyLimit > 0) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`download:${userId}:${dayKey}`}))`;
      const count = await tx.download.count({
        where: {
          userId,
          createdAt: { gte: today },
        },
      });
      if (count >= dailyLimit) throw new DailyDownloadLimitError(dailyLimit);
    }

    if (!noRecord || dailyLimit > 0) {
      // 下载历史去重：同一用户+模型+格式只保留一行，重复下载仅刷新时间置顶。
      // 注意：dailyLimit 计数依赖本表行数，去重后限额按「当天下载的不同模型数」计
      //（同模型重复下载不消耗额度）——语义比之前宽松，属预期变化。
      await tx.download.upsert({
        where: { userId_modelId_format: { userId, modelId, format } },
        create: { userId, modelId, format, fileSize },
        update: { createdAt: new Date(), fileSize },
      });
    }

    await tx.model.update({
      where: { id: modelId },
      data: { downloadCount: { increment: 1 } },
    });
  });
}

export async function recordQueuedModelDownloads(prisma: DownloadRecorderPrisma, records: QueuedModelDownloadRecord[]) {
  if (records.length === 0) return;

  // 下载历史去重：批内先按 (userId, modelId, format) 合并，再逐键 upsert（同键只留一行，时间刷新）
  const deduped = new Map<string, { userId: string; modelId: string; format: string; fileSize: number }>();
  for (const record of records) {
    if (!record.userId) continue;
    const key = `${record.userId}\0${record.modelId}\0${record.format}`;
    deduped.set(key, {
      userId: record.userId,
      modelId: record.modelId,
      format: record.format,
      fileSize: record.fileSize,
    });
  }

  const increments = new Map<string, number>();
  for (const record of records) {
    increments.set(record.modelId, (increments.get(record.modelId) || 0) + 1);
  }

  await prisma.$transaction(async (tx: DownloadRecorderTransaction) => {
    for (const item of deduped.values()) {
      await tx.download.upsert({
        where: {
          userId_modelId_format: { userId: item.userId, modelId: item.modelId, format: item.format },
        },
        create: { userId: item.userId, modelId: item.modelId, format: item.format, fileSize: item.fileSize },
        update: { createdAt: new Date(), fileSize: item.fileSize },
      });
    }
    for (const [modelId, count] of increments) {
      await tx.model.update({
        where: { id: modelId },
        data: { downloadCount: { increment: count } },
      });
    }
  });
}
