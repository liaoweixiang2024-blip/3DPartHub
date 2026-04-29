import type { Prisma, PrismaClient } from "@prisma/client";

export class DailyDownloadLimitError extends Error {
  constructor(readonly limit: number) {
    super(`每日下载次数已达上限 (${limit} 次)`);
  }
}

type DownloadRecorderPrisma = Pick<PrismaClient, "$transaction" | "model" | "download">;
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
  const dayKey = today.toISOString().slice(0, 10);

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
      await tx.download.create({
        data: {
          userId,
          modelId,
          format,
          fileSize,
        },
      });
    }

    await tx.model.update({
      where: { id: modelId },
      data: { downloadCount: { increment: 1 } },
    });
  });
}

export async function recordQueuedModelDownloads(
  prisma: DownloadRecorderPrisma,
  records: QueuedModelDownloadRecord[]
) {
  if (records.length === 0) return;

  const downloads = records
    .filter((record) => record.userId)
    .map((record) => ({
      userId: record.userId!,
      modelId: record.modelId,
      format: record.format,
      fileSize: record.fileSize,
    }));

  const increments = new Map<string, number>();
  for (const record of records) {
    increments.set(record.modelId, (increments.get(record.modelId) || 0) + 1);
  }

  const operations: Prisma.PrismaPromise<unknown>[] = [];
  if (downloads.length > 0) {
    operations.push(prisma.download.createMany({ data: downloads }));
  }
  for (const [modelId, count] of increments) {
    operations.push(prisma.model.update({
      where: { id: modelId },
      data: { downloadCount: { increment: count } },
    }));
  }

  if (operations.length > 0) {
    await prisma.$transaction(operations);
  }
}
