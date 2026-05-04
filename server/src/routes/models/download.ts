import { Router, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { sendAcceleratedFile } from '../../lib/acceleratedDownload.js';
import { consumeModelDownloadToken } from '../../lib/downloadTokenStore.js';
import { optionalString, booleanFlag } from '../../lib/requestValidation.js';
import { getSetting } from '../../lib/settings.js';
import { getVerifiedRequestUser, verifyRequestToken } from '../../middleware/auth.js';
import { enqueueModelDownloadRecord } from '../../services/modelDownloadQueue.js';
import {
  resolveDbModelDownloadTarget,
  resolveMetadataModelDownloadTarget,
  type ModelDownloadTarget,
} from '../../services/modelDownloadTarget.js';
import {
  DailyDownloadLimitError,
  recordModelDownload,
  shouldRecordDownloadSynchronously,
  shouldSkipDownloadRecord,
} from '../../services/modelDownloadRecorder.js';
import { MODEL_STATUS } from '../../services/modelStatus.js';
import { logger } from '../../lib/logger.js';

type ModelDownloadContext = {
  prisma: any;
  getMeta: (id: string) => Record<string, unknown> | null;
};

export function createModelDownloadRouter({ prisma, getMeta }: ModelDownloadContext) {
  const router = Router();

  // Download model file
  router.get('/api/models/:id/download', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const queryDownloadToken = optionalString(req.query.download_token, { maxLength: 160 });
    const downloadTokenPayload = queryDownloadToken ? consumeModelDownloadToken(queryDownloadToken) : null;
    let requestedFormat = optionalString(req.query.format, { maxLength: 20 });

    if (queryDownloadToken) {
      if (!downloadTokenPayload || downloadTokenPayload.modelId !== id) {
        res.status(401).json({ detail: '下载令牌无效或已过期' });
        return;
      }
      if (requestedFormat && requestedFormat !== downloadTokenPayload.format) {
        res.status(403).json({ detail: '下载令牌与请求格式不匹配' });
        return;
      }
      requestedFormat = downloadTokenPayload.format;
    }

    // Authenticated API callers should use the Authorization header.
    // Browser direct downloads use short-lived one-time download_token values instead of JWT query strings.
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
      res.status(401).json({ detail: '需要登录后才能下载' });
      return;
    }
    const dailyLimit = await getSetting<number>('daily_download_limit');
    const authUserId = authPayload?.userId;

    let target: ModelDownloadTarget | null = null;

    if (prisma) {
      try {
        const m = await prisma.model.findUnique({ where: { id } });
        if (m) {
          if (m.status !== MODEL_STATUS.COMPLETED && authHeaderPayload?.role !== 'ADMIN') {
            res.status(404).json({ detail: '文件不存在' });
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
        res.status(404).json({ detail: '模型不存在' });
        return;
      }
      target = resolveMetadataModelDownloadTarget(id, meta, requestedFormat);
    }

    if (!target || !existsSync(target.filePath)) {
      res.status(404).json({ detail: '文件不存在' });
      return;
    }

    if (prisma && target.record) {
      const recordOptions = {
        userId: authUserId,
        ...target.record,
        dailyLimit: Number(dailyLimit) || 0,
        noRecord: booleanFlag(req.query.no_record),
      };
      try {
        if (shouldSkipDownloadRecord(recordOptions)) {
          // Internal/no-record downloads skip statistics without touching the hot DB path.
        } else if (shouldRecordDownloadSynchronously(recordOptions)) {
          await recordModelDownload(prisma, recordOptions);
        } else {
          const queued = await enqueueModelDownloadRecord({
            userId: authUserId,
            modelId: target.record.modelId,
            format: target.record.format,
            fileSize: target.record.fileSize,
          });
          if (!queued) {
            await recordModelDownload(prisma, recordOptions);
          }
        }
      } catch (err) {
        if (err instanceof DailyDownloadLimitError) {
          res.status(429).json({ detail: err.message });
          return;
        }
        logger.error({ err }, '[models] Failed to record download');
      }
    }

    sendAcceleratedFile(req, res, {
      filePath: target.filePath,
      fileName: target.fileName,
      contentType: target.contentType,
      disposition: 'attachment',
    });
  });

  return router;
}
