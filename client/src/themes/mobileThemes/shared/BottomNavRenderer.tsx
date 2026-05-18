import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from '../../../components/shared/Icon';
import { useAuthEntry } from '../../../components/shared/useAuthEntry';
import { DEFAULT_MOBILE_NAV, getBusinessConfig } from '../../../lib/businessConfig';
import { usePublicSettings } from '../../../lib/publicSettings';
import { preloadRouteForPath } from '../../../lib/routeLoaders';

const fallbackTabs = DEFAULT_MOBILE_NAV;

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
  const location = useLocation();
  const { settings } = usePublicSettings();
  const { authNodes, handleProtectedLinkClick } = useAuthEntry(settings);
  const visibleTabs = getBusinessConfig(settings).mobileNav.slice(0, 5);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateOffset = () => {
      const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty('--visual-viewport-bottom', `${offset}px`);
      document.documentElement.style.setProperty('--bottom-nav-offset', `${-offset}px`);
    };

    updateOffset();
    viewport.addEventListener('resize', updateOffset);
    viewport.addEventListener('scroll', updateOffset);
    window.addEventListener('orientationchange', updateOffset);

    return () => {
      viewport.removeEventListener('resize', updateOffset);
      viewport.removeEventListener('scroll', updateOffset);
      window.removeEventListener('orientationchange', updateOffset);
      document.documentElement.style.removeProperty('--visual-viewport-bottom');
      document.documentElement.style.removeProperty('--bottom-nav-offset');
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
