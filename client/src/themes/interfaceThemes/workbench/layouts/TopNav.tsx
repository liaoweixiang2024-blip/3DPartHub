import { motion, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { NavItemConfig } from '../../../../lib/businessConfig';
import { preloadRouteForPath } from '../../../../lib/routeLoaders';
import type { DesktopTopNavThemeProps } from '../../types';

const WORKBENCH_NAV_PRIORITY = [
  '/',
  '/selection',
  '/thread-size',
  '/product-wall',
  '/favorites',
  '/downloads',
  '/my-shares',
  '/my-inquiries',
  '/my-tickets',
  '/support',
];

const WORKBENCH_NAV_LABELS: Record<string, string> = {
  '/': '模型',
  '/selection': '选型',
  '/thread-size': '规格',
  '/product-wall': '图库',
  '/favorites': '收藏',
  '/downloads': '下载',
  '/my-shares': '分享',
  '/my-inquiries': '询价',
  '/my-tickets': '工单',
  '/support': '支持',
};

function getWorkbenchNavItems(items: NavItemConfig[]) {
  const byPath = new Map(items.map((item) => [item.path, item]));
  const ordered: NavItemConfig[] = [];

  for (const path of WORKBENCH_NAV_PRIORITY) {
    const item = byPath.get(path);
    if (!item) continue;
    ordered.push(item);
    byPath.delete(path);
  }

  for (const item of items) {
    if (!byPath.has(item.path)) continue;
    ordered.push(item);
    byPath.delete(item.path);
  }

  return ordered;
}

const desktopTextClass = (active: boolean) =>
  `workbench-nav-link relative inline-flex h-10 shrink-0 items-center justify-center overflow-hidden px-2.5 text-sm font-semibold transition-[color,transform] duration-200 active:scale-[0.985] 2xl:px-3 ${
    active ? 'text-primary-container' : 'text-on-surface-variant hover:text-on-surface'
  }`;

function getWorkbenchNavLabel(item: NavItemConfig) {
  return WORKBENCH_NAV_LABELS[item.path] || item.label.replace(/^我的/, '').replace(/^产品/, '').replace(/历史$/, '');
}

export default function WorkbenchTopNav({
  source,
  userNavItems,
  renderBrand,
  tools,
  isNavActive,
  onNavClick,
}: DesktopTopNavThemeProps) {
  const navItems = useMemo(() => getWorkbenchNavItems(userNavItems), [userNavItems]);
  const reduceMotion = useReducedMotion();
  const location = useLocation();
  const isAdminRoute = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  const hasAlignedSidebarChrome = location.pathname === '/' || isAdminRoute;
  const navSpring = reduceMotion
    ? { duration: 0.14 }
    : {
        type: 'spring' as const,
        stiffness: 420,
        damping: 31,
        mass: 0.6,
      };

  return (
    <header
      className="workbench-top-nav flex h-16 shrink-0 items-center justify-center border-b border-outline-variant/12 bg-surface/95 z-50 backdrop-blur-md"
      data-app-top-nav={source}
    >
      <div
        className={`workbench-top-nav-inner flex h-full items-center gap-3 ${
          isAdminRoute ? 'workbench-top-nav-inner-admin' : ''
        } ${hasAlignedSidebarChrome ? 'workbench-top-nav-inner-aligned' : 'workbench-top-nav-inner-compact'}`}
      >
        {renderBrand(
          'workbench-brand-link flex h-full min-w-0 shrink-0 cursor-pointer items-center transition-[opacity,transform] hover:opacity-80 active:scale-[0.98]',
        )}

        {!isAdminRoute ? (
          <nav className="workbench-top-nav-menu flex min-w-0 flex-1 items-center gap-0.5" aria-label="主导航">
            {navItems.map((item) => {
              const active = isNavActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={desktopTextClass(active)}
                  onPointerEnter={() => preloadRouteForPath(item.path)}
                  onPointerDown={() => preloadRouteForPath(item.path)}
                  onFocus={() => preloadRouteForPath(item.path)}
                  onClick={(event) => onNavClick(event, item.path)}
                  aria-current={active ? 'page' : undefined}
                >
                  {active ? (
                    <motion.span
                      layoutId={`workbench-nav-active-line-${source}`}
                      className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-primary-container"
                      transition={navSpring}
                    />
                  ) : null}
                  <span className="relative z-10 whitespace-nowrap">{getWorkbenchNavLabel(item)}</span>
                </Link>
              );
            })}
          </nav>
        ) : (
          <div className="min-w-0 flex-1" />
        )}

        <div className="workbench-top-nav-tools flex shrink-0 items-center gap-1">{tools}</div>
      </div>
    </header>
  );
}
