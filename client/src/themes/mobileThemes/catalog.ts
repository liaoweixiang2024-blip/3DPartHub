import { classicMobileThemeManifest } from './classic/manifest';
import type { MobileThemeKey, MobileThemeMeta } from './types';

export const DEFAULT_MOBILE_THEME: MobileThemeKey = 'classic';

export const MOBILE_THEME_CATALOG: Record<MobileThemeKey, MobileThemeMeta> = {
  classic: classicMobileThemeManifest,
};

export const MOBILE_THEME_OPTIONS = Object.values(MOBILE_THEME_CATALOG).map((theme) => ({
  value: theme.key,
  label: theme.settingsLabel,
}));

export function isMobileThemeKey(value?: string | null): value is MobileThemeKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MOBILE_THEME_CATALOG, value);
}

export function normalizeMobileTheme(value?: string | null): MobileThemeKey {
  return isMobileThemeKey(value) ? value : DEFAULT_MOBILE_THEME;
}
