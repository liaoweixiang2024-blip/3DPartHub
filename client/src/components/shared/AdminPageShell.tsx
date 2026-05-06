import { createContext, lazy, useContext, useEffect, Suspense, useState, type ReactNode, type Ref } from 'react';
import { motion } from 'framer-motion';
import { Outlet, useLocation } from 'react-router-dom';
import useSWR from 'swr';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import { getCachedPublicSettings, getFooterCopyright, getSiteTitle } from '../../lib/publicSettings';
import BottomNav from './BottomNav';
import HomeFooter from './HomeFooter';
import { mergeClassName } from './PagePrimitives';
import AppSidebar from './Sidebar';
import TopNav from './TopNav';

const MobileNavDrawer = lazy(() => import('./MobileNavDrawer'));
// Preload drawer so first open has no delay
import('./MobileNavDrawer');

/** Context: when true, AdminPageShell/PublicPageShell skip rendering TopNav/Sidebar */
export const ShellLayoutContext = createContext(false);
/** Context: pages can hide the mobile bottom nav */
const HideBottomNavContext = createContext<{ hide: boolean; setHide: (v: boolean) => void }>({
  hide: false,
  setHide: () => {},
});

function AdminCopyrightBadge() {
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
  const text =
    (settings?.footer_copyright as string | undefined)?.trim() ||
    getFooterCopyright() ||
    `© ${new Date().getFullYear()} ${getSiteTitle()}. All rights reserved.`;
  const year = new Date().getFullYear();

  return (
    <div className="pointer-events-none fixed bottom-3 right-5 z-20 hidden max-w-[min(46vw,560px)] items-center gap-2 text-[11px] font-medium text-on-surface-variant/45 md:flex">
      <span className="h-px w-8 bg-gradient-to-r from-transparent to-outline-variant/35" />
      <span className="max-w-[min(38vw,480px)] truncate">{text}</span>
      {!text.includes(String(year)) ? <span className="tabular-nums text-on-surface-variant/35">{year}</span> : null}
    </div>
  );
}

// ─── Layout route: admin pages (TopNav + Sidebar) ───
export function AdminLayout() {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [navOpen, setNavOpen] = useState(false);
  const [hideBottomNav, setHideBottomNav] = useState(false);

  const bottomNavCtx = { hide: hideBottomNav, setHide: setHideBottomNav };

  if (isDesktop) {
    return (
      <ShellLayoutContext.Provider value>
        <HideBottomNavContext.Provider value={bottomNavCtx}>
          <div className="flex h-dvh flex-col overflow-hidden">
            <TopNav />
            <div className="flex flex-1 overflow-hidden">
              <AppSidebar />
              <main className="flex flex-1 flex-col overflow-y-auto bg-surface-dim custom-scrollbar">
                <Outlet />
              </main>
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
        <div className="flex h-dvh flex-col overflow-hidden bg-surface">
          <TopNav compact onMenuToggle={() => setNavOpen((prev) => !prev)} />
          <Suspense fallback={null}>
            <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
          </Suspense>
          <div className="flex flex-1 flex-col overflow-hidden">
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

  if (isDesktop) {
    return (
      <ShellLayoutContext.Provider value>
        <div className="flex h-dvh flex-col overflow-hidden bg-surface">
          <TopNav />
          <div className="flex flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
          {location.pathname === '/' && <HomeFooter />}
        </div>
      </ShellLayoutContext.Provider>
    );
  }

  return (
    <ShellLayoutContext.Provider value>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface">
        <TopNav compact onMenuToggle={() => setNavOpen((prev) => !prev)} />
        <Suspense fallback={null}>
          <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
        </Suspense>
        <div className="flex flex-1 flex-col overflow-hidden">
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

  // Communicate hideMobileBottomNav to the layout
  useEffect(() => {
    if (inLayout && !isDesktop) {
      bottomNavCtx.setHide(hideMobileBottomNav);
      return () => bottomNavCtx.setHide(false);
    }
  }, [inLayout, isDesktop, hideMobileBottomNav, bottomNavCtx]);

  // Inside layout route — layout already renders TopNav/Sidebar/BottomNav
  if (inLayout) {
    if (isDesktop) {
      return <div className={mergeClassName('flex flex-1 flex-col p-8', desktopContentClassName)}>{children}</div>;
    }
    return (
      <div
        ref={mobileMainRef as React.Ref<HTMLDivElement>}
        className={mergeClassName('flex-1 overflow-y-auto scrollbar-hidden', mobileMainClassName)}
      >
        <div className={mergeClassName('flex flex-col px-4 py-4 pb-20', mobileContentClassName)}>{children}</div>
      </div>
    );
  }

  // Standalone (fallback) — render full shell
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  if (isDesktop) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <motion.main
            key={location.pathname}
            className={mergeClassName(
              'flex flex-1 flex-col overflow-y-auto bg-surface-dim p-8 custom-scrollbar',
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
    <div className="flex h-dvh flex-col overflow-hidden bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen((prev) => !prev)} />
      <Suspense fallback={null}>
        <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      </Suspense>
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
