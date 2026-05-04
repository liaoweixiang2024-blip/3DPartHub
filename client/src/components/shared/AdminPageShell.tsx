import { lazy, Suspense, useState, type ReactNode, type Ref } from 'react';
import useSWR from 'swr';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import { getCachedPublicSettings, getFooterCopyright, getSiteTitle } from '../../lib/publicSettings';
import BottomNav from './BottomNav';
import { mergeClassName } from './PagePrimitives';
import AppSidebar from './Sidebar';
import TopNav from './TopNav';

const MobileNavDrawer = lazy(() => import('./MobileNavDrawer'));

interface AdminPageShellProps {
  children: ReactNode;
  desktopContentClassName?: string;
  mobileMainClassName?: string;
  mobileContentClassName?: string;
  mobileMainRef?: Ref<HTMLElement>;
  hideMobileBottomNav?: boolean;
}

function AdminCopyrightBadge() {
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
  const text =
    (settings?.footer_copyright as string | undefined)?.trim() ||
    getFooterCopyright() ||
    `\u00a9 ${new Date().getFullYear()} ${getSiteTitle()}. All rights reserved.`;
  const year = new Date().getFullYear();

  return (
    <div className="pointer-events-none fixed bottom-3 right-5 z-20 hidden max-w-[min(46vw,560px)] items-center gap-2 text-[11px] font-medium text-on-surface-variant/45 md:flex">
      <span className="h-px w-8 bg-gradient-to-r from-transparent to-outline-variant/35" />
      <span className="max-w-[min(38vw,480px)] truncate">{text}</span>
      {!text.includes(String(year)) ? <span className="tabular-nums text-on-surface-variant/35">{year}</span> : null}
    </div>
  );
}

export function AdminPageShell({
  children,
  desktopContentClassName,
  mobileMainClassName,
  mobileContentClassName,
  mobileMainRef,
  hideMobileBottomNav = false,
}: AdminPageShellProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [navOpen, setNavOpen] = useState(false);

  if (isDesktop) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main
            className={mergeClassName(
              'flex flex-1 flex-col overflow-y-auto bg-surface-dim p-8 custom-scrollbar',
              desktopContentClassName,
            )}
          >
            {children}
          </main>
          <AdminCopyrightBadge />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen((prev) => !prev)} />
      {navOpen ? (
        <Suspense fallback={null}>
          <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
        </Suspense>
      ) : null}
      <main
        ref={mobileMainRef}
        className={mergeClassName('flex-1 overflow-y-auto bg-surface-dim scrollbar-hidden', mobileMainClassName)}
      >
        <div
          className={mergeClassName(
            `flex min-h-full flex-col px-4 py-4 ${hideMobileBottomNav ? '' : 'pb-20'}`,
            mobileContentClassName,
          )}
        >
          {children}
        </div>
      </main>
      {hideMobileBottomNav ? null : <BottomNav />}
    </div>
  );
}
