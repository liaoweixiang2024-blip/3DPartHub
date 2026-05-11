import type { InterfaceThemePackage } from '../types';
import BottomNav from './layouts/BottomNav';
import MobileNavDrawer from './layouts/MobileNavDrawer';
import Sidebar from './layouts/Sidebar';
import TopNav from './layouts/TopNav';
import { workbenchThemeManifest } from './manifest';
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
