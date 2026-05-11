import type { InterfaceThemePackage } from '../types';
import BottomNav from './layouts/BottomNav';
import MobileNavDrawer from './layouts/MobileNavDrawer';
import Sidebar from './layouts/Sidebar';
import TopNav from './layouts/TopNav';
import { classicThemeManifest } from './manifest';
import HomeDesktop from './templates/HomeDesktop';
import Login from './templates/Login';
import NotFound from './templates/NotFound';
import './styles.css';

const classicTheme: InterfaceThemePackage = {
  manifest: classicThemeManifest,
  home: {
    listLoadingMode: 'infinite',
    showModelCardCategory: false,
    showModelCardVariantMeta: false,
  },
  chrome: {
    desktopSearch: {
      placement: 'inline',
    },
    adminLayout: {
      defaultPath: () => '/admin/settings',
      showDesktopSidebar: () => true,
    },
    publicLayout: {
      showDesktopHomeFooter: ({ pathname }) => pathname === '/',
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

export default classicTheme;
