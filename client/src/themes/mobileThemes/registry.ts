import { normalizeMobileTheme } from './catalog';
import classicMobileTheme from './classic';
import type { MobileThemeKey, MobileThemePackage } from './types';

export {
  DEFAULT_MOBILE_THEME,
  MOBILE_THEME_CATALOG,
  MOBILE_THEME_OPTIONS,
  isMobileThemeKey,
  normalizeMobileTheme,
} from './catalog';

export const MOBILE_THEME_PACKAGES: Record<MobileThemeKey, MobileThemePackage> = {
  classic: classicMobileTheme,
};

export function getMobileThemePackage(value?: string | null): MobileThemePackage {
  return MOBILE_THEME_PACKAGES[normalizeMobileTheme(value)];
}
