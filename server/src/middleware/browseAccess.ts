import type { Request, Response } from 'express';
import { logger } from '../lib/logger.js';
import { getSetting } from '../lib/settings.js';
import { getVerifiedRequestUser, type AuthRequest } from './auth.js';

/**
 * 浏览登录门槛守卫。settingKey 区分门槛类别：
 * - require_login_browse：模型列表/详情等模型浏览（默认）
 * - require_login_selection：选型页（独立开关，互不联动）
 */
export async function requireBrowseAccess(
  req: Request,
  res: Response,
  settingKey: 'require_login_browse' | 'require_login_selection' = 'require_login_browse',
): Promise<boolean> {
  const requireLogin = await getSetting<boolean>(settingKey);
  if (!requireLogin) return true;

  let verified: Awaited<ReturnType<typeof getVerifiedRequestUser>>;
  try {
    verified = await getVerifiedRequestUser(req);
  } catch (err) {
    logger.error({ err }, 'Failed to verify browse access user');
    res.status(500).json({ detail: '认证服务暂不可用' });
    return false;
  }

  if (!verified) {
    // code 供前端区分「浏览需登录」与普通会话失效：匿名访客不弹「登录失效」、不强制跳登录页
    const detail = settingKey === 'require_login_selection' ? '需要登录后才能浏览选型' : '需要登录后才能浏览模型';
    res.status(401).json({ detail, code: 'LOGIN_REQUIRED_BROWSE' });
    return false;
  }
  if (verified.mustChangePassword) {
    res.status(403).json({ detail: '首次登录请先修改密码', code: 'PASSWORD_CHANGE_REQUIRED' });
    return false;
  }

  (req as AuthRequest).user = verified.payload;

  return true;
}
