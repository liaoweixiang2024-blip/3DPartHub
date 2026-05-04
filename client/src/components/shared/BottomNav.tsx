import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import useSWR from 'swr';
import { DEFAULT_MOBILE_NAV, getBusinessConfig } from '../../lib/businessConfig';
import { getCachedPublicSettings } from '../../lib/publicSettings';
import Icon from './Icon';

const tabs = DEFAULT_MOBILE_NAV;

export default function BottomNav() {
  const location = useLocation();
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
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
      className="bottom-nav fixed inset-x-0 z-[60] min-h-14 bg-surface-container-low border-t border-outline-variant/10 flex items-center justify-around px-3"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        bottom: 'var(--bottom-nav-offset, 0px)',
      }}
    >
      {(visibleTabs.length ? visibleTabs : tabs).map((tab) => {
        const active = isActive(tab.path);
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={`flex flex-col items-center gap-0.5 py-1 min-w-[48px] min-h-[44px] justify-center cursor-pointer active:scale-95 transition-transform ${
              active ? 'text-primary-container border-t-2 border-primary-container -mt-px' : 'text-on-surface-variant'
            }`}
          >
            <Icon name={tab.icon} size={22} />
            <span className={active ? 'text-[10px] font-bold' : 'text-[10px]'}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
