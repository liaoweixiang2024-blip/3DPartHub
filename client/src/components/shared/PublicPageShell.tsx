import { useContext, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import useSWR from 'swr';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import { getCachedPublicSettings } from '../../lib/publicSettings';
import { getInterfaceThemePackage } from '../../themes/interfaceThemes/registry';
import { getMobileThemePackage } from '../../themes/mobileThemes/registry';
import { ShellLayoutContext } from './AdminPageShell';
import { mergeClassName } from './PagePrimitives';
import TopNav from './TopNav';

interface PublicPageShellProps {
  children: ReactNode;
  className?: string;
  mobileClassName?: string;
  mobileDrawer?: ReactNode;
  onMobileMenuToggle?: () => void;
  showMobileBottomNav?: boolean;
  keepMobileDrawerMounted?: boolean;
}

export function PublicPageShell({
  children,
  className,
  mobileClassName,
  mobileDrawer,
  onMobileMenuToggle,
  showMobileBottomNav = true,
  keepMobileDrawerMounted = false,
}: PublicPageShellProps) {
  const inLayout = useContext(ShellLayoutContext);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
  const ThemePackage = getInterfaceThemePackage(settings?.interface_theme);
  const MobileThemePackage = getMobileThemePackage(settings?.mobile_interface_theme);
  const BottomNav = MobileThemePackage.components.BottomNav;
  const MobileNavDrawer = MobileThemePackage.components.MobileNavDrawer;
  const interfaceTheme = ThemePackage.manifest.key;
  const mobileTheme = MobileThemePackage.manifest.key;
  const chromeContext = {
    pathname: location.pathname,
    isAdminRoute: location.pathname === '/admin' || location.pathname.startsWith('/admin/'),
  };
  const themeDesktopContentClassName = ThemePackage.chrome.publicLayout.desktopContentClassName?.(chromeContext);

  // Inside layout route — layout handles TopNav/BottomNav, just render content
  if (inLayout) {
    if (isDesktop) {
      return (
        <div
          className={mergeClassName(
            mergeClassName('flex h-full min-h-0 flex-1 flex-col', themeDesktopContentClassName),
            className,
          )}
        >
          {children}
        </div>
      );
    }
    // Mobile inside layout — wrap in flex container so children with flex-1 get proper height
    return <div className="flex h-full min-h-0 flex-1 flex-col">{children}</div>;
  }

  // Standalone (fallback) — render full shell
  if (isDesktop) {
    return (
      <div
        className={mergeClassName('flex h-dvh flex-col overflow-hidden bg-surface', className)}
        data-interface-theme={interfaceTheme}
      >
        <TopNav source="standalone" />
        {children}
      </div>
    );
  }

  const handleMenuToggle = onMobileMenuToggle || (() => setNavOpen((prev) => !prev));

  return (
    <div
      className={mergeClassName('flex h-dvh flex-col overflow-hidden bg-surface', mobileClassName || className)}
      data-interface-theme={interfaceTheme}
      data-mobile-theme={mobileTheme}
    >
      <TopNav source="standalone" compact onMenuToggle={handleMenuToggle} />
      {mobileDrawer ||
        (keepMobileDrawerMounted || navOpen ? (
          <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
        ) : null)}
      {children}
      {showMobileBottomNav ? <BottomNav /> : null}
    </div>
  );
}
