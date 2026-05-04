import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router, Response } from 'express';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { getAllSettings } from '../../lib/settings.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { MODEL_STATUS } from '../../services/modelStatus.js';
import { asSingleString, buildSelectionShareNameMap } from './common.js';

type UserShareItem = {
  id: string;
  rawId: string;
  type: 'model' | 'selection';
  token: string;
  modelId: string | null;
  modelName: string;
  allowPreview: boolean;
  allowDownload: boolean;
  downloadLimit: number;
  downloadCount: number;
  viewCount: number;
  hasPassword: boolean;
  expiresAt: Date | null;
  createdAt: Date;
};

function parseUserShareId(value: string): { type: 'model' | 'selection'; id: string } {
  if (value.startsWith('model:')) return { type: 'model', id: value.slice('model:'.length) };
  if (value.startsWith('selection:')) return { type: 'selection', id: value.slice('selection:'.length) };
  return { type: 'model', id: value };
}

export function createUserSharesRouter() {
  const router = Router();

  // Create share link
  router.post('/api/shares', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      let { modelId, password, allowPreview, allowDownload = true, downloadLimit = 0, expiresAt } = req.body;

      if (!modelId) {
        res.status(400).json({ detail: '缺少 modelId' });
        return;
      }

      const model = await prisma.model.findUnique({ where: { id: modelId } });
      if (!model) {
        res.status(404).json({ detail: '模型不存在' });
        return;
      }
      if (model.status !== MODEL_STATUS.COMPLETED) {
        res.status(404).json({ detail: '模型不存在' });
        return;
      }
      if (model.createdById !== userId) {
        res.status(403).json({ detail: '只能分享自己的模型' });
        return;
      }

      // --- Apply share policy ---
      const settings = await getAllSettings();
      const sAllowPassword = settings.share_allow_password ?? true;
      const sAllowCustomExpiry = settings.share_allow_custom_expiry ?? true;
      const sDefaultExpireDays = Number(settings.share_default_expire_days) || 0;
      const sMaxExpireDays = Number(settings.share_max_expire_days) || 0;
      const sDefaultDownloadLimit = Number(settings.share_default_download_limit) || 0;
      const sMaxDownloadLimit = Number(settings.share_max_download_limit) || 0;
      const sAllowPreview = settings.share_allow_preview !== false;

      // Password policy
      if (!sAllowPassword) password = undefined;

      // Preview policy: a disabled system setting cannot be overridden by request body.
      allowPreview = sAllowPreview ? allowPreview !== false : false;

      // Expiry policy
      let finalExpiresAt: Date | null = null;
      if (!sAllowCustomExpiry) {
        // User cannot customize - use default only
        if (sDefaultExpireDays > 0) {
          finalExpiresAt = new Date(Date.now() + sDefaultExpireDays * 86400000);
        }
      } else {
        if (expiresAt) {
          finalExpiresAt = new Date(expiresAt);
          // Clamp to max
          if (sMaxExpireDays > 0) {
            const maxDate = new Date(Date.now() + sMaxExpireDays * 86400000);
            if (finalExpiresAt > maxDate) finalExpiresAt = maxDate;
          }
        } else if (sDefaultExpireDays > 0) {
          finalExpiresAt = new Date(Date.now() + sDefaultExpireDays * 86400000);
        }
      }

      // Download limit policy
      downloadLimit = Math.max(0, Math.floor(Number(downloadLimit) || 0));
      if (downloadLimit === 0 && sDefaultDownloadLimit > 0) {
        downloadLimit = sDefaultDownloadLimit;
      }
      if (sMaxDownloadLimit > 0 && downloadLimit > sMaxDownloadLimit) {
        downloadLimit = sMaxDownloadLimit;
      }

      const token = randomBytes(16).toString('hex');
      const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

      const share = await prisma.shareLink.create({
        data: {
          modelId,
          token,
          password: hashedPassword,
          allowPreview,
          allowDownload,
          downloadLimit,
          expiresAt: finalExpiresAt,
          createdById: userId,
        },
      });

      res.status(201).json({
        id: share.id,
        token: share.token,
        allowPreview: share.allowPreview,
        allowDownload: share.allowDownload,
        downloadLimit: share.downloadLimit,
        downloadCount: share.downloadCount,
        viewCount: share.viewCount,
        hasPassword: !!share.password,
        expiresAt: share.expiresAt,
        createdAt: share.createdAt,
        url: `${req.protocol}://${req.get('host')}/share/${share.token}`,
      });
    } catch (err) {
      logger.error({ err }, '[Shares] Create error');
      res.status(500).json({ detail: '创建分享失败' });
    }
  });

  // List my shares
  router.get('/api/shares', authMiddleware, async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;
    const [modelShares, selectionShares] = await Promise.all([
      prisma.shareLink.findMany({
        where: { createdById: userId },
        include: {
          model: { select: { id: true, name: true, originalName: true, format: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.selectionShare.findMany({
        where: { createdById: userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    const selectionSlugs = Array.from(new Set(selectionShares.map((row) => row.categorySlug).filter(Boolean)));
    const selectionCategories = selectionSlugs.length
      ? await prisma.selectionCategory.findMany({
          where: { slug: { in: selectionSlugs } },
          select: { slug: true, name: true },
        })
      : [];
    const selectionCategoryMap = new Map(selectionCategories.map((item) => [item.slug, item.name]));
    const selectionNameMap = await buildSelectionShareNameMap(selectionShares, selectionCategoryMap);

    const modelItems: UserShareItem[] = modelShares
      .filter((s: any) => s.model)
      .map((s: any) => ({
        id: `model:${s.id}`,
        rawId: s.id,
        type: 'model',
        token: s.token,
        modelId: s.modelId,
        modelName: s.model.name || s.model.originalName,
        allowPreview: s.allowPreview,
        allowDownload: s.allowDownload,
        downloadLimit: s.downloadLimit,
        downloadCount: s.downloadCount,
        viewCount: s.viewCount,
        hasPassword: !!s.password,
        expiresAt: s.expiresAt,
        createdAt: s.createdAt,
      }));
    const selectionItems: UserShareItem[] = selectionShares.map((s) => ({
      id: `selection:${s.id}`,
      rawId: s.id,
      type: 'selection',
      token: s.token,
      modelId: null,
      modelName: selectionNameMap.get(s.id) || selectionCategoryMap.get(s.categorySlug) || s.categorySlug || '产品选型',
      allowPreview: true,
      allowDownload: false,
      downloadLimit: 0,
      downloadCount: 0,
      viewCount: s.viewCount,
      hasPassword: false,
      expiresAt: null,
      createdAt: s.createdAt,
    }));

    res.json([...modelItems, ...selectionItems].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  });

  // List shares for a specific model
  router.get('/api/models/:id/shares', authMiddleware, async (req: AuthRequest, res: Response) => {
    const modelId = asSingleString(req.params.id);
    const userId = req.user!.userId;
    if (!modelId) {
      res.status(400).json({ detail: '模型参数无效' });
      return;
    }
    const shares = await prisma.shareLink.findMany({
      where: { modelId, createdById: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json(
      shares.map((s) => ({
        id: s.id,
        token: s.token,
        allowPreview: s.allowPreview,
        allowDownload: s.allowDownload,
        downloadLimit: s.downloadLimit,
        downloadCount: s.downloadCount,
        viewCount: s.viewCount,
        hasPassword: !!s.password,
        expiresAt: s.expiresAt,
        createdAt: s.createdAt,
      })),
    );
  });

  // Delete share
  router.delete('/api/shares/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;
    const id = asSingleString(req.params.id);
    if (!id) {
      res.status(400).json({ detail: '分享参数无效' });
      return;
    }

    const target = parseUserShareId(id);
    if (target.type === 'selection') {
      const selectionShare = await prisma.selectionShare.findUnique({ where: { id: target.id } });
      if (!selectionShare || selectionShare.createdById !== userId) {
        res.status(404).json({ detail: '分享链接不存在' });
        return;
      }
      await prisma.selectionShare.delete({ where: { id: target.id } });
      res.json({ ok: true });
      return;
    }

    const share = await prisma.shareLink.findUnique({ where: { id: target.id } });
    if (!share || share.createdById !== userId) {
      res.status(404).json({ detail: '分享链接不存在' });
      return;
    }

    await prisma.shareLink.delete({ where: { id: target.id } });
    res.json({ ok: true });
  });

  return router;
}
