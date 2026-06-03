import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import type { SystemSettings } from '../api/settings';
import { resources } from './resources';

export const SUPPORTED_LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'de-DE'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const SUPPORTED_LOCALES_SETTING_VALUE = SUPPORTED_LOCALES.join(',');

export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN';
export const LOCALE_STORAGE_KEY = 'ui_locale';

const LOCALE_LABEL_KEYS: Record<SupportedLocale, string> = {
  'zh-CN': 'language.zhCN',
  'zh-TW': 'language.zhTW',
  'en-US': 'language.enUS',
  'ja-JP': 'language.jaJP',
  'ko-KR': 'language.koKR',
  'de-DE': 'language.deDE',
};

const LOCALE_HTML_LANG: Record<SupportedLocale, string> = {
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  'en-US': 'en',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
  'de-DE': 'de',
};

function readLocalStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors in private mode.
  }
}

export function normalizeLocale(value: unknown, fallback: SupportedLocale = DEFAULT_LOCALE): SupportedLocale {
  return parseSupportedLocale(value) || fallback;
}

function parseSupportedLocale(value: unknown): SupportedLocale | null {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh-hans' || raw === 'cn') return 'zh-CN';
  if (raw === 'zh-tw' || raw === 'zh-hk' || raw === 'zh-hant' || raw === 'tw' || raw === 'hk') return 'zh-TW';
  if (raw === 'en' || raw === 'en-us' || raw === 'en-gb') return 'en-US';
  if (raw === 'ja' || raw === 'ja-jp' || raw === 'jp') return 'ja-JP';
  if (raw === 'ko' || raw === 'ko-kr' || raw === 'kr') return 'ko-KR';
  if (raw === 'de' || raw === 'de-de' || raw === 'de-at' || raw === 'de-ch') return 'de-DE';
  return null;
}

export function getLocaleLabelKey(locale: SupportedLocale): string {
  return LOCALE_LABEL_KEYS[locale];
}

export function getEnabledLocales(settings?: Partial<SystemSettings> | null): SupportedLocale[] {
  const raw = settings?.ui_enabled_locales;
  const candidates = Array.isArray(raw)
    ? raw
    : String(raw || SUPPORTED_LOCALES_SETTING_VALUE)
        .split(',')
        .map((item) => item.trim());
  const enabled = Array.from(
    new Set(
      candidates.map((item) => parseSupportedLocale(item)).filter((item): item is SupportedLocale => Boolean(item)),
    ),
  );
  return enabled.length ? enabled : [DEFAULT_LOCALE];
}

function getBrowserLocale(): SupportedLocale | null {
  if (typeof navigator === 'undefined') return null;
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    const normalized = parseSupportedLocale(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function getDefaultLocale(settings?: Partial<SystemSettings> | null): SupportedLocale {
  const enabled = getEnabledLocales(settings);
  const configured = normalizeLocale(settings?.ui_default_locale);
  if (enabled.includes(configured)) return configured;
  return enabled[0] || DEFAULT_LOCALE;
}

export function resolveAppLocale(settings?: Partial<SystemSettings> | null): SupportedLocale {
  const enabled = getEnabledLocales(settings);
  const stored = parseSupportedLocale(readLocalStorage(LOCALE_STORAGE_KEY));
  if (stored && enabled.includes(stored)) return stored;

  if (settings?.ui_follow_browser_locale) {
    const browserLocale = getBrowserLocale();
    if (browserLocale && enabled.includes(browserLocale)) return browserLocale;
  }

  return getDefaultLocale(settings);
}

function applyHtmlLanguage(locale: SupportedLocale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = LOCALE_HTML_LANG[locale];
}

export async function initI18n(settings?: Partial<SystemSettings> | null) {
  const locale = resolveAppLocale(settings);

  if (!i18n.isInitialized) {
    await i18n
      .use(LanguageDetector)
      .use(initReactI18next)
      .init({
        resources,
        lng: locale,
        fallbackLng: DEFAULT_LOCALE,
        supportedLngs: [...SUPPORTED_LOCALES],
        interpolation: {
          escapeValue: false,
        },
        detection: {
          order: ['localStorage', 'navigator', 'htmlTag'],
          lookupLocalStorage: LOCALE_STORAGE_KEY,
          caches: ['localStorage'],
        },
        react: {
          useSuspense: false,
        },
      });
  } else if (normalizeLocale(i18n.language) !== locale) {
    await i18n.changeLanguage(locale);
  }

  applyHtmlLanguage(locale);
  return i18n;
}

export async function changeAppLanguage(locale: SupportedLocale) {
  const normalized = normalizeLocale(locale);
  writeLocalStorage(LOCALE_STORAGE_KEY, normalized);
  if (!i18n.isInitialized) {
    await initI18n({ ui_default_locale: normalized, ui_enabled_locales: SUPPORTED_LOCALES_SETTING_VALUE });
    return normalized;
  }
  await i18n.changeLanguage(normalized);
  applyHtmlLanguage(normalized);
  return normalized;
}

export function syncI18nSettings(settings?: Partial<SystemSettings> | null) {
  if (!i18n.isInitialized) return;
  const enabled = getEnabledLocales(settings);
  const current = normalizeLocale(i18n.language);
  if (!enabled.includes(current)) {
    void changeAppLanguage(getDefaultLocale(settings));
    return;
  }
  applyHtmlLanguage(current);
}

export { i18n };
