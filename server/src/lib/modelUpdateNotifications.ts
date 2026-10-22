import { logger } from './logger.js';
import { createNotification } from './notificationDelivery.js';
import { prisma } from './prisma.js';

/** 单模型单用户 24h 内最多一条更新通知（管理员连续传多版本不轰炸收藏者） */
const MODEL_UPDATE_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** fan-out 上限保护（极端收藏量的热门模型） */
const MODEL_UPDATE_FANOUT_LIMIT = 2000;

/**
 * 模型内容更新（新版本 / 回滚版本 / 替换文件 / 删除下架 / 恢复上架）→ 通知收藏该模型的用户。
 * - 站内必查收藏者个人开关；邮件走 model_update_notice 模板（站点开关 + 个人 email 开关双闸，默认关）
 * - 排除操作者本人；默认 24h 去重（删除/恢复等一次性事件可关去重）
 * - link=false 时不带 relatedId（已下架的模型不再给详情链接）
 * - fire-and-forget：失败只记日志，不影响上传/删除事务
 */
export function notifyModelUpdate(params: {
  modelId: string;
  actorId: string;
  summary: string;
  siteUrl?: string;
  link?: boolean;
  dedupe?: boolean;
}): void {
  const { modelId, actorId, summary, siteUrl, link = true, dedupe = true } = params;
  void (async () => {
    try {
      if (!prisma) return;
      const [model, favoriters, recent] = await Promise.all([
        prisma.model.findUnique({ where: { id: modelId }, select: { name: true } }),
        prisma.favorite.findMany({
          where: { modelId },
          select: { userId: true },
          take: MODEL_UPDATE_FANOUT_LIMIT,
        }),
        dedupe
          ? prisma.notification.findMany({
              where: {
                type: 'model_update',
                relatedId: modelId,
                createdAt: { gt: new Date(Date.now() - MODEL_UPDATE_DEDUP_WINDOW_MS) },
              },
              select: { userId: true },
            })
          : Promise.resolve([]),
      ]);
      if (!model) return;
      const notifiedRecently = new Set(recent.map((n) => n.userId));
      await Promise.all(
        favoriters
          .filter((f) => f.userId !== actorId && !notifiedRecently.has(f.userId))
          .map((f) =>
            createNotification({
              userId: f.userId,
              title: '收藏的模型有更新',
              message: `${model.name} ${summary}`,
              type: 'model_update',
              audience: 'user',
              relatedId: link ? modelId : null,
              siteUrl,
              emailTemplateKey: 'model_update_notice',
              emailVars: { modelName: model.name, updateSummary: summary },
            }).catch(() => {}),
          ),
      );
    } catch (err) {
      logger.warn({ err, modelId }, '[model-update] Failed to notify favoriters');
    }
  })();
}
