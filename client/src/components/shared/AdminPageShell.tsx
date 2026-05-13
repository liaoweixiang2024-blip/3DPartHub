import { motion } from 'framer-motion';
import { createContext, useContext, useLayoutEffect, useState, type ReactNode, type Ref } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import { getFooterCopyright, usePublicSettings } from '../../lib/publicSettings';
import { getInterfaceThemePackage } from '../../themes/interfaceThemes/registry';
import type { FloatingMenuThemeProps } from '../../themes/interfaceThemes/types';
import { getMobileThemePackage } from '../../themes/mobileThemes/registry';
import HomeFooter from './HomeFooter';
import { mergeClassName } from './PagePrimitives';
import TopNav from './TopNav';

/** Context: when true, AdminPageShell/PublicPageShell skip rendering TopNav/Sidebar */
export const ShellLayoutContext = createContext(false);
/** Context: pages can hide the mobile bottom nav */
const HideBottomNavContext = createContext<{ hide: boolean; setHide: (v: boolean) => void }>({
  hide: false,
  setHide: () => {},
});

function AdminCopyrightBadge() {
  const text = getFooterCopyright();

  return (
    <div className="pointer-events-none fixed bottom-3 right-5 z-20 hidden max-w-[min(46vw,560px)] items-center gap-2 text-[11px] font-medium text-on-surface-variant/45 md:flex">
      <span className="h-px w-8 bg-gradient-to-r from-transparent to-outline-variant/35" />
      <span className="max-w-[min(38vw,480px)] truncate">{text}</span>
    </div>
  );
}

function useInterfaceThemeShellComponents() {
  const { settings } = usePublicSettings();
  return getInterfaceThemePackage(settings?.interface_theme);
}

function useMobileThemeShellComponents() {
  const { settings } = usePublicSettings();
  return getMobileThemePackage(settings?.mobile_interface_theme);
}

function useFloatingMenuThemeProps(): FloatingMenuThemeProps {
  const { settings } = usePublicSettings();
  return {
    contactAddress: settings?.contact_address || '',
    contactEmail: settings?.contact_email || '',
    contactPhone: settings?.contact_phone || '',
  };
}

// ─── Layout route: admin pages (TopNav + Sidebar) ───
export function AdminLayout() {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [navOpen, setNavOpen] = useState(false);
  const [hideBottomNav, setHideBottomNav] = useState(false);
  const location = useLocation();
  const ThemePackage = useInterfaceThemeShellComponents();
  const MobileThemePackage = useMobileThemeShellComponents();
  const Sidebar = ThemePackage.components.Sidebar;
  const BottomNav = MobileThemePackage.components.BottomNav;
  const MobileNavDrawer = MobileThemePackage.components.MobileNavDrawer;
  const FloatingMenu = ThemePackage.components.FloatingMenu;
  const floatingMenuProps = useFloatingMenuThemeProps();
  const interfaceTheme = ThemePackage.manifest.key;
  const mobileTheme = MobileThemePackage.manifest.key;
  const isAdminRoute = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  const chromeContext = { pathname: location.pathname, isAdminRoute };
  const showDesktopSidebar = ThemePackage.chrome.adminLayout.showDesktopSidebar(chromeContext);
  const showDesktopFloatingMenu = ThemePackage.chrome.adminLayout.showDesktopFloatingMenu?.(chromeContext) ?? false;

  const bottomNavCtx = { hide: hideBottomNav, setHide: setHideBottomNav };

  if (isDesktop) {
    return (
      <ShellLayoutContext.Provider value>
        <HideBottomNavContext.Provider value={bottomNavCtx}>
          <div className="flex h-dvh flex-col overflow-hidden" data-interface-theme={interfaceTheme}>
            <TopNav source="layout" />
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {showDesktopSidebar ? <Sidebar /> : null}
              <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-dim custom-scrollbar">
                <Outlet />
              </main>
              {showDesktopFloatingMenu && FloatingMenu ? <FloatingMenu {...floatingMenuProps} /> : null}
              <AdminCopyrightBadge />
            </div>
          </div>
        </HideBottomNavContext.Provider>
      </ShellLayoutContext.Provider>
    );
  }

  return (
    <ShellLayoutContext.Provider value>
      <HideBottomNavContext.Provider value={bottomNavCtx}>
        <div
          className="flex h-dvh flex-col overflow-hidden bg-surface"
          data-interface-theme={interfaceTheme}
          data-mobile-theme={mobileTheme}
        >
          <TopNav source="layout" compact onMenuToggle={() => setNavOpen((prev) => !prev)} />
          <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
          {hideBottomNav ? null : <BottomNav />}
        </div>
      </HideBottomNavContext.Provider>
    </ShellLayoutContext.Provider>
  );
}

// ─── Layout route: public pages (TopNav only, no sidebar) ───
export function PublicLayout() {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const ThemePackage = useInterfaceThemeShellComponents();
  const MobileThemePackage = useMobileThemeShellComponents();
  const BottomNav = MobileThemePackage.components.BottomNav;
  const MobileNavDrawer = MobileThemePackage.components.MobileNavDrawer;
  const FloatingMenu = ThemePackage.components.FloatingMenu;
  const floatingMenuProps = useFloatingMenuThemeProps();
  const interfaceTheme = ThemePackage.manifest.key;
  const mobileTheme = MobileThemePackage.manifest.key;
  const isAdminRoute = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  const chromeContext = { pathname: location.pathname, isAdminRoute };
  const showDesktopHomeFooter = ThemePackage.chrome.publicLayout.showDesktopHomeFooter?.(chromeContext) ?? false;
  const showDesktopFloatingMenu = ThemePackage.chrome.publicLayout.showDesktopFloatingMenu?.(chromeContext) ?? false;

  if (isDesktop) {
    return (
      <ShellLayoutContext.Provider value>
        <div className="flex h-dvh flex-col overflow-hidden bg-surface" data-interface-theme={interfaceTheme}>
          <TopNav source="layout" />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
          {showDesktopHomeFooter ? <HomeFooter /> : null}
          {showDesktopFloatingMenu && FloatingMenu ? <FloatingMenu {...floatingMenuProps} /> : null}
        </div>
      </ShellLayoutContext.Provider>
    );
  }

  return (
    <ShellLayoutContext.Provider value>
      <div
        className="flex h-dvh flex-col overflow-hidden bg-surface"
        data-interface-theme={interfaceTheme}
        data-mobile-theme={mobileTheme}
      >
        <TopNav source="layout" compact onMenuToggle={() => setNavOpen((prev) => !prev)} />
        <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
        <BottomNav />
      </div>
    </ShellLayoutContext.Provider>
  );
}

// ─── AdminPageShell: context-aware ───
// When inside a layout route, skips TopNav/Sidebar and only renders content wrapper
interface AdminPageShellProps {
  children: ReactNode;
  desktopContentClassName?: string;
  mobileMainClassName?: string;
  mobileContentClassName?: string;
  mobileMainRef?: Ref<HTMLElement>;
  hideMobileBottomNav?: boolean;
}

export function AdminPageShell({
  children,
  desktopContentClassName,
  mobileMainClassName,
  mobileContentClassName,
  mobileMainRef,
  hideMobileBottomNav = false,
}: AdminPageShellProps) {
  const inLayout = useContext(ShellLayoutContext);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const bottomNavCtx = useContext(HideBottomNavContext);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const ThemePackage = useInterfaceThemeShellComponents();
  const MobileThemePackage = useMobileThemeShellComponents();
  const Sidebar = ThemePackage.components.Sidebar;
  const BottomNav = MobileThemePackage.components.BottomNav;
  const MobileNavDrawer = MobileThemePackage.components.MobileNavDrawer;
  const interfaceTheme = ThemePackage.manifest.key;
  const mobileTheme = MobileThemePackage.manifest.key;
  const isAdminRoute = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  const chromeContext = { pathname: location.pathname, isAdminRoute };
  const showDesktopSidebar = ThemePackage.chrome.adminLayout.showDesktopSidebar(chromeContext);
  const themeDesktopContentClassName = ThemePackage.chrome.adminLayout.desktopContentClassName?.(chromeContext);
  const defaultDesktopContentPadding = isAdminRoute ? 'p-8' : 'p-6';

  const setHideBottomNav = bottomNavCtx.setHide;

  // Communicate hideMobileBottomNav before paint to avoid one-frame bottom-nav jumps.
  useLayoutEffect(() => {
    if (inLayout && !isDesktop) {
      setHideBottomNav(hideMobileBottomNav);
      return () => setHideBottomNav(false);
    }
  }, [inLayout, isDesktop, hideMobileBottomNav, setHideBottomNav]);

  // Inside layout route — layout already renders TopNav/Sidebar/BottomNav
  if (inLayout) {
    if (isDesktop) {
      return (
        <div
          className={mergeClassName(
            mergeClassName(
              `flex flex-1 flex-col min-h-0 ${defaultDesktopContentPadding}`,
              themeDesktopContentClassName,
            ),
            desktopContentClassName,
          )}
        >
          {children}
        </div>
      );
    }
    return (
      <div
        ref={mobileMainRef as React.Ref<HTMLDivElement>}
        className={mergeClassName('flex-1 overflow-y-auto scrollbar-hidden', mobileMainClassName)}
      >
        <div
          className={mergeClassName(
            `flex flex-col px-4 py-4 ${hideMobileBottomNav ? '' : 'pb-20'}`,
            mobileContentClassName,
          )}
        >
          {children}
        </div>
      </div>
    );
  }

  // Standalone (fallback) — render full shell
  if (isDesktop) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden" data-interface-theme={interfaceTheme}>
        <TopNav source="standalone" />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {showDesktopSidebar ? <Sidebar /> : null}
          <motion.main
            key={location.pathname}
            className={mergeClassName(
              mergeClassName(
                `flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-dim ${defaultDesktopContentPadding} custom-scrollbar`,
                themeDesktopContentClassName,
              ),
              desktopContentClassName,
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          >
            {children}
          </motion.main>
          <AdminCopyrightBadge />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-surface"
      data-interface-theme={interfaceTheme}
      data-mobile-theme={mobileTheme}
    >
      <TopNav source="standalone" compact onMenuToggle={() => setNavOpen((prev) => !prev)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <motion.main
        key={location.pathname}
        ref={mobileMainRef}
        className={mergeClassName('flex-1 overflow-y-auto bg-surface-dim scrollbar-hidden', mobileMainClassName)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <div
          className={mergeClassName(
            `flex min-h-full flex-col px-4 py-4 ${hideMobileBottomNav ? '' : 'pb-20'}`,
            mobileContentClassName,
          )}
        >
          {children}
        </div>
      </motion.main>
      {hideMobileBottomNav ? null : <BottomNav />}
    </div>
  );
}
