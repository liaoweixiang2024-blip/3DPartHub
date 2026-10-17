export interface SettingModule {
  key: string;
  title: string;
  desc: string;
  icon: string;
  tabTitles: string[];
}

// title / desc / tabTitles 均存 adminSettings 命名空间的 i18n 键，消费方渲染时用 t() 取文案。
export const SETTINGS_MODULES: SettingModule[] = [
  {
    key: 'basic',
    title: 'adminSettings.groupBasic',
    desc: 'adminSettings.navBasicDesc',
    icon: 'tune',
    tabTitles: [
      'adminSettings.tabSiteBrand',
      'adminSettings.tabAppearance',
      'adminSettings.tabAnnouncement',
      'adminSettings.tabMenuConfig',
      'adminSettings.tabLegal',
    ],
  },
  {
    key: 'access',
    title: 'adminSettings.groupAccess',
    desc: 'adminSettings.navAccessDesc',
    icon: 'shield',
    tabTitles: ['adminSettings.tabAccessControl', 'adminSettings.tabSecurity'],
  },
  {
    key: 'content',
    title: 'adminSettings.groupBusiness',
    desc: 'adminSettings.navContentDesc',
    icon: 'inventory_2',
    tabTitles: [
      'adminSettings.tabDownloadShare',
      'adminSettings.tab3dPreview',
      'adminSettings.tabSelection',
      'adminSettings.tabBizDict',
      'adminSettings.tabUploadLimits',
      'adminSettings.tabEmail',
    ],
  },
  {
    key: 'storage',
    title: 'adminSettings.groupStorage',
    desc: 'adminSettings.navStorageDesc',
    icon: 'storage',
    tabTitles: [
      'adminSettings.tabRedisCache',
      'adminSettings.tabStorageProvider',
      'adminSettings.tabStoragePolicy',
      'adminSettings.tabLocalCloudSync',
      'adminSettings.tabAssetOptimization',
      'adminSettings.tabCacheCleanup',
    ],
  },
  {
    key: 'operations',
    title: 'adminSettings.groupOperations',
    desc: 'adminSettings.navOperationsDesc',
    icon: 'build',
    tabTitles: ['adminSettings.tabOpsMaintenance', 'adminSettings.tabBackup'],
  },
];
