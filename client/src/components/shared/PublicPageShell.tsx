import { useContext, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import { useResolvedPublicInterfaceTheme } from '../../lib/interfaceThemePreference';
import { usePublicSettings } from '../../lib/publicSettings';
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
  /** 移动端补标准内容包装层（px-4 py-4 + 底部安全区）：默认分支无内边距，
      供全屏自管布局页（模型详情/登录/分享）使用；标准管理结构页
      （AdminManagementPage + AdminPageHero）传 true——否则标题卡贴死顶栏与屏幕边缘，
      与 AdminPageShell 页面（自带该包装层）间距不一致 */
  mobilePadded?: boolean;
}

export function PublicPageShell({
  children,
  className,
  mobileClassName,
  mobileDrawer,
  onMobileMenuToggle,
  showMobileBottomNav = true,
  keepMobileDrawerMounted = false,
  mobilePadded = false,
}: PublicPageShellProps) {
  const inLayout = useContext(ShellLayoutContext);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const { settings } = usePublicSettings();
  const resolvedPublicTheme = useResolvedPublicInterfaceTheme(settings);
  const ThemePackage = getInterfaceThemePackage(isDesktop ? resolvedPublicTheme : settings?.interface_theme);
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
    if (mobilePadded) {
      // 标准内容包装层：与 AdminPageShell 移动端同款间距（16px + 底部安全区）
      return <div className="flex h-full min-h-0 flex-1 flex-col px-4 py-4 pb-safe-nav">{children}</div>;
    }
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
      {mobilePadded ? <div className="flex min-h-0 flex-1 flex-col px-4 py-4 pb-safe-nav">{children}</div> : children}
      {showMobileBottomNav ? <BottomNav /> : null}
    </div>
  );
}
