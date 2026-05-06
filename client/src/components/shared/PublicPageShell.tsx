import { lazy, Suspense, useState, useContext, type ReactNode } from 'react';
import { ShellLayoutContext } from './AdminPageShell';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import BottomNav from './BottomNav';
import { mergeClassName } from './PagePrimitives';
import TopNav from './TopNav';

const MobileNavDrawer = lazy(() => import('./MobileNavDrawer'));

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
  const [navOpen, setNavOpen] = useState(false);

  // Inside layout route — layout handles TopNav/BottomNav, just render content
  if (inLayout) {
    if (isDesktop) {
      return <div className="flex flex-1 flex-col min-h-0">{children}</div>;
    }
    // Mobile inside layout — wrap in flex container so children with flex-1 get proper height
    return <div className="flex flex-1 flex-col min-h-0">{children}</div>;
  }

  // Standalone (fallback) — render full shell
  if (isDesktop) {
    return (
      <div className={mergeClassName('flex h-dvh flex-col overflow-hidden bg-surface', className)}>
        <TopNav />
        {children}
      </div>
    );
  }

  const handleMenuToggle = onMobileMenuToggle || (() => setNavOpen((prev) => !prev));

  return (
    <div className={mergeClassName('flex h-dvh flex-col overflow-hidden bg-surface', mobileClassName || className)}>
      <TopNav compact onMenuToggle={handleMenuToggle} />
      {mobileDrawer ||
        (keepMobileDrawerMounted || navOpen ? (
          <Suspense fallback={null}>
            <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
          </Suspense>
        ) : null)}
      {children}
      {showMobileBottomNav ? <BottomNav /> : null}
    </div>
  );
}
