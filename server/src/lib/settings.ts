import {
  DEFAULT_INQUIRY_STATUSES_FOR_SETTINGS,
  DEFAULT_MOBILE_NAV_FOR_SETTINGS,
  DEFAULT_NAV_FOR_SETTINGS,
  DEFAULT_PAGE_SIZE_POLICY_FOR_SETTINGS,
  DEFAULT_SELECTION_THREAD_PRIORITY_FOR_SETTINGS,
  DEFAULT_SUPPORT_STEPS_FOR_SETTINGS,
  DEFAULT_TICKET_CLASSIFICATIONS_FOR_SETTINGS,
  DEFAULT_TICKET_STATUSES_FOR_SETTINGS,
  DEFAULT_UPLOAD_POLICY_FOR_SETTINGS,
} from './businessDefaults.js';
import { cacheDel, redis } from './cache.js';
import { config } from './config.js';
import { DEFAULT_EMAIL_TEMPLATES } from './emailTemplates.js';
import { prisma } from './prisma.js';

interface SettingDef {
  key: string;
  defaultValue: unknown;
}

const DEFAULT_MAINTENANCE_TITLE = '系统维护中';
const DEFAULT_MAINTENANCE_MESSAGE = '系统正在进行维护、数据恢复或资源重建，部分页面可能暂时不可用。请稍后再访问。';
const LEGACY_MAINTENANCE_TITLE = '模型库维护中';
const LEGACY_MAINTENANCE_MESSAGE = '模型预览资源正在重建，部分模型数量和缩略图可能暂时不完整。请稍后再访问。';
const DEFAULT_COPYRIGHT_PROJECT_NAME = '3DPartHub';
const DEFAULT_INTERFACE_THEME_KEYS = ['workbench', 'classic'] as const;
const DEFAULT_MOBILE_THEME_KEYS = ['classic'] as const;
const HOME_LIST_LOADING_MODE_KEYS = ['infinite', 'pagination'] as const;
const UI_LOCALE_KEYS = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'de-DE'] as const;
const DEFAULT_UI_ENABLED_LOCALES = UI_LOCALE_KEYS.join(',');
const COLOR_SCHEME_KEYS = ['orange', 'blue', 'green', 'purple', 'red', 'teal', 'custom'] as const;
const CACHE_DRIVER_KEYS = ['redis', 'memory', 'off'] as const;
const STORAGE_PROVIDER_KEYS = ['local', 'minio', 'tencent_cos', 'aliyun_oss', 'qiniu_kodo', 's3_compatible'] as const;
const MASKED_SECRET_VALUE = '********';
const LEGACY_LOCAL_REDIS_URLS = new Set(['redis://localhost:6379', 'redis://127.0.0.1:6379']);
const MAX_CUSTOM_COLOR_JSON_LENGTH = 20_000;
export const CONTACT_PHONE_SETTING_MESSAGE =
  '联系电话格式不正确，请填写中国手机号、带区号座机、400/800 服务电话或国际号码';
const DEFAULT_USER_NAV_FOR_SETTINGS = DEFAULT_NAV_FOR_SETTINGS.filter(
  (item) => !item.roles?.includes('ADMIN') && !item.path.startsWith('/admin/'),
);
const DEFAULT_ADMIN_NAV_FOR_SETTINGS = DEFAULT_NAV_FOR_SETTINGS;
const SENSITIVE_SETTING_KEYS = new Set(['smtp_pass', 'redis_password', 'storage_access_key_secret']);

function getCopyrightYear(): string {
  return String(new Date().getFullYear());
}

function normalizeCopyrightProjectName(siteTitle: unknown): string {
  return String(siteTitle || '').trim() || DEFAULT_COPYRIGHT_PROJECT_NAME;
}

export function buildFooterCopyright(siteTitle?: unknown): string {
  return `© ${getCopyrightYear()} ${normalizeCopyrightProjectName(siteTitle)}. All rights reserved.`;
}

export function buildModelDetailCopyright(siteTitle?: unknown): string {
  return `© ${getCopyrightYear()} ${normalizeCopyrightProjectName(siteTitle)}`;
}

export const DEFAULT_FOOTER_COPYRIGHT = buildFooterCopyright(DEFAULT_COPYRIGHT_PROJECT_NAME);
export const DEFAULT_MODEL_DETAIL_DISCLAIMER =
  '本平台所有 3D 模型仅供参考与模拟验证，不作为生产加工依据。产品持续迭代更新，请以实物为准。';
export const DEFAULT_MODEL_DETAIL_COPYRIGHT = buildModelDetailCopyright(DEFAULT_COPYRIGHT_PROJECT_NAME);

type FooterLink = { label: string; url: string };

export function normalizeFooterLinksSetting(value: unknown): string {
  let parsed = value;
  if (typeof value === 'string') {
    if (!value.trim()) return '[]';
    try {
      parsed = JSON.parse(value);
    } catch {
      return '[]';
    }
  }
  if (!Array.isArray(parsed)) return '[]';
  const links = parsed
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as Partial<FooterLink>) : {};
      return {
        label: typeof row.label === 'string' ? row.label.trim() : '',
        url: typeof row.url === 'string' ? row.url.trim() : '',
      };
    })
    .filter((link) => link.label && link.url);
  return JSON.stringify(links, null, 2);
}

const SETTINGS_SCHEMA: SettingDef[] = [
  { key: 'require_login_download', defaultValue: false },
  { key: 'require_login_browse', defaultValue: false },
  { key: 'allow_register', defaultValue: true },
  { key: 'auth_modal_enabled', defaultValue: true },
  { key: 'login_dialog_enabled', defaultValue: true },
  { key: 'login_dialog_favorites', defaultValue: true },
  { key: 'login_dialog_downloads', defaultValue: true },
  { key: 'login_dialog_my_shares', defaultValue: true },
  { key: 'login_dialog_profile', defaultValue: true },
  { key: 'login_dialog_support', defaultValue: true },
  { key: 'login_dialog_my_tickets', defaultValue: true },
  { key: 'login_dialog_my_inquiries', defaultValue: true },
  { key: 'login_dialog_projects', defaultValue: true },
  { key: 'daily_download_limit', defaultValue: 0 },
  { key: 'show_watermark', defaultValue: false },
  { key: 'watermark_text', defaultValue: '3DPartHub' },
  { key: 'watermark_image', defaultValue: '' },
  { key: 'site_title', defaultValue: '3DPartHub' },
  { key: 'site_browser_title', defaultValue: '' },
  { key: 'site_logo', defaultValue: '' },
  { key: 'site_icon', defaultValue: '' },
  { key: 'site_favicon', defaultValue: '/favicon.svg' },
  { key: 'site_logo_display', defaultValue: 'logo_and_title' },
  { key: 'site_description', defaultValue: '' },
  { key: 'site_keywords', defaultValue: '' },
  { key: 'announcement_enabled', defaultValue: false },
  { key: 'announcement_text', defaultValue: '' },
  { key: 'announcement_type', defaultValue: 'info' },
  { key: 'announcement_color', defaultValue: '' },
  { key: 'maintenance_enabled', defaultValue: false },
  { key: 'maintenance_auto_enabled', defaultValue: true },
  { key: 'maintenance_auto_queue_threshold', defaultValue: 50 },
  { key: 'maintenance_title', defaultValue: DEFAULT_MAINTENANCE_TITLE },
  { key: 'maintenance_message', defaultValue: DEFAULT_MAINTENANCE_MESSAGE },
  { key: 'conversion_worker_concurrency', defaultValue: 1 },
  { key: 'smtp_host', defaultValue: '' },
  { key: 'smtp_port', defaultValue: 465 },
  { key: 'smtp_user', defaultValue: '' },
  { key: 'smtp_pass', defaultValue: '' },
  { key: 'smtp_from', defaultValue: '' },
  { key: 'smtp_secure', defaultValue: true },
  { key: 'email_templates', defaultValue: JSON.stringify(DEFAULT_EMAIL_TEMPLATES, null, 2) },
  { key: 'contact_email', defaultValue: '' },
  { key: 'contact_phone', defaultValue: '' },
  { key: 'contact_address', defaultValue: '' },
  { key: 'footer_links', defaultValue: '' },
  { key: 'footer_copyright', defaultValue: DEFAULT_FOOTER_COPYRIGHT },
  { key: 'footer_copyright_follow_site_title', defaultValue: true },
  { key: 'model_detail_disclaimer', defaultValue: DEFAULT_MODEL_DETAIL_DISCLAIMER },
  { key: 'model_detail_copyright', defaultValue: DEFAULT_MODEL_DETAIL_COPYRIGHT },
  { key: 'model_detail_copyright_follow_site_title', defaultValue: true },
  { key: 'legal_privacy_updated_at', defaultValue: '2026 年 4 月' },
  { key: 'legal_terms_updated_at', defaultValue: '2026 年 4 月' },
  { key: 'legal_privacy_sections', defaultValue: '' },
  { key: 'legal_terms_sections', defaultValue: '' },
  { key: 'interface_theme', defaultValue: 'workbench' },
  { key: 'mobile_interface_theme', defaultValue: 'classic' },
  { key: 'user_interface_theme_enabled', defaultValue: true },
  { key: 'home_desktop_list_loading_mode', defaultValue: 'pagination' },
  { key: 'home_mobile_list_loading_mode', defaultValue: 'infinite' },
  { key: 'ui_default_locale', defaultValue: 'zh-CN' },
  { key: 'ui_enabled_locales', defaultValue: DEFAULT_UI_ENABLED_LOCALES },
  { key: 'ui_follow_browser_locale', defaultValue: false },
  { key: 'color_scheme', defaultValue: 'orange' },
  { key: 'color_custom_dark', defaultValue: '{}' },
  { key: 'color_custom_light', defaultValue: '{}' },
  { key: 'default_theme', defaultValue: 'light' },
  { key: 'auto_theme_enabled', defaultValue: false },
  { key: 'auto_theme_dark_hour', defaultValue: 20 },
  { key: 'auto_theme_light_hour', defaultValue: 8 },

  // 3D Material presets — default
  { key: 'mat_default_color', defaultValue: '#c8cad0' },
  { key: 'mat_default_metalness', defaultValue: 0.5 },
  { key: 'mat_default_roughness', defaultValue: 0.25 },
  { key: 'mat_default_envMapIntensity', defaultValue: 1.5 },
  // 3D Material presets — metal
  { key: 'mat_metal_color', defaultValue: '#f0f0f4' },
  { key: 'mat_metal_metalness', defaultValue: 1.0 },
  { key: 'mat_metal_roughness', defaultValue: 0.05 },
  { key: 'mat_metal_envMapIntensity', defaultValue: 2.0 },
  // 3D Material presets — plastic
  { key: 'mat_plastic_color', defaultValue: '#4499ff' },
  { key: 'mat_plastic_metalness', defaultValue: 0.0 },
  { key: 'mat_plastic_roughness', defaultValue: 0.35 },
  { key: 'mat_plastic_envMapIntensity', defaultValue: 0.6 },
  // 3D Material presets — glass
  { key: 'mat_glass_color', defaultValue: '#ffffff' },
  { key: 'mat_glass_metalness', defaultValue: 0.0 },
  { key: 'mat_glass_roughness', defaultValue: 0.0 },
  { key: 'mat_glass_envMapIntensity', defaultValue: 1.0 },
  { key: 'mat_glass_transmission', defaultValue: 0.95 },
  { key: 'mat_glass_ior', defaultValue: 1.5 },
  { key: 'mat_glass_thickness', defaultValue: 0.5 },
  // 3D Material presets — original (overlay, empty = no override)
  { key: 'mat_original_color', defaultValue: '#808080' },
  { key: 'mat_original_metalness', defaultValue: '' },
  { key: 'mat_original_roughness', defaultValue: '' },
  { key: 'mat_original_envMapIntensity', defaultValue: '' },
  // 3D Viewer lighting
  { key: 'viewer_exposure', defaultValue: 1.4 },
  { key: 'viewer_ambient_intensity', defaultValue: 1.0 },
  { key: 'viewer_main_light_intensity', defaultValue: 2.0 },
  { key: 'viewer_fill_light_intensity', defaultValue: 0.8 },
  { key: 'viewer_hemisphere_intensity', defaultValue: 0.5 },
  { key: 'viewer_bg_color', defaultValue: '#ffffff' },
  { key: 'viewer_default_preset', defaultValue: 'original' },
  { key: 'viewer_visible_presets', defaultValue: 'original' },
  { key: 'viewer_edge_enabled', defaultValue: true },
  { key: 'viewer_edge_threshold_angle', defaultValue: 28 },
  { key: 'viewer_edge_vertex_limit', defaultValue: 700000 },
  { key: 'viewer_edge_color', defaultValue: '#000000' },
  { key: 'viewer_edge_opacity', defaultValue: 0.25 },
  { key: 'viewer_edge_width', defaultValue: 1 },
  { key: 'viewer_measure_default_unit', defaultValue: 'auto' },
  { key: 'viewer_measure_record_limit', defaultValue: 12 },

  // Account security
  { key: 'security_email_code_cooldown_seconds', defaultValue: 60 },
  { key: 'security_email_code_ttl_seconds', defaultValue: 600 },
  { key: 'security_captcha_ttl_seconds', defaultValue: 300 },
  { key: 'security_password_min_length', defaultValue: 8 },
  { key: 'security_username_min_length', defaultValue: 2 },
  { key: 'security_username_max_length', defaultValue: 32 },

  // Share policy
  { key: 'share_default_expire_days', defaultValue: 0 },
  { key: 'share_max_expire_days', defaultValue: 0 },
  { key: 'share_default_download_limit', defaultValue: 0 },
  { key: 'share_max_download_limit', defaultValue: 0 },
  { key: 'share_enabled', defaultValue: true },
  { key: 'share_allow_password', defaultValue: true },
  { key: 'share_allow_custom_expiry', defaultValue: true },
  { key: 'share_allow_preview', defaultValue: true },
  // Feature toggles
  { key: 'feature_selection_enabled', defaultValue: true },
  { key: 'feature_inquiry_enabled', defaultValue: true },
  { key: 'feature_product_wall_enabled', defaultValue: true },
  { key: 'feature_tickets_enabled', defaultValue: true },
  { key: 'feature_favorites_enabled', defaultValue: true },
  { key: 'feature_shares_enabled', defaultValue: true },
  { key: 'feature_downloads_enabled', defaultValue: true },
  { key: 'feature_password_reset_enabled', defaultValue: true },

  // Selection wizard
  { key: 'selection_page_title', defaultValue: '产品选型' },
  { key: 'selection_page_desc', defaultValue: '先选产品大类，再按参数逐步缩小范围' },
  { key: 'selection_enable_match', defaultValue: true },
  {
    key: 'selection_thread_priority',
    defaultValue: JSON.stringify(DEFAULT_SELECTION_THREAD_PRIORITY_FOR_SETTINGS, null, 2),
  },

  // Business dictionaries and policies
  { key: 'inquiry_statuses', defaultValue: JSON.stringify(DEFAULT_INQUIRY_STATUSES_FOR_SETTINGS, null, 2) },
  { key: 'ticket_statuses', defaultValue: JSON.stringify(DEFAULT_TICKET_STATUSES_FOR_SETTINGS, null, 2) },
  { key: 'ticket_classifications', defaultValue: JSON.stringify(DEFAULT_TICKET_CLASSIFICATIONS_FOR_SETTINGS, null, 2) },
  { key: 'support_process_steps', defaultValue: JSON.stringify(DEFAULT_SUPPORT_STEPS_FOR_SETTINGS, null, 2) },
  { key: 'nav_items', defaultValue: JSON.stringify(DEFAULT_NAV_FOR_SETTINGS, null, 2) },
  { key: 'nav_user_items', defaultValue: JSON.stringify(DEFAULT_USER_NAV_FOR_SETTINGS, null, 2) },
  { key: 'nav_admin_items', defaultValue: JSON.stringify(DEFAULT_ADMIN_NAV_FOR_SETTINGS, null, 2) },
  { key: 'nav_mobile_items', defaultValue: JSON.stringify(DEFAULT_MOBILE_NAV_FOR_SETTINGS, null, 2) },
  { key: 'upload_policy', defaultValue: JSON.stringify(DEFAULT_UPLOAD_POLICY_FOR_SETTINGS, null, 2) },
  { key: 'page_size_policy', defaultValue: JSON.stringify(DEFAULT_PAGE_SIZE_POLICY_FOR_SETTINGS, null, 2) },
  { key: 'audit_log_retention_days', defaultValue: 365 },

  // Anti-reverse-proxy & hotlink protection
  { key: 'anti_proxy_enabled', defaultValue: false },
  { key: 'allowed_hosts', defaultValue: '' },
  { key: 'hotlink_protection_enabled', defaultValue: false },
  { key: 'allowed_referers', defaultValue: '' },

  // Product wall upload limits
  { key: 'product_wall_max_image_mb', defaultValue: 50 },
  { key: 'product_wall_max_batch_count', defaultValue: 50 },
  { key: 'product_wall_max_zip_extract', defaultValue: 100 },

  // Cache and object storage
  { key: 'cache_driver', defaultValue: 'redis' },
  { key: 'cache_enabled', defaultValue: true },
  { key: 'redis_url', defaultValue: config.redisUrl },
  { key: 'redis_password', defaultValue: '' },
  { key: 'redis_db', defaultValue: 0 },
  { key: 'redis_key_prefix', defaultValue: '3dparthub' },
  { key: 'redis_tls_enabled', defaultValue: false },
  { key: 'cache_public_settings_ttl_seconds', defaultValue: 60 },
  { key: 'cache_model_list_ttl_seconds', defaultValue: 300 },
  { key: 'cache_model_detail_ttl_seconds', defaultValue: 300 },
  { key: 'cache_search_ttl_seconds', defaultValue: 60 },
  { key: 'cache_selection_ttl_seconds', defaultValue: 600 },
  { key: 'cache_static_asset_max_age_days', defaultValue: 30 },
  { key: 'storage_provider', defaultValue: 'local' },
  { key: 'storage_endpoint', defaultValue: '' },
  { key: 'storage_region', defaultValue: '' },
  { key: 'storage_bucket', defaultValue: '' },
  { key: 'storage_access_key_id', defaultValue: '' },
  { key: 'storage_access_key_secret', defaultValue: '' },
  { key: 'storage_use_ssl', defaultValue: true },
  { key: 'storage_force_path_style', defaultValue: false },
  { key: 'storage_public_base_url', defaultValue: '' },
  { key: 'storage_cdn_base_url', defaultValue: '' },
  { key: 'storage_image_prefix', defaultValue: 'images' },
  { key: 'storage_thumbnail_prefix', defaultValue: 'thumbnails' },
  { key: 'storage_model_prefix', defaultValue: 'models' },
  { key: 'storage_original_prefix', defaultValue: 'originals' },
  { key: 'storage_drawing_prefix', defaultValue: 'drawings' },
  { key: 'storage_product_wall_prefix', defaultValue: 'product-wall' },
  { key: 'storage_attachment_prefix', defaultValue: 'attachments' },
  { key: 'storage_backup_prefix', defaultValue: 'backups' },
  { key: 'storage_temp_prefix', defaultValue: 'temp' },
  { key: 'storage_signed_url_enabled', defaultValue: false },
  { key: 'storage_signed_url_ttl_seconds', defaultValue: 3600 },
  { key: 'storage_upload_multipart_mb', defaultValue: 16 },
  { key: 'storage_upload_concurrency', defaultValue: 4 },
  { key: 'storage_sync_enabled', defaultValue: false },
  { key: 'storage_sync_delete_extra_enabled', defaultValue: false },
  { key: 'image_cdn_enabled', defaultValue: false },
  { key: 'image_optimize_enabled', defaultValue: true },
  { key: 'image_webp_enabled', defaultValue: true },
  { key: 'image_thumbnail_quality', defaultValue: 82 },
  { key: 'image_large_max_width', defaultValue: 2560 },
  { key: 'image_cache_max_age_days', defaultValue: 30 },
  { key: 'resource_cdn_enabled', defaultValue: false },
  { key: 'resource_cache_max_age_days', defaultValue: 30 },
  { key: 'resource_download_acceleration_enabled', defaultValue: false },

  // Download token TTL
  { key: 'download_token_ttl_minutes', defaultValue: 5 },

  // Ticket attachment limits
  { key: 'ticket_attachment_max_mb', defaultValue: 100 },
  {
    key: 'ticket_attachment_types',
    defaultValue: 'jpg,jpeg,png,gif,webp,svg,pdf,doc,docx,xls,xlsx,ppt,pptx,zip,rar,7z,step,stp,iges,igs,binary',
  },

  // API rate limiting
  { key: 'api_rate_limit', defaultValue: 5000 },

  // Enterprise backup policy
  { key: 'backup_auto_enabled', defaultValue: false },
  { key: 'backup_schedule_time', defaultValue: '03:00' },
  { key: 'backup_retention_count', defaultValue: 7 },
  { key: 'backup_mirror_enabled', defaultValue: false },
  { key: 'backup_mirror_dir', defaultValue: '' },
  { key: 'backup_last_mirror_status', defaultValue: '' },
  { key: 'backup_last_mirror_message', defaultValue: '' },
  { key: 'backup_last_mirror_at', defaultValue: '' },
  { key: 'backup_last_auto_date', defaultValue: '' },
  { key: 'backup_last_auto_status', defaultValue: '' },
  { key: 'backup_last_auto_message', defaultValue: '' },
  { key: 'backup_last_auto_job_id', defaultValue: '' },
  { key: 'backup_last_auto_at', defaultValue: '' },
];

const DEFAULTS: Record<string, unknown> = {};
for (const s of SETTINGS_SCHEMA) DEFAULTS[s.key] = s.defaultValue;

export function getSettingDefaults(keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in DEFAULTS) result[key] = DEFAULTS[key];
  }
  return result;
}

function normalizeLegacyMaintenanceSettings(settings: Record<string, unknown>): Record<string, unknown> {
  if (settings.maintenance_title === LEGACY_MAINTENANCE_TITLE) {
    settings.maintenance_title = DEFAULT_MAINTENANCE_TITLE;
  }
  if (settings.maintenance_message === LEGACY_MAINTENANCE_MESSAGE) {
    settings.maintenance_message = DEFAULT_MAINTENANCE_MESSAGE;
  }
  return settings;
}

function normalizeRuntimeBackedSettings(settings: Record<string, unknown>): Record<string, unknown> {
  normalizeLegacyMaintenanceSettings(settings);
  const redisUrl = typeof settings.redis_url === 'string' ? settings.redis_url.trim() : '';
  if (LEGACY_LOCAL_REDIS_URLS.has(redisUrl) && !LEGACY_LOCAL_REDIS_URLS.has(config.redisUrl)) {
    settings.redis_url = config.redisUrl;
  }
  return settings;
}

export function normalizeContactPhoneSetting(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[－—–]/g, '-')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, ' ');
}

export function isValidContactPhoneSetting(value: unknown): boolean {
  const phone = normalizeContactPhoneSetting(value);
  if (!phone) return true;
  if (phone.length > 32) return false;
  if (!/^\+?[0-9][0-9\s()-]{5,31}$/.test(phone)) return false;

  const digits = phone.replace(/\D/g, '');
  const noSpaceOrParen = phone.replace(/[()\s]/g, '');

  if (/^1[3-9]\d{9}$/.test(digits)) return true;
  if (/^(400|800)-?\d{3}-?\d{4}$/.test(noSpaceOrParen)) return true;
  if (/^0\d{2,3}-?\d{7,8}(-?\d{1,6})?$/.test(noSpaceOrParen)) return true;
  if (phone.startsWith('+') && digits.length >= 8 && digits.length <= 15) return true;

  return false;
}

// In-memory cache
let cache: Record<string, unknown> | null = null;
let cacheAt = 0;
const CACHE_TTL = 30_000; // 30 seconds — fast propagation across workers

const SETTINGS_INVALIDATE_CHANNEL = 'cache:settings:invalidate';
const settingsSubscriber = redis.duplicate();

settingsSubscriber.on('error', () => {});
settingsSubscriber.subscribe(SETTINGS_INVALIDATE_CHANNEL).catch(() => {});
settingsSubscriber.on('message', (channel: string) => {
  if (channel === SETTINGS_INVALIDATE_CHANNEL) {
    cache = null;
    cacheAt = 0;
  }
});

function broadcastSettingsInvalidate(): void {
  redis.publish(SETTINGS_INVALIDATE_CHANNEL, '1').catch(() => {});
}

/** Clear the in-memory settings cache (used after restore) */
export function clearSettingsCache(): void {
  cache = null;
  cacheAt = 0;
}

/**
 * 同步读取内存里的设置快照（供 generateThumbnail / sendAcceleratedFile / CDN 中间件等
 * 同步消费者使用）。快照尚未加载（启动初期）或被失效时返回空对象 —— 调用方需对缺失值
 * 自行回退到默认。设置变更通过 redis 广播在 30s 内（CACHE_TTL）刷新到所有 worker。
 */
export function getCachedSettings(): Record<string, unknown> {
  return cache ?? {};
}

export async function getAllSettings(options: { forceRefresh?: boolean } = {}): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (!options.forceRefresh && cache && now - cacheAt < CACHE_TTL) return cache;

  if (!prisma) return normalizeRuntimeBackedSettings({ ...DEFAULTS });

  try {
    const rows = await prisma.setting.findMany();
    const result: Record<string, unknown> = { ...DEFAULTS };
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        result[row.key] = row.value;
      }
    }
    normalizeRuntimeBackedSettings(result);
    cache = result;
    cacheAt = now;
    return result;
  } catch {
    return normalizeRuntimeBackedSettings({ ...DEFAULTS });
  }
}

export async function getSetting<T = unknown>(key: string): Promise<T> {
  const all = await getAllSettings();
  return all[key] as T;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  if (!prisma) return;
  await prisma.setting.upsert({
    where: { key },
    update: { value: JSON.stringify(value) },
    create: { key, value: JSON.stringify(value) },
  });
  // Invalidate cache
  cache = null;
  await cacheDel('cache:settings:public');
  broadcastSettingsInvalidate();
}

const SETTINGS_KEYS = new Set(SETTINGS_SCHEMA.map((s) => s.key));

const NUMERIC_KEYS = new Set([
  'daily_download_limit',
  'smtp_port',
  'maintenance_auto_queue_threshold',
  'conversion_worker_concurrency',
  'mat_default_metalness',
  'mat_default_roughness',
  'mat_default_envMapIntensity',
  'mat_metal_metalness',
  'mat_metal_roughness',
  'mat_metal_envMapIntensity',
  'mat_plastic_metalness',
  'mat_plastic_roughness',
  'mat_plastic_envMapIntensity',
  'mat_glass_metalness',
  'mat_glass_roughness',
  'mat_glass_envMapIntensity',
  'mat_glass_transmission',
  'mat_glass_ior',
  'mat_glass_thickness',
  'viewer_exposure',
  'viewer_ambient_intensity',
  'viewer_main_light_intensity',
  'viewer_fill_light_intensity',
  'viewer_hemisphere_intensity',
  'viewer_edge_threshold_angle',
  'viewer_edge_vertex_limit',
  'viewer_edge_opacity',
  'viewer_edge_width',
  'viewer_measure_record_limit',
  'security_email_code_cooldown_seconds',
  'security_email_code_ttl_seconds',
  'security_captcha_ttl_seconds',
  'security_password_min_length',
  'security_username_min_length',
  'security_username_max_length',
  'share_default_expire_days',
  'share_max_expire_days',
  'share_default_download_limit',
  'share_max_download_limit',
  'auto_theme_dark_hour',
  'auto_theme_light_hour',
  'product_wall_max_image_mb',
  'product_wall_max_batch_count',
  'product_wall_max_zip_extract',
  'redis_db',
  'cache_public_settings_ttl_seconds',
  'cache_model_list_ttl_seconds',
  'cache_model_detail_ttl_seconds',
  'cache_search_ttl_seconds',
  'cache_selection_ttl_seconds',
  'cache_static_asset_max_age_days',
  'storage_signed_url_ttl_seconds',
  'storage_upload_multipart_mb',
  'storage_upload_concurrency',
  'image_thumbnail_quality',
  'image_large_max_width',
  'image_cache_max_age_days',
  'resource_cache_max_age_days',
  'download_token_ttl_minutes',
  'ticket_attachment_max_mb',
  'api_rate_limit',
  'backup_retention_count',
  'audit_log_retention_days',
]);

const BOOLEAN_KEYS = new Set([
  'require_login_download',
  'require_login_browse',
  'allow_register',
  'auth_modal_enabled',
  'login_dialog_enabled',
  'login_dialog_favorites',
  'login_dialog_downloads',
  'login_dialog_my_shares',
  'login_dialog_profile',
  'login_dialog_support',
  'login_dialog_my_tickets',
  'login_dialog_my_inquiries',
  'login_dialog_projects',
  'footer_copyright_follow_site_title',
  'model_detail_copyright_follow_site_title',
  'show_watermark',
  'announcement_enabled',
  'maintenance_enabled',
  'maintenance_auto_enabled',
  'smtp_secure',
  'auto_theme_enabled',
  'user_interface_theme_enabled',
  'ui_follow_browser_locale',
  'viewer_edge_enabled',
  'selection_enable_match',
  'share_enabled',
  'share_allow_password',
  'share_allow_custom_expiry',
  'share_allow_preview',
  'feature_selection_enabled',
  'feature_inquiry_enabled',
  'feature_product_wall_enabled',
  'feature_tickets_enabled',
  'feature_favorites_enabled',
  'feature_shares_enabled',
  'feature_downloads_enabled',
  'feature_password_reset_enabled',
  'cache_enabled',
  'redis_tls_enabled',
  'storage_use_ssl',
  'storage_force_path_style',
  'storage_signed_url_enabled',
  'storage_sync_enabled',
  'storage_sync_delete_extra_enabled',
  'image_cdn_enabled',
  'image_optimize_enabled',
  'image_webp_enabled',
  'resource_cdn_enabled',
  'resource_download_acceleration_enabled',
  'anti_proxy_enabled',
  'hotlink_protection_enabled',
  'backup_auto_enabled',
  'backup_mirror_enabled',
]);

function getSupportedInterfaceThemes(): Set<string> {
  const configured = process.env.INTERFACE_THEME_KEYS;
  if (!configured) return new Set(DEFAULT_INTERFACE_THEME_KEYS);
  const keys = configured
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^[a-z][a-z0-9-]{0,48}$/.test(item));
  return new Set(keys.length ? keys : DEFAULT_INTERFACE_THEME_KEYS);
}

function getSupportedMobileThemes(): Set<string> {
  const configured = process.env.MOBILE_THEME_KEYS;
  if (!configured) return new Set(DEFAULT_MOBILE_THEME_KEYS);
  const keys = configured
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^[a-z][a-z0-9-]{0,48}$/.test(item));
  return new Set(keys.length ? keys : DEFAULT_MOBILE_THEME_KEYS);
}

function normalizeJsonObjectSetting(key: string, value: unknown, maxLength = MAX_CUSTOM_COLOR_JSON_LENGTH): unknown {
  if (typeof value === 'string' && value.length > maxLength) return DEFAULTS[key];

  let parsed = value;
  if (typeof value === 'string') {
    if (!value.trim()) return DEFAULTS[key];
    try {
      parsed = JSON.parse(value);
    } catch {
      return DEFAULTS[key];
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULTS[key];

  const serialized = JSON.stringify(parsed);
  if (serialized.length > maxLength) return DEFAULTS[key];
  return JSON.stringify(parsed, null, 2);
}

function normalizeTrimmedStringSetting(value: unknown, fallback = ''): string {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeStoragePrefixSetting(key: string, value: unknown): string {
  const fallback = String(DEFAULTS[key] ?? '').trim();
  const normalized = String(value ?? fallback)
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
  return normalized || fallback;
}

function clampNumericSetting(key: string, value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number(DEFAULTS[key]);
  return Math.min(max, Math.max(min, n));
}

export function validateSettingValue(key: string, value: unknown): unknown {
  if (key === 'footer_links') return normalizeFooterLinksSetting(value);
  if (key === 'cache_driver') {
    const driver = String(value || '').trim();
    return (CACHE_DRIVER_KEYS as readonly string[]).includes(driver) ? driver : DEFAULTS[key];
  }
  if (key === 'storage_provider') {
    const provider = String(value || '').trim();
    return (STORAGE_PROVIDER_KEYS as readonly string[]).includes(provider) ? provider : DEFAULTS[key];
  }
  if (key === 'contact_phone') {
    const phone = normalizeContactPhoneSetting(value);
    return isValidContactPhoneSetting(phone) ? phone : DEFAULTS[key];
  }
  if (key === 'interface_theme') {
    const theme = String(value || '').trim();
    return getSupportedInterfaceThemes().has(theme) ? theme : DEFAULTS[key];
  }
  if (key === 'mobile_interface_theme') {
    const theme = String(value || '').trim();
    return getSupportedMobileThemes().has(theme) ? theme : DEFAULTS[key];
  }
  if (key === 'home_desktop_list_loading_mode' || key === 'home_mobile_list_loading_mode') {
    const mode = String(value || '').trim();
    return (HOME_LIST_LOADING_MODE_KEYS as readonly string[]).includes(mode) ? mode : DEFAULTS[key];
  }
  if (key === 'ui_default_locale') {
    const locale = String(value || '').trim();
    return (UI_LOCALE_KEYS as readonly string[]).includes(locale) ? locale : DEFAULTS[key];
  }
  if (key === 'ui_enabled_locales') {
    const locales = Array.from(
      new Set(
        String(value || '')
          .split(',')
          .map((item) => item.trim())
          .filter((item) => (UI_LOCALE_KEYS as readonly string[]).includes(item)),
      ),
    );
    return locales.length ? locales.join(',') : DEFAULTS[key];
  }
  if (key === 'color_scheme') {
    const scheme = String(value || '').trim();
    return (COLOR_SCHEME_KEYS as readonly string[]).includes(scheme) ? scheme : DEFAULTS[key];
  }
  if (key === 'color_custom_dark' || key === 'color_custom_light') {
    return normalizeJsonObjectSetting(key, value);
  }
  if (key === 'auto_theme_dark_hour' || key === 'auto_theme_light_hour') {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULTS[key];
    return Math.min(23, Math.max(0, Math.round(n)));
  }
  if (key === 'redis_db') return clampNumericSetting(key, value, 0, 15);
  if (
    key === 'cache_public_settings_ttl_seconds' ||
    key === 'cache_model_list_ttl_seconds' ||
    key === 'cache_model_detail_ttl_seconds' ||
    key === 'cache_search_ttl_seconds' ||
    key === 'cache_selection_ttl_seconds'
  ) {
    return clampNumericSetting(key, value, 0, 86400);
  }
  if (
    key === 'cache_static_asset_max_age_days' ||
    key === 'image_cache_max_age_days' ||
    key === 'resource_cache_max_age_days'
  ) {
    return clampNumericSetting(key, value, 0, 365);
  }
  if (key === 'storage_signed_url_ttl_seconds') return clampNumericSetting(key, value, 60, 86400);
  if (key === 'storage_upload_multipart_mb') return clampNumericSetting(key, value, 5, 512);
  if (key === 'storage_upload_concurrency') return clampNumericSetting(key, value, 1, 16);
  if (key === 'image_thumbnail_quality') return clampNumericSetting(key, value, 1, 100);
  if (key === 'image_large_max_width') return clampNumericSetting(key, value, 320, 12000);
  if (key.startsWith('storage_') && key.endsWith('_prefix')) return normalizeStoragePrefixSetting(key, value);
  if (
    key === 'redis_url' ||
    key === 'redis_key_prefix' ||
    key === 'storage_endpoint' ||
    key === 'storage_region' ||
    key === 'storage_bucket' ||
    key === 'storage_access_key_id' ||
    key === 'storage_public_base_url' ||
    key === 'storage_cdn_base_url'
  ) {
    return normalizeTrimmedStringSetting(value, String(DEFAULTS[key] ?? ''));
  }
  if (NUMERIC_KEYS.has(key)) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULTS[key];
    return n;
  }
  if (BOOLEAN_KEYS.has(key)) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      // Fix: "false" should return false, but other truthy strings like "yes", "1" should return true
      if (value.toLowerCase() === 'false') return false;
      if (value === 'true' || value === 'yes') return true;
      // For other strings, fall through to Boolean()
    }
    return Boolean(value);
  }
  if (typeof value === 'string' && value.length > 1_000_000) {
    return value.slice(0, 1_000_000);
  }
  return value;
}

export async function setSettings(settings: Record<string, unknown>): Promise<void> {
  if (!prisma) return;
  const shouldPreserveSecrets = Object.entries(settings).some(
    ([key, value]) => SENSITIVE_SETTING_KEYS.has(key) && value === MASKED_SECRET_VALUE,
  );
  const existingSettings = shouldPreserveSecrets ? await getAllSettings() : {};
  const filtered = Object.entries(settings)
    .filter(([key]) => SETTINGS_KEYS.has(key))
    .map(([key, value]) => {
      const nextValue =
        SENSITIVE_SETTING_KEYS.has(key) && value === MASKED_SECRET_VALUE
          ? (existingSettings[key] ?? DEFAULTS[key])
          : value;
      return [key, validateSettingValue(key, nextValue)] as [string, unknown];
    });
  if (filtered.length === 0) return;
  const ops = filtered.map(([key, value]) =>
    prisma.setting.upsert({
      where: { key },
      update: { value: JSON.stringify(value) },
      create: { key, value: JSON.stringify(value) },
    }),
  );
  await prisma.$transaction(ops);
  // Invalidate cache
  cache = null;
  await cacheDel('cache:settings:public');
  broadcastSettingsInvalidate();
}

export async function initDefaultSettings(): Promise<void> {
  if (!prisma) return;
  await prisma.setting.createMany({
    data: SETTINGS_SCHEMA.map((def) => ({ key: def.key, value: JSON.stringify(def.defaultValue) })),
    skipDuplicates: true,
  });
  cache = null;
}
