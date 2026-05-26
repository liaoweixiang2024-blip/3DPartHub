import { existsSync } from 'fs';
import { extname } from 'node:path';
import archiver from 'archiver';
import { Router, Response, urlencoded } from 'express';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { getErrorMessage } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { getSetting } from '../lib/settings.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { shouldAttachExternalGltfBin, shouldDownloadOriginalBatchFormat } from '../services/batchArchive.js';
import { withAssetVersion } from '../services/gltfAsset.js';
import { DailyDownloadLimitError, recordModelDownload } from '../services/modelDownloadRecorder.js';
import { resolveDbModelDownloadTarget } from '../services/modelDownloadTarget.js';
import { findOriginalModelPath } from '../services/modelFiles.js';
import { MODEL_STATUS } from '../services/modelStatus.js';
import { createNotification } from './notifications.js';

const router = Router();
const parseBatchDownloadForm = urlencoded({ extended: false, limit: '1mb' });

function param(req: { params: Record<string, string | string[]> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

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

function readBatchModelIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const data = body as { modelIds?: unknown; 'modelIds[]'?: unknown };
  return uniqueStringList(data.modelIds ?? data['modelIds[]']);
}

// List user's favorites
router.get('/api/favorites', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const cacheKey = `cache:favorites:${req.user!.userId}`;
    const { cacheGetOrSet, TTL } = await import('../lib/cache.js');
    const { value: favorites } = await cacheGetOrSet(cacheKey, TTL.MODELS_LIST, async () => {
      const rows = await prisma.favorite.findMany({
        where: { userId: req.user!.userId, modelId: { not: '' } },
        take: 200,
        select: {
          id: true,
          modelId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      const modelIds = Array.from(new Set(rows.map((favorite) => favorite.modelId).filter(Boolean)));
      const models = modelIds.length
        ? await prisma.model.findMany({
            where: { id: { in: modelIds } },
            select: {
              id: true,
              name: true,
              originalName: true,
              format: true,
              thumbnailUrl: true,
              gltfUrl: true,
              gltfSize: true,
              originalSize: true,
              status: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : [];
      const modelById = new Map(models.map((model) => [model.id, model]));
      return rows.map((favorite) => ({
        ...favorite,
        model: modelById.get(favorite.modelId) || null,
      }));
    });
    res.json(
      favorites
        .filter((favorite) => favorite.model)
        .map((favorite) => ({
          id: favorite.id,
          modelId: favorite.modelId,
          createdAt: favorite.createdAt,
          model: favorite.model
            ? {
                model_id: favorite.model.id,
                name: favorite.model.name,
                original_name: favorite.model.originalName,
                format: favorite.model.format,
                thumbnail_url: withAssetVersion(favorite.model.thumbnailUrl, favorite.model.updatedAt),
                gltf_url: withAssetVersion(favorite.model.gltfUrl, favorite.model.updatedAt),
                file_size: favorite.model.gltfSize,
                original_size: favorite.model.originalSize,
                created_at: favorite.model.createdAt,
              }
            : null,
        })),
    );
  } catch (err) {
    logger.error({ err }, '[favorites] Failed to list favorites');
    res.status(500).json({ detail: '获取收藏列表失败' });
  }
});

// Add to favorites
router.post('/api/models/:id/favorite', authMiddleware, async (req: AuthRequest, res: Response) => {
  const modelId = param(req, 'id');
  try {
    const favorite = await prisma.favorite.create({
      data: { userId: req.user!.userId, modelId },
    });
    const { cacheDel } = await import('../lib/cache.js');
    await cacheDel(`cache:favorites:${req.user!.userId}`);
    // Notify model owner about new favorite
    if (prisma) {
      try {
        const model = await prisma.model.findUnique({
          where: { id: modelId },
          select: { createdById: true, name: true },
        });
        if (model && model.createdById !== req.user!.userId) {
          await createNotification({
            userId: model.createdById,
            title: '新收藏',
            message: `有用户收藏了模型「${model.name}」`,
            type: 'favorite',
            relatedId: modelId,
          });
        }
      } catch {
        logger.warn('Failed to notify model owner about new favorite');
      }
    }
    res.json(favorite);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'P2002') {
      res.json({ message: '已收藏' });
      return;
    }
    res.status(500).json({ detail: '收藏失败' });
  }
});

// Remove from favorites
router.delete('/api/models/:id/favorite', authMiddleware, async (req: AuthRequest, res: Response) => {
  const modelId = param(req, 'id');
  try {
    await prisma.favorite.deleteMany({
      where: { userId: req.user!.userId, modelId },
    });
    const { cacheDel } = await import('../lib/cache.js');
    await cacheDel(`cache:favorites:${req.user!.userId}`);
    res.json({ message: '已取消收藏' });
  } catch {
    res.status(500).json({ detail: '取消收藏失败' });
  }
});

// Batch remove favorites
router.post('/api/favorites/batch-remove', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { modelIds } = req.body as { modelIds: string[] };
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    res.status(400).json({ detail: '请选择要取消收藏的模型' });
    return;
  }
  if (modelIds.length > 1000) {
    res.status(400).json({ detail: '单次最多取消收藏 1000 个模型' });
    return;
  }
  try {
    const result = await prisma.favorite.deleteMany({
      where: {
        userId: req.user!.userId,
        modelId: { in: modelIds },
      },
    });
    const { cacheDel } = await import('../lib/cache.js');
    await cacheDel(`cache:favorites:${req.user!.userId}`);
    res.json({ removed: result.count });
  } catch {
    res.status(500).json({ detail: '批量取消收藏失败' });
  }
});

// Batch download favorites as ZIP
router.post(
  '/api/favorites/batch-download',
  parseBatchDownloadForm,
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    const modelIds = readBatchModelIds(req.body);
    const format = bodyString(req.body, 'format');
    if (!Array.isArray(modelIds) || modelIds.length === 0) {
      res.status(400).json({ detail: '请选择要下载的模型' });
      return;
    }
    const uniqueModelIds = uniqueStringList(modelIds);
    if (uniqueModelIds.length === 0) {
      res.status(400).json({ detail: '请选择要下载的模型' });
      return;
    }
    const { pageSizePolicy } = await getBusinessConfig();
    const batchMax = Math.max(1, Math.floor(Number(pageSizePolicy.userBatchDownloadMax) || 100));
    if (uniqueModelIds.length > batchMax) {
      res.status(400).json({ detail: `单次最多下载 ${batchMax} 个模型` });
      return;
    }

    try {
      const favorites = await prisma.favorite.findMany({
        where: { userId: req.user!.userId, modelId: { in: uniqueModelIds } },
        select: {
          modelId: true,
        },
      });
      const favoriteModelIds = Array.from(new Set(favorites.map((favorite) => favorite.modelId).filter(Boolean)));
      const favoriteModels = favoriteModelIds.length
        ? await prisma.model.findMany({
            where: { id: { in: favoriteModelIds } },
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
          })
        : [];
      const modelById = new Map(
        favoriteModels.filter((model) => model.status === MODEL_STATUS.COMPLETED).map((model) => [model.id, model]),
      );
      const models = uniqueModelIds
        .map((id) => modelById.get(id))
        .filter((model): model is (typeof favoriteModels)[number] => Boolean(model));

      if (models.length === 0) {
        res.status(404).json({ detail: '没有可下载的模型' });
        return;
      }

      const downloadOriginal = shouldDownloadOriginalBatchFormat(format);

      // Pre-scan files before committing response headers
      const fileEntries: Array<{
        filePath: string;
        fileName: string;
        binPath?: string;
        record?: { modelId: string; format: string; fileSize: number };
      }> = [];
      for (const m of models) {
        if (downloadOriginal && !findOriginalModelPath(m)) continue;

        const target = resolveDbModelDownloadTarget(m, downloadOriginal ? 'original' : undefined);
        if (target && existsSync(target.filePath)) {
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
      }

      if (fileEntries.length === 0) {
        res.status(404).json({ detail: downloadOriginal ? '没有找到可下载的原始模型文件' : '没有找到可下载的文件' });
        return;
      }

      if (req.get('x-download-preflight') === '1') {
        res.json({ fileCount: fileEntries.length });
        return;
      }

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
        } catch (err: unknown) {
          if (err instanceof DailyDownloadLimitError) {
            res.status(429).json({ detail: err.message });
            return;
          }
        }
      }

      // Now safe to commit headers and stream
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="favorites_${Date.now()}.zip"`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      archive.pipe(res);

      const usedNames = new Map<string, number>();
      for (const entry of fileEntries) {
        const finalName = uniqueArchiveFileName(entry.fileName, usedNames);
        archive.file(entry.filePath, { name: finalName });
        const binEntry = { ...entry, fileName: finalName };
        if (shouldAttachExternalGltfBin(binEntry)) {
          const binName = finalName.replace(/\.[^.]+$/, '.bin');
          archive.file(binEntry.binPath, { name: binName });
        }
      }

      await archive.finalize();
    } catch (err: unknown) {
      logger.error({ err_message: getErrorMessage(err) }, '[favorites] Batch download error');
      if (!res.headersSent) {
        if (err instanceof DailyDownloadLimitError) {
          res.status(429).json({ detail: err.message });
          return;
        }
        res.status(500).json({ detail: '打包下载失败' });
      }
    }
  },
);

export default router;
