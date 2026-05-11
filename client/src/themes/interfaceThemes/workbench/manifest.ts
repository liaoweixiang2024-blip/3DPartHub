import type { InterfaceThemeMeta } from '../types';

export const workbenchThemeManifest: InterfaceThemeMeta = {
  key: 'workbench',
  label: 'PartHub 工作台',
  settingsLabel: 'PartHub Workbench（PartHub 工作台）',
  description: '现代工作台式布局，适合文字导航、统一内容宽度和后续页面模板深度定制。',
  author: '3DPartHub',
  version: '1.0.0',
  screenshot: '/interface-themes/workbench-preview.svg',
  capabilities: [
    'desktop-top-nav',
    'desktop-home-template',
    'login-template',
    'not-found-template',
    'sidebar',
    'mobile-bottom-nav',
    'mobile-drawer',
    'hero-section',
    'contact-panel',
  ],
};
