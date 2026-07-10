import type { ComponentType, MouseEvent, ReactElement, ReactNode, RefObject } from 'react';
import type { Category, HomeBreadcrumb, HomeViewMode, Product } from '../../components/home/homeTypes';
import type { NavItemConfig } from '../../lib/businessConfig';

export type InterfaceThemeKey = 'workbench' | 'classic';
export type TopNavSource = 'layout' | 'standalone';
export type HomeListLoadingMode = 'infinite' | 'pagination';
export type InterfaceThemeCapability =
  | 'desktop-top-nav'
  | 'desktop-home-template'
  | 'login-template'
  | 'not-found-template'
  | 'sidebar'
  | 'category-sidebar'
  | 'mobile-bottom-nav'
  | 'mobile-drawer'
  | 'floating-menu'
  | 'hero-section'
  | 'contact-panel';

export interface InterfaceThemeMeta {
  key: InterfaceThemeKey;
  label: string;
  settingsLabel: string;
  shortLabel?: string;
  description: string;
  author: string;
  version: string;
  screenshot?: string;
  capabilities: InterfaceThemeCapability[];
}

export interface DesktopTopNavThemeProps {
  source: TopNavSource;
  userNavItems: NavItemConfig[];
  adminNavItems: NavItemConfig[];
  topNavItems: NavItemConfig[];
  isAdmin: boolean;
  isWideDesktop: boolean;
  isVeryWideDesktop: boolean;
  renderBrand: (className: string) => ReactNode;
  renderSearch: (className: string) => ReactNode;
  tools: ReactNode;
  isNavActive: (path: string) => boolean;
  onNavClick: (event: MouseEvent<HTMLElement>, path: string) => void;
}

export type DesktopTopNavThemeComponent = (props: DesktopTopNavThemeProps) => ReactElement;

export interface MobileNavDrawerThemeProps {
  open: boolean;
  onClose: () => void;
}

export interface FloatingMenuThemeProps {
  contactAddress?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface InterfaceThemeComponents {
  DesktopTopNav: DesktopTopNavThemeComponent;
  Sidebar: ComponentType;
  BottomNav: ComponentType;
  MobileNavDrawer: ComponentType<MobileNavDrawerThemeProps>;
  FloatingMenu?: ComponentType<FloatingMenuThemeProps>;
}

export interface InterfaceThemeTemplates {
  DesktopHome: ComponentType<DesktopHomeThemeProps>;
  AuthDialog: ComponentType<AuthDialogThemeProps>;
  Login: ComponentType<LoginThemeProps>;
  NotFound: ComponentType<NotFoundThemeProps>;
}

export interface DesktopHomeThemeProps {
  activeCategory: string;
  breadcrumb: HomeBreadcrumb;
  categories: Category[];
  contactAddress: string;
  contactEmail: string;
  contactPhone: string;
  displayTotalItems: number;
  expandedCategories: Set<string>;
  footerCopyright: string;
  footerLinks: { label: string; url: string }[];
  footerIcpNumber?: string;
  footerPoliceNumber?: string;
  footerPoliceUrl?: string;
  hasMore: boolean;
  homePageSizeOptions: number[];
  homeSearchMaxLength: number;
  isLoadingMore: boolean;
  listLoadingMode: HomeListLoadingMode;
  normalizeSearchQuery: (query: string) => string;
  page: number;
  pageSize: number;
  products: Product[];
  renderProductCard: (product: Product, index: number) => ReactNode;
  resultsAnchorRef: RefObject<HTMLDivElement | null>;
  scrollContainerRef: RefObject<HTMLElement | null>;
  searchQuery: string;
  showHomeListSkeleton: boolean;
  sortBy: string;
  totalItems: number;
  totalModelCount: number;
  totalPages: number;
  viewMode: HomeViewMode;
  onHeroExplore: () => void;
  onHeroSearch: (query: string) => void;
  onLoadMore: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSelectCategory: (id: string) => void;
  onSortChange: (sort: string) => void;
  onToggleCategory: (id: string) => void;
  onViewModeChange: (mode: HomeViewMode) => void;
}

export interface HomeThemeBehavior {
  listLoadingMode: HomeListLoadingMode;
  showModelCardCategory: boolean;
  showModelCardVariantMeta: boolean;
}

export interface LoginThemeProps {
  mode: 'login' | 'register';
  brand: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  form: ReactNode;
  modeSwitch: ReactNode;
  legalLinks: ReactNode;
  backLink: ReactNode;
}

export interface AuthDialogThemeProps {
  mode: 'login' | 'register';
  brand: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  children: ReactNode;
  closeLabel: string;
  onClose: () => void;
}

export interface NotFoundThemeProps {
  brand?: ReactNode;
  title: ReactNode;
  description: ReactNode;
  homeLink: ReactNode;
}

export interface InterfaceThemeChromeContext {
  pathname: string;
  isAdminRoute: boolean;
}

export interface InterfaceThemeChrome {
  desktopToolbar?: {
    showTooltips?: boolean;
  };
  adminSettings?: {
    moduleNavigation?: {
      enabled: boolean;
      basePath?: string;
    };
    groupNavigation?: {
      placement: 'sidebar' | 'top';
      variant?: 'panel' | 'line';
      sticky?: boolean;
    };
    sectionNavigation?: {
      variant?: 'line' | 'surface';
    };
  };
  desktopSearch: {
    placement: 'inline' | 'toolbar' | 'none';
  };
  adminLayout: {
    defaultPath?: (context: InterfaceThemeChromeContext) => string;
    showDesktopSidebar: (context: InterfaceThemeChromeContext) => boolean;
    desktopContentClassName?: (context: InterfaceThemeChromeContext) => string | undefined;
    showDesktopFloatingMenu?: (context: InterfaceThemeChromeContext) => boolean;
  };
  publicLayout: {
    desktopContentClassName?: (context: InterfaceThemeChromeContext) => string | undefined;
    showDesktopHomeFooter?: (context: InterfaceThemeChromeContext) => boolean;
    showDesktopFloatingMenu?: (context: InterfaceThemeChromeContext) => boolean;
  };
}

export interface InterfaceThemePackage {
  manifest: InterfaceThemeMeta;
  home: HomeThemeBehavior;
  chrome: InterfaceThemeChrome;
  templates: InterfaceThemeTemplates;
  components: InterfaceThemeComponents;
}
