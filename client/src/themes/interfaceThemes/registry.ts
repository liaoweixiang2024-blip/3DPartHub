import { normalizeInterfaceTheme } from './catalog';
import './shared/base.css';
import classicTheme from './classic';
import type { InterfaceThemeKey, InterfaceThemePackage } from './types';
import workbenchTheme from './workbench';

export {
  DEFAULT_INTERFACE_THEME,
  INTERFACE_THEME_CATALOG,
  INTERFACE_THEME_OPTIONS,
  isInterfaceThemeKey,
  normalizeInterfaceTheme,
} from './catalog';

export const INTERFACE_THEME_PACKAGES: Record<InterfaceThemeKey, InterfaceThemePackage> = {
  workbench: workbenchTheme,
  classic: classicTheme,
};

export function getInterfaceThemePackage(value?: string | null): InterfaceThemePackage {
  return INTERFACE_THEME_PACKAGES[normalizeInterfaceTheme(value)];
}

export function getInterfaceThemeComponents(value?: string | null) {
  return getInterfaceThemePackage(value).components;
}
