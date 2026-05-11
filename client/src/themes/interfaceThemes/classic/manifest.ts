import type { InterfaceThemeMeta } from '../types';

export const classicThemeManifest: InterfaceThemeMeta = {
  key: 'classic',
  label: 'PartHub 经典版',
  settingsLabel: 'PartHub Classic（PartHub 经典版）',
  description: '保留旧版图标导航和原有页面体验，作为稳定基线主题独立维护。',
  author: '3DPartHub',
  version: '1.0.0',
  screenshot: '/interface-themes/classic-preview.svg',
  capabilities: [
    'desktop-top-nav',
    'desktop-home-template',
    'login-template',
    'not-found-template',
    'sidebar',
    'category-sidebar',
    'mobile-bottom-nav',
    'mobile-drawer',
  ],
};
