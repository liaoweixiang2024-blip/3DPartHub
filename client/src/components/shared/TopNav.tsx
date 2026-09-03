import { motion, AnimatePresence } from 'framer-motion';
import {
  lazy,
  Suspense,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useSyncExternalStore,
  type ChangeEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { mutate } from 'swr';
import type { SystemSettings } from '../../api/settings';
import {
  changeAppLanguage,
  getEnabledLocales,
  getLocaleLabelKey,
  normalizeLocale,
  type SupportedLocale,
} from '../../i18n';
import { localizeNavItems } from '../../i18n/nav';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import { getBusinessConfig } from '../../lib/businessConfig';
import {
  HOME_SEARCH_EVENT,
  HOME_SEARCH_MAX_LENGTH,
  dispatchHomeBrowseReset,
  dispatchHomeSearchQuery,
  normalizeHomeSearchQuery,
  readHomeSearchQuery,
  saveHomeSearchQuery,
  type HomeSearchEventDetail,
} from '../../lib/homeSearchState';
import {
  INTERFACE_THEME_PREFERENCE_OPTIONS,
  type InterfaceThemePreferenceScope,
  isUserInterfaceThemeEnabled,
  setInterfaceThemePreference,
  useInterfaceThemePreference,
  useResolvedAdminInterfaceTheme,
  useResolvedPublicInterfaceTheme,
} from '../../lib/interfaceThemePreference';
import { isModelDetailPath } from '../../lib/modelReturnPath';
import { onSiteConfigChange, useFeatureFlags, usePublicSettings } from '../../lib/publicSettings';
import { preloadRouteForPath } from '../../lib/routeLoaders';
import { useAuthStore } from '../../stores/useAuthStore';
import { useThemeStore } from '../../stores/useThemeStore';
import { getInterfaceThemePackage } from '../../themes/interfaceThemes/registry';
import BrandMark from './BrandMark';
import Icon from './Icon';
import { loadNotificationPanel, scheduleNotificationPanelPreload } from './preloadNotificationPanel';
import { checkProtectedAccess } from './ProtectedLink';
import SearchField from './SearchField';
import { useToast } from './Toast';
import Tooltip from './Tooltip';
import { useAuthEntry } from './useAuthEntry';

const preloadUploadModal = () => import('./UploadModal');
const UploadModal = lazy(preloadUploadModal);
const NotificationPanel = lazy(loadNotificationPanel);
scheduleNotificationPanelPreload();
const TOP_NAV_SEARCH_DEBOUNCE_MS = 280;

interface TopNavProps {
  compact?: boolean;
  onMenuToggle?: () => void;
  source?: 'layout' | 'standalone';
}

let layoutTopNavCount = 0;
let layoutTopNavVersion = 0;
const layoutTopNavListeners = new Set<() => void>();

function notifyLayoutTopNavListeners() {
  layoutTopNavVersion += 1;
  layoutTopNavListeners.forEach((listener) => listener());
}

function subscribeLayoutTopNav(listener: () => void) {
  layoutTopNavListeners.add(listener);
  return () => layoutTopNavListeners.delete(listener);
}

function getLayoutTopNavSnapshot() {
  return layoutTopNavVersion;
}

function useLayoutTopNavCount() {
  useSyncExternalStore(subscribeLayoutTopNav, getLayoutTopNavSnapshot, getLayoutTopNavSnapshot);
  return layoutTopNavCount;
}

function clampSearchInput(value: string) {
  return Array.from(value).slice(0, HOME_SEARCH_MAX_LENGTH).join('');
}

function isComposingNativeEvent(event: Event) {
  return Boolean((event as Event & { isComposing?: boolean }).isComposing);
}

function NotificationPanelLoader({
  compact = false,
  onLoginClick,
  showTooltip = true,
}: {
  compact?: boolean;
  onLoginClick?: () => void;
  showTooltip?: boolean;
}) {
  return (
    <Suspense
      fallback={<NotificationPanelFallback compact={compact} onLoginClick={onLoginClick} showTooltip={showTooltip} />}
    >
      <NotificationPanel compact={compact} onLoginClick={onLoginClick} showTooltip={showTooltip} />
    </Suspense>
  );
}

function NotificationPanelFallback({
  compact = false,
  onLoginClick,
  showTooltip = true,
}: {
  compact?: boolean;
  onLoginClick?: () => void;
  showTooltip?: boolean;
}) {
  const { t } = useTranslation();
  if (!useAuthStore.getState().isAuthenticated) {
    if (compact) {
      return (
        <button
          onPointerEnter={loadNotificationPanel}
          onPointerDown={loadNotificationPanel}
          onFocus={loadNotificationPanel}
          onClick={() => {
            if (onLoginClick) {
              onLoginClick();
            } else {
              window.location.href = '/login';
            }
          }}
          className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
          aria-label={t('common.notifications')}
          title={showTooltip ? t('topNav.loginToViewNotifications') : undefined}
        >
          <Icon name="notifications" size={20} />
        </button>
      );
    }
    return null;
  }

  return (
    <button
      onPointerEnter={loadNotificationPanel}
      onPointerDown={loadNotificationPanel}
      onFocus={loadNotificationPanel}
      onClick={loadNotificationPanel}
      className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors relative"
      aria-label={t('common.notifications')}
      data-tooltip={showTooltip ? t('common.notifications') : undefined}
      data-tooltip-side={showTooltip ? 'bottom' : undefined}
    >
      <Icon name="notifications" size={20} />
    </button>
  );
}

function UploadModalLoader({
  open,
  onClose,
  onConverted,
}: {
  open: boolean;
  onClose: () => void;
  onConverted: () => void;
}) {
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <UploadModal open={open} onClose={onClose} onConverted={onConverted} />
    </Suspense>
  );
}

function UserMenu({
  size = 'default',
  onLoginRequired,
  onLoginClick,
  adminDefaultPath = '/admin/models',
  settings,
}: {
  size?: 'compact' | 'default';
  onLoginRequired: (reason: string, returnUrl: string) => void;
  onLoginClick?: () => void;
  adminDefaultPath?: string;
  settings?: Partial<SystemSettings>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleLogout = () => {
    setOpen(false);
    logout();
    navigate('/login');
  };

  const isCompact = size === 'compact';
  const avatarSize = isCompact ? 'w-7 h-7' : 'w-8 h-8';
  const iconSize = isCompact ? 16 : 18;
  const compactButtonClass = isCompact ? 'h-9 w-9 justify-center' : '';
  const userMenuButtonClass = `top-nav-user-menu-button flex items-center gap-2 cursor-pointer ${compactButtonClass} ${
    isCompact ? '' : 'ml-2'
  }`;

  const featureFlags = useFeatureFlags();
  const menuItems = [
    {
      label: t('nav.profile'),
      icon: 'person',
      path: '/profile',
    },
    ...(featureFlags.tempViewer ? [{ label: t('nav.tempViewer'), icon: 'view_in_ar', path: '/temp-viewer' }] : []),
    {
      label: t('auth.changePassword'),
      icon: 'lock',
      path: '/profile?tab=security',
    },
    ...(featureFlags.downloads ? [{ label: t('nav.downloads'), icon: 'download', path: '/downloads' }] : []),
    ...(featureFlags.shares ? [{ label: t('nav.myShares'), icon: 'share', path: '/my-shares' }] : []),
    ...(featureFlags.invite && user?.canInvite
      ? [{ label: t('nav.myInvites'), icon: 'card_giftcard', path: '/my-invites' }]
      : []),
  ];

  const isAdminUser = user?.role === 'ADMIN';

  if (!user) {
    return (
      <button onClick={onLoginClick || (() => navigate('/login'))} className={userMenuButtonClass}>
        <div className={`${avatarSize} rounded-full bg-surface-container-highest flex items-center justify-center`}>
          <Icon name="person" size={iconSize} className="text-on-surface-variant" />
        </div>
        {!isCompact && (
          <span className="hidden md:inline text-sm text-on-surface-variant font-light">{t('topNav.login')}</span>
        )}
      </button>
    );
  }

  return (
    <div
      className="top-nav-user-menu relative"
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen(!open)}
        className={userMenuButtonClass}
        aria-label={t('topNav.userMenu')}
        data-tooltip-ignore
      >
        <div className={`${avatarSize} rounded-full bg-surface-container-highest flex items-center justify-center`}>
          <Icon name="person" size={iconSize} className="text-on-surface-variant" />
        </div>
        {!isCompact && (
          <span className="hidden md:inline text-sm text-on-surface-variant font-light">
            {user?.username || t('common.user')}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className={`absolute ${isCompact ? 'right-0' : 'right-0'} top-full z-[100] w-48 pt-2`}
          >
            <div className="bg-surface-container-high border border-outline-variant/20 rounded-sm shadow-lg py-1">
              <div className="px-4 py-2.5 border-b border-outline-variant/15">
                <p className="text-sm font-medium text-on-surface truncate">{user?.username || t('common.user')}</p>
                <p className="text-xs text-on-surface-variant truncate mt-0.5">{user?.email || ''}</p>
              </div>
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    setOpen(false);
                    const result = checkProtectedAccess(item.path, settings);
                    if (result.action === 'dialog') {
                      onLoginRequired(result.reason, result.returnUrl);
                    } else if (result.action === 'redirect') {
                      navigate('/login', { state: { from: result.returnUrl } });
                    } else {
                      navigate(item.path);
                    }
                  }}
                  onPointerEnter={() => preloadRouteForPath(item.path)}
                  onPointerDown={() => preloadRouteForPath(item.path)}
                  onFocus={() => preloadRouteForPath(item.path)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-on-surface hover:bg-surface-container-highest"
                >
                  <Icon name={item.icon} size={18} />
                  {item.label}
                </button>
              ))}
              {isAdminUser && (
                <button
                  onClick={() => {
                    setOpen(false);
                    preloadRouteForPath(adminDefaultPath);
                    navigate(adminDefaultPath);
                  }}
                  onPointerEnter={() => preloadRouteForPath(adminDefaultPath)}
                  onPointerDown={() => preloadRouteForPath(adminDefaultPath)}
                  onFocus={() => preloadRouteForPath(adminDefaultPath)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-on-surface hover:bg-surface-container-highest"
                >
                  <Icon name="admin_panel_settings" size={18} />
                  {t('common.admin')}
                </button>
              )}
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-error hover:bg-error-container/10"
              >
                <Icon name="logout" size={18} />
                {t('common.logout')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InterfaceThemeSegment({
  onSelect,
  compact = false,
  scope = 'public',
}: {
  onSelect?: (label: string) => void;
  compact?: boolean;
  scope?: InterfaceThemePreferenceScope;
}) {
  const { t } = useTranslation();
  const preference = useInterfaceThemePreference(scope);

  return (
    <div className="space-y-0.5">
      {INTERFACE_THEME_PREFERENCE_OPTIONS.map((option) => {
        const active = preference === option.value;
        const label = t(option.shortLabelKey || option.labelKey, {
          defaultValue: option.shortLabel || option.label,
        });
        const fullLabel = t(option.labelKey, { defaultValue: option.label });
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (active) return;
              setInterfaceThemePreference(option.value, scope);
              onSelect?.(fullLabel);
            }}
            className={`flex h-8 w-full items-center justify-between rounded-lg px-2.5 text-xs font-medium transition-colors ${
              active
                ? 'bg-surface-container-highest/45 text-on-surface'
                : 'text-on-surface-variant hover:bg-surface-container-highest/25 hover:text-on-surface'
            } ${compact ? 'h-6 text-[11px]' : ''}`}
          >
            <span>{label}</span>
            <span
              className={`flex h-4 w-4 items-center justify-center text-primary-container transition-opacity ${
                active ? 'opacity-100' : 'opacity-0'
              }`}
              aria-hidden="true"
            >
              <Icon name="check" size={13} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function LanguageSegment({ settings, onSelect }: { settings?: Partial<SystemSettings>; onSelect?: () => void }) {
  const { t, i18n } = useTranslation();
  const enabledLocales = useMemo(() => getEnabledLocales(settings), [settings]);
  const [currentLocale, setCurrentLocale] = useState<SupportedLocale>(() => normalizeLocale(i18n.language));

  useEffect(() => {
    const handleLanguageChanged = (language: string) => setCurrentLocale(normalizeLocale(language));
    i18n.on('languageChanged', handleLanguageChanged);
    handleLanguageChanged(i18n.language);
    return () => i18n.off('languageChanged', handleLanguageChanged);
  }, [i18n]);

  if (enabledLocales.length <= 1) return null;

  return (
    <div className="space-y-0.5">
      {enabledLocales.map((locale) => {
        const active = currentLocale === locale;
        const label = t(getLocaleLabelKey(locale));
        return (
          <button
            key={locale}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (active) {
                onSelect?.();
                return;
              }
              void changeAppLanguage(locale);
              onSelect?.();
            }}
            className={`flex h-8 w-full items-center justify-between rounded-lg px-2.5 text-xs font-medium transition-colors ${
              active
                ? 'bg-surface-container-highest/45 text-on-surface'
                : 'text-on-surface-variant hover:bg-surface-container-highest/25 hover:text-on-surface'
            }`}
          >
            <span>{label}</span>
            <span
              className={`flex h-4 w-4 items-center justify-center text-primary-container transition-opacity ${
                active ? 'opacity-100' : 'opacity-0'
              }`}
              aria-hidden="true"
            >
              <Icon name="check" size={13} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ThemeToggle({
  showTooltip = true,
  showInterfaceThemePreference = false,
  interfaceThemeScope = 'public',
  settings,
}: {
  showTooltip?: boolean;
  showInterfaceThemePreference?: boolean;
  interfaceThemeScope?: InterfaceThemePreferenceScope;
  settings?: Partial<SystemSettings>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const { toast } = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const label = t('theme.displaySettings');

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const setDisplayMode = (mode: 'light' | 'dark') => {
    if (theme === mode) {
      setOpen(false);
      return;
    }
    if (theme !== mode) toggleTheme();
    toast(mode === 'dark' ? t('theme.switchedToDark') : t('theme.switchedToLight'), 'success');
    setOpen(false);
  };

  const displayModes = [
    { value: 'light' as const, label: t('theme.light'), icon: 'light_mode' },
    { value: 'dark' as const, label: t('theme.dark'), icon: 'dark_mode' },
  ];
  const enabledLocales = getEnabledLocales(settings);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors"
        title={showTooltip ? label : undefined}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tooltip={showTooltip ? label : undefined}
        data-tooltip-side={showTooltip ? 'bottom' : undefined}
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={theme}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ display: 'block' }}
          >
            <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} size={20} />
          </motion.span>
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-full z-[120] pt-2"
          >
            <div className="w-52 overflow-hidden rounded-xl border border-outline-variant/12 bg-surface/95 p-1.5 shadow-dropdown backdrop-blur-xl">
              <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-on-surface-variant/55">
                {t('theme.display')}
              </div>
              <div className="space-y-0.5">
                {displayModes.map((mode) => {
                  const active = theme === mode.value;
                  return (
                    <button
                      key={mode.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setDisplayMode(mode.value)}
                      className={`flex h-8 w-full items-center justify-between rounded-lg px-2.5 text-xs font-medium transition-colors ${
                        active
                          ? 'bg-surface-container-highest/45 text-on-surface'
                          : 'text-on-surface-variant hover:bg-surface-container-highest/25 hover:text-on-surface'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon name={mode.icon} size={14} className="shrink-0 opacity-70" />
                        <span>{mode.label}</span>
                      </span>
                      <span
                        className={`flex h-4 w-4 items-center justify-center text-primary-container transition-opacity ${
                          active ? 'opacity-100' : 'opacity-0'
                        }`}
                        aria-hidden="true"
                      >
                        <Icon name="check" size={13} />
                      </span>
                    </button>
                  );
                })}
              </div>

              {showInterfaceThemePreference ? (
                <div className="mt-1.5 border-t border-outline-variant/10 pt-1.5">
                  <div className="px-2 pb-1 text-[11px] font-medium text-on-surface-variant/55">
                    {t('common.interface')}
                  </div>
                  <InterfaceThemeSegment
                    scope={interfaceThemeScope}
                    onSelect={(nextLabel) => {
                      toast(t('theme.switchedToTheme', { label: nextLabel }), 'success');
                      setOpen(false);
                    }}
                  />
                </div>
              ) : null}

              {enabledLocales.length > 1 ? (
                <div className="mt-1.5 border-t border-outline-variant/10 pt-1.5">
                  <div className="px-2 pb-1 text-[11px] font-medium text-on-surface-variant/55">
                    {t('common.language')}
                  </div>
                  <LanguageSegment settings={settings} onSelect={() => setOpen(false)} />
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function TopNav({ source = 'standalone', ...props }: TopNavProps) {
  const activeLayoutTopNavCount = useLayoutTopNavCount();

  useEffect(() => {
    if (source !== 'layout') return;
    layoutTopNavCount += 1;
    notifyLayoutTopNavListeners();
    return () => {
      layoutTopNavCount = Math.max(0, layoutTopNavCount - 1);
      notifyLayoutTopNavListeners();
    };
  }, [source]);

  if (source === 'standalone' && activeLayoutTopNavCount > 0) {
    return null;
  }

  return <TopNavContent {...props} source={source} />;
}

function TopNavContent({ compact = false, onMenuToggle, source = 'standalone' }: TopNavProps) {
  const { t } = useTranslation();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [desktopSearchOpen, setDesktopSearchOpen] = useState(false);
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'ADMIN';
  const [searchParams] = useSearchParams();
  const [localQuery, setLocalQuery] = useState(() => readHomeSearchQuery() ?? searchParams.get('q') ?? '');
  const [desktopSearchDraft, setDesktopSearchDraft] = useState(
    () => readHomeSearchQuery() ?? searchParams.get('q') ?? '',
  );
  const navigate = useNavigate();
  const location = useLocation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchCompositionRef = useRef(false);
  const desktopSearchCompositionRef = useRef(false);
  const desktopSearchRef = useRef<HTMLDivElement>(null);
  const desktopSearchInputRef = useRef<HTMLInputElement>(null);
  const isWideDesktop = useMediaQuery('(min-width: 1280px)');
  const isVeryWideDesktop = useMediaQuery('(min-width: 1536px)');
  // Force re-render when site config changes
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    return onSiteConfigChange(() => forceUpdate((n) => n + 1));
  }, []);
  const { settings } = usePublicSettings();
  const { authNodes, handleProtectedLinkClick, openAuthEntry, openLoginPrompt } = useAuthEntry(settings);
  const resolvedPublicTheme = useResolvedPublicInterfaceTheme(settings);
  const resolvedAdminTheme = useResolvedAdminInterfaceTheme(settings);
  const { userNavItems, adminNavItems } = useMemo(() => {
    const business = getBusinessConfig(settings);
    return {
      userNavItems: localizeNavItems(business.userNav, t),
      adminNavItems: localizeNavItems(
        business.adminNav.filter((item) => item.path.startsWith('/admin/')),
        t,
      ),
    };
  }, [settings, t]);
  const topNavItems = useMemo(() => userNavItems.filter((item) => item.path !== '/'), [userNavItems]);
  const isAdminRoute = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  const ThemePackage = getInterfaceThemePackage(isAdminRoute ? resolvedAdminTheme : resolvedPublicTheme);
  const ThemeTopNav = ThemePackage.components.DesktopTopNav;
  const showDesktopTooltips = ThemePackage.chrome.desktopToolbar?.showTooltips ?? true;
  const adminDefaultPath =
    ThemePackage.chrome.adminLayout.defaultPath?.({
      pathname: location.pathname,
      isAdminRoute: location.pathname === '/admin' || location.pathname.startsWith('/admin/'),
    }) || '/admin/models';

  const getReturnPath = useCallback(
    () => `${location.pathname}${location.search}${location.hash}`,
    [location.hash, location.pathname, location.search],
  );

  useEffect(() => {
    if (!desktopSearchOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!desktopSearchRef.current?.contains(target)) {
        setDesktopSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [desktopSearchOpen]);

  useEffect(() => {
    if (!desktopSearchOpen) return;
    const focusFrame = requestAnimationFrame(() => desktopSearchInputRef.current?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, [desktopSearchOpen]);

  useEffect(() => {
    setDesktopSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const stored = readHomeSearchQuery();
    const nextQuery = stored ?? searchParams.get('q') ?? '';
    setLocalQuery(nextQuery);
    if (!desktopSearchOpen) {
      setDesktopSearchDraft(nextQuery);
    }
  }, [desktopSearchOpen, searchParams]);

  useEffect(() => {
    const handleSearchEvent = (event: Event) => {
      const detail = (event as CustomEvent<HomeSearchEventDetail>).detail;
      if (!detail || typeof detail.query !== 'string') return;
      setLocalQuery(detail.query);
      if (!desktopSearchOpen) {
        setDesktopSearchDraft(detail.query);
      }
    };
    window.addEventListener(HOME_SEARCH_EVENT, handleSearchEvent);
    return () => window.removeEventListener(HOME_SEARCH_EVENT, handleSearchEvent);
  }, [desktopSearchOpen]);

  const doSearch = useCallback(
    (value: string) => {
      const query = normalizeHomeSearchQuery(value);
      setLocalQuery(query);
      saveHomeSearchQuery(query);
      dispatchHomeSearchQuery(query);
      if (location.pathname === '/') {
        return;
      } else {
        navigate('/', { state: { homeBrowseState: { query, page: 1 } } });
      }
    },
    [location.pathname, navigate],
  );

  const clearSearchDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  useEffect(() => clearSearchDebounce, [clearSearchDebounce]);

  const scheduleSearch = useCallback(
    (value: string) => {
      clearSearchDebounce();
      const nextValue = clampSearchInput(value);
      if (!nextValue.trim()) {
        doSearch('');
        return;
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        doSearch(nextValue);
      }, TOP_NAV_SEARCH_DEBOUNCE_MS);
    },
    [clearSearchDebounce, doSearch],
  );

  const handleSearchChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const nextValue = clampSearchInput(e.target.value);
      setLocalQuery(nextValue);
      if (searchCompositionRef.current || isComposingNativeEvent(e.nativeEvent)) {
        clearSearchDebounce();
        return;
      }
      scheduleSearch(nextValue);
    },
    [clearSearchDebounce, scheduleSearch],
  );

  const handleSearchInput = useCallback(
    (e: FormEvent<HTMLInputElement>) => {
      const nextValue = clampSearchInput(e.currentTarget.value);
      setLocalQuery(nextValue);
      if (searchCompositionRef.current || isComposingNativeEvent(e.nativeEvent)) {
        clearSearchDebounce();
        return;
      }
      scheduleSearch(nextValue);
    },
    [clearSearchDebounce, scheduleSearch],
  );

  const handleSearchCompositionStart = useCallback(() => {
    searchCompositionRef.current = true;
    clearSearchDebounce();
  }, [clearSearchDebounce]);

  const handleSearchCompositionUpdate = useCallback(
    (e: CompositionEvent<HTMLInputElement>) => {
      setLocalQuery(clampSearchInput(e.currentTarget.value));
      clearSearchDebounce();
    },
    [clearSearchDebounce],
  );

  const handleSearchCompositionEnd = useCallback(
    (e: CompositionEvent<HTMLInputElement>) => {
      searchCompositionRef.current = false;
      const nextValue = clampSearchInput(e.currentTarget.value);
      setLocalQuery(nextValue);
      scheduleSearch(nextValue);
    },
    [scheduleSearch],
  );

  const handleSearchKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && (searchCompositionRef.current || isComposingNativeEvent(e.nativeEvent))) {
      e.preventDefault();
    }
  }, []);

  const handleClearSearch = useCallback(() => {
    searchCompositionRef.current = false;
    setLocalQuery('');
    clearSearchDebounce();
    doSearch('');
  }, [clearSearchDebounce, doSearch]);

  const handleSearchSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (searchCompositionRef.current || isComposingNativeEvent(e.nativeEvent)) return;
      clearSearchDebounce();
      doSearch(localQuery);
    },
    [clearSearchDebounce, localQuery, doSearch],
  );

  const handleDesktopSearchToggle = useCallback(() => {
    clearSearchDebounce();
    desktopSearchCompositionRef.current = false;
    setDesktopSearchOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) {
        setDesktopSearchDraft(localQuery);
      }
      return nextOpen;
    });
  }, [clearSearchDebounce, localQuery]);

  const handleDesktopSearchDraftChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setDesktopSearchDraft(clampSearchInput(e.currentTarget.value));
  }, []);

  const handleDesktopSearchDraftInput = useCallback((e: FormEvent<HTMLInputElement>) => {
    setDesktopSearchDraft(clampSearchInput(e.currentTarget.value));
  }, []);

  const handleDesktopSearchCompositionStart = useCallback(() => {
    desktopSearchCompositionRef.current = true;
  }, []);

  const handleDesktopSearchCompositionUpdate = useCallback((e: CompositionEvent<HTMLInputElement>) => {
    setDesktopSearchDraft(clampSearchInput(e.currentTarget.value));
  }, []);

  const handleDesktopSearchCompositionEnd = useCallback((e: CompositionEvent<HTMLInputElement>) => {
    desktopSearchCompositionRef.current = false;
    setDesktopSearchDraft(clampSearchInput(e.currentTarget.value));
  }, []);

  const handleDesktopSearchKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        desktopSearchCompositionRef.current = false;
        setDesktopSearchOpen(false);
        return;
      }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (desktopSearchCompositionRef.current || isComposingNativeEvent(e.nativeEvent)) return;
      clearSearchDebounce();
      const query = normalizeHomeSearchQuery(desktopSearchDraft);
      setDesktopSearchDraft(query);
      doSearch(query);
      setDesktopSearchOpen(false);
    },
    [clearSearchDebounce, desktopSearchDraft, doSearch],
  );

  const handleDesktopSearchClear = useCallback(() => {
    desktopSearchCompositionRef.current = false;
    const activeQuery = normalizeHomeSearchQuery(localQuery);
    const draftQuery = normalizeHomeSearchQuery(desktopSearchDraft);
    setDesktopSearchDraft('');
    if (activeQuery && activeQuery === draftQuery) doSearch('');
  }, [desktopSearchDraft, doSearch, localQuery]);

  const handleDesktopSearchSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (desktopSearchCompositionRef.current || isComposingNativeEvent(e.nativeEvent)) return;
      clearSearchDebounce();
      const query = normalizeHomeSearchQuery(desktopSearchDraft);
      setDesktopSearchDraft(query);
      doSearch(query);
      setDesktopSearchOpen(false);
    },
    [clearSearchDebounce, desktopSearchDraft, doSearch],
  );

  const handleUploaded = useCallback(() => {
    mutate((key) => typeof key === 'string' && key.startsWith('/models'));
  }, []);

  const handleProtectedNavClick = useCallback(
    (event: ReactMouseEvent, path: string) => {
      handleProtectedLinkClick(event, path);
    },
    [handleProtectedLinkClick],
  );

  const isNavActive = useCallback(
    (path: string) => {
      if (path === '/') return location.pathname === '/';
      return location.pathname === path || location.pathname.startsWith(`${path}/`);
    },
    [location.pathname],
  );

  const renderBrand = (className: string) => (
    <Link
      to="/"
      onClick={(e) => {
        if (location.pathname === '/') {
          e.preventDefault();
          // 已在首页：点 logo = 回到首页初始状态（清搜索 + 分类回「全部」+ 第 1 页）
          handleClearSearch();
          dispatchHomeBrowseReset();
          requestAnimationFrame(() => {
            const scroller =
              document.querySelector<HTMLElement>('.home-scroll-container') ||
              document.querySelector<HTMLElement>('main.overflow-y-auto');
            if (scroller && scroller.scrollTop > 0) {
              scroller.scrollTo({ top: 0, behavior: 'smooth' });
            }
          });
        }
      }}
      className={className}
    >
      <BrandMark size="nav" className="w-full" eagerLoad />
    </Link>
  );

  const renderSearch = (
    className: string,
    inputRef?: Ref<HTMLInputElement>,
    placeholder = t('topNav.searchModelsAndSpecs'),
  ) => (
    <SearchField
      formProps={{ onSubmit: handleSearchSubmit }}
      inputProps={{
        value: localQuery,
        onChange: handleSearchChange,
        onInput: handleSearchInput,
        onCompositionStart: handleSearchCompositionStart,
        onCompositionUpdate: handleSearchCompositionUpdate,
        onCompositionEnd: handleSearchCompositionEnd,
        onKeyDown: handleSearchKeyDown,
        maxLength: HOME_SEARCH_MAX_LENGTH,
        enterKeyHint: 'search',
        autoComplete: 'off',
        spellCheck: false,
      }}
      inputRef={inputRef}
      value={localQuery}
      onClear={handleClearSearch}
      placeholder={placeholder}
      className={className}
    />
  );
  const renderToolbarTooltip = (children: ReactNode, text: string) =>
    showDesktopTooltips ? (
      <Tooltip text={text} side="bottom">
        {children}
      </Tooltip>
    ) : (
      <>{children}</>
    );

  const desktopSearchTool =
    ThemePackage.chrome.desktopSearch.placement === 'toolbar' ? (
      <div ref={desktopSearchRef} className="relative">
        {renderToolbarTooltip(
          <button
            type="button"
            onClick={handleDesktopSearchToggle}
            className={`flex h-9 w-9 items-center justify-center rounded-[0.625rem] transition-colors ${
              desktopSearchOpen
                ? 'bg-primary-container/12 text-primary-container'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
            }`}
            aria-label={t('common.search')}
            aria-expanded={desktopSearchOpen}
            data-tooltip-ignore
          >
            <Icon name="search" size={20} />
          </button>,
          t('common.search'),
        )}
        <AnimatePresence>
          {desktopSearchOpen ? (
            <motion.form
              key="top-nav-toolbar-search"
              onSubmit={handleDesktopSearchSubmit}
              className="top-nav-search-panel absolute right-0 top-[calc(100%+0.625rem)] z-[110] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-outline-variant/14 bg-surface/95 p-2 text-on-surface shadow-dropdown backdrop-blur-xl"
              role="search"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              <div className="top-nav-search-panel-field flex h-11 items-center gap-2 rounded-xl border border-outline-variant/18 bg-surface-container-lowest px-3 transition-colors focus-within:border-primary-container/60">
                <Icon name="search" size={17} className="shrink-0 text-on-surface-variant/65" />
                <input
                  ref={desktopSearchInputRef}
                  type="text"
                  value={desktopSearchDraft}
                  onChange={handleDesktopSearchDraftChange}
                  onInput={handleDesktopSearchDraftInput}
                  onCompositionStart={handleDesktopSearchCompositionStart}
                  onCompositionUpdate={handleDesktopSearchCompositionUpdate}
                  onCompositionEnd={handleDesktopSearchCompositionEnd}
                  onKeyDown={handleDesktopSearchKeyDown}
                  maxLength={HOME_SEARCH_MAX_LENGTH}
                  enterKeyHint="search"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('topNav.searchModelsAndSpecs')}
                  className="h-full min-w-0 flex-1 appearance-none border-none bg-transparent p-0 text-[0.875rem] text-on-surface outline-none placeholder:text-on-surface-variant/45"
                />
                {desktopSearchDraft ? (
                  <button
                    type="button"
                    onClick={handleDesktopSearchClear}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                    aria-label={t('topNav.clearSearch')}
                  >
                    <Icon name="close" size={14} />
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-primary-container transition-colors hover:bg-primary-container/10"
                  aria-label={t('common.search')}
                >
                  <Icon name="arrow_forward" size={15} />
                </button>
              </div>
            </motion.form>
          ) : null}
        </AnimatePresence>
      </div>
    ) : null;

  const desktopTools = (
    <>
      {isAdmin &&
        renderToolbarTooltip(
          <button
            onClick={() => setUploadOpen(true)}
            onPointerEnter={preloadUploadModal}
            onPointerDown={preloadUploadModal}
            onFocus={preloadUploadModal}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors"
            aria-label={t('topNav.uploadModel')}
          >
            <Icon name="cloud_upload" size={20} />
          </button>,
          t('topNav.uploadModel'),
        )}
      {desktopSearchTool}
      <NotificationPanelLoader onLoginClick={() => openAuthEntry(getReturnPath())} showTooltip={showDesktopTooltips} />
      <ThemeToggle
        showTooltip={showDesktopTooltips}
        showInterfaceThemePreference={isAdminRoute || isUserInterfaceThemeEnabled(settings)}
        interfaceThemeScope={isAdminRoute ? 'admin' : 'public'}
        settings={settings}
      />
      <UserMenu
        adminDefaultPath={adminDefaultPath}
        settings={settings}
        onLoginClick={() => openAuthEntry(getReturnPath())}
        onLoginRequired={(reason, returnUrl) => {
          openLoginPrompt(reason, returnUrl);
        }}
      />
    </>
  );

  const showMobileModelSearch = location.pathname === '/' || isModelDetailPath(location.pathname);

  if (compact) {
    return (
      <>
        <header
          className="bg-surface-container-low border-b border-surface-container-highest shrink-0 z-[250]"
          data-app-top-nav={source}
        >
          {/* Safe area spacer — keeps Logo and icons clickable */}
          <div style={{ height: 'env(safe-area-inset-top, 0px)' }} />
          <div className="flex h-12 items-center gap-1 px-3">
            <button
              onClick={() => onMenuToggle?.()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-primary-container transition-colors hover:bg-surface-container-high hover:text-on-surface"
              aria-label={t('topNav.menu')}
              data-tooltip-ignore
            >
              <Icon name="menu" size={22} />
            </button>
            <Link
              to="/"
              onClick={(e) => {
                if (location.pathname === '/') {
                  e.preventDefault();
                  // 已在首页：点 logo = 回到首页初始状态（清搜索 + 分类回「全部」+ 第 1 页）
                  handleClearSearch();
                  dispatchHomeBrowseReset();
                  requestAnimationFrame(() => {
                    const scroller =
                      document.querySelector<HTMLElement>('.home-scroll-container') ||
                      document.querySelector<HTMLElement>('main.overflow-y-auto');
                    if (scroller && scroller.scrollTop > 0) {
                      scroller.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  });
                }
              }}
              className="flex h-9 min-w-0 flex-1 items-center rounded-sm active:opacity-60 transition-opacity duration-100"
            >
              <BrandMark size="compact" eagerLoad />
            </Link>
            <div className="ml-auto flex h-9 shrink-0 items-center gap-0.5">
              <NotificationPanelLoader compact onLoginClick={() => openAuthEntry(getReturnPath())} />
              <ThemeToggle settings={settings} />
              <UserMenu
                size="compact"
                adminDefaultPath={adminDefaultPath}
                settings={settings}
                onLoginClick={() => openAuthEntry(getReturnPath())}
                onLoginRequired={(reason, returnUrl) => {
                  openLoginPrompt(reason, returnUrl);
                }}
              />
            </div>
          </div>
          {showMobileModelSearch && (
            <div className="px-3 pb-2">
              <SearchField
                formProps={{ onSubmit: handleSearchSubmit }}
                inputProps={{
                  value: localQuery,
                  onChange: handleSearchChange,
                  onInput: handleSearchInput,
                  onCompositionStart: handleSearchCompositionStart,
                  onCompositionUpdate: handleSearchCompositionUpdate,
                  onCompositionEnd: handleSearchCompositionEnd,
                  onKeyDown: handleSearchKeyDown,
                  maxLength: HOME_SEARCH_MAX_LENGTH,
                  enterKeyHint: 'search',
                  autoComplete: 'off',
                  spellCheck: false,
                }}
                value={localQuery}
                onClear={handleClearSearch}
                placeholder={t('topNav.searchModels')}
                className="!h-10 !rounded-sm !px-2.5"
                inputClassName="!text-base"
              />
            </div>
          )}
        </header>
        <UploadModalLoader open={uploadOpen} onClose={() => setUploadOpen(false)} onConverted={handleUploaded} />
        {authNodes}
      </>
    );
  }

  return (
    <>
      <ThemeTopNav
        source={source}
        userNavItems={userNavItems}
        adminNavItems={adminNavItems}
        topNavItems={topNavItems}
        isAdmin={isAdmin}
        isWideDesktop={isWideDesktop}
        isVeryWideDesktop={isVeryWideDesktop}
        renderBrand={renderBrand}
        renderSearch={renderSearch}
        tools={desktopTools}
        isNavActive={isNavActive}
        onNavClick={handleProtectedNavClick}
      />
      <UploadModalLoader open={uploadOpen} onClose={() => setUploadOpen(false)} onConverted={handleUploaded} />
      {authNodes}
    </>
  );
}
