import type { ReactNode } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { getPublicSettingsSnapshot } from '../../lib/publicSettings';

const PROTECTED_PREFIXES = [
  '/favorites',
  '/my-shares',
  '/profile',
  '/support',
  '/my-tickets',
  '/my-inquiries',
  '/downloads',
  '/projects',
];

const PATH_LABELS: Record<string, string> = {
  '/favorites': '查看收藏',
  '/my-shares': '查看分享',
  '/profile': '个人设置',
  '/support': '技术支持',
  '/my-tickets': '提交工单',
  '/my-inquiries': '查看询价',
  '/downloads': '下载历史',
  '/projects': '查看项目',
};

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}

export function getLoginReason(path: string): string {
  for (const [prefix, label] of Object.entries(PATH_LABELS)) {
    if (path === prefix || path.startsWith(prefix + '/')) return label;
  }
  return '访问此页面';
}

export function isLoginDialogEnabled(path?: string): boolean {
  const settings = getPublicSettingsSnapshot();
  const master = settings.login_dialog_enabled;
  if (master === false) return false;
  if (!path) return true;
  const perPageKey = getPerPageDialogKey(path);
  if (perPageKey) {
    const v = settings[perPageKey as keyof typeof settings];
    return v !== false;
  }
  return true;
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
):
  | { action: 'dialog'; reason: string; returnUrl: string }
  | { action: 'redirect'; returnUrl: string }
  | { action: 'allow' } {
  if (useAuthStore.getState().isAuthenticated) return { action: 'allow' };
  if (!isProtectedPath(path)) return { action: 'allow' };
  const returnUrl = path;
  if (isLoginDialogEnabled(path)) {
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
    <a href={to} className={className} onClick={handleClick} style={{ cursor: 'pointer' }}>
      {children}
    </a>
  );
}
