import { classicThemeManifest } from './classic/manifest';
import type { InterfaceThemeKey, InterfaceThemeMeta } from './types';
import { workbenchThemeManifest } from './workbench/manifest';

export const DEFAULT_INTERFACE_THEME: InterfaceThemeKey = 'workbench';

export const INTERFACE_THEME_CATALOG: Record<InterfaceThemeKey, InterfaceThemeMeta> = {
  workbench: workbenchThemeManifest,
  classic: classicThemeManifest,
};

export const INTERFACE_THEME_OPTIONS = Object.values(INTERFACE_THEME_CATALOG).map((theme) => ({
  value: theme.key,
  label: theme.settingsLabel,
}));

export function isInterfaceThemeKey(value?: string | null): value is InterfaceThemeKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(INTERFACE_THEME_CATALOG, value);
}

export function normalizeInterfaceTheme(value?: string | null): InterfaceThemeKey {
  return isInterfaceThemeKey(value) ? value : DEFAULT_INTERFACE_THEME;
}
