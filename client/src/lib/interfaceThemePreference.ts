import { useSyncExternalStore } from 'react';
import type { SystemSettings } from '../api/settings';
import {
  DEFAULT_INTERFACE_THEME,
  INTERFACE_THEME_CATALOG,
  isInterfaceThemeKey,
  normalizeInterfaceTheme,
} from '../themes/interfaceThemes/catalog';
import type { InterfaceThemeKey } from '../themes/interfaceThemes/types';

export type InterfaceThemePreference = 'system' | InterfaceThemeKey;
export type InterfaceThemePreferenceScope = 'public' | 'admin';

const GLOBAL_STORAGE_KEY = 'interface_theme_preference';
const STORAGE_KEYS: Record<InterfaceThemePreferenceScope, string> = {
  public: 'front_interface_theme_preference',
  admin: 'admin_interface_theme_preference',
};
const LEGACY_STORAGE_KEYS = Object.values(STORAGE_KEYS);
const ALL_STORAGE_KEYS = [GLOBAL_STORAGE_KEY, ...LEGACY_STORAGE_KEYS];
const CHANGE_EVENT = 'interface-theme-preference-change';
const LEGACY_CHANGE_EVENT = 'front-interface-theme-preference-change';

type InterfaceThemePreferenceOption = {
  value: InterfaceThemePreference;
  label: string;
  labelKey: string;
  shortLabel?: string;
  shortLabelKey?: string;
  description: string;
  descriptionKey: string;
};

export const INTERFACE_THEME_PREFERENCE_OPTIONS: InterfaceThemePreferenceOption[] = [
  {
    value: 'system',
    label: 'Site default',
    labelKey: 'themePreference.system.label',
    shortLabel: 'Default',
    shortLabelKey: 'themePreference.system.shortLabel',
    description: 'Use the default interface theme configured by the administrator',
    descriptionKey: 'themePreference.system.description',
  },
  ...Object.values(INTERFACE_THEME_CATALOG).map((theme) => ({
    value: theme.key,
    labelKey: `themePreference.${theme.key}.label`,
    label: theme.label,
    shortLabelKey: `themePreference.${theme.key}.shortLabel`,
    shortLabel: theme.shortLabel,
    descriptionKey: `themePreference.${theme.key}.description`,
    description: theme.description,
  })),
];

function notifyPreferenceChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
  window.dispatchEvent(new Event(LEGACY_CHANGE_EVENT));
}

export function isUserInterfaceThemeEnabled(settings?: Partial<SystemSettings> | null) {
  return settings?.user_interface_theme_enabled !== false;
}

function getStorageKey(scope: InterfaceThemePreferenceScope) {
  return STORAGE_KEYS[scope];
}

function readStoredPreference(key: string): InterfaceThemePreference | null {
  try {
    const value = window.localStorage.getItem(key);
    if (value === 'system' || isInterfaceThemeKey(value)) return value;
  } catch {
    // Ignore storage errors in private mode.
  }
  return null;
}

export function getInterfaceThemePreference(scope: InterfaceThemePreferenceScope = 'public'): InterfaceThemePreference {
  if (typeof window === 'undefined') return 'system';
  return (
    readStoredPreference(GLOBAL_STORAGE_KEY) ||
    readStoredPreference(STORAGE_KEYS.public) ||
    readStoredPreference(STORAGE_KEYS.admin) ||
    readStoredPreference(getStorageKey(scope)) ||
    'system'
  );
}

export function setInterfaceThemePreference(
  value: InterfaceThemePreference,
  scope: InterfaceThemePreferenceScope = 'public',
) {
  if (typeof window === 'undefined') return;
  const normalized: InterfaceThemePreference = value === 'system' || isInterfaceThemeKey(value) ? value : 'system';
  try {
    const storageKeys = new Set([...ALL_STORAGE_KEYS, getStorageKey(scope)]);
    if (normalized === 'system') {
      storageKeys.forEach((storageKey) => window.localStorage.removeItem(storageKey));
    } else {
      storageKeys.forEach((storageKey) => window.localStorage.setItem(storageKey, normalized));
    }
  } catch {
    // Ignore storage errors in private mode.
  }
  notifyPreferenceChange();
}

function subscribePreference(scope: InterfaceThemePreferenceScope, listener: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const storageKeys = new Set([...ALL_STORAGE_KEYS, getStorageKey(scope)]);
  const handleStorage = (event: StorageEvent) => {
    if (!event.key || storageKeys.has(event.key)) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener(LEGACY_CHANGE_EVENT, listener);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener(LEGACY_CHANGE_EVENT, listener);
    window.removeEventListener('storage', handleStorage);
  };
}

export function useInterfaceThemePreference(scope: InterfaceThemePreferenceScope = 'public') {
  return useSyncExternalStore<InterfaceThemePreference>(
    (listener) => subscribePreference(scope, listener),
    () => getInterfaceThemePreference(scope),
    () => 'system',
  );
}

export function resolvePublicInterfaceTheme(
  settings?: Partial<SystemSettings> | null,
  preference: InterfaceThemePreference = getInterfaceThemePreference('public'),
  allowUserPreference = true,
): InterfaceThemeKey {
  const siteDefault = normalizeInterfaceTheme(settings?.interface_theme || DEFAULT_INTERFACE_THEME);
  if (!allowUserPreference || !isUserInterfaceThemeEnabled(settings)) return siteDefault;
  return preference === 'system' ? siteDefault : normalizeInterfaceTheme(preference);
}

export function useResolvedPublicInterfaceTheme(
  settings?: Partial<SystemSettings> | null,
  allowUserPreference = true,
): InterfaceThemeKey {
  const preference = useInterfaceThemePreference('public');
  return resolvePublicInterfaceTheme(settings, preference, allowUserPreference);
}

export function resolveAdminInterfaceTheme(
  settings?: Partial<SystemSettings> | null,
  preference: InterfaceThemePreference = getInterfaceThemePreference('admin'),
): InterfaceThemeKey {
  const siteDefault = normalizeInterfaceTheme(settings?.interface_theme || DEFAULT_INTERFACE_THEME);
  return preference === 'system' ? siteDefault : normalizeInterfaceTheme(preference);
}

export function useResolvedAdminInterfaceTheme(settings?: Partial<SystemSettings> | null): InterfaceThemeKey {
  const preference = useInterfaceThemePreference('admin');
  return resolveAdminInterfaceTheme(settings, preference);
}
