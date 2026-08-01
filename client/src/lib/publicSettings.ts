import useSWR, { mutate } from 'swr';
import { getPublicSettings, type SystemSettings } from '../api/settings';
import { syncI18nSettings } from '../i18n';
import { applyServerThemeDefaults } from '../stores/useThemeStore';
import { applyColorScheme } from './colorScheme';
import { buildPoliceFilingUrl } from './filingNumber';

let cache: Partial<SystemSettings> | null = null;
let fetchedAt = 0;
let inflight: Promise<Partial<SystemSettings>> | null = null;
let scheduledRefreshHandle = 0;
let scheduledNotifyHandle = 0;
let scheduledThemeDefaultsHandle = 0;
let pendingNotifySyncSWR = false;
let pendingThemeDefaults: {
  defaultTheme: string;
  autoEnabled: boolean;
  autoDarkHour: number;
  autoLightHour: number;
} | null = null;
const STORAGE_KEY = 'site_config_cache';
const TTL = 2 * 60 * 1000; // 2 minutes — config changes propagate faster
const DEFAULT_COPYRIGHT_PROJECT_NAME = '3DPartHub';
const DEFAULT_3D_PREVIEW_SETTINGS: Partial<SystemSettings> = {
  mat_original_color: '#808080',
  mat_original_metalness: '',
  mat_original_roughness: '',
  mat_original_envMapIntensity: '',
  viewer_default_preset: 'original',
  viewer_visible_presets: 'original',
  viewer_edge_opacity: 0.25,
};

function getCopyrightYear(): string {
  return String(new Date().getFullYear());
}

function normalizeCopyrightProjectName(siteTitle: string | undefined): string {
  return String(siteTitle || '').trim() || DEFAULT_COPYRIGHT_PROJECT_NAME;
}

export function buildFooterCopyright(siteTitle?: string): string {
  return `© ${getCopyrightYear()} ${normalizeCopyrightProjectName(siteTitle)}. All rights reserved.`;
}

export function buildModelDetailCopyright(siteTitle?: string): string {
  return `© ${getCopyrightYear()} ${normalizeCopyrightProjectName(siteTitle)}`;
}

export const DEFAULT_FOOTER_COPYRIGHT = buildFooterCopyright(DEFAULT_COPYRIGHT_PROJECT_NAME);
export const DEFAULT_MODEL_DETAIL_DISCLAIMER =
  '本平台所有 3D 模型仅供参考与模拟验证，不作为生产加工依据。产品持续迭代更新，请以实物为准。';
export const DEFAULT_MODEL_DETAIL_COPYRIGHT = buildModelDetailCopyright(DEFAULT_COPYRIGHT_PROJECT_NAME);

type FooterLink = { label: string; url: string };

type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout?: number }) => number;
};

// Sync listeners for site title/logo changes
type Listener = () => void;
const listeners = new Set<Listener>();

// Eagerly hydrate cache from localStorage so synchronous getters
// (getSiteTitle, getSiteLogo, etc.) always return the last-known values,
// even on cold start or when the network is slow.
{
  const stored = loadFromStorage();
  if (stored) {
    cache = stored.data;
    fetchedAt = stored.ts;
  }
}

function loadFromStorage(): { data: Partial<SystemSettings>; ts: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveToStorage(data: Partial<SystemSettings>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // Ignore storage quota or private-mode write failures.
  }
}

function notifySiteConfigChange(syncSWR = true) {
  if (typeof window === 'undefined') {
    listeners.forEach((fn) => fn());
    if (syncSWR) void mutate('publicSettings', cache, { revalidate: false });
    return;
  }

  pendingNotifySyncSWR ||= syncSWR;

  if (scheduledNotifyHandle) return;

  scheduledNotifyHandle = window.setTimeout(() => {
    scheduledNotifyHandle = 0;
    const shouldSyncSWR = pendingNotifySyncSWR;
    pendingNotifySyncSWR = false;
    listeners.forEach((fn) => fn());
    if (shouldSyncSWR) void mutate('publicSettings', cache, { revalidate: false });
  }, 0);
}

function scheduleServerThemeDefaults(
  defaultTheme: string,
  autoEnabled: boolean,
  autoDarkHour: number,
  autoLightHour: number,
) {
  pendingThemeDefaults = { defaultTheme, autoEnabled, autoDarkHour, autoLightHour };

  if (typeof window === 'undefined') {
    applyServerThemeDefaults(defaultTheme, autoEnabled, autoDarkHour, autoLightHour);
    pendingThemeDefaults = null;
    return;
  }

  if (scheduledThemeDefaultsHandle) return;

  scheduledThemeDefaultsHandle = window.setTimeout(() => {
    scheduledThemeDefaultsHandle = 0;
    const next = pendingThemeDefaults;
    pendingThemeDefaults = null;
    if (!next) return;
    applyServerThemeDefaults(next.defaultTheme, next.autoEnabled, next.autoDarkHour, next.autoLightHour);
  }, 0);
}

function fetchAndApplyPublicSettings() {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const data = await getPublicSettings();
      cache = data;
      fetchedAt = Date.now();
      saveToStorage(cache);
      applyMetaTags();
      applyFavicon();
      applyAppearanceSettings(cache);
      syncI18nSettings(cache);
      notifySiteConfigChange();
      return cache;
    } catch {
      return cache || { show_watermark: false, watermark_image: '', site_title: '', site_logo: '' };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

function schedulePublicSettingsRefresh() {
  if (scheduledRefreshHandle || inflight || typeof window === 'undefined') return;

  const refresh = () => {
    scheduledRefreshHandle = 0;
    void fetchAndApplyPublicSettings();
  };

  const idleWindow = window as WindowWithIdleCallback;
  if (idleWindow.requestIdleCallback) {
    scheduledRefreshHandle = idleWindow.requestIdleCallback(refresh, { timeout: 2500 });
    return;
  }

  scheduledRefreshHandle = window.setTimeout(refresh, 1200);
}

export function onSiteConfigChange(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function clearCache() {
  cache = null;
  fetchedAt = 0;
  // Notify all listeners so React components re-render
  notifySiteConfigChange();
}

// Refresh config: clear all caches, re-fetch, apply, then notify listeners
export async function refreshSiteConfig(): Promise<Partial<SystemSettings>> {
  cache = null;
  fetchedAt = 0;
  localStorage.removeItem(STORAGE_KEY);
  try {
    cache = await getPublicSettings();
    fetchedAt = Date.now();
    saveToStorage(cache);
    applyMetaTags();
    applyFavicon();
    applyAppearanceSettings(cache);
    syncI18nSettings(cache);
  } catch {
    // Keep stale/default config if the public settings endpoint is unavailable.
  }
  // Notify all listeners with fresh cache populated
  notifySiteConfigChange();
  return cache || { show_watermark: false, watermark_image: '', site_title: '', site_logo: '' };
}

export function patchPublicSettings(patch: Partial<SystemSettings>): Partial<SystemSettings> {
  const stored = loadFromStorage();
  cache = { ...(stored?.data || cache || {}), ...patch };
  fetchedAt = Date.now();
  saveToStorage(cache);
  applyMetaTags();
  applyFavicon();
  applyAppearanceSettings(cache);
  syncI18nSettings(cache);
  notifySiteConfigChange();
  return cache;
}

export async function getCachedPublicSettings(): Promise<Partial<SystemSettings>> {
  const now = Date.now();
  if (cache && now - fetchedAt < TTL) return cache;

  // Try localStorage first for instant hydration
  if (!cache) {
    const stored = loadFromStorage();
    if (stored && now - stored.ts < TTL) {
      cache = stored.data;
      fetchedAt = stored.ts;
      notifySiteConfigChange(false);
    }
  }

  if (cache) {
    schedulePublicSettingsRefresh();
    return cache;
  }

  // No cached config exists yet, so fetch immediately to avoid rendering defaults forever.
  return fetchAndApplyPublicSettings();
}

// Synchronous getter for already-fetched settings
export function getPublicSettingsSnapshot(): Partial<SystemSettings> {
  return (
    cache || {
      show_watermark: false,
      watermark_image: '',
      site_title: '',
      site_logo: '',
      auth_modal_enabled: true,
      login_dialog_enabled: true,
      user_interface_theme_enabled: true,
      ui_default_locale: 'zh-CN',
      ui_enabled_locales: 'zh-CN,zh-TW,en-US,ja-JP,ko-KR,de-DE',
      ui_follow_browser_locale: false,
      feature_selection_enabled: true,
      feature_inquiry_enabled: true,
      feature_product_wall_enabled: true,
      feature_tickets_enabled: true,
      feature_favorites_enabled: true,
      feature_shares_enabled: true,
      feature_downloads_enabled: true,
      feature_temp_viewer_enabled: true,
      ...DEFAULT_3D_PREVIEW_SETTINGS,
    }
  );
}

// Get site title (sync, with fallback) — used in nav bar, login page
export function getSiteTitle(): string {
  return (cache?.site_title as string) || '3DPartHub';
}

// Get browser title (sync) — used in document.title / browser tab
// Falls back to site_title if not set
export function getBrowserTitle(): string {
  const bt = cache?.site_browser_title as string;
  return bt || getSiteTitle();
}

// Get site logo URL (sync, empty string = no custom logo)
export function getSiteLogo(): string {
  return (cache?.site_logo as string) || '';
}

// Get site icon URL (sync, square icon for logo+title mode)
export function getSiteIcon(): string {
  return (cache?.site_icon as string) || '';
}

// Get logo display mode: 'logo_and_title' | 'logo_only' | 'title_only'
export function getLogoDisplayMode(): string {
  return (cache?.site_logo_display as string) || 'logo_and_title';
}

// Get site favicon URL (sync, empty string = no custom favicon)
export function getSiteFavicon(): string {
  return (cache?.site_favicon as string) || '';
}

// Get announcement config (sync)
export function getAnnouncement(): { enabled: boolean; text: string; type: string; color: string } {
  return {
    enabled: (cache?.announcement_enabled as boolean) || false,
    text: (cache?.announcement_text as string) || '',
    type: (cache?.announcement_type as string) || 'info',
    color: (cache?.announcement_color as string) || '',
  };
}

// Get contact email (sync)
export function getContactEmail(): string {
  return (cache?.contact_email as string) || '';
}
export function getContactPhone(): string {
  return (cache?.contact_phone as string) || '';
}
export function getContactAddress(): string {
  return (cache?.contact_address as string) || '';
}

// Get footer links (sync) — JSON string or empty
export function getFooterLinks(): FooterLink[] {
  try {
    const value = cache?.footer_links;
    const parsed = typeof value === 'string' ? (value.trim() ? JSON.parse(value) : []) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const row = item && typeof item === 'object' ? (item as Partial<FooterLink>) : {};
        return {
          label: typeof row.label === 'string' ? row.label.trim() : '',
          url: typeof row.url === 'string' ? row.url.trim() : '',
        };
      })
      .filter((link) => link.label && link.url);
  } catch {
    return [];
  }
}

// Get footer copyright text (sync)
export function getFooterCopyright(): string {
  if (cache?.footer_copyright_follow_site_title !== false) return buildFooterCopyright(getSiteTitle());
  return (cache?.footer_copyright as string)?.trim() || DEFAULT_FOOTER_COPYRIGHT;
}

// ICP filing number (中国大陆工信部备案号)，留空则不显示。固定指向工信部查询页。
export function getFooterIcpNumber(): string {
  return (cache?.footer_icp_number as string)?.trim() || '';
}

// 公安备案号，留空则不显示。标准查询链接由号码中的数字生成；号码不含足够
// 数字时降级为纯文本（不可点）。
export function getFooterPoliceNumber(): string {
  return (cache?.footer_police_number as string)?.trim() || '';
}

// 由公安备案号推导标准查询链接；无法提取到记录号时返回空串（调用方按纯文本渲染）。
// 纯逻辑见 ./filingNumber.ts（buildPoliceFilingUrl），这里只从缓存取号码再委托。
export function getFooterPoliceUrl(): string {
  return buildPoliceFilingUrl(getFooterPoliceNumber());
}

export function getModelDetailDisclaimer(): string {
  return (cache?.model_detail_disclaimer as string)?.trim() || DEFAULT_MODEL_DETAIL_DISCLAIMER;
}

export function getModelDetailCopyright(): string {
  if (cache?.model_detail_copyright_follow_site_title !== false) return buildModelDetailCopyright(getSiteTitle());
  return (cache?.model_detail_copyright as string)?.trim() || DEFAULT_MODEL_DETAIL_COPYRIGHT;
}

// Apply dynamic meta tags (description, keywords, og:title, og:description)
function applyMetaTags() {
  if (!cache) return;
  const desc = (cache.site_description as string) || '';
  const keywords = (cache.site_keywords as string) || '';
  const title = getBrowserTitle();

  // Update <meta name="description">
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content', desc);
  // Update <meta name="keywords">
  if (keywords) {
    let metaKeywords = document.querySelector('meta[name="keywords"]');
    if (!metaKeywords) {
      metaKeywords = document.createElement('meta');
      metaKeywords.setAttribute('name', 'keywords');
      document.head.appendChild(metaKeywords);
    }
    metaKeywords.setAttribute('content', keywords);
  }
  // Update og:title
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute('content', title);
  // Update og:description
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.setAttribute('content', desc);
}

// Apply dynamic favicon
function applyFavicon() {
  if (!cache) return;
  const favicon = getSiteFavicon();
  if (!favicon) return;

  let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  // Determine type from extension
  if (favicon.endsWith('.svg')) link.type = 'image/svg+xml';
  else if (favicon.endsWith('.ico')) link.type = 'image/x-icon';
  else if (favicon.endsWith('.png')) link.type = 'image/png';
  else if (favicon.endsWith('.jpg') || favicon.endsWith('.jpeg')) link.type = 'image/jpeg';
  link.href = favicon + (favicon.includes('?') ? '&' : '?') + '_t=' + Date.now();
}

// Apply appearance-related settings (color scheme + theme defaults)
export function applyAppearanceSettings(settings: Partial<SystemSettings>) {
  applyColorScheme(
    (settings.color_scheme as string) || 'orange',
    (settings.color_custom_dark as string) || '{}',
    (settings.color_custom_light as string) || '{}',
  );
  scheduleServerThemeDefaults(
    (settings.default_theme as string) || 'dark',
    (settings.auto_theme_enabled as boolean) || false,
    (settings.auto_theme_dark_hour as number) ?? 20,
    (settings.auto_theme_light_hour as number) ?? 8,
  );
}

// 3D Material & Viewer config helpers
export interface MaterialPresetConfig {
  color: string;
  metalness: number;
  roughness: number;
  envMapIntensity: number;
  transmission?: number;
  ior?: number;
  thickness?: number;
}

export type ViewerSettingsOverride = Partial<
  Pick<
    SystemSettings,
    | 'viewer_exposure'
    | 'viewer_ambient_intensity'
    | 'viewer_main_light_intensity'
    | 'viewer_fill_light_intensity'
    | 'viewer_hemisphere_intensity'
    | 'viewer_bg_color'
    | 'mat_default_color'
    | 'mat_default_metalness'
    | 'mat_default_roughness'
    | 'mat_default_envMapIntensity'
  >
>;

export function get3DMaterialConfig(overrides?: ViewerSettingsOverride) {
  const s = { ...DEFAULT_3D_PREVIEW_SETTINGS, ...(cache || {}), ...(overrides || {}) };
  const originalOverride: Partial<MaterialPresetConfig> | null =
    (s.mat_original_color as string) ||
    (s.mat_original_metalness as string) !== '' ||
    (s.mat_original_roughness as string) !== '' ||
    (s.mat_original_envMapIntensity as string) !== ''
      ? {
          color: (s.mat_original_color as string) || undefined,
          metalness: (s.mat_original_metalness as number) ?? undefined,
          roughness: (s.mat_original_roughness as number) ?? undefined,
          envMapIntensity: (s.mat_original_envMapIntensity as number) ?? undefined,
        }
      : null;
  return {
    presets: {
      original: originalOverride,
      default: {
        color: (s.mat_default_color as string) || '#c8cad0',
        metalness: (s.mat_default_metalness as number) ?? 0.5,
        roughness: (s.mat_default_roughness as number) ?? 0.25,
        envMapIntensity: (s.mat_default_envMapIntensity as number) ?? 1.5,
      } satisfies MaterialPresetConfig,
      metal: {
        color: (s.mat_metal_color as string) || '#f0f0f4',
        metalness: (s.mat_metal_metalness as number) ?? 1.0,
        roughness: (s.mat_metal_roughness as number) ?? 0.05,
        envMapIntensity: (s.mat_metal_envMapIntensity as number) ?? 2.0,
      } satisfies MaterialPresetConfig,
      plastic: {
        color: (s.mat_plastic_color as string) || '#4499ff',
        metalness: (s.mat_plastic_metalness as number) ?? 0.0,
        roughness: (s.mat_plastic_roughness as number) ?? 0.35,
        envMapIntensity: (s.mat_plastic_envMapIntensity as number) ?? 0.6,
      } satisfies MaterialPresetConfig,
      glass: {
        color: (s.mat_glass_color as string) || '#ffffff',
        metalness: (s.mat_glass_metalness as number) ?? 0.0,
        roughness: (s.mat_glass_roughness as number) ?? 0.0,
        envMapIntensity: (s.mat_glass_envMapIntensity as number) ?? 1.0,
        transmission: (s.mat_glass_transmission as number) ?? 0.95,
        ior: (s.mat_glass_ior as number) ?? 1.5,
        thickness: (s.mat_glass_thickness as number) ?? 0.5,
      } satisfies MaterialPresetConfig,
    },
    viewer: {
      exposure: (s.viewer_exposure as number) ?? 1.4,
      ambientIntensity: (s.viewer_ambient_intensity as number) ?? 1.0,
      mainLightIntensity: (s.viewer_main_light_intensity as number) ?? 2.0,
      fillLightIntensity: (s.viewer_fill_light_intensity as number) ?? 0.8,
      hemisphereIntensity: (s.viewer_hemisphere_intensity as number) ?? 0.5,
      bgColor: (s.viewer_bg_color as string) || '#ffffff',
    },
  };
}

export function getEdgeStyleConfig() {
  const s = { ...DEFAULT_3D_PREVIEW_SETTINGS, ...(cache || {}) };
  return {
    color: (s.viewer_edge_color as string) || '#000000',
    opacity: (s.viewer_edge_opacity as number) ?? 0.25,
    width: (s.viewer_edge_width as number) ?? 1,
  };
}

export function getDefaultPreset(): string {
  return (cache?.viewer_default_preset as string) || 'original';
}

export function usePublicSettings() {
  const { data, isLoading } = useSWR('publicSettings', () => getCachedPublicSettings());
  return { settings: data ?? undefined, isLoading };
}

// Feature flag hook for gating UI buttons. Reads from the cached public settings
// snapshot and re-renders when settings change. Feature toggles apply to everyone,
// including admins — a disabled feature is hidden/inaccessible site-wide.
export interface FeatureFlags {
  selection: boolean;
  inquiry: boolean;
  productWall: boolean;
  tickets: boolean;
  favorites: boolean;
  shares: boolean;
  downloads: boolean;
  registration: boolean;
  passwordReset: boolean;
  tempViewer: boolean;
  invite: boolean;
}

export function useFeatureFlags(): FeatureFlags {
  const { settings } = usePublicSettings();
  return {
    selection: settings?.feature_selection_enabled !== false,
    inquiry: settings?.feature_inquiry_enabled !== false,
    productWall: settings?.feature_product_wall_enabled !== false,
    tickets: settings?.feature_tickets_enabled !== false,
    favorites: settings?.feature_favorites_enabled !== false,
    shares: settings?.share_enabled !== false && settings?.feature_shares_enabled !== false,
    downloads: settings?.feature_downloads_enabled !== false,
    registration: settings?.allow_register !== false,
    passwordReset: settings?.feature_password_reset_enabled !== false,
    tempViewer: settings?.feature_temp_viewer_enabled !== false,
    // 注意：邀请码功能默认关闭，用 === true 判断（区别于其他 flag 的 !== false）
    invite: settings?.require_invite_code === true,
  };
}
