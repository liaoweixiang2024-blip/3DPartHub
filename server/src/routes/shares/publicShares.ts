import { existsSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { Router, Request, Response } from 'express';
import { sendAcceleratedFile } from '../../lib/acceleratedDownload.js';
import { cacheDel, cacheGetOrSet, TTL, redis } from '../../lib/cache.js';
import { createProtectedResourceToken } from '../../lib/downloadTokenStore.js';
import { prisma } from '../../lib/prisma.js';
import { getSetting } from '../../lib/settings.js';
import { withAssetVersion } from '../../services/gltfAsset.js';
import { resolveDbModelDownloadTarget } from '../../services/modelDownloadTarget.js';
import { asSingleString, hasShareAccess, SHARE_ACCESS_TOKEN_TTL_MS } from './common.js';

type ShareInfoCache = {
  allowDownload: boolean;
  allowDrawing: boolean;
  allowPreview: boolean;
  downloadCount: number;
  downloadLimit: number;
  expiresAt: Date | null;
  id: string;
  model: {
    description: string | null;
    drawingUrl: string | null;
    format: string;
    gltfSize: number;
    gltfUrl: string;
    id: string;
    name: string;
    originalFormat: string | null;
    originalName: string;
    originalSize: number;
    thumbnailUrl: string | null;
    updatedAt: Date;
    uploadPath: string | null;
  } | null;
  modelId: string;
};

export function createPublicSharesRouter() {
  const router = Router();

  // Get share info
  router.get('/api/shares/:token/info', async (req: Request, res: Response) => {
    const token = asSingleString(req.params.token);
    if (!token) {
      res.status(400).json({ detail: '分享参数无效' });
      return;
    }

    const { value: shareRaw } = await cacheGetOrSet<ShareInfoCache | null>(
      `cache:share:info:${token}`,
      TTL.MODEL_DETAIL,
      async () => {
        const result = await prisma.shareLink.findUnique({
          where: { token },
          select: {
            id: true,
            modelId: true,
            allowPreview: true,
            allowDownload: true,
            allowDrawing: true,
            downloadLimit: true,
            downloadCount: true,
            expiresAt: true,
          },
        });
        if (result) {
          const model = await prisma.model.findUnique({
            where: { id: result.modelId },
            select: {
              id: true,
              name: true,
              originalName: true,
              format: true,
              originalSize: true,
              gltfUrl: true,
              gltfSize: true,
              originalFormat: true,
              uploadPath: true,
              thumbnailUrl: true,
              description: true,
              drawingUrl: true,
              updatedAt: true,
            },
          });
          return { ...result, model };
        }
        return result;
      },
    );

    const sharePassword: string | null = shareRaw?.id
      ? ((await prisma.shareLink.findUnique({ where: { id: shareRaw.id }, select: { password: true } }))?.password ??
        null)
      : null;
    const share = shareRaw;

    if (!share) {
      res.status(404).json({ detail: '分享链接不存在' });
      return;
    }

    if (!share.model) {
      await cacheDel(`cache:share:info:${token}`);
      res.status(404).json({ detail: '分享的模型已被删除' });
      return;
    }

    if (share.expiresAt && new Date() > share.expiresAt) {
      res.status(410).json({ detail: '分享链接已过期', expired: true });
      return;
    }

    // Increment view count (best effort)
    prisma.shareLink.update({ where: { id: share.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});

    const model = share.model;
    const siteTitle = await getSetting<string>('site_title').catch(() => '3DPartHub');
    const accessVerified = hasShareAccess(share.id, sharePassword, req.query.share_access_token);

    res.json({
      id: share.id,
      modelName: model.name || model.originalName,
      format: model.originalFormat || model.format,
      fileSize: model.originalSize,
      description: model.description,
      thumbnailUrl: withAssetVersion(model.thumbnailUrl, model.updatedAt),
      allowPreview: share.allowPreview,
      allowDownload: share.allowDownload,
      downloadLimit: share.downloadLimit,
      downloadCount: share.downloadCount,
      remainingDownloads: share.downloadLimit > 0 ? Math.max(0, share.downloadLimit - share.downloadCount) : -1,
      hasPassword: !!sharePassword,
      expiresAt: share.expiresAt,
      siteTitle,
      gltfUrl: share.allowPreview && accessVerified ? withAssetVersion(model.gltfUrl, model.updatedAt) : undefined,
      drawingUrl: share.allowDrawing && model.drawingUrl ? withAssetVersion(model.drawingUrl, model.updatedAt) : null,
    });
  });

  // Verify password
  router.post('/api/shares/:token/verify', async (req: Request, res: Response) => {
    const token = asSingleString(req.params.token);
    const { password } = req.body;
    if (!token) {
      res.status(400).json({ detail: '分享参数无效' });
      return;
    }

    if (!password) {
      res.status(400).json({ detail: '请输入密码' });
      return;
    }

    const share = await prisma.shareLink.findUnique({ where: { token } });
    if (!share) {
      res.status(404).json({ detail: '分享链接不存在' });
      return;
    }

    if (share.expiresAt && new Date() > share.expiresAt) {
      res.status(410).json({ detail: '分享链接已过期' });
      return;
    }

    if (!share.password) {
      res.json({ verified: true });
      return;
    }

    const attemptsKey = `share_verify:${share.id}`;
    const attempts = await redis.incr(attemptsKey);
    if (attempts === 1) await redis.expire(attemptsKey, 300);
    if (attempts > 10) {
      res.status(429).json({ detail: '尝试次数过多，请稍后再试' });
      return;
    }

    const valid = await bcrypt.compare(password, share.password);
    if (!valid) {
      res.status(403).json({ detail: '密码错误' });
      return;
    }

    const created = createProtectedResourceToken({
      type: 'share-access',
      resourceId: share.id,
      userId: 'anonymous',
      ttlMs: SHARE_ACCESS_TOKEN_TTL_MS,
      singleUse: false,
    });

    res.json({ verified: true, accessToken: created.token, expiresAt: created.expiresAt });
  });

  // Download via share link
  router.get('/api/shares/:token/download', async (req: Request, res: Response) => {
    const token = asSingleString(req.params.token);
    if (!token) {
      res.status(400).json({ detail: '分享参数无效' });
      return;
    }

    const share = await prisma.shareLink.findUnique({
      where: { token },
      select: {
        id: true,
        modelId: true,
        expiresAt: true,
        allowDownload: true,
        password: true,
        downloadLimit: true,
      },
    });

    if (!share) {
      res.status(404).json({ detail: '分享链接不存在' });
      return;
    }

    if (share.expiresAt && new Date() > share.expiresAt) {
      res.status(410).json({ detail: '分享链接已过期' });
      return;
    }

    if (!share.allowDownload) {
      res.status(403).json({ detail: '此链接不允许下载' });
      return;
    }

    if (!hasShareAccess(share.id, share.password, req.query.share_access_token)) {
      res.status(403).json({ detail: '请输入正确的分享密码' });
      return;
    }

    const model = await prisma.model.findUnique({ where: { id: share.modelId } });
    if (!model) {
      res.status(404).json({ detail: '分享的模型已被删除' });
      return;
    }

    const target = resolveDbModelDownloadTarget(model, 'original') || resolveDbModelDownloadTarget(model);
    if (!target || !existsSync(target.filePath)) {
      res.status(404).json({ detail: '文件不存在' });
      return;
    }

    // Atomically claim one download slot before streaming.
    // Use $transaction with row-level lock to prevent concurrent limit bypass.
    let claimed = false;
    if (share.downloadLimit > 0) {
      await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ download_count: number }>>`
          SELECT download_count FROM share_links WHERE id = ${share.id} FOR UPDATE
        `;
        if (locked.length > 0 && locked[0].download_count < share.downloadLimit) {
          await tx.shareLink.update({ where: { id: share.id }, data: { downloadCount: { increment: 1 } } });
          claimed = true;
        }
      });
    } else {
      await prisma.shareLink.update({ where: { id: share.id }, data: { downloadCount: { increment: 1 } } });
      claimed = true;
    }
    if (!claimed) {
      res.status(429).json({ detail: '下载次数已达上限' });
      return;
    }

    // Invalidate the cached share info so the remaining-download count stays accurate.
    await cacheDel(`cache:share:info:${token}`);

    sendAcceleratedFile(req, res, {
      filePath: target.filePath,
      fileName: target.fileName,
      contentType: 'application/octet-stream',
      disposition: 'attachment',
    });
  });

  return router;
}
