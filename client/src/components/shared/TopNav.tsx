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
  type Ref,
} from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { mutate } from 'swr';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import { getBusinessConfig } from '../../lib/businessConfig';
import {
  HOME_SEARCH_EVENT,
  HOME_SEARCH_MAX_LENGTH,
  dispatchHomeSearchQuery,
  normalizeHomeSearchQuery,
  readHomeSearchQuery,
  saveHomeSearchQuery,
  type HomeSearchEventDetail,
} from '../../lib/homeSearchState';
import { isModelDetailPath } from '../../lib/modelReturnPath';
import { onSiteConfigChange, usePublicSettings } from '../../lib/publicSettings';
import { preloadRouteForPath } from '../../lib/routeLoaders';
import { useAuthStore } from '../../stores/useAuthStore';
import { useThemeStore } from '../../stores/useThemeStore';
import { getInterfaceThemePackage } from '../../themes/interfaceThemes/registry';
import AuthModal from './AuthModal';
import BrandMark from './BrandMark';
import Icon from './Icon';
import LoginConfirmDialog from './LoginConfirmDialog';
import { loadNotificationPanel, scheduleNotificationPanelPreload } from './preloadNotificationPanel';
import { checkProtectedAccess } from './ProtectedLink';
import SearchField from './SearchField';
import Tooltip from './Tooltip';

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

function NotificationPanelLoader({ compact = false }: { compact?: boolean }) {
  return (
    <Suspense fallback={<NotificationPanelFallback compact={compact} />}>
      <NotificationPanel compact={compact} />
    </Suspense>
  );
}

function NotificationPanelFallback({ compact = false }: { compact?: boolean }) {
  if (!useAuthStore.getState().isAuthenticated) {
    if (compact) {
      return (
        <button
          onPointerEnter={loadNotificationPanel}
          onPointerDown={loadNotificationPanel}
          onFocus={loadNotificationPanel}
          onClick={() => {
            window.location.href = '/login';
          }}
          className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
          aria-label="通知"
          title="登录后查看通知"
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
      aria-label="通知"
      data-tooltip="通知"
      data-tooltip-side="bottom"
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
}: {
  size?: 'compact' | 'default';
  onLoginRequired: (reason: string, returnUrl: string) => void;
  onLoginClick?: () => void;
  adminDefaultPath?: string;
}) {
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

  const menuItems = [
    {
      label: '个人中心',
      icon: 'person',
      path: '/profile',
    },
    {
      label: '修改密码',
      icon: 'lock',
      path: '/profile?tab=security',
    },
    {
      label: '下载历史',
      icon: 'download',
      path: '/downloads',
    },
    {
      label: '我的分享',
      icon: 'share',
      path: '/my-shares',
    },
  ];

  const isAdminUser = user?.role === 'ADMIN';

  if (!user) {
    return (
      <button onClick={onLoginClick || (() => navigate('/login'))} className={userMenuButtonClass}>
        <div className={`${avatarSize} rounded-full bg-surface-container-highest flex items-center justify-center`}>
          <Icon name="person" size={iconSize} className="text-on-surface-variant" />
        </div>
        {!isCompact && <span className="hidden md:inline text-sm text-on-surface-variant font-light">登录</span>}
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
      <button onClick={() => setOpen(!open)} className={userMenuButtonClass} aria-label="用户菜单" data-tooltip-ignore>
        <div className={`${avatarSize} rounded-full bg-surface-container-highest flex items-center justify-center`}>
          <Icon name="person" size={iconSize} className="text-on-surface-variant" />
        </div>
        {!isCompact && (
          <span className="hidden md:inline text-sm text-on-surface-variant font-light">
            {user?.username || '用户'}
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
            className={`absolute ${isCompact ? 'right-0' : 'right-0'} top-full pt-2 w-48 z-[100]`}
          >
            <div className="bg-surface-container-high border border-outline-variant/20 rounded-sm shadow-lg py-1">
              <div className="px-4 py-2.5 border-b border-outline-variant/15">
                <p className="text-sm font-medium text-on-surface truncate">{user?.username || '用户'}</p>
                <p className="text-xs text-on-surface-variant truncate mt-0.5">{user?.email || ''}</p>
              </div>
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    setOpen(false);
                    const result = checkProtectedAccess(item.path);
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
                  后台管理
                </button>
              )}
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-error hover:bg-error-container/10"
              >
                <Icon name="logout" size={18} />
                退出登录
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  return (
    <button
      onClick={toggleTheme}
      className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors"
      title={theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}
      aria-label={theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}
      data-tooltip={theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}
      data-tooltip-side="bottom"
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
  const [uploadOpen, setUploadOpen] = useState(false);
  const [desktopSearchOpen, setDesktopSearchOpen] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginReturnUrl, setLoginReturnUrl] = useState('');
  const [loginDialogReason, setLoginDialogReason] = useState('');
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogReturnUrl, setAuthDialogReturnUrl] = useState('');
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'ADMIN';
  const [searchParams] = useSearchParams();
  const [localQuery, setLocalQuery] = useState(() => readHomeSearchQuery() ?? searchParams.get('q') ?? '');
  const navigate = useNavigate();
  const location = useLocation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchCompositionRef = useRef(false);
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
  const { userNavItems, adminNavItems } = useMemo(() => {
    const business = getBusinessConfig(settings);
    return {
      userNavItems: business.userNav,
      adminNavItems: business.adminNav.filter((item) => item.path.startsWith('/admin/')),
    };
  }, [settings]);
  const topNavItems = useMemo(() => userNavItems.filter((item) => item.path !== '/'), [userNavItems]);
  const ThemePackage = getInterfaceThemePackage(settings?.interface_theme);
  const ThemeTopNav = ThemePackage.components.DesktopTopNav;
  const adminDefaultPath =
    ThemePackage.chrome.adminLayout.defaultPath?.({
      pathname: location.pathname,
      isAdminRoute: location.pathname === '/admin' || location.pathname.startsWith('/admin/'),
    }) || '/admin/models';

  const getReturnPath = useCallback(
    () => `${location.pathname}${location.search}${location.hash}`,
    [location.hash, location.pathname, location.search],
  );

  const openAuthDialog = useCallback(
    (nextReturnUrl?: string) => {
      setAuthDialogReturnUrl(nextReturnUrl || getReturnPath());
      setAuthDialogOpen(true);
    },
    [getReturnPath],
  );

  useEffect(() => {
    if (!desktopSearchOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!desktopSearchRef.current?.contains(event.target as Node)) {
        setDesktopSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [desktopSearchOpen]);

  useEffect(() => {
    if (!desktopSearchOpen) return;
    requestAnimationFrame(() => desktopSearchInputRef.current?.focus());
  }, [desktopSearchOpen]);

  useEffect(() => {
    setDesktopSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const stored = readHomeSearchQuery();
    setLocalQuery(stored ?? searchParams.get('q') ?? '');
  }, [searchParams]);

  useEffect(() => {
    const handleSearchEvent = (event: Event) => {
      const detail = (event as CustomEvent<HomeSearchEventDetail>).detail;
      if (!detail || typeof detail.query !== 'string') return;
      setLocalQuery(detail.query);
    };
    window.addEventListener(HOME_SEARCH_EVENT, handleSearchEvent);
    return () => window.removeEventListener(HOME_SEARCH_EVENT, handleSearchEvent);
  }, []);

  const doSearch = useCallback(
    (value: string) => {
      const query = normalizeHomeSearchQuery(value);
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
      setDesktopSearchOpen(false);
    },
    [clearSearchDebounce, localQuery, doSearch],
  );

  const handleUploaded = useCallback(() => {
    mutate((key) => typeof key === 'string' && key.startsWith('/models'));
  }, []);

  const handleProtectedNavClick = useCallback(
    (event: ReactMouseEvent, path: string) => {
      const result = checkProtectedAccess(path);
      if (result.action === 'dialog') {
        event.preventDefault();
        setLoginReturnUrl(result.returnUrl);
        setLoginDialogReason(result.reason);
        setLoginDialogOpen(true);
      } else if (result.action === 'redirect') {
        event.preventDefault();
        openAuthDialog(result.returnUrl);
      }
    },
    [openAuthDialog],
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
          handleClearSearch();
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

  const renderSearch = (className: string, inputRef?: Ref<HTMLInputElement>, placeholder = '搜索模型、规格...') => (
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

  const desktopSearchTool =
    ThemePackage.chrome.desktopSearch.placement === 'toolbar' ? (
      <div ref={desktopSearchRef} className="relative">
        <Tooltip text="搜索" side="bottom">
          <button
            type="button"
            onClick={() => setDesktopSearchOpen((value) => !value)}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors"
            aria-label="搜索"
            aria-haspopup="dialog"
            aria-expanded={desktopSearchOpen}
          >
            <Icon name="search" size={20} />
          </button>
        </Tooltip>
        <AnimatePresence>
          {desktopSearchOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className="absolute right-0 top-full z-[110] pt-2"
            >
              <div className="w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-outline-variant/16 bg-surface p-2 shadow-lg">
                {renderSearch(
                  '!h-10 !rounded-lg !border-outline-variant/25 !bg-surface-container-lowest',
                  desktopSearchInputRef,
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    ) : null;

  const desktopTools = (
    <>
      {isAdmin && (
        <Tooltip text="上传模型" side="bottom">
          <button
            onClick={() => setUploadOpen(true)}
            onPointerEnter={preloadUploadModal}
            onPointerDown={preloadUploadModal}
            onFocus={preloadUploadModal}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors"
          >
            <Icon name="cloud_upload" size={20} />
          </button>
        </Tooltip>
      )}
      {desktopSearchTool}
      <NotificationPanelLoader />
      <ThemeToggle />
      <UserMenu
        adminDefaultPath={adminDefaultPath}
        onLoginClick={() => openAuthDialog(getReturnPath())}
        onLoginRequired={(reason, returnUrl) => {
          setLoginReturnUrl(returnUrl);
          setLoginDialogReason(reason);
          setLoginDialogOpen(true);
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
              aria-label="打开菜单"
              data-tooltip-ignore
            >
              <Icon name="menu" size={22} />
            </button>
            <Link
              to="/"
              onClick={(e) => {
                if (location.pathname === '/') {
                  e.preventDefault();
                  handleClearSearch();
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
              <NotificationPanelLoader compact />
              <ThemeToggle />
              <UserMenu
                size="compact"
                adminDefaultPath={adminDefaultPath}
                onLoginClick={() => openAuthDialog(getReturnPath())}
                onLoginRequired={(reason, returnUrl) => {
                  setLoginReturnUrl(returnUrl);
                  setLoginDialogReason(reason);
                  setLoginDialogOpen(true);
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
                placeholder="搜索模型..."
                className="!h-10 !rounded-sm !px-2.5"
                inputClassName="!text-base"
              />
            </div>
          )}
        </header>
        <UploadModalLoader open={uploadOpen} onClose={() => setUploadOpen(false)} onConverted={handleUploaded} />
        <LoginConfirmDialog
          open={loginDialogOpen}
          onClose={() => setLoginDialogOpen(false)}
          reason={loginDialogReason}
          returnUrl={loginReturnUrl}
          onLogin={() => openAuthDialog(loginReturnUrl || getReturnPath())}
        />
        <AuthModal open={authDialogOpen} onClose={() => setAuthDialogOpen(false)} returnUrl={authDialogReturnUrl} />
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
      <LoginConfirmDialog
        open={loginDialogOpen}
        onClose={() => setLoginDialogOpen(false)}
        reason={loginDialogReason}
        returnUrl={loginReturnUrl}
        onLogin={() => openAuthDialog(loginReturnUrl || getReturnPath())}
      />
      <AuthModal open={authDialogOpen} onClose={() => setAuthDialogOpen(false)} returnUrl={authDialogReturnUrl} />
    </>
  );
}
