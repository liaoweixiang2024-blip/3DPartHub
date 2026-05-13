import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../../../components/shared/Icon';
import LoginConfirmDialog from '../../../components/shared/LoginConfirmDialog';
import { checkProtectedAccess } from '../../../components/shared/ProtectedLink';
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
  const navigate = useNavigate();
  const { settings } = usePublicSettings();
  const visibleTabs = getBusinessConfig(settings).mobileNav.slice(0, 5);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginReturnUrl, setLoginReturnUrl] = useState('');
  const [loginDialogReason, setLoginDialogReason] = useState('');

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
            onClick={(e) => {
              const result = checkProtectedAccess(tab.path);
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
            className={appearance.linkClassName(active)}
          >
            <Icon name={tab.icon} size={appearance.iconSize} />
            <span className={appearance.labelClassName(active)}>{tab.label}</span>
          </Link>
        );
      })}
      <LoginConfirmDialog
        open={loginDialogOpen}
        onClose={() => setLoginDialogOpen(false)}
        reason={loginDialogReason}
        returnUrl={loginReturnUrl}
      />
    </nav>
  );
}
