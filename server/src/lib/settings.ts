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
  { key: "default_theme", defaultValue: "dark" },
  { key: "auto_theme_enabled", defaultValue: false },
  { key: "auto_theme_dark_hour", defaultValue: 20 },
  { key: "auto_theme_light_hour", defaultValue: 8 },
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
