import { Router, Response } from 'express';
import { sendTestEmail } from '../../lib/email.js';
import { requestSiteUrl } from '../../lib/requestSiteUrl.js';
import {
  CONTACT_PHONE_SETTING_MESSAGE,
  getAllSettings,
  getSettingDefaults,
  isValidContactPhoneSetting,
  setSettings,
} from '../../lib/settings.js';
import { testCacheConnectivity, testStorageConnectivity } from '../../lib/settingsConnectivity.js';
import { checkUpdateAvailable, getUpdateHistory } from '../../lib/update.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { adminOnly } from './common.js';

const SENSITIVE_SETTING_KEYS = ['smtp_pass', 'redis_password', 'storage_access_key_secret'] as const;

function maskSensitiveSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...settings };
  for (const key of SENSITIVE_SETTING_KEYS) {
    if (masked[key]) masked[key] = '********';
  }
  return masked;
}

const PRODUCT_WALL_UPLOAD_ROLE_VALUES = new Set(['ADMIN', 'EDITOR', 'VIEWER', 'INTERNAL']);
const PRODUCT_WALL_UPLOAD_IDS_MAX_LENGTH = 5000;

function validateProductWallUploadSettings(payload: Record<string, unknown>): string | null {
  if ('product_wall_upload_roles' in payload) {
    const value = payload.product_wall_upload_roles;
    if (typeof value !== 'string') return '图库上传角色白名单格式不正确';
    const roles = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (roles.some((role) => !PRODUCT_WALL_UPLOAD_ROLE_VALUES.has(role))) {
      return '图库上传角色只能是 ADMIN、EDITOR、VIEWER、INTERNAL';
    }
  }
  if ('product_wall_upload_allowed_user_ids' in payload) {
    const value = payload.product_wall_upload_allowed_user_ids;
    if (typeof value !== 'string') return '图库上传用户白名单格式不正确';
    if (value.length > PRODUCT_WALL_UPLOAD_IDS_MAX_LENGTH) return '图库上传用户白名单过长';
  }
  return null;
}

function validateSettingsPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '设置数据格式不正确';
  if ('contact_phone' in payload && !isValidContactPhoneSetting((payload as Record<string, unknown>).contact_phone)) {
    return CONTACT_PHONE_SETTING_MESSAGE;
  }
  const productWallError = validateProductWallUploadSettings(payload as Record<string, unknown>);
  if (productWallError) return productWallError;
  return null;
}

export function createSettingsAdminRouter() {
  const router = Router();

  // Admin: check for updates (version detection only, no auto-update)
  router.get('/api/settings/update/check', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const result = await checkUpdateAvailable();
      res.json(result);
    } catch {
      res.json({ current: 'unknown', remote: 'unknown', updateAvailable: false });
    }
  });

  // Admin: version update history (About-page timeline, from GitHub Releases)
  router.get('/api/settings/update/history', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const entries = await getUpdateHistory();
      res.json({ entries });
    } catch {
      res.json({ entries: [] });
    }
  });

  // Admin: get all settings
  router.get('/api/settings', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const settings = await getAllSettings();
      res.json(maskSensitiveSettings(settings));
    } catch {
      res.status(500).json({ detail: '获取设置失败' });
    }
  });

  // Admin: update settings
  router.put('/api/settings', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const validationMessage = validateSettingsPayload(req.body);
      if (validationMessage) {
        res.status(400).json({ detail: validationMessage });
        return;
      }
      await setSettings(req.body);
      const settings = await getAllSettings();
      res.json(maskSensitiveSettings(settings));
    } catch {
      res.status(500).json({ detail: '更新设置失败' });
    }
  });

  // Admin: send a test email using the saved SMTP settings and email template.
  router.post('/api/settings/email/test', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      res.status(400).json({ detail: '请输入正确的测试收件邮箱' });
      return;
    }
    try {
      const siteUrl = typeof req.body?.siteUrl === 'string' ? req.body.siteUrl : requestSiteUrl(req);
      const templateKey =
        typeof req.body?.templateKey === 'string' && /^[\w.-]{1,80}$/.test(req.body.templateKey)
          ? req.body.templateKey
          : 'smtp_test';
      await sendTestEmail(to, siteUrl, templateKey);
      res.json({ message: '测试邮件已发送' });
    } catch {
      res.status(500).json({ detail: '测试邮件发送失败' });
    }
  });

  // Admin: test Redis/cache connectivity using the saved settings.
  router.post('/api/settings/cache/test', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const settings = await getAllSettings();
      const result = await testCacheConnectivity(settings);
      res.json(result);
    } catch {
      res
        .status(500)
        .json({ ok: false, status: 'error', message: '缓存测试失败', details: ['服务器执行测试时发生异常'] });
    }
  });

  // Admin: test local/cloud object storage by writing, reading and deleting a temporary object.
  router.post('/api/settings/storage/test', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const settings = await getAllSettings();
      const result = await testStorageConnectivity(settings);
      res.json(result);
    } catch {
      res
        .status(500)
        .json({ ok: false, status: 'error', message: '存储测试失败', details: ['服务器执行测试时发生异常'] });
    }
  });

  // Admin: get default values for given setting keys
  router.post('/api/settings/defaults', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const keys = req.body.keys;
    if (!Array.isArray(keys)) {
      res.status(400).json({ detail: '需要 keys 数组' });
      return;
    }
    res.json({ success: true, data: getSettingDefaults(keys) });
  });

  // Admin: get current client IP (for IP whitelist configuration)
  router.get('/api/settings/my-ip', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : typeof req.headers['x-real-ip'] === 'string'
          ? req.headers['x-real-ip']
          : req.ip || req.socket.remoteAddress || 'unknown';
    res.json({ ip });
  });

  return router;
}
