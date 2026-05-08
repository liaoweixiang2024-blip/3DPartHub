import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import archiver from 'archiver';
import { Router, Response, urlencoded } from 'express';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { createLogger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { getSetting } from '../lib/settings.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { shouldAttachExternalGltfBin, shouldDownloadOriginalBatchFormat } from '../services/batchArchive.js';
import { DailyDownloadLimitError, recordModelDownload } from '../services/modelDownloadRecorder.js';
import { resolveDbModelDownloadTarget } from '../services/modelDownloadTarget.js';
import { findOriginalModelPath } from '../services/modelFiles.js';
import { MODEL_STATUS } from '../services/modelStatus.js';

const log = createLogger({ component: 'batch-downloads' });
const router = Router();
const parseBatchDownloadForm = urlencoded({ extended: false, limit: '1mb' });

type BatchDownloadSource = 'downloads' | 'favorites';
type ArchiveEntry = {
  filePath: string;
  fileName: string;
  binPath?: string;
  record?: { modelId: string; format: string; fileSize: number };
};

type ArchiveLookup =
  | { ok: true; fileEntries: ArchiveEntry[]; zipPrefix: string; shouldRecordDownloads: boolean }
  | { ok: false; status: number; detail: string };

function uniqueArchiveFileName(fileName: string, usedNames: Map<string, number>): string {
  const safeFileName = (fileName || 'model.step').replace(/[<>:"/\\|?*]/g, '_');
  const match = safeFileName.match(/^(.*?)(\.[^.]+)?$/);
  const stem = (match?.[1] || 'model').trim() || 'model';
  const ext = match?.[2] || '.step';
  const baseName = `${stem}${ext}`;
  const count = usedNames.get(baseName) || 0;
  usedNames.set(baseName, count + 1);
  return count > 0 ? `${stem}_${count}${ext}` : baseName;
}

function uniqueStringList(value: unknown): string[] {
  let values: unknown[] = [];
  if (Array.isArray(value)) {
    values = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        values = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        values = [trimmed];
      }
    } else if (trimmed) {
      values = [trimmed];
    }
  }

  return Array.from(
    new Set(
      values
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .map((item) => item.trim()),
    ),
  );
}

function bodyString(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>)[key];
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function bodyIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const data = body as { ids?: unknown; 'ids[]'?: unknown };
  return uniqueStringList(data.ids ?? data['ids[]']);
}

function bodySource(body: unknown): BatchDownloadSource | null {
  const source = bodyString(body, 'source');
  return source === 'downloads' || source === 'favorites' ? source : null;
}

async function validateBatchSize(ids: string[], label: string): Promise<ArchiveLookup | null> {
  if (ids.length === 0) return { ok: false, status: 400, detail: `请选择要下载的${label}` };

  const { pageSizePolicy } = await getBusinessConfig();
  const batchMax = Math.max(1, Math.floor(Number(pageSizePolicy.userBatchDownloadMax) || 100));
  if (ids.length > batchMax) {
    return { ok: false, status: 400, detail: `单次最多下载 ${batchMax} 个${label}` };
  }
  return null;
}

async function lookupHistoryArchiveEntries(ids: string[], userId: string): Promise<ArchiveLookup> {
  if (!prisma) return { ok: false, status: 503, detail: 'DB unavailable' };

  const validation = await validateBatchSize(ids, '记录');
  if (validation) return validation;

  const downloads = await prisma.download.findMany({
    where: { id: { in: ids }, userId },
    include: {
      model: {
        select: {
          id: true,
          name: true,
          originalName: true,
          format: true,
          originalFormat: true,
          originalSize: true,
          gltfUrl: true,
          gltfSize: true,
          uploadPath: true,
          status: true,
        },
      },
    },
  });
  const downloadById = new Map(downloads.map((download) => [download.id, download]));
  const addedModelIds = new Set<string>();
  const fileEntries: ArchiveEntry[] = [];

  for (const id of ids) {
    const download = downloadById.get(id);
    const model = download?.model;
    if (!model || model.status !== MODEL_STATUS.COMPLETED || addedModelIds.has(model.id)) continue;
    if (!findOriginalModelPath(model)) continue;

    const target = resolveDbModelDownloadTarget(model, 'original');
    if (!target || !existsSync(target.filePath)) continue;

    fileEntries.push({ filePath: target.filePath, fileName: target.fileName });
    addedModelIds.add(model.id);
  }

  if (fileEntries.length === 0) {
    return { ok: false, status: 404, detail: '没有找到可打包下载的原始模型文件' };
  }

  return { ok: true, fileEntries, zipPrefix: 'downloads', shouldRecordDownloads: false };
}

async function lookupFavoriteArchiveEntries(
  ids: string[],
  userId: string,
  format = 'original',
): Promise<ArchiveLookup> {
  if (!prisma) return { ok: false, status: 503, detail: 'DB unavailable' };

  const validation = await validateBatchSize(ids, '模型');
  if (validation) return validation;

  const favorites = await prisma.favorite.findMany({
    where: { userId, modelId: { in: ids } },
    include: {
      model: {
        select: {
          id: true,
          name: true,
          originalName: true,
          format: true,
          originalFormat: true,
          originalSize: true,
          gltfUrl: true,
          gltfSize: true,
          uploadPath: true,
          status: true,
        },
      },
    },
  });
  const modelById = new Map(
    favorites
      .map((favorite) => favorite.model)
      .filter((model): model is NonNullable<typeof model> => model?.status === MODEL_STATUS.COMPLETED)
      .map((model) => [model.id, model]),
  );
  const models: Array<NonNullable<(typeof favorites)[number]['model']>> = [];
  for (const id of ids) {
    const model = modelById.get(id);
    if (model) models.push(model);
  }
  if (models.length === 0) return { ok: false, status: 404, detail: '没有可下载的模型' };

  const downloadOriginal = shouldDownloadOriginalBatchFormat(format);
  const fileEntries: ArchiveEntry[] = [];
  for (const model of models) {
    if (downloadOriginal && !findOriginalModelPath(model)) continue;

    const target = resolveDbModelDownloadTarget(model, downloadOriginal ? 'original' : undefined);
    if (!target || !existsSync(target.filePath)) continue;

    const binPath =
      !downloadOriginal && extname(target.filePath).toLowerCase() === '.gltf'
        ? target.filePath.replace(/\.gltf$/i, '.bin')
        : undefined;
    fileEntries.push({
      filePath: target.filePath,
      fileName: target.fileName,
      binPath: binPath && existsSync(binPath) ? binPath : undefined,
      record: target.record,
    });
  }

  if (fileEntries.length === 0) {
    return {
      ok: false,
      status: 404,
      detail: downloadOriginal ? '没有找到可下载的原始模型文件' : '没有找到可下载的文件',
    };
  }

  return { ok: true, fileEntries, zipPrefix: 'favorites', shouldRecordDownloads: true };
}

async function recordArchiveDownloads(req: AuthRequest, res: Response, fileEntries: ArchiveEntry[]): Promise<boolean> {
  const dailyLimit = Number(await getSetting<number>('daily_download_limit')) || 0;

  for (const entry of fileEntries) {
    if (!entry.record) continue;
    try {
      await recordModelDownload(prisma, {
        userId: req.user!.userId,
        ...entry.record,
        dailyLimit,
        noRecord: false,
      });
    } catch (err) {
      if (err instanceof DailyDownloadLimitError) {
        res.status(429).json({ detail: err.message });
        return false;
      }
      throw err;
    }
  }

  return true;
}

async function streamArchive(res: Response, fileEntries: ArchiveEntry[], zipPrefix: string): Promise<void> {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipPrefix}_${Date.now()}.zip"`);

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.on('error', (err) => {
    log.error({ err }, 'Unified batch archive error');
    if (!res.headersSent) {
      res.status(500).json({ detail: '打包下载失败' });
    } else {
      res.destroy(err);
    }
  });
  archive.pipe(res);

  const usedNames = new Map<string, number>();
  for (const entry of fileEntries) {
    const finalName = uniqueArchiveFileName(entry.fileName, usedNames);
    archive.file(entry.filePath, { name: finalName });
    const binEntry = { ...entry, fileName: finalName };
    if (shouldAttachExternalGltfBin(binEntry)) {
      archive.file(binEntry.binPath, { name: finalName.replace(/\.[^.]+$/, '.bin') });
    }
  }

  await archive.finalize();
}

router.post('/api/batch-download', parseBatchDownloadForm, authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const source = bodySource(req.body);
    const ids = bodyIds(req.body);
    const format = bodyString(req.body, 'format') || 'original';

    if (!source) {
      res.status(400).json({ detail: '缺少批量下载类型' });
      return;
    }

    const lookup =
      source === 'downloads'
        ? await lookupHistoryArchiveEntries(ids, req.user!.userId)
        : await lookupFavoriteArchiveEntries(ids, req.user!.userId, format);
    if (!lookup.ok) {
      res.status(lookup.status).json({ detail: lookup.detail });
      return;
    }

    if (req.get('x-download-preflight') === '1') {
      res.json({ fileCount: lookup.fileEntries.length });
      return;
    }

    if (lookup.shouldRecordDownloads) {
      const recorded = await recordArchiveDownloads(req, res, lookup.fileEntries);
      if (!recorded) return;
    }

    await streamArchive(res, lookup.fileEntries, lookup.zipPrefix);
  } catch (err) {
    log.error({ err }, 'Unified batch download failed');
    if (!res.headersSent) res.status(500).json({ detail: '打包下载失败' });
  }
});

export default router;
