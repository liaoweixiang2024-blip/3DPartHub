import { motion, AnimatePresence } from 'framer-motion';
import {
  lazy,
  Suspense,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ChangeEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { mutate } from 'swr';
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
import { onSiteConfigChange, getCachedPublicSettings } from '../../lib/publicSettings';
import { useAuthStore } from '../../stores/useAuthStore';
import { useThemeStore } from '../../stores/useThemeStore';
import BrandMark from './BrandMark';
import Icon from './Icon';
import LoginConfirmDialog from './LoginConfirmDialog';
import Tooltip from './Tooltip';
import NotificationPanel from './NotificationPanel';
import { checkProtectedAccess } from './ProtectedLink';

const UploadModal = lazy(() => import('./UploadModal'));

interface TopNavProps {
  compact?: boolean;
  onMenuToggle?: () => void;
}

function clampSearchInput(value: string) {
  return Array.from(value).slice(0, HOME_SEARCH_MAX_LENGTH).join('');
}

function isComposingNativeEvent(event: Event) {
  return Boolean((event as Event & { isComposing?: boolean }).isComposing);
}

function NotificationPanelLoader({ compact = false }: { compact?: boolean }) {
  return <NotificationPanel compact={compact} />;
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
}: {
  size?: 'compact' | 'default';
  onLoginRequired: (reason: string, returnUrl: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuthStore();
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
      <button
        onClick={() => navigate('/login')}
        className={`flex items-center gap-2 cursor-pointer ${compactButtonClass} ${isCompact ? '' : 'ml-2'}`}
      >
        <div className={`${avatarSize} rounded-full bg-surface-container-highest flex items-center justify-center`}>
          <Icon name="person" size={iconSize} className="text-on-surface-variant" />
        </div>
        {!isCompact && <span className="hidden md:inline text-sm text-on-surface-variant font-light">登录</span>}
      </button>
    );
  }

  return (
    <div className="relative" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 cursor-pointer ${compactButtonClass} ${isCompact ? '' : 'ml-2'}`}
        aria-label="用户菜单"
        data-tooltip-ignore
      >
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
                    navigate('/admin/models');
                  }}
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
  const { theme, toggleTheme } = useThemeStore();
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

export default function TopNav({ compact = false, onMenuToggle }: TopNavProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginReturnUrl, setLoginReturnUrl] = useState('');
  const [loginDialogReason, setLoginDialogReason] = useState('');
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  const [searchParams] = useSearchParams();
  const [localQuery, setLocalQuery] = useState(() => readHomeSearchQuery() ?? searchParams.get('q') ?? '');
  const navigate = useNavigate();
  const location = useLocation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchCompositionRef = useRef(false);
  // Force re-render when site config changes
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    return onSiteConfigChange(() => forceUpdate((n) => n + 1));
  }, []);
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
  const topNavItems = useMemo(() => {
    const business = getBusinessConfig(settings);
    return business.userNav.filter((item) => item.path !== '/');
  }, [settings]);

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
      }, 500);
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

  const handleUploaded = useCallback(() => {
    mutate((key) => typeof key === 'string' && key.startsWith('/models'));
  }, []);

  const desktopIconClass =
    'p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors';

  if (compact) {
    return (
      <>
        <header className="bg-surface-container-low border-b border-surface-container-highest shrink-0 z-[250]">
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
                  window.location.reload();
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
                onLoginRequired={(reason, returnUrl) => {
                  setLoginReturnUrl(returnUrl);
                  setLoginDialogReason(reason);
                  setLoginDialogOpen(true);
                }}
              />
            </div>
          </div>
          <div className="px-3 pb-2">
            <form
              onSubmit={handleSearchSubmit}
              className="flex h-10 items-center overflow-hidden bg-surface-container-lowest rounded-sm px-2.5 border border-outline-variant/30 focus-within:ring-1 focus-within:ring-primary-container transition-colors"
            >
              <Icon name="search" size={16} className="text-on-surface-variant mr-2 shrink-0" />
              <input
                type="text"
                value={localQuery}
                onChange={handleSearchChange}
                onInput={handleSearchInput}
                onCompositionStart={handleSearchCompositionStart}
                onCompositionUpdate={handleSearchCompositionUpdate}
                onCompositionEnd={handleSearchCompositionEnd}
                onKeyDown={handleSearchKeyDown}
                maxLength={HOME_SEARCH_MAX_LENGTH}
                enterKeyHint="search"
                autoComplete="off"
                spellCheck={false}
                placeholder="搜索模型..."
                className="h-full min-w-0 flex-1 appearance-none border-none bg-transparent p-0 text-base leading-none text-on-surface outline-none placeholder:text-on-surface-variant/50"
              />
              {localQuery && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="p-0.5 text-on-surface-variant hover:text-on-surface shrink-0"
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </form>
          </div>
        </header>
        <UploadModalLoader open={uploadOpen} onClose={() => setUploadOpen(false)} onConverted={handleUploaded} />
        <LoginConfirmDialog
          open={loginDialogOpen}
          onClose={() => setLoginDialogOpen(false)}
          reason={loginDialogReason}
          returnUrl={loginReturnUrl}
        />
      </>
    );
  }

  return (
    <>
      <header className="h-14 flex items-center bg-surface-container-low border-b border-outline-variant/10 shrink-0 z-50">
        <Link
          to="/"
          onClick={(e) => {
            if (location.pathname === '/') {
              e.preventDefault();
              window.location.reload();
            }
          }}
          className="flex w-56 shrink-0 cursor-pointer items-center px-5 transition-[opacity,transform] hover:opacity-80 active:scale-95"
        >
          <BrandMark size="nav" className="w-full" eagerLoad />
        </Link>

        <form
          onSubmit={handleSearchSubmit}
          className="hidden h-9 md:flex items-center flex-1 max-w-lg bg-surface-container-lowest rounded-lg px-3 border border-outline-variant/20 focus-within:ring-1 focus-within:ring-primary-container transition-colors"
        >
          <Icon name="search" size={16} className="text-on-surface-variant mr-2 shrink-0" />
          <input
            type="text"
            value={localQuery}
            onChange={handleSearchChange}
            onInput={handleSearchInput}
            onCompositionStart={handleSearchCompositionStart}
            onCompositionUpdate={handleSearchCompositionUpdate}
            onCompositionEnd={handleSearchCompositionEnd}
            onKeyDown={handleSearchKeyDown}
            maxLength={HOME_SEARCH_MAX_LENGTH}
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="搜索模型、规格..."
            className="h-full min-w-0 flex-1 appearance-none border-none bg-transparent p-0 text-sm leading-none text-on-surface outline-none placeholder:text-on-surface-variant/50"
          />
          {localQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="p-0.5 text-on-surface-variant hover:text-on-surface shrink-0"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </form>

        <div className="flex items-center gap-0.5 shrink-0 ml-auto pr-6">
          {topNavItems.map((item) => (
            <Tooltip key={item.path} text={item.label} side="bottom">
              <Link
                to={item.path}
                className={desktopIconClass}
                onClick={(e) => {
                  const result = checkProtectedAccess(item.path);
                  if (result.action === 'dialog') {
                    e.preventDefault();
                    setLoginReturnUrl(result.returnUrl);
                    setLoginDialogReason(result.reason);
                    setLoginDialogOpen(true);
                  } else if (result.action === 'redirect') {
                    e.preventDefault();
                    navigate('/login', { state: { from: result.returnUrl } });
                  }
                }}
              >
                <Icon name={item.icon} size={20} />
              </Link>
            </Tooltip>
          ))}
          {isAdmin && (
            <Tooltip text="上传模型" side="bottom">
              <button
                onClick={() => setUploadOpen(true)}
                className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors"
              >
                <Icon name="cloud_upload" size={20} />
              </button>
            </Tooltip>
          )}
          <NotificationPanelLoader />
          <ThemeToggle />
          <UserMenu
            onLoginRequired={(reason, returnUrl) => {
              setLoginReturnUrl(returnUrl);
              setLoginDialogReason(reason);
              setLoginDialogOpen(true);
            }}
          />
        </div>
      </header>
      <UploadModalLoader open={uploadOpen} onClose={() => setUploadOpen(false)} onConverted={handleUploaded} />
      <LoginConfirmDialog
        open={loginDialogOpen}
        onClose={() => setLoginDialogOpen(false)}
        reason={loginDialogReason}
        returnUrl={loginReturnUrl}
      />
    </>
  );
}
