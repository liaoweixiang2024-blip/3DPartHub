import { prisma } from "./prisma.js";
import { cacheDel } from "./cache.js";

interface SettingDef {
  key: string;
  defaultValue: unknown;
}

const SETTINGS_SCHEMA: SettingDef[] = [
  { key: "require_login_download", defaultValue: false },
  { key: "require_login_browse", defaultValue: false },
  { key: "allow_register", defaultValue: true },
  { key: "daily_download_limit", defaultValue: 0 },
  { key: "allow_comments", defaultValue: true },
  { key: "show_watermark", defaultValue: false },
  { key: "watermark_text", defaultValue: "3DPartHub" },
  { key: "watermark_image", defaultValue: "" },
  { key: "site_title", defaultValue: "3DPartHub" },
  { key: "site_browser_title", defaultValue: "" },
  { key: "site_logo", defaultValue: "/static/logo/logo.svg" },
  { key: "site_icon", defaultValue: "/static/logo/icon.svg" },
  { key: "site_favicon", defaultValue: "/favicon.svg" },
  { key: "site_logo_display", defaultValue: "logo_and_title" },
  { key: "site_description", defaultValue: "" },
  { key: "site_keywords", defaultValue: "" },
  { key: "announcement_enabled", defaultValue: false },
  { key: "announcement_text", defaultValue: "" },
  { key: "announcement_type", defaultValue: "info" },
  { key: "announcement_color", defaultValue: "" },
  { key: "smtp_host", defaultValue: "" },
  { key: "smtp_port", defaultValue: 465 },
  { key: "smtp_user", defaultValue: "" },
  { key: "smtp_pass", defaultValue: "" },
  { key: "smtp_from", defaultValue: "" },
  { key: "smtp_secure", defaultValue: true },
  { key: "color_scheme", defaultValue: "orange" },
  { key: "color_custom_dark", defaultValue: "{}" },
  { key: "color_custom_light", defaultValue: "{}" },
  { key: "default_theme", defaultValue: "light" },
  { key: "auto_theme_enabled", defaultValue: false },
  { key: "auto_theme_dark_hour", defaultValue: 20 },
  { key: "auto_theme_light_hour", defaultValue: 8 },

  // 3D Material presets — default
  { key: "mat_default_color", defaultValue: "#c8cad0" },
  { key: "mat_default_metalness", defaultValue: 0.5 },
  { key: "mat_default_roughness", defaultValue: 0.25 },
  { key: "mat_default_envMapIntensity", defaultValue: 1.5 },
  // 3D Material presets — metal
  { key: "mat_metal_color", defaultValue: "#f0f0f4" },
  { key: "mat_metal_metalness", defaultValue: 1.0 },
  { key: "mat_metal_roughness", defaultValue: 0.05 },
  { key: "mat_metal_envMapIntensity", defaultValue: 2.0 },
  // 3D Material presets — plastic
  { key: "mat_plastic_color", defaultValue: "#4499ff" },
  { key: "mat_plastic_metalness", defaultValue: 0.0 },
  { key: "mat_plastic_roughness", defaultValue: 0.35 },
  { key: "mat_plastic_envMapIntensity", defaultValue: 0.6 },
  // 3D Material presets — glass
  { key: "mat_glass_color", defaultValue: "#ffffff" },
  { key: "mat_glass_metalness", defaultValue: 0.0 },
  { key: "mat_glass_roughness", defaultValue: 0.0 },
  { key: "mat_glass_envMapIntensity", defaultValue: 1.0 },
  { key: "mat_glass_transmission", defaultValue: 0.95 },
  { key: "mat_glass_ior", defaultValue: 1.5 },
  { key: "mat_glass_thickness", defaultValue: 0.5 },
  // 3D Viewer lighting
  { key: "viewer_exposure", defaultValue: 1.2 },
  { key: "viewer_ambient_intensity", defaultValue: 0.6 },
  { key: "viewer_main_light_intensity", defaultValue: 1.4 },
  { key: "viewer_fill_light_intensity", defaultValue: 0.6 },
  { key: "viewer_hemisphere_intensity", defaultValue: 0.3 },
  { key: "viewer_bg_color", defaultValue: "linear-gradient(180deg, #2a2a3e 0%, #1e2a42 50%, #162040 100%)" },
  // Share policy
  { key: "share_default_expire_days", defaultValue: 0 },
  { key: "share_max_expire_days", defaultValue: 0 },
  { key: "share_default_download_limit", defaultValue: 0 },
  { key: "share_max_download_limit", defaultValue: 0 },
  { key: "share_allow_password", defaultValue: true },
  { key: "share_allow_custom_expiry", defaultValue: true },
  { key: "share_allow_preview", defaultValue: true },

  // Selection wizard
  { key: "selection_page_title", defaultValue: "产品选型" },
  { key: "selection_page_desc", defaultValue: "选择产品大类，逐步筛选出精确型号" },
  { key: "selection_enable_match", defaultValue: true },
  { key: "field_aliases", defaultValue: "{}" },
];

const DEFAULTS: Record<string, unknown> = {};
for (const s of SETTINGS_SCHEMA) DEFAULTS[s.key] = s.defaultValue;

// In-memory cache
let cache: Record<string, unknown> | null = null;
let cacheAt = 0;
const CACHE_TTL = 300_000; // 5 minutes — public config rarely changes

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL) return cache;

  if (!prisma) return { ...DEFAULTS };

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
    cache = result;
    cacheAt = now;
    return result;
  } catch {
    return { ...DEFAULTS };
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
  await cacheDel("cache:settings:public");
}

export async function setSettings(settings: Record<string, unknown>): Promise<void> {
  if (!prisma) return;
  const ops = Object.entries(settings).map(([key, value]) =>
    prisma.setting.upsert({
      where: { key },
      update: { value: JSON.stringify(value) },
      create: { key, value: JSON.stringify(value) },
    })
  );
  await prisma.$transaction(ops);
  // Invalidate cache
  cache = null;
  await cacheDel("cache:settings:public");
}

export async function initDefaultSettings(): Promise<void> {
  if (!prisma) return;
  for (const def of SETTINGS_SCHEMA) {
    try {
      await prisma.setting.upsert({
        where: { key: def.key },
        update: {},
        create: { key: def.key, value: JSON.stringify(def.defaultValue) },
      });
    } catch {
      // Ignore duplicate key errors from concurrent workers
    }
  }
  cache = null;
}
