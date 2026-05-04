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
import { cacheDel } from './cache.js';
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

const SETTINGS_SCHEMA: SettingDef[] = [
  { key: 'require_login_download', defaultValue: false },
  { key: 'require_login_browse', defaultValue: false },
  { key: 'allow_register', defaultValue: true },
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
  { key: 'footer_copyright', defaultValue: '' },
  { key: 'legal_privacy_updated_at', defaultValue: '2026 年 4 月' },
  { key: 'legal_terms_updated_at', defaultValue: '2026 年 4 月' },
  { key: 'legal_privacy_sections', defaultValue: '' },
  { key: 'legal_terms_sections', defaultValue: '' },
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
  { key: 'mat_original_color', defaultValue: '' },
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
  { key: 'viewer_default_preset', defaultValue: 'default' },
  { key: 'viewer_visible_presets', defaultValue: 'original,default,metal,plastic,glass' },
  { key: 'viewer_edge_enabled', defaultValue: true },
  { key: 'viewer_edge_threshold_angle', defaultValue: 28 },
  { key: 'viewer_edge_vertex_limit', defaultValue: 700000 },
  { key: 'viewer_edge_color', defaultValue: '#000000' },
  { key: 'viewer_edge_opacity', defaultValue: 1.0 },
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
  { key: 'share_allow_password', defaultValue: true },
  { key: 'share_allow_custom_expiry', defaultValue: true },
  { key: 'share_allow_preview', defaultValue: true },

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
  { key: 'nav_mobile_items', defaultValue: JSON.stringify(DEFAULT_MOBILE_NAV_FOR_SETTINGS, null, 2) },
  { key: 'upload_policy', defaultValue: JSON.stringify(DEFAULT_UPLOAD_POLICY_FOR_SETTINGS, null, 2) },
  { key: 'page_size_policy', defaultValue: JSON.stringify(DEFAULT_PAGE_SIZE_POLICY_FOR_SETTINGS, null, 2) },

  // Anti-reverse-proxy & hotlink protection
  { key: 'anti_proxy_enabled', defaultValue: false },
  { key: 'allowed_hosts', defaultValue: '' },
  { key: 'hotlink_protection_enabled', defaultValue: false },
  { key: 'allowed_referers', defaultValue: '' },

  // Product wall upload limits
  { key: 'product_wall_max_image_mb', defaultValue: 50 },
  { key: 'product_wall_max_batch_count', defaultValue: 50 },
  { key: 'product_wall_max_zip_extract', defaultValue: 100 },

  // Download token TTL
  { key: 'download_token_ttl_minutes', defaultValue: 5 },

  // Ticket attachment limits
  { key: 'ticket_attachment_max_mb', defaultValue: 100 },
  {
    key: 'ticket_attachment_types',
    defaultValue: 'jpg,jpeg,png,gif,webp,svg,pdf,doc,docx,xls,xlsx,ppt,pptx,zip,rar,7z,step,stp,iges,igs,xt,binary',
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

// In-memory cache
let cache: Record<string, unknown> | null = null;
let cacheAt = 0;
const CACHE_TTL = 30_000; // 30 seconds — fast propagation across workers

/** Clear the in-memory settings cache (used after restore) */
export function clearSettingsCache(): void {
  cache = null;
  cacheAt = 0;
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL) return cache;

  if (!prisma) return normalizeLegacyMaintenanceSettings({ ...DEFAULTS });

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
    normalizeLegacyMaintenanceSettings(result);
    cache = result;
    cacheAt = now;
    return result;
  } catch {
    return normalizeLegacyMaintenanceSettings({ ...DEFAULTS });
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
  'download_token_ttl_minutes',
  'ticket_attachment_max_mb',
  'api_rate_limit',
  'backup_retention_count',
]);

const BOOLEAN_KEYS = new Set([
  'require_login_download',
  'require_login_browse',
  'allow_register',
  'show_watermark',
  'announcement_enabled',
  'maintenance_enabled',
  'maintenance_auto_enabled',
  'smtp_secure',
  'auto_theme_enabled',
  'viewer_edge_enabled',
  'selection_enable_match',
  'share_allow_password',
  'share_allow_custom_expiry',
  'share_allow_preview',
  'anti_proxy_enabled',
  'hotlink_protection_enabled',
  'backup_auto_enabled',
  'backup_mirror_enabled',
]);

function validateSettingValue(key: string, value: unknown): unknown {
  if (NUMERIC_KEYS.has(key)) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULTS[key];
    return n;
  }
  if (BOOLEAN_KEYS.has(key)) {
    return Boolean(value);
  }
  if (typeof value === 'string' && value.length > 1_000_000) {
    return value.slice(0, 1_000_000);
  }
  return value;
}

export async function setSettings(settings: Record<string, unknown>): Promise<void> {
  if (!prisma) return;
  const filtered = Object.entries(settings)
    .filter(([key]) => SETTINGS_KEYS.has(key))
    .map(([key, value]) => [key, validateSettingValue(key, value)] as [string, unknown]);
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
}

export async function initDefaultSettings(): Promise<void> {
  if (!prisma) return;
  await prisma.setting.createMany({
    data: SETTINGS_SCHEMA.map((def) => ({ key: def.key, value: JSON.stringify(def.defaultValue) })),
    skipDuplicates: true,
  });
  cache = null;
}
