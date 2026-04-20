import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useCallback, useEffect, useRef } from "react";
import { useThemeStore } from "../../stores/useThemeStore";
import { useAuthStore } from "../../stores/useAuthStore";
import { mutate } from "swr";
import UploadModal from "./UploadModal";
import NotificationPanel from "./NotificationPanel";
import Icon from "./Icon";
import Tooltip from "./Tooltip";
import { getSiteTitle, getSiteLogo, getLogoDisplayMode, onSiteConfigChange } from "../../lib/publicSettings";

interface TopNavProps {
  compact?: boolean;
  onMenuToggle?: () => void;
}

function UserMenu({ size = 'default' }: { size?: 'compact' | 'default' }) {
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

  const menuItems = [
    { label: '个人中心', icon: 'person', onClick: () => { setOpen(false); navigate('/profile'); } },
    { label: '修改密码', icon: 'lock', onClick: () => { setOpen(false); navigate('/profile?tab=security'); } },
    { label: '下载历史', icon: 'download', onClick: () => { setOpen(false); navigate('/downloads'); } },
    { label: '退出登录', icon: 'logout', onClick: handleLogout, danger: true },
  ];

  if (!user) {
    return (
      <button
        onClick={() => navigate('/login')}
        className={`flex items-center gap-2 cursor-pointer ${isCompact ? '' : 'ml-2'}`}
      >
        <div className={`${avatarSize} rounded-full bg-surface-container-highest flex items-center justify-center`}>
          <Icon name="person" size={iconSize} className="text-on-surface-variant" />
        </div>
        {!isCompact && (
          <span className="hidden md:inline text-sm text-on-surface-variant font-light">登录</span>
        )}
      </button>
    );
  }

  return (
    <div
      className="relative"
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 cursor-pointer ${isCompact ? '' : 'ml-2'}`}
        aria-label="用户菜单"
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
                onClick={item.onClick}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  'danger' in item
                    ? 'text-error hover:bg-error-container/10'
                    : 'text-on-surface hover:bg-surface-container-highest'
                }`}
              >
                <Icon name={item.icon} size={18} />
                {item.label}
              </button>
            ))}
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
      className="p-2 text-on-surface-variant hover:text-on-surface transition-colors rounded-sm hover:bg-surface-container-high"
      title={theme === "dark" ? "切换亮色模式" : "切换暗色模式"}
      aria-label={theme === "dark" ? "切换亮色模式" : "切换暗色模式"}
    >
      <AnimatePresence mode="wait">
        <motion.span
          key={theme}
          initial={{ rotate: -90, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          exit={{ rotate: 90, opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: "block" }}
        >
          <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} size={24} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

export default function TopNav({ compact = false, onMenuToggle }: TopNavProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN";
  const [searchParams, setSearchParams] = useSearchParams();
  const [localQuery, setLocalQuery] = useState(searchParams.get("q") || "");
  const navigate = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  // Force re-render when site config changes
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    return onSiteConfigChange(() => forceUpdate(n => n + 1));
  }, []);

  useEffect(() => {
    const q = searchParams.get("q") || "";
    setLocalQuery(q);
  }, [searchParams]);

  const doSearch = useCallback((value: string) => {
    if (window.location.pathname === "/") {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) {
          next.set("q", value);
        } else {
          next.delete("q");
        }
        return next;
      }, { replace: true });
    } else {
      navigate(`/?q=${encodeURIComponent(value)}`);
    }
  }, [setSearchParams, navigate]);

  const handleSearchChange = useCallback((value: string) => {
    setLocalQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) return;
    debounceRef.current = setTimeout(() => {
      doSearch(value);
    }, 500);
  }, [doSearch]);

  const handleSearchSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSearch(localQuery);
  }, [localQuery, doSearch]);

  const handleUploaded = useCallback(() => {
    mutate((key) => typeof key === "string" && key.startsWith("/models"));
  }, []);

  if (compact) {
    return (
      <>
        <header className="bg-surface-container-low border-b border-surface-container-highest shrink-0 z-50">
          <div className="h-11 flex items-center justify-between px-3">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                onClick={() => onMenuToggle?.()}
                className="p-1 text-[#f97316] hover:text-on-surface transition-colors"
                aria-label="打开菜单"
              >
                <Icon name="menu" size={22} />
              </button>
              <Link to="/" className="flex items-center gap-1.5 min-w-0">
                {getLogoDisplayMode() !== 'title_only' && getSiteLogo() ? (
                  <img src={getSiteLogo()} alt="" className={`${getLogoDisplayMode() === 'logo_only' ? 'h-5 max-w-[100px]' : 'h-4 max-w-[64px]'} shrink-0 object-contain`} />
                ) : getLogoDisplayMode() !== 'title_only' ? (
                  <Icon name="precision_manufacturing" size={20} className="text-orange-500 shrink-0" />
                ) : null}
                {getLogoDisplayMode() !== 'logo_only' && (
                  <span className="font-headline font-bold text-on-surface text-xs tracking-tighter truncate">{getSiteTitle()}</span>
                )}
              </Link>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <NotificationPanel compact />
              <ThemeToggle />
              <UserMenu size="compact" />
            </div>
          </div>
          <div className="px-3 pb-2">
            <form onSubmit={handleSearchSubmit} className="flex items-center bg-surface-container-lowest rounded-sm px-2.5 py-1.5 border border-outline-variant/30 focus-within:ring-1 focus-within:ring-primary-container transition-all">
              <Icon name="search" size={16} className="text-on-surface-variant mr-2 shrink-0" />
              <input
                type="text"
                value={localQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="搜索模型..."
                className="bg-transparent border-none outline-none text-sm text-on-surface placeholder:text-on-surface-variant/50 w-full"
              />
              {localQuery && (
                <button type="button" onClick={() => { setLocalQuery(""); doSearch(""); }} className="p-0.5 text-on-surface-variant hover:text-on-surface shrink-0">
                  <Icon name="close" size={14} />
                </button>
              )}
            </form>
          </div>
        </header>
        <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onConverted={handleUploaded} />
      </>
    );
  }

  const displayMode = getLogoDisplayMode();
  const siteLogo = getSiteLogo();
  const siteTitle = getSiteTitle();

  return (
    <>
      <header className="h-14 flex items-center bg-surface-container-low border-b border-outline-variant/10 shrink-0 z-50">
        <Link to="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity shrink-0 w-56 pl-6 pr-2">
          {displayMode !== 'title_only' && siteLogo ? (
            <img
              src={siteLogo}
              alt={siteTitle}
              className={`${displayMode === 'logo_only' ? 'h-8 max-w-[160px]' : 'h-7 max-w-[120px]'} object-contain`}
            />
          ) : displayMode !== 'title_only' && !siteLogo ? (
            <Icon name="view_in_ar" size={26} className="text-orange-500" />
          ) : null}
          {displayMode !== 'logo_only' && (
            <span className="text-sm font-headline font-bold tracking-tighter text-on-surface hidden sm:inline">{siteTitle}</span>
          )}
        </Link>

        <form onSubmit={handleSearchSubmit} className="hidden md:flex items-center flex-1 max-w-lg bg-surface-container-lowest rounded-lg px-3 py-1.5 border border-outline-variant/20 focus-within:ring-1 focus-within:ring-primary-container transition-all">
          <Icon name="search" size={16} className="text-on-surface-variant mr-2 shrink-0" />
          <input
            type="text"
            value={localQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="搜索模型、规格..."
            className="bg-transparent border-none outline-none text-sm text-on-surface placeholder:text-on-surface-variant/50 w-full"
          />
          {localQuery && (
            <button type="button" onClick={() => { setLocalQuery(""); doSearch(""); }} className="p-0.5 text-on-surface-variant hover:text-on-surface shrink-0">
              <Icon name="close" size={14} />
            </button>
          )}
        </form>

        <div className="flex items-center gap-0.5 shrink-0 ml-auto pr-6">
          {isAdmin && (
            <Tooltip text="后台设置" side="bottom">
              <Link to="/settings" className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors">
                <Icon name="settings" size={20} />
              </Link>
            </Tooltip>
          )}
          {isAdmin && (
            <Tooltip text="上传模型" side="bottom">
              <button onClick={() => setUploadOpen(true)} className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors">
                <Icon name="cloud_upload" size={20} />
              </button>
            </Tooltip>
          )}
          <Tooltip text="我的收藏" side="bottom">
            <Link to="/favorites" className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors">
              <Icon name="star" size={20} />
            </Link>
          </Tooltip>
          <Tooltip text="下载历史" side="bottom">
            <Link to="/downloads" className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors">
              <Icon name="download" size={20} />
            </Link>
          </Tooltip>
          <Tooltip text="我的工单" side="bottom">
            <Link to="/my-tickets" className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors">
              <Icon name="assignment_add" size={20} />
            </Link>
          </Tooltip>
          <Tooltip text="技术支持" side="bottom">
            <Link to="/support" className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors">
              <Icon name="support_agent" size={20} />
            </Link>
          </Tooltip>
          <NotificationPanel />
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onConverted={handleUploaded} />
    </>
  );
}
