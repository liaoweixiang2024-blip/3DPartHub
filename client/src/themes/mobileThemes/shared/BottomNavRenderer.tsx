import { useEffect, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import Icon from '../../../components/shared/Icon';
import { useAuthEntry } from '../../../components/shared/useAuthEntry';
import { localizeNavItems } from '../../../i18n/nav';
import { DEFAULT_MOBILE_NAV, getBusinessConfig } from '../../../lib/businessConfig';
import { usePublicSettings } from '../../../lib/publicSettings';
import { preloadRouteForPath } from '../../../lib/routeLoaders';

export interface BottomNavAppearance {
  rootClassName: string;
  linkClassName: (active: boolean) => string;
  labelClassName: (active: boolean) => string;
  iconSize: number;
}

interface BottomNavRendererProps {
  appearance: BottomNavAppearance;
}

export default function BottomNavRenderer({ appearance }: BottomNavRendererProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { settings } = usePublicSettings();
  const { authNodes, handleProtectedLinkClick } = useAuthEntry(settings);
  const visibleTabs = localizeNavItems(getBusinessConfig(settings).mobileNav.slice(0, 5), t, 'mobile');
  const fallbackTabs = localizeNavItems(DEFAULT_MOBILE_NAV, t, 'mobile');

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateOffset = () => {
      const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty('--visual-viewport-bottom', `${offset}px`);
      document.documentElement.style.setProperty('--bottom-nav-offset', `${-offset}px`);
      /* 键盘弹出期间 iOS 会把 fixed 元素重定位到可视视口——拖动时导航栏会被
         拽到键盘上方飘着。键盘态（offset 超过 URL 栏级别的阈值）直接
         visibility:hidden：WebKit 再怎么重定位也画不出隐藏元素 */
      document.documentElement.style.setProperty('--bottom-nav-visibility', offset > 80 ? 'hidden' : 'visible');
      if (offset > 80 && (window.scrollY !== 0 || window.pageXOffset !== 0)) window.scrollTo(0, 0);
    };

    updateOffset();
    viewport.addEventListener('resize', updateOffset);
    viewport.addEventListener('scroll', updateOffset);
    window.addEventListener('orientationchange', updateOffset);
    /* 键盘态 WebKit 允许拖动 window（fixed 根被整体拖起、底部导航飘到键盘上方）。
       html/body 本就 overflow:hidden+fixed、文档没有合法可滚内容——键盘开时把
       window 钉回原点，拖动即被钳制 */
    window.addEventListener('scroll', updateOffset);

    return () => {
      viewport.removeEventListener('resize', updateOffset);
      viewport.removeEventListener('scroll', updateOffset);
      window.removeEventListener('orientationchange', updateOffset);
      window.removeEventListener('scroll', updateOffset);
      document.documentElement.style.removeProperty('--visual-viewport-bottom');
      document.documentElement.style.removeProperty('--bottom-nav-offset');
      document.documentElement.style.removeProperty('--bottom-nav-visibility');
    };
  }, []);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <nav
      className={appearance.rootClassName}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        bottom: 'var(--bottom-nav-offset, 0px)',
        visibility: 'var(--bottom-nav-visibility, visible)' as CSSProperties['visibility'],
      }}
      data-mobile-theme-nav
    >
      {(visibleTabs.length ? visibleTabs : fallbackTabs).map((tab) => {
        const active = isActive(tab.path);
        return (
          <Link
            key={tab.path}
            to={tab.path}
            onPointerEnter={() => preloadRouteForPath(tab.path)}
            onPointerDown={() => preloadRouteForPath(tab.path)}
            onFocus={() => preloadRouteForPath(tab.path)}
            onClick={(e) => handleProtectedLinkClick(e, tab.path)}
            className={appearance.linkClassName(active)}
          >
            <Icon name={tab.icon} size={appearance.iconSize} />
            <span className={appearance.labelClassName(active)}>{tab.label}</span>
          </Link>
        );
      })}
      {authNodes}
    </nav>
  );
}
