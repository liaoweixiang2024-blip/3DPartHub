import { existsSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { Router, Request, Response } from 'express';
import { sendAcceleratedFile } from '../../lib/acceleratedDownload.js';
import {
  claimModelDownloadRecordMark,
  releaseModelDownloadRecordMark,
  verifyModelDownloadToken,
} from '../../lib/downloadTokenStore.js';
import { deviceFromRequest } from '../../lib/downloadDevice.js';
import { logger } from '../../lib/logger.js';
import { createNotification } from '../../lib/notificationDelivery.js';
import { requestSiteUrl } from '../../lib/requestSiteUrl.js';
import { optionalString, booleanFlag } from '../../lib/requestValidation.js';
import { sendResourceError } from '../../lib/resourceErrorPage.js';
import { getSetting } from '../../lib/settings.js';
import { getVerifiedRequestUser, verifyRequestToken } from '../../middleware/auth.js';
import { trackActiveModelDownload } from '../../services/activeModelDownloads.js';
import { getInvisibleCategoryIds } from '../../services/categoryAccess.js';
import { enqueueModelDownloadRecord } from '../../services/modelDownloadQueue.js';
import {
  DailyDownloadLimitError,
  recordModelDownload,
  shouldRecordDownloadSynchronously,
  shouldSkipDownloadRecord,
} from '../../services/modelDownloadRecorder.js';
import {
  resolveDbModelDownloadTarget,
  resolveMetadataModelDownloadTarget,
  type ModelDownloadTarget,
} from '../../services/modelDownloadTarget.js';
import { MODEL_STATUS } from '../../services/modelStatus.js';

type ModelDownloadContext = {
  prisma: PrismaClient | null;
  getMeta: (id: string) => Record<string, unknown> | null;
};

function notifyModelOwnerAboutDownload(
  prisma: PrismaClient,
  modelId: string,
  downloaderId: string | null | undefined,
  format: string,
  siteUrl?: string,
) {
  void (async () => {
    try {
      const model = await prisma.model.findUnique({
        where: { id: modelId },
        select: { id: true, name: true, createdById: true },
      });
      if (!model || model.createdById === downloaderId) return;
      const downloader = downloaderId
        ? await prisma.user.findUnique({ where: { id: downloaderId }, select: { username: true } })
        : null;
      await createNotification({
        userId: model.createdById,
        title: '模型被下载',
        message: `${downloader ? `用户「${downloader.username}」` : '有用户'}下载了模型「${model.name}」`,
        type: 'download',
        audience: 'owner',
        relatedId: model.id,
        siteUrl,
        emailTemplateKey: 'download_notice',
        emailVars: {
          modelName: model.name,
          downloadFormat: format.toUpperCase(),
          downloaderName: downloader?.username || '',
        },
      });
    } catch (err) {
      logger.warn({ err, modelId }, '[models] Failed to notify model owner about download');
    }
  })();
}

export function createModelDownloadRouter({ prisma, getMeta }: ModelDownloadContext) {
  const router = Router();

  // Download model file
  router.get('/api/models/:id/download', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const isHeadRequest = req.method === 'HEAD';
    const queryDownloadToken = optionalString(req.query.download_token, { maxLength: 160 });
    // 令牌 TTL 内可多次校验（verify 而非一次性 consume）：华为/鸿蒙等浏览器的系统下载
    // 管理器会对同一 URL 发起多次请求（重拉 / Range 续传），一次性令牌在第一次请求即被
    // 销毁，第二次请求 401 → 下载器报「下载失败」（桌面 Chrome 单请求不受影响，此前掩盖
    // 了该问题）。打点只记一次由 claimModelDownloadRecordMark 保证，与图纸/备份令牌同款语义。
    const downloadTokenPayload = queryDownloadToken ? verifyModelDownloadToken(queryDownloadToken) : null;
    let requestedFormat = optionalString(req.query.format, { maxLength: 20 });

    if (queryDownloadToken) {
      if (!downloadTokenPayload || downloadTokenPayload.modelId !== id) {
        await sendResourceError(req, res, 401, '下载链接已失效，请回到模型详情页重新发起下载', {
          htmlTitle: '下载链接已失效',
          hint: '下载链接有时效，过期后请回到模型详情页重新发起下载',
        });
        return;
      }
      if (requestedFormat && requestedFormat !== downloadTokenPayload.format) {
        await sendResourceError(req, res, 403, '下载链接与请求的文件格式不匹配，请重新发起下载', {
          htmlTitle: '下载链接无效',
        });
        return;
      }
      requestedFormat = downloadTokenPayload.format;
    }

    // Authenticated API callers should use the Authorization header.
    // Browser direct downloads use short-lived download_token values (TTL 内可复用，见上方
    // verify 注释) instead of JWT query strings.
    const rawAuthHeaderPayload = verifyRequestToken(req);
    let verifiedAuthUser: Awaited<ReturnType<typeof getVerifiedRequestUser>> | null = null;
    if (rawAuthHeaderPayload) {
      try {
        verifiedAuthUser = await getVerifiedRequestUser(req);
      } catch (err) {
        logger.error({ err }, '[models] Failed to verify download user');
        res.status(500).json({ detail: '认证服务暂不可用' });
        return;
      }
      if (!verifiedAuthUser) {
        res.status(401).json({ detail: '认证令牌无效或用户不存在' });
        return;
      }
      if (verifiedAuthUser.mustChangePassword) {
        res.status(403).json({ detail: '首次登录请先修改密码', code: 'PASSWORD_CHANGE_REQUIRED' });
        return;
      }
    }
    const authHeaderPayload = verifiedAuthUser?.payload || null;
    const authPayload = downloadTokenPayload || authHeaderPayload;

    // Check if login is required to download
    const requireLogin = await getSetting<boolean>('require_login_download');
    if (requireLogin && !authPayload) {
      await sendResourceError(req, res, 401, '需要登录后才能下载', { htmlTitle: '请先登录' });
      return;
    }
    const dailyLimit = await getSetting<number>('daily_download_limit');
    const authUserId = authPayload?.userId;

    let target: ModelDownloadTarget | null = null;

    // 分类访问控制：受限分类下的模型，非白名单用户（含匿名，即使未开登录下载）一律 403
    const invisibleCategories = await getInvisibleCategoryIds(
      authHeaderPayload?.role ?? null,
      authHeaderPayload?.userId ?? downloadTokenPayload?.userId ?? null,
    );

    if (prisma) {
      try {
        const m = await prisma.model.findUnique({ where: { id } });
        if (m) {
          if (m.status !== MODEL_STATUS.COMPLETED && authHeaderPayload?.role !== 'ADMIN') {
            await sendResourceError(req, res, 404, '文件不存在或尚未完成处理', { htmlTitle: '文件不存在' });
            return;
          }
          if (m.categoryId && invisibleCategories.has(m.categoryId)) {
            await sendResourceError(req, res, 403, '您没有下载该模型的权限', { htmlTitle: '无权下载' });
            return;
          }
          target = resolveDbModelDownloadTarget(m, requestedFormat);
        }
      } catch {
        // Fallback
      }
    }

    // Filesystem fallback
    if (!target) {
      const meta = getMeta(id);
      if (!meta) {
        await sendResourceError(req, res, 404, '模型不存在或已被删除', { htmlTitle: '模型不存在' });
        return;
      }
      if (typeof meta.category_id === 'string' && invisibleCategories.has(meta.category_id)) {
        await sendResourceError(req, res, 403, '您没有下载该模型的权限', { htmlTitle: '无权下载' });
        return;
      }
      target = resolveMetadataModelDownloadTarget(id, meta, requestedFormat);
    }

    if (!target || !existsSync(target.filePath)) {
      await sendResourceError(req, res, 404, '文件不存在或已被移除', { htmlTitle: '文件不存在' });
      return;
    }

    if (!isHeadRequest && prisma && target.record) {
      const device = deviceFromRequest(req);
      const recordOptions = {
        userId: authUserId,
        ...target.record,
        dailyLimit: Number(dailyLimit) || 0,
        noRecord: booleanFlag(req.query.no_record),
        device,
      };
      // 同一令牌只打一次点：华为/鸿蒙下载器的二次请求（重拉/续传）跳过打点直接出流。
      // 限额拒绝时归还标记（见 catch 内 release），否则重试请求会绕过限额检查。
      const shouldRecordThisRequest =
        !queryDownloadToken || claimModelDownloadRecordMark(queryDownloadToken, downloadTokenPayload?.expiresAt ?? 0);
      try {
        if (!shouldRecordThisRequest) {
          // 同令牌已打点：不再重复计数/通知/限额，直接进入文件下发。
        } else if (shouldSkipDownloadRecord(recordOptions)) {
          // Internal/no-record downloads skip statistics without touching the hot DB path.
        } else if (shouldRecordDownloadSynchronously(recordOptions)) {
          await recordModelDownload(prisma, recordOptions);
          notifyModelOwnerAboutDownload(
            prisma,
            target.record.modelId,
            authUserId,
            target.record.format,
            requestSiteUrl(req),
          );
        } else {
          const queued = await enqueueModelDownloadRecord({
            userId: authUserId,
            modelId: target.record.modelId,
            format: target.record.format,
            fileSize: target.record.fileSize,
            device,
          });
          if (!queued) {
            await recordModelDownload(prisma, recordOptions);
          }
          notifyModelOwnerAboutDownload(
            prisma,
            target.record.modelId,
            authUserId,
            target.record.format,
            requestSiteUrl(req),
          );
        }
      } catch (err) {
        if (err instanceof DailyDownloadLimitError) {
          // 归还打点标记：限额拒绝没有产生记录，同令牌的后续请求应重新过限额检查，
          // 而不是因「已打点」跳过检查直接拿到文件流。
          if (queryDownloadToken) releaseModelDownloadRecordMark(queryDownloadToken);
          res.status(429).json({ detail: err.message });
          return;
        }
        // 记录失败（DB 抖动等）按可用性优先放行下载——有意设计，不是漏洞：
        // 1) 每日限额是策略旋钮而非安全边界（鉴权/分类权限在更前面，不受此处影响）；
        // 2) DB 不可用时整条链路本就降级走文件系统元数据（target.record 为空、完全不打点），
        //    此处改 fail-closed 只会让 DB 打嗝期间全站无法下载，换不来真实的配额保障。
        logger.error({ err }, '[models] Failed to record download');
      }
    }

    let releaseActiveDownload: (() => void) | null = null;
    if (!isHeadRequest && target.record?.modelId) {
      releaseActiveDownload = trackActiveModelDownload(target.record.modelId);
      const releaseOnce = () => {
        releaseActiveDownload?.();
        releaseActiveDownload = null;
      };
      res.once('close', releaseOnce);
      res.once('finish', releaseOnce);
    }

    try {
      sendAcceleratedFile(req, res, {
        filePath: target.filePath,
        fileName: target.fileName,
        contentType: target.contentType,
        disposition: 'attachment',
        // 计数下载（受每日限额约束）不缓存，确保每次下载都打点、限额准确。
        cacheControl: 'private, no-store',
      });
    } catch (err) {
      releaseActiveDownload?.();
      throw err;
    }
  });

  return router;
}
