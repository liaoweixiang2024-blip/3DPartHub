import type { SystemSettings } from '../api/settings';
import { getPublicSettingsSnapshot } from './publicSettings';

export interface StatusConfig {
  value: string;
  label: string;
  color?: string;
  bg?: string;
  tab?: boolean;
  terminal?: boolean;
}

export interface TicketClassificationConfig {
  value: string;
  label: string;
  icon: string;
  desc: string;
  enabled?: boolean;
}

export interface SupportStepConfig {
  icon: string;
  title: string;
  desc: string;
}

export interface NavItemConfig {
  label: string;
  icon: string;
  path: string;
  enabled?: boolean;
  roles?: ('USER' | 'ADMIN')[];
}

export interface UploadPolicy {
  modelFormats: string[];
  modelMaxSizeMb: number;
  chunkSizeMb: number;
  chunkThresholdMb: number;
  optionImageMaxSizeMb: number;
  optionImageMimePattern: string;
  selectionImportMaxSizeMb: number;
  selectionImportMaxRows: number;
  selectionImportMaxColumns: number;
  productWallImageMaxSizeMb: number;
  productWallUploadMaxFiles: number;
  ticketAttachmentMaxSizeMb: number;
  ticketAttachmentExts: string[];
}

export const DEFAULT_INQUIRY_STATUSES: StatusConfig[] = [
  { value: 'draft', label: '草稿', color: 'text-on-surface-variant', bg: 'bg-surface-container-highest' },
  { value: 'submitted', label: '待处理', color: 'text-blue-500', bg: 'bg-blue-500/10', tab: true },
  { value: 'quoted', label: '已回复', color: 'text-green-600', bg: 'bg-green-500/10', tab: true },
  {
    value: 'accepted',
    label: '已转销售',
    color: 'text-emerald-600',
    bg: 'bg-emerald-500/10',
    tab: true,
    terminal: true,
  },
  { value: 'rejected', label: '已关闭', color: 'text-red-500', bg: 'bg-red-500/10', tab: true, terminal: true },
  {
    value: 'cancelled',
    label: '已取消',
    color: 'text-on-surface-variant',
    bg: 'bg-surface-container-highest',
    terminal: true,
  },
];

const INQUIRY_STATUS_LABELS: Record<string, string> = {
  submitted: '待处理',
  quoted: '已回复',
  accepted: '已转销售',
  rejected: '已关闭',
};

function normalizeInquiryStatuses(items: StatusConfig[]) {
  return items.map((item) =>
    INQUIRY_STATUS_LABELS[item.value] ? { ...item, label: INQUIRY_STATUS_LABELS[item.value] } : item,
  );
}

export const DEFAULT_TICKET_STATUSES: StatusConfig[] = [
  { value: 'open', label: '待处理', color: 'text-primary-container', bg: 'bg-primary-container/10', tab: true },
  { value: 'waiting_user', label: '待回复', color: 'text-amber-600', bg: 'bg-amber-500/10', tab: true },
  { value: 'in_progress', label: '处理中', color: 'text-blue-500', bg: 'bg-blue-500/10', tab: true },
  { value: 'resolved', label: '已解决', color: 'text-green-500', bg: 'bg-green-500/10', tab: true },
  {
    value: 'closed',
    label: '已关闭',
    color: 'text-on-surface-variant',
    bg: 'bg-surface-container-highest',
    tab: true,
    terminal: true,
  },
];

export const DEFAULT_TICKET_CLASSIFICATIONS: TicketClassificationConfig[] = [
  { value: 'dimension', label: '尺寸修改', icon: 'straighten', desc: '调整模型尺寸参数', enabled: true },
  { value: 'material', label: '材料变更', icon: 'layers', desc: '更换材料属性', enabled: true },
  { value: 'novel', label: '新零件设计', icon: 'add', desc: '全新零件定制', enabled: true },
  { value: 'topology', label: '错误报告', icon: 'error', desc: '报告拓扑问题', enabled: true },
];

export const DEFAULT_SUPPORT_STEPS: SupportStepConfig[] = [
  { icon: 'assignment_add', title: '提交需求', desc: '描述您的定制要求' },
  { icon: 'build', title: '工程师评估', desc: '技术团队评估方案' },
  { icon: 'precision_manufacturing', title: '模型修改', desc: '执行定制化修改' },
  { icon: 'check_circle', title: '交付验收', desc: '确认最终模型' },
];

export const DEFAULT_NAV: NavItemConfig[] = [
  { label: '模型库', icon: 'dashboard', path: '/', enabled: true },
  { label: '产品选型', icon: 'tune', path: '/selection', enabled: true },
  { label: '产品图库', icon: 'image', path: '/product-wall', enabled: true },
  { label: '规格查询', icon: 'straighten', path: '/thread-size', enabled: true },
  { label: '我的收藏', icon: 'star', path: '/favorites', enabled: true },
  { label: '我的分享', icon: 'share', path: '/my-shares', enabled: true },
  { label: '下载历史', icon: 'download', path: '/downloads', enabled: true },
  { label: '我的询价', icon: 'request_quote', path: '/my-inquiries', enabled: true },
  { label: '我的工单', icon: 'assignment_add', path: '/my-tickets', enabled: true },
  { label: '技术支持', icon: 'support_agent', path: '/support', enabled: true },
  { label: '模型管理', icon: 'view_in_ar', path: '/admin/models', enabled: true, roles: ['ADMIN'] },
  { label: '分类管理', icon: 'folder', path: '/admin/categories', enabled: true, roles: ['ADMIN'] },
  { label: '选型管理', icon: 'tune', path: '/admin/selections', enabled: true, roles: ['ADMIN'] },
  { label: '询价管理', icon: 'receipt_long', path: '/admin/inquiries', enabled: true, roles: ['ADMIN'] },
  { label: '工单处理', icon: 'build', path: '/admin/tickets', enabled: true, roles: ['ADMIN'] },
  { label: '用户管理', icon: 'group', path: '/admin/users', enabled: true, roles: ['ADMIN'] },
  { label: '分享管理', icon: 'share', path: '/admin/shares', enabled: true, roles: ['ADMIN'] },
  { label: '下载统计', icon: 'download', path: '/admin/downloads', enabled: true, roles: ['ADMIN'] },
  { label: '操作日志', icon: 'schedule', path: '/admin/audit', enabled: true, roles: ['ADMIN'] },
  { label: '系统设置', icon: 'settings', path: '/admin/settings', enabled: true, roles: ['ADMIN'] },
];

// Legacy aliases for backward compatibility
export const DEFAULT_USER_NAV = DEFAULT_NAV.filter((item) => !isAdminOnly(item));
export const DEFAULT_ADMIN_NAV = DEFAULT_NAV;

export const DEFAULT_MOBILE_NAV: NavItemConfig[] = [
  { label: '首页', icon: 'dashboard', path: '/', enabled: true },
  { label: '选型', icon: 'tune', path: '/selection', enabled: true },
  { label: '收藏', icon: 'star', path: '/favorites', enabled: true },
  { label: '工单', icon: 'assignment_add', path: '/my-tickets', enabled: true },
  { label: '我的', icon: 'person', path: '/profile', enabled: true },
];

export const DEFAULT_UPLOAD_POLICY: UploadPolicy = {
  modelFormats: ['step', 'stp', 'iges', 'igs', 'x_t', 'xt'],
  modelMaxSizeMb: 100,
  chunkSizeMb: 5,
  chunkThresholdMb: 20,
  optionImageMaxSizeMb: 5,
  optionImageMimePattern: 'image\\/(png|jpe?g|gif|webp|svg\\+xml)',
  selectionImportMaxSizeMb: 5,
  selectionImportMaxRows: 10000,
  selectionImportMaxColumns: 200,
  productWallImageMaxSizeMb: 8,
  productWallUploadMaxFiles: 20,
  ticketAttachmentMaxSizeMb: 5,
  ticketAttachmentExts: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
};

const DISABLED_MODEL_UPLOAD_FORMATS = new Set(['html', 'htm']);

export function normalizeUploadPolicy(policy: UploadPolicy): UploadPolicy {
  const modelFormats = Array.from(
    new Set(
      (policy.modelFormats || [])
        .map((item) => item.toLowerCase())
        .filter((item) => item && !DISABLED_MODEL_UPLOAD_FORMATS.has(item)),
    ),
  );
  return { ...policy, modelFormats: modelFormats.length ? modelFormats : DEFAULT_UPLOAD_POLICY.modelFormats };
}

export const DEFAULT_THREAD_PRIORITY: Record<string, number> = {
  R: 0,
  RC: 0,
  G: 1,
  '': 2,
  NPT: 3,
  PT: 4,
  ZG: 4,
  M: 5,
};

export function parseSetting<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return value && typeof value === 'object' ? (value as T) : fallback;
  if (!value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

export function isAdminOnly(item: NavItemConfig): boolean {
  if (item.roles?.includes('ADMIN')) return true;
  return item.path.startsWith('/admin/');
}

function enabled<T extends { enabled?: boolean; path?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.enabled === false) return false;
    if ('path' in item && typeof item.path === 'string') {
      if (seen.has(item.path)) return false;
      seen.add(item.path);
    }
    return true;
  });
}

// Migrate legacy split nav_user_items + nav_admin_items into unified nav_items
function migrateLegacyNav(settings: Partial<SystemSettings>): NavItemConfig[] | null {
  const navItems = parseSetting<NavItemConfig[] | undefined>(settings.nav_items, undefined);
  if (navItems) return navItems;

  const userItems = parseSetting<NavItemConfig[] | undefined>(settings.nav_user_items, undefined);
  const adminItems = parseSetting<NavItemConfig[] | undefined>(settings.nav_admin_items, undefined);
  if (!userItems && !adminItems) return null;

  const merged: NavItemConfig[] = [...(userItems || [])];
  const existingPaths = new Set(merged.map((i) => i.path));
  for (const item of adminItems || []) {
    if (!existingPaths.has(item.path)) {
      merged.push({ ...item, roles: ['ADMIN'] });
      existingPaths.add(item.path);
    }
  }
  return merged;
}

export function getBusinessConfig(settings: Partial<SystemSettings> = getPublicSettingsSnapshot()) {
  const pageSizePolicy = {
    homeDefault: 60,
    homeMax: 10000,
    homeOption1: 30,
    homeOption2: 60,
    homeOption3: 120,
    homeOption4: 180,
    selectionDefault: 50,
    selectionMax: 50000,
    selectionAdminRenderBatch: 120,
    selectionGeneratePreviewPageSize: 50,
    inquiryAdminDefault: 20,
    inquiryAdminMax: 100,
    ticketListMax: 50,
    notificationDefault: 20,
    notificationMax: 100,
    adminUserDefault: 20,
    adminUserMax: 100,
    shareAdminDefault: 20,
    shareAdminMax: 100,
    auditDefault: 50,
    auditMax: 100,
    userBatchDownloadMax: 100,
    adminBatchDownloadMax: 50,
    ...parseSetting<Record<string, number>>(settings.page_size_policy, {}),
  };

  const allNav = migrateLegacyNav(settings) || DEFAULT_NAV;
  const filteredNav = enabled(allNav);

  return {
    inquiryStatuses: normalizeInquiryStatuses(parseSetting(settings.inquiry_statuses, DEFAULT_INQUIRY_STATUSES)),
    ticketStatuses: parseSetting(settings.ticket_statuses, DEFAULT_TICKET_STATUSES),
    ticketClassifications: enabled(parseSetting(settings.ticket_classifications, DEFAULT_TICKET_CLASSIFICATIONS)),
    supportProcessSteps: parseSetting(settings.support_process_steps, DEFAULT_SUPPORT_STEPS),
    userNav: filteredNav.filter((item) => !isAdminOnly(item)),
    adminNav: filteredNav,
    mobileNav: enabled(parseSetting(settings.nav_mobile_items, DEFAULT_MOBILE_NAV)),
    uploadPolicy: normalizeUploadPolicy({
      ...DEFAULT_UPLOAD_POLICY,
      ...parseSetting<Partial<UploadPolicy>>(settings.upload_policy, {}),
    }),
    threadPriority: {
      ...DEFAULT_THREAD_PRIORITY,
      ...parseSetting<Record<string, number>>(settings.selection_thread_priority, {}),
    },
    pageSizePolicy,
  };
}

export function statusInfo(statuses: StatusConfig[], value: string) {
  return statuses.find((item) => item.value === value) || statuses[0] || { value, label: value };
}
