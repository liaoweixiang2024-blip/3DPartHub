import type { ReactNode } from 'react';
import type { SystemSettings } from '../../api/settings';
import { i18n } from '../../i18n';
import { getPublicSettingsSnapshot } from '../../lib/publicSettings';
import { preloadRouteForPath } from '../../lib/routeLoaders';
import { useAuthStore } from '../../stores/useAuthStore';

const PROTECTED_PREFIXES = [
  '/admin',
  '/favorites',
  '/my-shares',
  '/profile',
  '/support',
  '/my-tickets',
  '/my-inquiries',
  '/downloads',
  '/projects',
];

const PATH_LABEL_KEYS: Record<string, string> = {
  '/admin': 'protected.reasons.admin',
  '/favorites': 'protected.reasons.favorites',
  '/my-shares': 'protected.reasons.myShares',
  '/profile': 'protected.reasons.profile',
  '/support': 'protected.reasons.support',
  '/my-tickets': 'protected.reasons.myTickets',
  '/my-inquiries': 'protected.reasons.myInquiries',
  '/downloads': 'protected.reasons.downloads',
  '/projects': 'protected.reasons.projects',
};

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}

export function getLoginReason(path: string): string {
  for (const [prefix, labelKey] of Object.entries(PATH_LABEL_KEYS)) {
    if (path === prefix || path.startsWith(prefix + '/')) return i18n.t(labelKey);
  }
  return i18n.t('protected.reasons.default');
}

function readSettings(settings?: Partial<SystemSettings>) {
  return settings || getPublicSettingsSnapshot();
}

export function isAuthModalEnabled(settings?: Partial<SystemSettings>): boolean {
  return readSettings(settings).auth_modal_enabled !== false;
}

export function isLoginDialogEnabled(path?: string, settings?: Partial<SystemSettings>): boolean {
  const resolvedSettings = readSettings(settings);
  const master = resolvedSettings.login_dialog_enabled;
  if (master === false) return false;
  if (!path) return false;
  const perPageKey = getPerPageDialogKey(path);
  if (perPageKey) {
    const v = resolvedSettings[perPageKey as keyof typeof resolvedSettings];
    return v !== false;
  }
  return false;
}

export function shouldShowLoginPromptForRequest(path?: string, settings?: Partial<SystemSettings>): boolean {
  const resolvedSettings = readSettings(settings);
  if (resolvedSettings.login_dialog_enabled === false) return false;
  if (!path) return true;
  const perPageKey = getPerPageDialogKey(path);
  if (!perPageKey) return true;
  const v = resolvedSettings[perPageKey as keyof typeof resolvedSettings];
  return v !== false;
}

const PATH_TO_DIALOG_KEY: Record<string, string> = {
  '/favorites': 'login_dialog_favorites',
  '/downloads': 'login_dialog_downloads',
  '/my-shares': 'login_dialog_my_shares',
  '/profile': 'login_dialog_profile',
  '/support': 'login_dialog_support',
  '/my-tickets': 'login_dialog_my_tickets',
  '/my-inquiries': 'login_dialog_my_inquiries',
  '/projects': 'login_dialog_projects',
};

function getPerPageDialogKey(path: string): string | undefined {
  for (const [prefix, key] of Object.entries(PATH_TO_DIALOG_KEY)) {
    if (path === prefix || path.startsWith(prefix + '/')) return key;
  }
  return undefined;
}

/**
 * Check if a protected path requires login, and return either:
 * - { action: 'dialog', reason, returnUrl } — show login confirm dialog
 * - { action: 'redirect' } — navigate directly to login page
 * - { action: 'allow' } — user is authenticated, proceed normally
 */
export function checkProtectedAccess(
  path: string,
  settings?: Partial<SystemSettings>,
):
  | { action: 'dialog'; reason: string; returnUrl: string }
  | { action: 'redirect'; returnUrl: string }
  | { action: 'allow' } {
  if (useAuthStore.getState().isAuthenticated) return { action: 'allow' };
  if (!isProtectedPath(path)) return { action: 'allow' };
  const returnUrl = path;
  if (isLoginDialogEnabled(path, settings)) {
    return { action: 'dialog', reason: getLoginReason(path), returnUrl };
  }
  return { action: 'redirect', returnUrl };
}

interface ProtectedNavLinkProps {
  to: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  onLoginRequired: (path: string) => void;
}

export default function ProtectedNavLink({ to, children, className, onClick, onLoginRequired }: ProtectedNavLinkProps) {
  function handleClick(e: React.MouseEvent) {
    onClick?.();
    if (!useAuthStore.getState().isAuthenticated && isProtectedPath(to)) {
      e.preventDefault();
      onLoginRequired(to);
    }
  }

  return (
    <a
      href={to}
      className={className}
      onPointerEnter={() => preloadRouteForPath(to)}
      onPointerDown={() => preloadRouteForPath(to)}
      onFocus={() => preloadRouteForPath(to)}
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
    >
      {children}
    </a>
  );
}
