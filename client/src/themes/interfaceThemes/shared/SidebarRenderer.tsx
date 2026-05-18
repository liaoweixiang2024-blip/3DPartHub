import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../../../components/shared/Icon';
import { useAuthEntry } from '../../../components/shared/useAuthEntry';
import { getBusinessConfig } from '../../../lib/businessConfig';
import { usePublicSettings } from '../../../lib/publicSettings';
import { preloadRouteForPath } from '../../../lib/routeLoaders';
import { useAuthStore } from '../../../stores/useAuthStore';

const footerNav = [
  { label: '个人设置', icon: 'settings', path: '/profile' },
  { label: '退出登录', icon: 'logout', path: '' },
];

export interface SidebarAppearance {
  rootClassName: string;
  navClassName: string;
  navIntroWrapperClassName?: string;
  navIntroLabelClassName?: string;
  navIntroLineClassName?: string;
  navIntroLabel?: string;
  topFadeWrapperClassName: (visible: boolean) => string;
  topFadeClassName: string;
  bottomFadeWrapperClassName: (visible: boolean) => string;
  bottomFadeClassName: string;
  sectionWrapperClassName: string;
  sectionLabelClassName: string;
  sectionLineClassName: string;
  itemClassName: (active: boolean) => string;
  itemLabelClassName: string;
  footerWrapperClassName: string;
  footerButtonClassName: string;
  iconSize: number;
}

interface SidebarRendererProps {
  appearance: SidebarAppearance;
  adminRouteMode?: 'all' | 'admin-only';
}

function isAdminRoutePath(path: string) {
  return path === '/admin' || path.startsWith('/admin/');
}

function isRouteActive(pathname: string, path: string) {
  return pathname === path || (path !== '/' && pathname.startsWith(`${path}/`));
}

export default function SidebarRenderer({ appearance, adminRouteMode = 'all' }: SidebarRendererProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const { settings } = usePublicSettings();
  const isAdmin = user?.role === 'ADMIN';
  const isAdminRoute = isAdminRoutePath(location.pathname);
  const { authNodes, handleProtectedLinkClick } = useAuthEntry(settings);
  const navItems = useMemo(() => {
    const business = getBusinessConfig(settings);
    if (!isAdmin) return business.userNav;
    if (adminRouteMode === 'admin-only' && isAdminRoute) {
      return business.adminNav.filter((item) => isAdminRoutePath(item.path));
    }
    return business.adminNav;
  }, [adminRouteMode, isAdmin, isAdminRoute, settings]);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState({ top: false, bottom: false });
  const showNavIntro = Boolean(appearance.navIntroLabel && !(adminRouteMode === 'admin-only' && isAdminRoute));

  const checkOverflow = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const next = {
      top: el.scrollTop > 4,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 4,
    };
    setOverflow((prev) => {
      if (prev.top === next.top && prev.bottom === next.bottom) return prev;
      return next;
    });
  }, []);

  useEffect(() => {
    checkOverflow();
    const el = navRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkOverflow);
    return () => el.removeEventListener('scroll', checkOverflow);
  }, [checkOverflow, navItems]);

  useEffect(() => {
    const el = activeRef.current;
    const container = navRef.current;
    if (!el || !container) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    if (eRect.top < cRect.top || eRect.bottom > cRect.bottom) {
      el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [location.pathname]);

  return (
    <aside className={appearance.rootClassName}>
      <div className={appearance.topFadeWrapperClassName(overflow.top)}>
        <div className={appearance.topFadeClassName} />
      </div>

      <nav ref={navRef} className={appearance.navClassName}>
        {showNavIntro && (
          <div className={appearance.navIntroWrapperClassName}>
            <span className={appearance.navIntroLabelClassName}>{appearance.navIntroLabel}</span>
            <div className={appearance.navIntroLineClassName} />
          </div>
        )}
        {navItems.map((item, idx) => {
          const isActive = isRouteActive(location.pathname, item.path);
          const isAdminPath = isAdminRoutePath(item.path);
          const showDivider = isAdmin && isAdminPath && !navItems.slice(0, idx).some((p) => isAdminRoutePath(p.path));
          return (
            <Fragment key={item.path}>
              {showDivider && (
                <div className={appearance.sectionWrapperClassName}>
                  <span className={appearance.sectionLabelClassName}>后台管理</span>
                  <div className={appearance.sectionLineClassName} />
                </div>
              )}
              <Link
                to={item.path}
                ref={isActive ? activeRef : undefined}
                className={appearance.itemClassName(isActive)}
                onPointerEnter={() => preloadRouteForPath(item.path)}
                onPointerDown={() => preloadRouteForPath(item.path)}
                onFocus={() => preloadRouteForPath(item.path)}
                onClick={(e) => handleProtectedLinkClick(e, item.path)}
              >
                <Icon name={item.icon} size={appearance.iconSize} />
                <span className={appearance.itemLabelClassName}>{item.label}</span>
              </Link>
            </Fragment>
          );
        })}
      </nav>

      <div className={appearance.bottomFadeWrapperClassName(overflow.bottom)}>
        <div className={appearance.bottomFadeClassName} />
      </div>

      <div className="px-3 mt-auto">
        {user && (
          <div className={appearance.footerWrapperClassName}>
            {footerNav.map((item) => {
              if (item.path === '') {
                return (
                  <button
                    key={item.label}
                    onClick={() => {
                      logout();
                      navigate('/login');
                    }}
                    className={appearance.footerButtonClassName}
                  >
                    <Icon name={item.icon} size={appearance.iconSize} />
                    <span className={appearance.itemLabelClassName}>{item.label}</span>
                  </button>
                );
              }
              const isActive =
                location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={appearance.itemClassName(isActive)}
                  onPointerEnter={() => preloadRouteForPath(item.path)}
                  onPointerDown={() => preloadRouteForPath(item.path)}
                  onFocus={() => preloadRouteForPath(item.path)}
                  onClick={(e) => handleProtectedLinkClick(e, item.path)}
                >
                  <Icon name={item.icon} size={appearance.iconSize} />
                  <span className={appearance.itemLabelClassName}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      {authNodes}
    </aside>
  );
}
