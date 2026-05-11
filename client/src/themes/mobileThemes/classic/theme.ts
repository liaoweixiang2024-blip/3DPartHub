import type { MobileThemePackage } from '../types';
import BottomNav from './layouts/BottomNav';
import MobileNavDrawer from './layouts/MobileNavDrawer';
import { classicMobileThemeManifest } from './manifest';

const classicMobileTheme: MobileThemePackage = {
  manifest: classicMobileThemeManifest,
  home: {
    dataHomeTheme: 'classic',
    listLoadingMode: 'infinite',
  },
  components: {
    BottomNav,
    MobileNavDrawer,
  },
};

export default classicMobileTheme;
