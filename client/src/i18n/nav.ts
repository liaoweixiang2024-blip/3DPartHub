import type { TFunction } from 'i18next';
import type { NavItemConfig } from '../lib/businessConfig';

type NavTranslation = {
  key: string;
  shortKey?: string;
  mobileKey?: string;
  knownLabels: string[];
};

const NAV_TRANSLATIONS: Record<string, NavTranslation> = {
  '/': {
    key: 'nav.models',
    shortKey: 'nav.short.models',
    mobileKey: 'nav.home',
    knownLabels: ['模型库', '模型', '首页', 'Model Library', 'Models', 'Home'],
  },
  '/selection': {
    key: 'nav.selection',
    shortKey: 'nav.short.selection',
    knownLabels: ['产品选型', '选型', 'Product Selection', 'Selection'],
  },
  '/category-nav': {
    key: 'nav.categoryNav',
    shortKey: 'nav.short.categoryNav',
    knownLabels: ['系统选型', 'System Selector Map', '系统選定ナビ', '시스템 선택', 'System-Auswahlkarte'],
  },
  '/product-wall': {
    key: 'nav.productWall',
    shortKey: 'nav.short.productWall',
    knownLabels: ['产品图库', '图库', 'Gallery'],
  },
  '/temp-viewer': {
    key: 'nav.tempViewer',
    knownLabels: ['临时看图', 'Temporary Viewer'],
  },
  '/thread-size': {
    key: 'nav.specs',
    shortKey: 'nav.short.specs',
    knownLabels: ['规格查询', '规格', 'Thread Sizes', 'Specs'],
  },
  '/favorites': {
    key: 'nav.favorites',
    shortKey: 'nav.short.favorites',
    knownLabels: ['我的收藏', '收藏', 'Favorites'],
  },
  '/my-shares': {
    key: 'nav.myShares',
    shortKey: 'nav.short.shares',
    knownLabels: ['我的分享', '分享', 'My Shares', 'Shares'],
  },
  '/downloads': {
    key: 'nav.downloads',
    shortKey: 'nav.short.downloads',
    knownLabels: ['下载历史', '下载', 'Download History', 'Downloads'],
  },
  '/my-inquiries': {
    key: 'nav.myInquiries',
    shortKey: 'nav.short.inquiries',
    knownLabels: ['我的询价', '询价', 'My Inquiries', 'Inquiries'],
  },
  '/my-tickets': {
    key: 'nav.myTickets',
    shortKey: 'nav.short.tickets',
    mobileKey: 'nav.myTickets',
    knownLabels: ['我的工单', '工单', 'My Tickets', 'Tickets'],
  },
  '/support': {
    key: 'nav.support',
    shortKey: 'nav.short.support',
    knownLabels: ['技术支持', '支持', 'Support'],
  },
  '/profile': {
    key: 'nav.profile',
    mobileKey: 'nav.my',
    knownLabels: ['个人中心', '个人设置', '我的', 'Profile', 'Profile Settings', 'My'],
  },
  '/admin/models': {
    key: 'nav.admin.models',
    knownLabels: ['模型管理', 'Model Admin'],
  },
  '/admin/categories': {
    key: 'nav.admin.categories',
    knownLabels: ['分类管理', 'Categories'],
  },
  '/admin/selections': {
    key: 'nav.admin.selections',
    knownLabels: ['选型管理', 'Selection Admin'],
  },
  '/admin/inquiries': {
    key: 'nav.admin.inquiries',
    knownLabels: ['询价管理', 'Inquiry Admin'],
  },
  '/admin/tickets': {
    key: 'nav.admin.tickets',
    knownLabels: ['工单处理', 'Ticket Admin'],
  },
  '/admin/users': {
    key: 'nav.admin.users',
    knownLabels: ['用户管理', 'Users'],
  },
  '/admin/shares': {
    key: 'nav.admin.shares',
    knownLabels: ['分享管理', 'Share Admin'],
  },
  '/admin/downloads': {
    key: 'nav.admin.downloads',
    knownLabels: ['下载统计', 'Download Stats'],
  },
  '/admin/audit': {
    key: 'nav.admin.audit',
    knownLabels: ['操作日志', 'Audit Logs'],
  },
  '/admin/settings': {
    key: 'nav.admin.settings',
    knownLabels: ['系统设置', 'System Settings'],
  },
};

function isDefaultNavLabel(item: NavItemConfig, translation: NavTranslation) {
  const label = item.label.trim();
  return translation.knownLabels.includes(label);
}

export function localizeNavLabel(item: NavItemConfig, t: TFunction, mode: 'default' | 'mobile' | 'short' = 'default') {
  const translation = NAV_TRANSLATIONS[item.path];
  if (!translation || !isDefaultNavLabel(item, translation)) return item.label;
  if (mode === 'short' && translation.shortKey) return t(translation.shortKey);
  if (mode === 'mobile' && translation.mobileKey) return t(translation.mobileKey);
  return t(translation.key);
}

export function localizeNavItems(items: NavItemConfig[], t: TFunction, mode: 'default' | 'mobile' = 'default') {
  return items.map((item) => ({
    ...item,
    label: localizeNavLabel(item, t, mode),
  }));
}
