import { existsSync } from 'fs';
import archiver from 'archiver';
import { Router, Response } from 'express';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { getSetting } from '../lib/settings.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getPreviewAssetExtension, withAssetVersion } from '../services/gltfAsset.js';
import { DailyDownloadLimitError, recordModelDownload } from '../services/modelDownloadRecorder.js';
import { resolveDbModelDownloadTarget } from '../services/modelDownloadTarget.js';
import { MODEL_STATUS } from '../services/modelStatus.js';
import { createNotification } from './notifications.js';

const router = Router();

function param(req: { params: Record<string, string | string[]> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

// List user's favorites
router.get('/api/favorites', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const cacheKey = `cache:favorites:${req.user!.userId}`;
    const { cacheGetOrSet, TTL } = await import('../lib/cache.js');
    const { value: favorites } = await cacheGetOrSet(cacheKey, TTL.MODELS_LIST, async () => {
      return prisma.favorite.findMany({
        where: { userId: req.user!.userId, modelId: { not: '' }, model: { is: {} } },
        take: 200,
        include: {
          model: {
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
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
    res.json(
      favorites
        .filter((f: any) => f.model)
        .map((favorite: any) => ({
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
  } catch {
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
      } catch {}
    }
    res.json(favorite);
  } catch (err: any) {
    if (err.code === 'P2002') {
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
router.post('/api/favorites/batch-download', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { modelIds, format } = req.body as { modelIds: string[]; format?: string };
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    res.status(400).json({ detail: '请选择要下载的模型' });
    return;
  }
  const uniqueModelIds = Array.from(
    new Set(modelIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())),
  );
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
        .map((favorite: any) => favorite.model)
        .filter((model: any) => model?.status === MODEL_STATUS.COMPLETED)
        .map((model: any) => [model.id, model]),
    );
    const models = uniqueModelIds.map((id) => modelById.get(id)).filter(Boolean);

    if (models.length === 0) {
      res.status(404).json({ detail: '没有可下载的模型' });
      return;
    }

    const downloadOriginal = format === 'original';

    // Pre-scan files before committing response headers
    const fileEntries: Array<{
      filePath: string;
      fileName: string;
      binPath?: string;
      record?: { modelId: string; format: string; fileSize: number };
    }> = [];
    for (const m of models) {
      const target = resolveDbModelDownloadTarget(m, downloadOriginal ? 'original' : undefined);
      if (target && existsSync(target.filePath)) {
        const ext = getPreviewAssetExtension(target.filePath);
        const binPath = ext === 'gltf' ? target.filePath.replace(/\.gltf$/, '.bin') : undefined;
        fileEntries.push({
          filePath: target.filePath,
          fileName: target.fileName,
          binPath: binPath && existsSync(binPath) ? binPath : undefined,
          record: target.record,
        });
      }
    }

    if (fileEntries.length === 0) {
      res.status(404).json({ detail: '没有找到可下载的文件' });
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
      } catch (err: any) {
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
      const safeName = (entry.fileName.replace(/\.[^.]+$/, '') || 'file').replace(/[<>:"/\\|?*]/g, '_');
      const ext = entry.filePath.split('.').pop()?.toLowerCase() || 'bin';
      const baseName = `${safeName}.${ext}`;
      const count = usedNames.get(baseName) || 0;
      usedNames.set(baseName, count + 1);
      const finalName = count > 0 ? `${safeName}_${count}.${ext}` : baseName;
      archive.file(entry.filePath, { name: finalName });
      if (entry.binPath) {
        const binName = count > 0 ? `${safeName}_${count}.bin` : `${safeName}.bin`;
        archive.file(entry.binPath, { name: binName });
      }
    }

    await archive.finalize();
  } catch (err: any) {
    logger.error({ err_message: err.message }, '[favorites] Batch download error');
    if (!res.headersSent) {
      if (err instanceof DailyDownloadLimitError) {
        res.status(429).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: '打包下载失败' });
    }
  }
});

export default router;
