import { lazy, Suspense, useState, type ReactNode } from "react";
import { useMediaQuery } from "../../layouts/hooks/useMediaQuery";
import TopNav from "./TopNav";
import BottomNav from "./BottomNav";
import AppSidebar from "./Sidebar";
import { mergeClassName } from "./PagePrimitives";

const MobileNavDrawer = lazy(() => import("./MobileNavDrawer"));

interface AdminPageShellProps {
  children: ReactNode;
  desktopContentClassName?: string;
  mobileMainClassName?: string;
  mobileContentClassName?: string;
  hideMobileBottomNav?: boolean;
}

export function AdminPageShell({
  children,
  desktopContentClassName,
  mobileMainClassName,
  mobileContentClassName,
  hideMobileBottomNav = false,
}: AdminPageShellProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [navOpen, setNavOpen] = useState(false);

  if (isDesktop) {
    return (
      <div className="flex h-screen flex-col overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className={mergeClassName("flex flex-1 flex-col overflow-y-auto bg-surface-dim p-8 custom-scrollbar", desktopContentClassName)}>
            {children}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen((prev) => !prev)} />
      {navOpen ? (
        <Suspense fallback={null}>
          <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
        </Suspense>
      ) : null}
      <main className={mergeClassName("flex-1 overflow-y-auto bg-surface-dim scrollbar-hidden", mobileMainClassName)}>
        <div className={mergeClassName(`flex min-h-full flex-col px-4 py-4 ${hideMobileBottomNav ? "" : "pb-20"}`, mobileContentClassName)}>{children}</div>
      </main>
      {hideMobileBottomNav ? null : <BottomNav />}
    </div>
  );
}
