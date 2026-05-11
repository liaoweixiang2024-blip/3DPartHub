import type { ComponentType } from 'react';

export type MobileThemeKey = 'classic';

export interface MobileThemeMeta {
  key: MobileThemeKey;
  label: string;
  settingsLabel: string;
  description: string;
  author: string;
  version: string;
}

export interface MobileNavDrawerThemeProps {
  open: boolean;
  onClose: () => void;
}

export interface MobileThemeComponents {
  BottomNav: ComponentType;
  MobileNavDrawer: ComponentType<MobileNavDrawerThemeProps>;
}

export type MobileHomeListLoadingMode = 'infinite' | 'pagination';

export interface MobileHomeThemeBehavior {
  dataHomeTheme: string;
  listLoadingMode: MobileHomeListLoadingMode;
}

export interface MobileThemePackage {
  manifest: MobileThemeMeta;
  home: MobileHomeThemeBehavior;
  components: MobileThemeComponents;
}
