import type { Request, Response, NextFunction } from 'express';
import { getSetting } from '../lib/settings.js';
import { getVerifiedRequestUser, type AuthRequest } from './auth.js';

const FEATURE_DISABLED_MESSAGE: Record<string, string> = {
  feature_selection_enabled: '选型功能已关闭',
  feature_inquiry_enabled: '询价功能已关闭',
  feature_product_wall_enabled: '产品图库已关闭',
  feature_tickets_enabled: '工单功能已关闭',
  feature_favorites_enabled: '收藏功能已关闭',
  feature_shares_enabled: '分享功能已关闭',
  feature_downloads_enabled: '下载功能已关闭',
  feature_password_reset_enabled: '找回密码功能已关闭',
  allow_register: '注册功能已关闭',
  require_invite_code: '邀请码功能已关闭',
};

export function featureGuard(settingKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const enabled = await getSetting<boolean>(settingKey);
    if (enabled !== false) {
      next();
      return;
    }

    // Admin bypass — admins must always reach disabled features to re-enable
    try {
      const verified = await getVerifiedRequestUser(req);
      if (verified?.payload.role === 'ADMIN' && !verified.mustChangePassword) {
        (req as AuthRequest).user = verified.payload;
        next();
        return;
      }
    } catch {
      // Not authenticated — fall through to 403
    }

    res.status(403).json({
      detail: FEATURE_DISABLED_MESSAGE[settingKey] || '此功能已关闭',
      code: 'FEATURE_DISABLED',
    });
  };
}
