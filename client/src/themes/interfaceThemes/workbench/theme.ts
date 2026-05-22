import type { InterfaceThemePackage } from '../types';
import BottomNav from './layouts/BottomNav';
import MobileNavDrawer from './layouts/MobileNavDrawer';
import Sidebar from './layouts/Sidebar';
import TopNav from './layouts/TopNav';
import { workbenchThemeManifest } from './manifest';
import AuthDialog from './templates/AuthDialog';
import HomeDesktop from './templates/HomeDesktop';
import Login from './templates/Login';
import NotFound from './templates/NotFound';
import './styles.css';

const workbenchTheme: InterfaceThemePackage = {
  manifest: workbenchThemeManifest,
  home: {
    listLoadingMode: 'pagination',
    showModelCardCategory: false,
    showModelCardVariantMeta: false,
  },
  chrome: {
    desktopToolbar: {
      showTooltips: false,
    },
    adminSettings: {
      moduleNavigation: {
        enabled: true,
        basePath: '/admin/settings',
      },
      groupNavigation: {
        placement: 'top',
        variant: 'line',
        sticky: true,
      },
      sectionNavigation: {
        variant: 'line',
      },
    },
    desktopSearch: {
      placement: 'toolbar',
    },
    adminLayout: {
      defaultPath: () => '/admin/settings',
      showDesktopSidebar: ({ isAdminRoute }) => isAdminRoute,
      desktopContentClassName: ({ isAdminRoute }) => (isAdminRoute ? undefined : 'workbench-page-content'),
      showDesktopFloatingMenu: () => false,
    },
    publicLayout: {
      desktopContentClassName: ({ pathname }) =>
        pathname === '/' ||
        pathname.startsWith('/model/') ||
        pathname === '/temp-viewer' ||
        pathname.startsWith('/share/') ||
        pathname.startsWith('/selection/s/')
          ? undefined
          : 'workbench-page-content',
      showDesktopHomeFooter: () => false,
      showDesktopFloatingMenu: () => false,
    },
  },
  templates: {
    DesktopHome: HomeDesktop,
    AuthDialog,
    Login,
    NotFound,
  },
  components: {
    DesktopTopNav: TopNav,
    Sidebar,
    BottomNav,
    MobileNavDrawer,
  },
};

export default workbenchTheme;
