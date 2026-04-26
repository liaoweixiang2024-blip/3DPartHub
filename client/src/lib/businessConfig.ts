import type { SystemSettings } from "../api/settings";
import { getCachedPublicSettings } from "./publicSettings";

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
}

export interface UploadPolicy {
  modelFormats: string[];
  modelMaxSizeMb: number;
  chunkSizeMb: number;
  chunkThresholdMb: number;
  optionImageMaxSizeMb: number;
  optionImageMimePattern: string;
  ticketAttachmentMaxSizeMb: number;
  ticketAttachmentExts: string[];
}

export const DEFAULT_INQUIRY_STATUSES: StatusConfig[] = [
  { value: "draft", label: "草稿", color: "text-on-surface-variant", bg: "bg-surface-container-highest" },
  { value: "submitted", label: "待报价", color: "text-blue-500", bg: "bg-blue-500/10", tab: true },
  { value: "quoted", label: "已报价", color: "text-green-600", bg: "bg-green-500/10", tab: true },
  { value: "accepted", label: "已接受", color: "text-emerald-600", bg: "bg-emerald-500/10", tab: true, terminal: true },
  { value: "rejected", label: "已拒绝", color: "text-red-500", bg: "bg-red-500/10", tab: true, terminal: true },
  { value: "cancelled", label: "已取消", color: "text-on-surface-variant", bg: "bg-surface-container-highest", terminal: true },
];

export const DEFAULT_TICKET_STATUSES: StatusConfig[] = [
  { value: "open", label: "待处理", color: "text-primary-container", bg: "bg-primary-container/10", tab: true },
  { value: "waiting_user", label: "待回复", color: "text-amber-600", bg: "bg-amber-500/10", tab: true },
  { value: "in_progress", label: "处理中", color: "text-blue-500", bg: "bg-blue-500/10", tab: true },
  { value: "resolved", label: "已解决", color: "text-green-500", bg: "bg-green-500/10", tab: true },
  { value: "closed", label: "已关闭", color: "text-on-surface-variant", bg: "bg-surface-container-highest", tab: true, terminal: true },
];

export const DEFAULT_TICKET_CLASSIFICATIONS: TicketClassificationConfig[] = [
  { value: "dimension", label: "尺寸修改", icon: "straighten", desc: "调整模型尺寸参数", enabled: true },
  { value: "material", label: "材料变更", icon: "layers", desc: "更换材料属性", enabled: true },
  { value: "novel", label: "新零件设计", icon: "add", desc: "全新零件定制", enabled: true },
  { value: "topology", label: "错误报告", icon: "error", desc: "报告拓扑问题", enabled: true },
];

export const DEFAULT_SUPPORT_STEPS: SupportStepConfig[] = [
  { icon: "assignment_add", title: "提交需求", desc: "描述您的定制要求" },
  { icon: "build", title: "工程师评估", desc: "技术团队评估方案" },
  { icon: "precision_manufacturing", title: "模型修改", desc: "执行定制化修改" },
  { icon: "check_circle", title: "交付验收", desc: "确认最终模型" },
];

export const DEFAULT_USER_NAV: NavItemConfig[] = [
  { label: "模型库", icon: "dashboard", path: "/", enabled: true },
  { label: "产品选型", icon: "tune", path: "/selection", enabled: true },
  { label: "我的收藏", icon: "star", path: "/favorites", enabled: true },
  { label: "我的询价", icon: "request_quote", path: "/my-inquiries", enabled: true },
  { label: "下载历史", icon: "download", path: "/downloads", enabled: true },
  { label: "我的工单", icon: "assignment_add", path: "/my-tickets", enabled: true },
  { label: "技术支持", icon: "support_agent", path: "/support", enabled: true },
];

export const DEFAULT_ADMIN_NAV: NavItemConfig[] = [
  ...DEFAULT_USER_NAV,
  { label: "模型管理", icon: "view_in_ar", path: "/admin/models", enabled: true },
  { label: "分类管理", icon: "folder", path: "/admin/categories", enabled: true },
  { label: "选型管理", icon: "tune", path: "/admin/selections", enabled: true },
  { label: "询价管理", icon: "receipt_long", path: "/admin/inquiries", enabled: true },
  { label: "单据模板", icon: "description", path: "/admin/quote-template", enabled: true },
  { label: "工单处理", icon: "build", path: "/admin/tickets", enabled: true },
  { label: "用户管理", icon: "group", path: "/admin/users", enabled: true },
  { label: "分享管理", icon: "share", path: "/admin/shares", enabled: true },
  { label: "操作日志", icon: "schedule", path: "/admin/audit", enabled: true },
  { label: "系统设置", icon: "settings", path: "/admin/settings", enabled: true },
];

export const DEFAULT_MOBILE_NAV: NavItemConfig[] = [
  { label: "首页", icon: "dashboard", path: "/", enabled: true },
  { label: "选型", icon: "tune", path: "/selection", enabled: true },
  { label: "收藏", icon: "star", path: "/favorites", enabled: true },
  { label: "工单", icon: "assignment_add", path: "/my-tickets", enabled: true },
  { label: "我的", icon: "person", path: "/profile", enabled: true },
];

export const DEFAULT_UPLOAD_POLICY: UploadPolicy = {
  modelFormats: ["step", "stp", "x_t", "xt"],
  modelMaxSizeMb: 100,
  chunkSizeMb: 5,
  chunkThresholdMb: 20,
  optionImageMaxSizeMb: 5,
  optionImageMimePattern: "image\\/(png|jpe?g|gif|webp|svg\\+xml)",
  ticketAttachmentMaxSizeMb: 5,
  ticketAttachmentExts: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
};

export const DEFAULT_THREAD_PRIORITY: Record<string, number> = {
  R: 0,
  RC: 0,
  G: 1,
  "": 2,
  NPT: 3,
  PT: 4,
  ZG: 4,
  M: 5,
};

export function parseSetting<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return value && typeof value === "object" ? value as T : fallback;
  if (!value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

function enabled<T extends { enabled?: boolean }>(items: T[]) {
  return items.filter((item) => item.enabled !== false);
}

function normalizeAdminNav(items: NavItemConfig[]) {
  return items.map((item) => (
    item.path === "/admin/quote-template" && item.label === "报价模板"
      ? { ...item, label: "单据模板" }
      : item
  ));
}

export function getBusinessConfig(settings: Partial<SystemSettings> = getCachedPublicSettings()) {
  return {
    inquiryStatuses: parseSetting(settings.inquiry_statuses, DEFAULT_INQUIRY_STATUSES),
    ticketStatuses: parseSetting(settings.ticket_statuses, DEFAULT_TICKET_STATUSES),
    ticketClassifications: enabled(parseSetting(settings.ticket_classifications, DEFAULT_TICKET_CLASSIFICATIONS)),
    supportProcessSteps: parseSetting(settings.support_process_steps, DEFAULT_SUPPORT_STEPS),
    userNav: enabled(parseSetting(settings.nav_user_items, DEFAULT_USER_NAV)),
    adminNav: enabled(normalizeAdminNav(parseSetting(settings.nav_admin_items, DEFAULT_ADMIN_NAV))),
    mobileNav: enabled(parseSetting(settings.nav_mobile_items, DEFAULT_MOBILE_NAV)),
    uploadPolicy: { ...DEFAULT_UPLOAD_POLICY, ...parseSetting<Partial<UploadPolicy>>(settings.upload_policy, {}) },
    threadPriority: { ...DEFAULT_THREAD_PRIORITY, ...parseSetting<Record<string, number>>(settings.selection_thread_priority, {}) },
  };
}

export function statusInfo(statuses: StatusConfig[], value: string) {
  return statuses.find((item) => item.value === value) || statuses[0] || { value, label: value };
}
