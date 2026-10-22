import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../../../components/shared/Icon';
import { checkProtectedAccess } from '../../../components/shared/ProtectedLink';
import { useAuthEntry } from '../../../components/shared/useAuthEntry';
import { localizeNavItems } from '../../../i18n/nav';
import { getBusinessConfig } from '../../../lib/businessConfig';
import { usePublicSettings } from '../../../lib/publicSettings';
import { preloadRouteForPath } from '../../../lib/routeLoaders';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useMobileDrawerStore } from '../../../stores/useMobileDrawerStore';

export interface MobileNavDrawerAppearance {
  overlayClassName: string;
  sheetClassName: string;
  headerClassName: string;
  titleClassName: string;
  closeButtonClassName: string;
  navClassName: string;
  itemClassName: (active: boolean) => string;
  footerClassName: string;
  footerLinkClassName: string;
  iconSize: number;
}

interface MobileNavDrawerRendererProps {
  appearance: MobileNavDrawerAppearance;
}

/**
 * 面板与遮罩均常驻挂载 + CSS transition 驱动：
 * - 常驻（关闭态 visibility:hidden 不参与绘制）→ 打开首帧零 DOM 构建/布局；
 * - CSS transition 在合成器线程独立运行，主线程再忙也不掉帧（framer-motion 等 JS 动画
 *   逐帧占用主线程，任何抖动都会让动画像降了刷新率）；
 * - visibility 参与 transition 时按离散插值规则整个过渡期保持 visible——打开立即可见、
 *   关闭等滑出动画播完才隐藏，无需手工 delay；
 * - 开合状态走 useMobileDrawerStore，点击入口时页面树零 re-render。
 */
const SHEET_TRANSITION = {
  open: 'transform 0.26s cubic-bezier(0.32, 0.72, 0, 1), visibility 0.26s',
  closed: 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1), visibility 0.22s',
} as const;

export default function MobileNavDrawerRenderer({ appearance }: MobileNavDrawerRendererProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const open = useMobileDrawerStore((s) => s.navOpen);
  const closeNav = useMobileDrawerStore((s) => s.closeNav);
  const { settings } = usePublicSettings();
  const isAdmin = user?.role === 'ADMIN';
  const business = getBusinessConfig(settings);
  const navItems = localizeNavItems(isAdmin ? business.adminNav : business.userNav, t, 'mobile');
  const { authNodes, handleProtectedLinkClick } = useAuthEntry(settings, { onBeforeAuth: closeNav });
  const asideRef = useRef<HTMLElement>(null);

  // 常驻挂载下关闭时焦点可能仍留在抽屉内链接/按钮上，aria 隐藏含焦点元素会被浏览器告警——
  // 主动移走焦点兜底（inert 自身也会清）
  useEffect(() => {
    const el = asideRef.current;
    if (!open && el && el.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }, [open]);

  return (
    <>
      {/* 遮罩常驻（opacity 切换 + 关闭态穿透点击） */}
      <div
        aria-hidden="true"
        onClick={closeNav}
        className={`${appearance.overlayClassName} transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <aside
        ref={asideRef}
        inert={!open}
        className={appearance.sheetClassName}
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          transform: open ? 'translate3d(0, 0, 0)' : 'translate3d(-100%, 0, 0)',
          visibility: open ? 'visible' : 'hidden',
          transition: open ? SHEET_TRANSITION.open : SHEET_TRANSITION.closed,
          willChange: 'transform',
        }}
        data-mobile-theme-drawer
      >
        <div className={appearance.headerClassName}>
          <span className={appearance.titleClassName}>{t('common.navigation')}</span>
          <button onClick={closeNav} className={appearance.closeButtonClassName}>
            <Icon name="close" size={24} />
          </button>
        </div>
        <nav className={appearance.navClassName}>
          {navItems.map((item) => {
            const isActive =
              location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.path}
                to={item.path}
                onPointerEnter={() => preloadRouteForPath(item.path)}
                onPointerDown={() => preloadRouteForPath(item.path)}
                onFocus={() => preloadRouteForPath(item.path)}
                onClick={(e) => {
                  const result = checkProtectedAccess(item.path, settings);
                  if (result.action === 'allow') {
                    closeNav();
                    return;
                  }
                  handleProtectedLinkClick(e, item.path);
                }}
                className={appearance.itemClassName(isActive)}
              >
                <Icon name={item.icon} size={appearance.iconSize} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        {user && (
          <div className={appearance.footerClassName}>
            <Link
              to="/profile"
              onPointerEnter={() => preloadRouteForPath('/profile')}
              onPointerDown={() => preloadRouteForPath('/profile')}
              onFocus={() => preloadRouteForPath('/profile')}
              onClick={(e) => {
                const result = checkProtectedAccess('/profile', settings);
                if (result.action === 'allow') {
                  closeNav();
                  return;
                }
                handleProtectedLinkClick(e, '/profile');
              }}
              className={appearance.footerLinkClassName}
            >
              <Icon name="settings" size={appearance.iconSize} />
              {t('nav.profileSettings')}
            </Link>
            <button
              onClick={() => {
                logout();
                closeNav();
                navigate('/login');
              }}
              className={appearance.footerLinkClassName}
            >
              <Icon name="logout" size={appearance.iconSize} />
              {t('common.logout')}
            </button>
          </div>
        )}
      </aside>
      {authNodes}
    </>
  );
}
