import { lazy, Suspense, useState, type ReactNode } from "react";
import { useMediaQuery } from "../../layouts/hooks/useMediaQuery";
import TopNav from "./TopNav";
import BottomNav from "./BottomNav";

const MobileNavDrawer = lazy(() => import("./MobileNavDrawer"));

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
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [navOpen, setNavOpen] = useState(false);

  if (isDesktop) {
    return (
      <div className={className || "flex h-dvh flex-col overflow-hidden bg-surface"}>
        <TopNav />
        {children}
      </div>
    );
  }

  const handleMenuToggle = onMobileMenuToggle || (() => setNavOpen((prev) => !prev));

  return (
    <div className={mobileClassName || className || "flex h-dvh flex-col bg-surface"}>
      <TopNav compact onMenuToggle={handleMenuToggle} />
      {mobileDrawer || (
        keepMobileDrawerMounted || navOpen ? (
          <Suspense fallback={null}>
            <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
          </Suspense>
        ) : null
      )}
      {children}
      {showMobileBottomNav ? <BottomNav /> : null}
    </div>
  );
}
