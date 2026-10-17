import { i18n } from '../../i18n';
import { classicMobileThemeManifest } from './classic/manifest';
import type { MobileThemeKey, MobileThemeMeta } from './types';

export const DEFAULT_MOBILE_THEME: MobileThemeKey = 'classic';

export const MOBILE_THEME_CATALOG: Record<MobileThemeKey, MobileThemeMeta> = {
  classic: classicMobileThemeManifest,
};

export const MOBILE_THEME_OPTIONS = Object.values(MOBILE_THEME_CATALOG).map((theme) => ({
  value: theme.key,
  // getter：i18n 语言在模块加载后才就绪，取 label 时才求值（移动端主题键名带 mobile 前缀）
  get label() {
    return i18n.t(`themeMeta.mobile${theme.key.charAt(0).toUpperCase()}${theme.key.slice(1)}.settingsLabel`, {
      defaultValue: theme.settingsLabel,
    });
  },
}));

export function isMobileThemeKey(value?: string | null): value is MobileThemeKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MOBILE_THEME_CATALOG, value);
}

export function normalizeMobileTheme(value?: string | null): MobileThemeKey {
  return isMobileThemeKey(value) ? value : DEFAULT_MOBILE_THEME;
}
