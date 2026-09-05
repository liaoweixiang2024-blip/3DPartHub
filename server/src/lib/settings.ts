import {
  DEFAULT_INQUIRY_STATUSES_FOR_SETTINGS,
  DEFAULT_MOBILE_NAV_FOR_SETTINGS,
  DEFAULT_NAV_FOR_SETTINGS,
  DEFAULT_PAGE_SIZE_POLICY_FOR_SETTINGS,
  DEFAULT_SELECTION_THREAD_PRIORITY_FOR_SETTINGS,
  DEFAULT_SUPPORT_STEPS_FOR_SETTINGS,
  DEFAULT_TICKET_CLASSIFICATIONS_FOR_SETTINGS,
  DEFAULT_TICKET_STATUSES_FOR_SETTINGS,
  DEFAULT_UPLOAD_POLICY_FOR_SETTINGS,
} from './businessDefaults.js';
import { cacheDel, redis } from './cache.js';
import { config } from './config.js';
import { DEFAULT_EMAIL_TEMPLATES } from './emailTemplates.js';
import { prisma } from './prisma.js';

interface SettingDef {
  key: string;
  defaultValue: unknown;
}

const DEFAULT_MAINTENANCE_TITLE = '系统维护中';
const DEFAULT_MAINTENANCE_MESSAGE = '系统正在进行维护、数据恢复或资源重建，部分页面可能暂时不可用。请稍后再访问。';
const LEGACY_MAINTENANCE_TITLE = '模型库维护中';
const LEGACY_MAINTENANCE_MESSAGE = '模型预览资源正在重建，部分模型数量和缩略图可能暂时不完整。请稍后再访问。';
const DEFAULT_COPYRIGHT_PROJECT_NAME = '3DPartHub';
const DEFAULT_INTERFACE_THEME_KEYS = ['workbench', 'classic'] as const;
const DEFAULT_MOBILE_THEME_KEYS = ['classic'] as const;
const HOME_LIST_LOADING_MODE_KEYS = ['infinite', 'pagination'] as const;
const UI_LOCALE_KEYS = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'de-DE'] as const;
const DEFAULT_UI_ENABLED_LOCALES = UI_LOCALE_KEYS.join(',');
const COLOR_SCHEME_KEYS = ['orange', 'blue', 'green', 'purple', 'red', 'teal', 'custom'] as const;
const CACHE_DRIVER_KEYS = ['redis', 'memory', 'off'] as const;
const STORAGE_PROVIDER_KEYS = ['local', 'minio', 'tencent_cos', 'aliyun_oss', 'qiniu_kodo', 's3_compatible'] as const;
const MASKED_SECRET_VALUE = '********';
const LEGACY_LOCAL_REDIS_URLS = new Set(['redis://localhost:6379', 'redis://127.0.0.1:6379']);
const MAX_CUSTOM_COLOR_JSON_LENGTH = 20_000;
export const CONTACT_PHONE_SETTING_MESSAGE =
  '联系电话格式不正确，请填写中国手机号、带区号座机、400/800 服务电话或国际号码';
const DEFAULT_USER_NAV_FOR_SETTINGS = DEFAULT_NAV_FOR_SETTINGS.filter(
  (item) => !item.roles?.includes('ADMIN') && !item.path.startsWith('/admin/'),
);
const DEFAULT_ADMIN_NAV_FOR_SETTINGS = DEFAULT_NAV_FOR_SETTINGS;
const SENSITIVE_SETTING_KEYS = new Set(['smtp_pass', 'redis_password', 'storage_access_key_secret']);

function getCopyrightYear(): string {
  return String(new Date().getFullYear());
}

function normalizeCopyrightProjectName(siteTitle: unknown): string {
  return String(siteTitle || '').trim() || DEFAULT_COPYRIGHT_PROJECT_NAME;
}

export function buildFooterCopyright(siteTitle?: unknown): string {
  return `© ${getCopyrightYear()} ${normalizeCopyrightProjectName(siteTitle)}. All rights reserved.`;
}

export function buildModelDetailCopyright(siteTitle?: unknown): string {
  return `© ${getCopyrightYear()} ${normalizeCopyrightProjectName(siteTitle)}`;
}

export const DEFAULT_FOOTER_COPYRIGHT = buildFooterCopyright(DEFAULT_COPYRIGHT_PROJECT_NAME);
export const DEFAULT_MODEL_DETAIL_DISCLAIMER =
  '本平台所有 3D 模型仅供参考与模拟验证，不作为生产加工依据。产品持续迭代更新，请以实物为准。';
export const DEFAULT_MODEL_DETAIL_COPYRIGHT = buildModelDetailCopyright(DEFAULT_COPYRIGHT_PROJECT_NAME);

// ---- 分类选型导航页（/category-nav）----
export interface CategoryNavGroup {
  id: string;
  name: string;
  color: string;
}
/** 节点内挂的分类项：单分类节点显示大图，多分类节点每项一块小图 */
export interface CategoryNavItem {
  categoryId: string | null;
  customName?: string;
  imageUrl?: string;
  /** 合并名：弹窗里与另一 section 同名行合并成一行（如选型「竹节管」alias=万向管 → 与模型「万向管」同一行双按钮） */
  alias?: string;
}
export interface CategoryNavNode {
  id: string;
  groupId: string;
  /** 兼容旧结构（单分类）：读取时迁移为 items[0]（此时 imageUrl 归入 items[0]） */
  categoryId?: string | null;
  customName?: string;
  /** 节点级图标图（拓扑图卡位插画位）；优先于 SMC 默认插画 */
  imageUrl?: string;
  /** 节点显示名（拓扑图卡位标签）；未设置时前台回退默认文案 */
  label?: string;
  /** 节点可挂多个分类（1~6 项） */
  items?: CategoryNavItem[];
  description?: string;
}
export interface CategoryNavSection {
  groups: CategoryNavGroup[];
  nodes: CategoryNavNode[];
}
export interface CategoryNavConfig {
  model: CategoryNavSection;
  selection: CategoryNavSection;
}

/**
 * 默认配置：三条介质线（气源处理 / 冷却水路 / 液压润滑）+ 通用件。
 *
 * 设计给培训用——每条线内的节点顺序 = 介质在系统里的工艺流程顺序
 * （源头 → 处理 → 输送 → 连接 → 终端），新人沿连线走一遍即懂拓扑。
 * 水气混装分类的处理约定：能按子分类拆开的挂子分类；跨介质关键件
 * （阀门/仪表/宝塔等）在所属的每条线各放一个节点——同一分类被多个
 * 节点引用是合法的，培训时每条线自成一体；非关键混装件归通用件组。
 *
 * model section 的 categoryId 引用种子分类 ID（中文名即 ID）；
 * selection section 引用北泽选型目录的 slug（beize-xx-xx）。
 * 注意「储气罐套装」的分类 ID 是 UUID（历史数据改名产生），不能按名
 * 引用，故未纳入默认节点——需要时在后台手动添加。
 */
const DEFAULT_MODEL_NAV: CategoryNavSection = {
  groups: [
    { id: 'air', name: '气源处理', color: '#2563eb' },
    { id: 'cooling', name: '冷却水路', color: '#16a34a' },
    { id: 'oil', name: '液压润滑', color: '#d97706' },
    { id: 'common', name: '通用件与资料', color: '#64748b' },
  ],
  nodes: [
    // —— 气源处理：储气 → 净化 → 控压 → 阀控 → 集成 → 输送 → 连接 → 用气 ——
    { id: 'air-01', groupId: 'air', categoryId: '储气罐', description: '气源储能' },
    { id: 'air-02', groupId: 'air', categoryId: '气动元件', description: '阀控执行（SMC/亚德客/费斯托/金器）' },
    { id: 'air-03', groupId: 'air', categoryId: '气控模块', description: '集成控制' },
    { id: 'air-04', groupId: 'air', categoryId: '气控集成板', description: '集成控制' },
    { id: 'air-05', groupId: 'air', categoryId: '气动组合', description: '集成供气单元' },
    { id: 'air-06', groupId: 'air', categoryId: '万向管', description: '输送管路（可调位）' },
    { id: 'air-07', groupId: 'air', categoryId: '管道', description: '输送管路' },
    { id: 'air-08', groupId: 'air', categoryId: '气动接头', description: '输送连接' },
    { id: 'air-09', groupId: 'air', categoryId: '铜快插', description: '输送连接' },
    { id: 'air-10', groupId: 'air', categoryId: '铜快拧', description: '输送连接' },
    { id: 'air-11', groupId: 'air', categoryId: '快插接头', description: '不锈钢快插' },
    { id: 'air-12', groupId: 'air', categoryId: '快拧接头', description: '不锈钢快拧' },
    { id: 'air-13', groupId: 'air', categoryId: '铜卡套', description: '输送连接' },
    { id: 'air-14', groupId: 'air', categoryId: '气枪', description: '用气终端' },
    { id: 'air-15', groupId: 'air', categoryId: '气枪套装', description: '用气终端方案' },
    { id: 'air-16', groupId: 'air', categoryId: 'SMC气动模块', description: '整线方案' },
    { id: 'air-17', groupId: 'air', categoryId: '费斯托气动模块', description: '整线方案' },
    // —— 冷却水路：源头 → 分配 → 输送 → 连接 → 喷射 → 冲洗 ——
    { id: 'water-01', groupId: 'cooling', categoryId: '中心出水', description: '冷却源头' },
    { id: 'water-02', groupId: 'cooling', categoryId: '分流块', description: '流量分配' },
    { id: 'water-03', groupId: 'cooling', categoryId: '万向管', description: '输送（可调位）' },
    { id: 'water-04', groupId: 'cooling', categoryId: '304焊直通', description: '焊接输送管路' },
    { id: 'water-05', groupId: 'cooling', categoryId: '不锈钢管件', description: '输送连接' },
    { id: 'water-06', groupId: 'cooling', categoryId: '铁管件', description: '输送连接' },
    { id: 'water-07', groupId: 'cooling', categoryId: '高压喷嘴', description: '终端喷射' },
    { id: 'water-08', groupId: 'cooling', categoryId: '环喷', description: '环形喷射' },
    { id: 'water-09', groupId: 'cooling', categoryId: '水枪', description: '手动冲洗' },
    { id: 'water-10', groupId: 'cooling', categoryId: '水枪套装', description: '终端方案' },
    { id: 'water-11', groupId: 'cooling', categoryId: '水路模组', description: '整线方案' },
    // —— 液压润滑：输送 → 连接 → 转接 → 润滑 ——
    { id: 'oil-01', groupId: 'oil', categoryId: '高压油管', description: '油路输送' },
    { id: 'oil-02', groupId: 'oil', categoryId: '高压油管总成', description: '总成输送' },
    { id: 'oil-03', groupId: 'oil', categoryId: '油管扣压接头', description: '扣压连接' },
    { id: 'oil-04', groupId: 'oil', categoryId: '彩锌液压件', description: '液压连接' },
    { id: 'oil-05', groupId: 'oil', categoryId: '白锌液压件', description: '液压连接' },
    { id: 'oil-06', groupId: 'oil', categoryId: '碳钢接头', description: '液压连接' },
    { id: 'oil-07', groupId: 'oil', categoryId: '宝塔', description: '软管转接（水气油通用）' },
    { id: 'oil-08', groupId: 'oil', categoryId: '润滑配件', description: '润滑油路' },
    { id: 'oil-09', groupId: 'oil', categoryId: '油路套装', description: '整线方案' },
    // —— 通用件：跨介质共用 ——
    { id: 'common-01', groupId: 'common', categoryId: '不锈钢阀门', description: '管路开关（水气通用）' },
    { id: 'common-02', groupId: 'common', categoryId: '铜阀门', description: '管路开关（水气通用）' },
    { id: 'common-03', groupId: 'common', categoryId: '仪表', description: '压力监测（水气油通用）' },
    { id: 'common-04', groupId: 'common', categoryId: '铜宝塔', description: '软管转接（水气通用）' },
    { id: 'common-05', groupId: 'common', categoryId: '钣金', description: '安装结构件' },
    { id: 'common-06', groupId: 'common', categoryId: '其他辅料', description: '辅料' },
  ],
};

/** 选型导航（北泽目录）：与模型导航同构的四线映射，categoryId 为选型 slug */
const DEFAULT_SELECTION_NAV: CategoryNavSection = {
  groups: [
    { id: 'air', name: '气源处理', color: '#2563eb' },
    { id: 'cooling', name: '冷却水路', color: '#16a34a' },
    { id: 'oil', name: '液压润滑', color: '#d97706' },
    { id: 'common', name: '通用件与资料', color: '#64748b' },
  ],
  nodes: [
    // —— 气源处理 ——
    { id: 'sel-air-01', groupId: 'air', categoryId: 'beize-03-03', description: '储气罐' },
    { id: 'sel-air-02', groupId: 'air', categoryId: 'beize-07-07', description: '前置过滤器' },
    { id: 'sel-air-03', groupId: 'air', categoryId: 'beize-07-05', description: 'ADTV 排水器' },
    { id: 'sel-air-04', groupId: 'air', categoryId: 'beize-07-01', description: '压力表系列' },
    { id: 'sel-air-05', groupId: 'air', categoryId: 'beize-07-10', description: '压力开关 / 数显传感器' },
    { id: 'sel-air-06', groupId: 'air', categoryId: 'beize-07-04', description: 'VBA 增压器' },
    { id: 'sel-air-07', groupId: 'air', categoryId: 'beize-02-02', description: '铜阀门（气路阀控）' },
    { id: 'sel-air-08', groupId: 'air', categoryId: 'beize-07-03', description: '气控集成方案' },
    { id: 'sel-air-09', groupId: 'air', categoryId: 'beize-05-01', description: '气管 / 尼龙管 / 螺旋管' },
    { id: 'sel-air-10', groupId: 'air', categoryId: 'beize-05-02', description: '公母型快速接头' },
    { id: 'sel-air-11', groupId: 'air', categoryId: 'beize-01-01', description: '塑料快插接头' },
    { id: 'sel-air-12', groupId: 'air', categoryId: 'beize-01-02', description: '全铜快插接头' },
    { id: 'sel-air-13', groupId: 'air', categoryId: 'beize-01-03', description: '全铜快拧接头' },
    { id: 'sel-air-14', groupId: 'air', categoryId: 'beize-01-04', description: '全铜卡套接头' },
    { id: 'sel-air-15', groupId: 'air', categoryId: 'beize-01-06', description: '不锈钢快插接头' },
    { id: 'sel-air-16', groupId: 'air', categoryId: 'beize-01-07', description: '不锈钢快拧接头' },
    { id: 'sel-air-17', groupId: 'air', categoryId: 'beize-03-02', description: '气枪系列' },
    { id: 'sel-air-18', groupId: 'air', categoryId: 'beize-07-11', description: '气源模组选型' },
    { id: 'sel-air-19', groupId: 'air', categoryId: 'beize-07-06', description: '油、气接方案' },
    // —— 冷却水路 ——
    { id: 'sel-water-01', groupId: 'cooling', categoryId: 'beize-03-05', description: '竹节管（可调位输送）' },
    { id: 'sel-water-02', groupId: 'cooling', categoryId: 'beize-01-08', description: '不锈钢管件' },
    { id: 'sel-water-03', groupId: 'cooling', categoryId: 'beize-01-09', description: '不锈钢快速接头' },
    { id: 'sel-water-04', groupId: 'cooling', categoryId: 'beize-03-04', description: '高压喷嘴' },
    { id: 'sel-water-05', groupId: 'cooling', categoryId: 'beize-03-01', description: '水枪系列' },
    { id: 'sel-water-06', groupId: 'cooling', categoryId: 'beize-02-01', description: '不锈钢阀门（水路阀控）' },
    // —— 液压润滑 ——
    { id: 'sel-oil-01', groupId: 'oil', categoryId: 'beize-04-01', description: '高压油管总成' },
    { id: 'sel-oil-02', groupId: 'oil', categoryId: 'beize-04-02', description: '彩锌油管接头' },
    { id: 'sel-oil-03', groupId: 'oil', categoryId: 'beize-04-03', description: '油管 / 管卡 / 喉箍' },
    { id: 'sel-oil-04', groupId: 'oil', categoryId: 'beize-06-01', description: '润滑配件' },
    // —— 通用件与资料 ——
    { id: 'sel-common-01', groupId: 'common', categoryId: 'beize-01-05', description: '精品铜接头（水气通用）' },
    { id: 'sel-common-02', groupId: 'common', categoryId: 'beize-07-08', description: '圣戈班密封胶 / 螺纹密封' },
    { id: 'sel-common-03', groupId: 'common', categoryId: 'beize-07-09', description: '流体兼容性对照表' },
  ],
};

export const DEFAULT_CATEGORY_NAV_CONFIG: CategoryNavConfig = {
  model: DEFAULT_MODEL_NAV,
  selection: DEFAULT_SELECTION_NAV,
};

const CATEGORY_NAV_SECTION_LIMITS = { groups: 6, nodes: 100 } as const;
/** 每个节点最多挂的分类项数（多分类小图块） */
const CATEGORY_NAV_ITEM_LIMIT = 6;
const CATEGORY_NAV_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CATEGORY_NAV_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** 校验并规范化单个 section；非法输入整体回退默认，不抛错（与其它 setting 校验风格一致） */
function normalizeCategoryNavSection(value: unknown): CategoryNavSection {
  const fallback: CategoryNavSection = { groups: [], nodes: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const raw = value as Partial<CategoryNavSection>;
  if (!Array.isArray(raw.groups) || !Array.isArray(raw.nodes)) return fallback;
  if (raw.groups.length > CATEGORY_NAV_SECTION_LIMITS.groups) return fallback;
  if (raw.nodes.length > CATEGORY_NAV_SECTION_LIMITS.nodes) return fallback;

  const groups: CategoryNavGroup[] = [];
  const groupIds = new Set<string>();
  for (const g of raw.groups) {
    if (!g || typeof g !== 'object') return fallback;
    const id = String((g as CategoryNavGroup).id ?? '').trim();
    const name = String((g as CategoryNavGroup).name ?? '')
      .trim()
      .slice(0, 30);
    const color = String((g as CategoryNavGroup).color ?? '').trim();
    if (!CATEGORY_NAV_ID_RE.test(id) || !name || !CATEGORY_NAV_COLOR_RE.test(color)) return fallback;
    if (groupIds.has(id)) return fallback;
    groupIds.add(id);
    groups.push({ id, name, color });
  }

  const nodes: CategoryNavNode[] = [];
  const nodeIds = new Set<string>();
  for (const n of raw.nodes) {
    if (!n || typeof n !== 'object') return fallback;
    const row = n as CategoryNavNode;
    const id = String(row.id ?? '').trim();
    const groupId = String(row.groupId ?? '').trim();
    if (!CATEGORY_NAV_ID_RE.test(id) || nodeIds.has(id)) return fallback;
    if (!groupIds.has(groupId)) return fallback;

    // 旧结构（categoryId 直挂在节点上）迁移为 items[0]；新结构直接读 items。
    // 每项：有 categoryId 或有 customName 二者其一即合法。
    // 节点级 imageUrl 只在新结构（有 items）时保留为节点图标；旧结构归入 items[0]。
    const isLegacy = !(Array.isArray(row.items) && row.items.length);
    const nodeImageUrl = !isLegacy && typeof row.imageUrl === 'string' ? row.imageUrl.trim() : '';
    const rawItems: CategoryNavItem[] = isLegacy
      ? [
          {
            categoryId: row.categoryId ?? null,
            customName: row.customName,
            imageUrl: row.imageUrl,
          },
        ]
      : row.items!.slice(0, CATEGORY_NAV_ITEM_LIMIT);
    const items: CategoryNavItem[] = [];
    for (const it of rawItems) {
      if (!it || typeof it !== 'object') return fallback;
      const categoryId = it.categoryId == null ? null : String(it.categoryId).trim().slice(0, 128);
      const customName = it.customName == null ? undefined : String(it.customName).trim().slice(0, 50);
      if (categoryId == null && !customName) continue; // 跳过空项（如后台删剩的占位）
      const alias = it.alias == null ? undefined : String(it.alias).trim().slice(0, 50);
      items.push({
        categoryId,
        ...(customName ? { customName } : {}),
        ...(typeof it.imageUrl === 'string' && it.imageUrl.trim()
          ? { imageUrl: it.imageUrl.trim().slice(0, 500) }
          : {}),
        ...(alias ? { alias } : {}),
      });
    }
    if (items.length === 0) return fallback; // 节点至少要有一个有效项
    nodeIds.add(id);
    const nodeLabel = row.label == null ? undefined : String(row.label).trim().slice(0, 30);
    nodes.push({
      id,
      groupId,
      items,
      // 节点级图标图（拓扑图卡位插画位）；未传时前台回退 SMC 默认插画
      ...(nodeImageUrl ? { imageUrl: nodeImageUrl.slice(0, 500) } : {}),
      ...(nodeLabel ? { label: nodeLabel } : {}),
      ...(row.description != null && String(row.description).trim()
        ? { description: String(row.description).trim().slice(0, 100) }
        : {}),
    });
  }

  return { groups, nodes };
}

/** category_nav_config 校验入口：两个 section 各自校验，整体失败回默认 */
export function normalizeCategoryNavConfigSetting(value: unknown): string {
  let parsed = value;
  if (typeof value === 'string') {
    if (!value.trim()) return JSON.stringify(DEFAULT_CATEGORY_NAV_CONFIG, null, 2);
    try {
      parsed = JSON.parse(value);
    } catch {
      return JSON.stringify(DEFAULT_CATEGORY_NAV_CONFIG, null, 2);
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return JSON.stringify(DEFAULT_CATEGORY_NAV_CONFIG, null, 2);
  }
  const raw = parsed as Partial<CategoryNavConfig>;
  const config: CategoryNavConfig = {
    model: normalizeCategoryNavSection(raw.model),
    selection: normalizeCategoryNavSection(raw.selection),
  };
  const serialized = JSON.stringify(config);
  if (serialized.length > 200_000) return JSON.stringify(DEFAULT_CATEGORY_NAV_CONFIG, null, 2);
  return JSON.stringify(config, null, 2);
}

type FooterLink = { label: string; url: string };

export function normalizeFooterLinksSetting(value: unknown): string {
  let parsed = value;
  if (typeof value === 'string') {
    if (!value.trim()) return '[]';
    try {
      parsed = JSON.parse(value);
    } catch {
      return '[]';
    }
  }
  if (!Array.isArray(parsed)) return '[]';
  const links = parsed
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as Partial<FooterLink>) : {};
      return {
        label: typeof row.label === 'string' ? row.label.trim() : '',
        url: typeof row.url === 'string' ? row.url.trim() : '',
      };
    })
    .filter((link) => link.label && link.url);
  return JSON.stringify(links, null, 2);
}

const SETTINGS_SCHEMA: SettingDef[] = [
  { key: 'require_login_download', defaultValue: false },
  { key: 'require_login_browse', defaultValue: false },
  { key: 'allow_register', defaultValue: true },
  { key: 'auth_modal_enabled', defaultValue: true },
  { key: 'login_dialog_enabled', defaultValue: true },
  { key: 'login_dialog_favorites', defaultValue: true },
  { key: 'login_dialog_downloads', defaultValue: true },
  { key: 'login_dialog_my_shares', defaultValue: true },
  { key: 'login_dialog_profile', defaultValue: true },
  { key: 'login_dialog_support', defaultValue: true },
  { key: 'login_dialog_my_tickets', defaultValue: true },
  { key: 'login_dialog_my_inquiries', defaultValue: true },
  { key: 'login_dialog_projects', defaultValue: true },
  { key: 'daily_download_limit', defaultValue: 0 },
  { key: 'show_watermark', defaultValue: false },
  { key: 'watermark_text', defaultValue: '3DPartHub' },
  { key: 'watermark_image', defaultValue: '' },
  { key: 'site_title', defaultValue: '3DPartHub' },
  { key: 'site_browser_title', defaultValue: '' },
  // PWA 安装名称（site.webmanifest 的 name/short_name）。空串 = 跟随 site_title。
  { key: 'site_app_name', defaultValue: '' },
  // PWA 安装图标（Chrome 安装 / iOS 主屏）。空串 = 用镜像内置默认图标。
  { key: 'site_app_icon', defaultValue: '' },
  // PWA 应用描述（site.webmanifest 的 description，Chrome 安装后的应用备注）。
  // 空串 = 跟随 site_description；都为空时用内置默认英文。
  { key: 'site_app_desc', defaultValue: '' },
  { key: 'site_logo', defaultValue: '' },
  { key: 'site_icon', defaultValue: '' },
  { key: 'site_favicon', defaultValue: '/favicon.svg' },
  { key: 'site_logo_display', defaultValue: 'logo_and_title' },
  { key: 'site_description', defaultValue: '' },
  { key: 'site_keywords', defaultValue: '' },
  { key: 'announcement_enabled', defaultValue: false },
  { key: 'announcement_text', defaultValue: '' },
  { key: 'announcement_type', defaultValue: 'info' },
  { key: 'announcement_color', defaultValue: '' },
  { key: 'maintenance_enabled', defaultValue: false },
  { key: 'maintenance_auto_enabled', defaultValue: true },
  { key: 'maintenance_auto_queue_threshold', defaultValue: 50 },
  { key: 'maintenance_title', defaultValue: DEFAULT_MAINTENANCE_TITLE },
  { key: 'maintenance_message', defaultValue: DEFAULT_MAINTENANCE_MESSAGE },
  { key: 'conversion_worker_concurrency', defaultValue: 1 },
  { key: 'smtp_host', defaultValue: '' },
  { key: 'smtp_port', defaultValue: 465 },
  { key: 'smtp_user', defaultValue: '' },
  { key: 'smtp_pass', defaultValue: '' },
  { key: 'smtp_from', defaultValue: '' },
  { key: 'smtp_secure', defaultValue: true },
  { key: 'email_templates', defaultValue: JSON.stringify(DEFAULT_EMAIL_TEMPLATES, null, 2) },
  { key: 'contact_email', defaultValue: '' },
  { key: 'contact_phone', defaultValue: '' },
  { key: 'contact_address', defaultValue: '' },
  { key: 'footer_links', defaultValue: '' },
  { key: 'footer_copyright', defaultValue: DEFAULT_FOOTER_COPYRIGHT },
  { key: 'footer_copyright_follow_site_title', defaultValue: true },
  // 中国大陆备案号（可选，留空则不显示）。ICP 固定指向 beian.miit.gov.cn；
  // 公安备案号会自动从号码中提取数字生成 beian.gov.cn 标准查询链接。
  { key: 'footer_icp_number', defaultValue: '' },
  { key: 'footer_police_number', defaultValue: '' },
  { key: 'model_detail_disclaimer', defaultValue: DEFAULT_MODEL_DETAIL_DISCLAIMER },
  { key: 'model_detail_copyright', defaultValue: DEFAULT_MODEL_DETAIL_COPYRIGHT },
  { key: 'model_detail_copyright_follow_site_title', defaultValue: true },
  { key: 'legal_privacy_updated_at', defaultValue: '2026 年 4 月' },
  { key: 'legal_terms_updated_at', defaultValue: '2026 年 4 月' },
  { key: 'legal_privacy_sections', defaultValue: '' },
  { key: 'legal_terms_sections', defaultValue: '' },
  { key: 'interface_theme', defaultValue: 'workbench' },
  { key: 'mobile_interface_theme', defaultValue: 'classic' },
  { key: 'user_interface_theme_enabled', defaultValue: true },
  { key: 'home_desktop_list_loading_mode', defaultValue: 'pagination' },
  { key: 'home_mobile_list_loading_mode', defaultValue: 'infinite' },
  { key: 'ui_default_locale', defaultValue: 'zh-CN' },
  { key: 'ui_enabled_locales', defaultValue: DEFAULT_UI_ENABLED_LOCALES },
  { key: 'ui_follow_browser_locale', defaultValue: false },
  { key: 'color_scheme', defaultValue: 'orange' },
  { key: 'color_custom_dark', defaultValue: '{}' },
  { key: 'color_custom_light', defaultValue: '{}' },
  { key: 'default_theme', defaultValue: 'light' },
  { key: 'auto_theme_enabled', defaultValue: false },
  { key: 'auto_theme_dark_hour', defaultValue: 20 },
  { key: 'auto_theme_light_hour', defaultValue: 8 },

  // 3D Material presets — default
  { key: 'mat_default_color', defaultValue: '#c8cad0' },
  { key: 'mat_default_metalness', defaultValue: 0.5 },
  { key: 'mat_default_roughness', defaultValue: 0.25 },
  { key: 'mat_default_envMapIntensity', defaultValue: 1.5 },
  // 3D Material presets — metal
  { key: 'mat_metal_color', defaultValue: '#f0f0f4' },
  { key: 'mat_metal_metalness', defaultValue: 1.0 },
  { key: 'mat_metal_roughness', defaultValue: 0.05 },
  { key: 'mat_metal_envMapIntensity', defaultValue: 2.0 },
  // 3D Material presets — plastic
  { key: 'mat_plastic_color', defaultValue: '#4499ff' },
  { key: 'mat_plastic_metalness', defaultValue: 0.0 },
  { key: 'mat_plastic_roughness', defaultValue: 0.35 },
  { key: 'mat_plastic_envMapIntensity', defaultValue: 0.6 },
  // 3D Material presets — glass
  { key: 'mat_glass_color', defaultValue: '#ffffff' },
  { key: 'mat_glass_metalness', defaultValue: 0.0 },
  { key: 'mat_glass_roughness', defaultValue: 0.0 },
  { key: 'mat_glass_envMapIntensity', defaultValue: 1.0 },
  { key: 'mat_glass_transmission', defaultValue: 0.95 },
  { key: 'mat_glass_ior', defaultValue: 1.5 },
  { key: 'mat_glass_thickness', defaultValue: 0.5 },
  // 3D Material presets — original (overlay, empty = no override)
  { key: 'mat_original_color', defaultValue: '#808080' },
  { key: 'mat_original_metalness', defaultValue: '' },
  { key: 'mat_original_roughness', defaultValue: '' },
  { key: 'mat_original_envMapIntensity', defaultValue: '' },
  // 3D Viewer lighting
  { key: 'viewer_exposure', defaultValue: 1.4 },
  { key: 'viewer_ambient_intensity', defaultValue: 1.0 },
  { key: 'viewer_main_light_intensity', defaultValue: 2.0 },
  { key: 'viewer_fill_light_intensity', defaultValue: 0.8 },
  { key: 'viewer_hemisphere_intensity', defaultValue: 0.5 },
  { key: 'viewer_bg_color', defaultValue: '#ffffff' },
  { key: 'viewer_default_preset', defaultValue: 'original' },
  { key: 'viewer_visible_presets', defaultValue: 'original' },
  { key: 'viewer_edge_enabled', defaultValue: true },
  { key: 'viewer_edge_threshold_angle', defaultValue: 28 },
  { key: 'viewer_edge_vertex_limit', defaultValue: 700000 },
  { key: 'viewer_edge_color', defaultValue: '#000000' },
  { key: 'viewer_edge_opacity', defaultValue: 0.25 },
  { key: 'viewer_edge_width', defaultValue: 1 },
  { key: 'viewer_measure_default_unit', defaultValue: 'auto' },
  { key: 'viewer_measure_record_limit', defaultValue: 12 },

  // Account security
  { key: 'security_email_code_cooldown_seconds', defaultValue: 60 },
  { key: 'security_email_code_ttl_seconds', defaultValue: 600 },
  { key: 'security_captcha_ttl_seconds', defaultValue: 300 },
  { key: 'security_password_min_length', defaultValue: 8 },
  { key: 'security_username_min_length', defaultValue: 2 },
  { key: 'security_username_max_length', defaultValue: 32 },

  // Share policy
  { key: 'share_default_expire_days', defaultValue: 0 },
  { key: 'share_max_expire_days', defaultValue: 0 },
  { key: 'share_default_download_limit', defaultValue: 0 },
  { key: 'share_max_download_limit', defaultValue: 0 },
  { key: 'share_allow_password', defaultValue: true },
  { key: 'share_allow_custom_expiry', defaultValue: true },
  { key: 'share_allow_preview', defaultValue: true },
  // Feature toggles
  { key: 'feature_selection_enabled', defaultValue: true },
  { key: 'feature_inquiry_enabled', defaultValue: true },
  { key: 'feature_product_wall_enabled', defaultValue: true },
  { key: 'feature_tickets_enabled', defaultValue: true },
  { key: 'feature_favorites_enabled', defaultValue: true },
  { key: 'feature_shares_enabled', defaultValue: true },
  { key: 'feature_downloads_enabled', defaultValue: true },
  { key: 'feature_password_reset_enabled', defaultValue: true },
  { key: 'feature_temp_viewer_enabled', defaultValue: true },
  { key: 'feature_category_nav_enabled', defaultValue: true },
  { key: 'require_invite_code', defaultValue: false },
  { key: 'invite_max_active_per_user', defaultValue: 10 },

  // Selection wizard
  { key: 'selection_page_title', defaultValue: '产品选型' },
  { key: 'selection_page_desc', defaultValue: '先选产品大类，再按参数逐步缩小范围' },
  { key: 'selection_enable_match', defaultValue: true },
  {
    key: 'selection_thread_priority',
    defaultValue: JSON.stringify(DEFAULT_SELECTION_THREAD_PRIORITY_FOR_SETTINGS, null, 2),
  },

  // 分类选型导航页（/category-nav）：模型库/选型双 section 流程图配置
  { key: 'category_nav_config', defaultValue: JSON.stringify(DEFAULT_CATEGORY_NAV_CONFIG, null, 2) },

  // Business dictionaries and policies
  { key: 'inquiry_statuses', defaultValue: JSON.stringify(DEFAULT_INQUIRY_STATUSES_FOR_SETTINGS, null, 2) },
  { key: 'ticket_statuses', defaultValue: JSON.stringify(DEFAULT_TICKET_STATUSES_FOR_SETTINGS, null, 2) },
  { key: 'ticket_classifications', defaultValue: JSON.stringify(DEFAULT_TICKET_CLASSIFICATIONS_FOR_SETTINGS, null, 2) },
  { key: 'support_process_steps', defaultValue: JSON.stringify(DEFAULT_SUPPORT_STEPS_FOR_SETTINGS, null, 2) },
  { key: 'nav_items', defaultValue: JSON.stringify(DEFAULT_NAV_FOR_SETTINGS, null, 2) },
  { key: 'nav_user_items', defaultValue: JSON.stringify(DEFAULT_USER_NAV_FOR_SETTINGS, null, 2) },
  { key: 'nav_admin_items', defaultValue: JSON.stringify(DEFAULT_ADMIN_NAV_FOR_SETTINGS, null, 2) },
  { key: 'nav_mobile_items', defaultValue: JSON.stringify(DEFAULT_MOBILE_NAV_FOR_SETTINGS, null, 2) },
  { key: 'upload_policy', defaultValue: JSON.stringify(DEFAULT_UPLOAD_POLICY_FOR_SETTINGS, null, 2) },
  { key: 'page_size_policy', defaultValue: JSON.stringify(DEFAULT_PAGE_SIZE_POLICY_FOR_SETTINGS, null, 2) },
  { key: 'audit_log_retention_days', defaultValue: 365 },

  // Anti-reverse-proxy & hotlink protection
  { key: 'anti_proxy_enabled', defaultValue: false },
  { key: 'allowed_hosts', defaultValue: '' },
  { key: 'hotlink_protection_enabled', defaultValue: false },
  { key: 'allowed_referers', defaultValue: '' },

  // Product wall upload limits
  { key: 'product_wall_max_image_mb', defaultValue: 50 },
  { key: 'product_wall_max_batch_count', defaultValue: 50 },
  { key: 'product_wall_max_zip_extract', defaultValue: 100 },

  // Cache and object storage
  { key: 'cache_driver', defaultValue: 'redis' },
  { key: 'cache_enabled', defaultValue: true },
  { key: 'redis_url', defaultValue: config.redisUrl },
  { key: 'redis_password', defaultValue: '' },
  { key: 'redis_db', defaultValue: 0 },
  { key: 'redis_key_prefix', defaultValue: '3dparthub' },
  { key: 'redis_tls_enabled', defaultValue: false },
  { key: 'cache_public_settings_ttl_seconds', defaultValue: 60 },
  { key: 'cache_model_list_ttl_seconds', defaultValue: 300 },
  { key: 'cache_model_detail_ttl_seconds', defaultValue: 300 },
  { key: 'cache_search_ttl_seconds', defaultValue: 60 },
  { key: 'cache_selection_ttl_seconds', defaultValue: 600 },
  { key: 'cache_static_asset_max_age_days', defaultValue: 30 },
  { key: 'storage_provider', defaultValue: 'local' },
  { key: 'storage_endpoint', defaultValue: '' },
  { key: 'storage_region', defaultValue: '' },
  { key: 'storage_bucket', defaultValue: '' },
  { key: 'storage_access_key_id', defaultValue: '' },
  { key: 'storage_access_key_secret', defaultValue: '' },
  { key: 'storage_use_ssl', defaultValue: true },
  { key: 'storage_force_path_style', defaultValue: false },
  { key: 'storage_public_base_url', defaultValue: '' },
  { key: 'storage_cdn_base_url', defaultValue: '' },
  { key: 'storage_image_prefix', defaultValue: 'images' },
  { key: 'storage_thumbnail_prefix', defaultValue: 'thumbnails' },
  { key: 'storage_model_prefix', defaultValue: 'models' },
  { key: 'storage_original_prefix', defaultValue: 'originals' },
  { key: 'storage_drawing_prefix', defaultValue: 'drawings' },
  { key: 'storage_product_wall_prefix', defaultValue: 'product-wall' },
  { key: 'storage_attachment_prefix', defaultValue: 'attachments' },
  { key: 'storage_backup_prefix', defaultValue: 'backups' },
  { key: 'storage_temp_prefix', defaultValue: 'temp' },
  { key: 'storage_signed_url_enabled', defaultValue: false },
  { key: 'storage_signed_url_ttl_seconds', defaultValue: 3600 },
  { key: 'storage_upload_multipart_mb', defaultValue: 16 },
  { key: 'storage_upload_concurrency', defaultValue: 4 },
  { key: 'storage_sync_enabled', defaultValue: false },
  { key: 'storage_sync_delete_extra_enabled', defaultValue: false },
  { key: 'image_cdn_enabled', defaultValue: false },
  { key: 'image_optimize_enabled', defaultValue: true },
  { key: 'image_webp_enabled', defaultValue: true },
  { key: 'image_thumbnail_quality', defaultValue: 82 },
  { key: 'image_large_max_width', defaultValue: 2560 },
  { key: 'image_cache_max_age_days', defaultValue: 30 },
  { key: 'resource_cdn_enabled', defaultValue: false },
  { key: 'resource_cache_max_age_days', defaultValue: 30 },
  { key: 'resource_download_acceleration_enabled', defaultValue: false },

  // Download token TTL
  { key: 'download_token_ttl_minutes', defaultValue: 5 },

  // Ticket attachment limits
  { key: 'ticket_attachment_max_mb', defaultValue: 100 },
  {
    key: 'ticket_attachment_types',
    defaultValue: 'jpg,jpeg,png,gif,webp,svg,pdf,doc,docx,xls,xlsx,ppt,pptx,zip,rar,7z,step,stp,iges,igs,binary',
  },

  // API rate limiting
  { key: 'api_rate_limit', defaultValue: 5000 },

  // Enterprise backup policy
  { key: 'backup_auto_enabled', defaultValue: false },
  { key: 'backup_schedule_time', defaultValue: '03:00' },
  { key: 'backup_retention_count', defaultValue: 7 },
  { key: 'backup_mirror_enabled', defaultValue: false },
  { key: 'backup_mirror_dir', defaultValue: '' },
  { key: 'backup_last_mirror_status', defaultValue: '' },
  { key: 'backup_last_mirror_message', defaultValue: '' },
  { key: 'backup_last_mirror_at', defaultValue: '' },
  { key: 'backup_last_auto_date', defaultValue: '' },
  { key: 'backup_last_auto_status', defaultValue: '' },
  { key: 'backup_last_auto_message', defaultValue: '' },
  { key: 'backup_last_auto_job_id', defaultValue: '' },
  { key: 'backup_last_auto_at', defaultValue: '' },
];

const DEFAULTS: Record<string, unknown> = {};
for (const s of SETTINGS_SCHEMA) DEFAULTS[s.key] = s.defaultValue;

export function getSettingDefaults(keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in DEFAULTS) result[key] = DEFAULTS[key];
  }
  return result;
}

function normalizeLegacyMaintenanceSettings(settings: Record<string, unknown>): Record<string, unknown> {
  if (settings.maintenance_title === LEGACY_MAINTENANCE_TITLE) {
    settings.maintenance_title = DEFAULT_MAINTENANCE_TITLE;
  }
  if (settings.maintenance_message === LEGACY_MAINTENANCE_MESSAGE) {
    settings.maintenance_message = DEFAULT_MAINTENANCE_MESSAGE;
  }
  return settings;
}

function normalizeRuntimeBackedSettings(settings: Record<string, unknown>): Record<string, unknown> {
  normalizeLegacyMaintenanceSettings(settings);
  const redisUrl = typeof settings.redis_url === 'string' ? settings.redis_url.trim() : '';
  if (LEGACY_LOCAL_REDIS_URLS.has(redisUrl) && !LEGACY_LOCAL_REDIS_URLS.has(config.redisUrl)) {
    settings.redis_url = config.redisUrl;
  }
  return settings;
}

export function normalizeContactPhoneSetting(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[－—–]/g, '-')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, ' ');
}

export function isValidContactPhoneSetting(value: unknown): boolean {
  const phone = normalizeContactPhoneSetting(value);
  if (!phone) return true;
  if (phone.length > 32) return false;
  if (!/^\+?[0-9][0-9\s()-]{5,31}$/.test(phone)) return false;

  const digits = phone.replace(/\D/g, '');
  const noSpaceOrParen = phone.replace(/[()\s]/g, '');

  if (/^1[3-9]\d{9}$/.test(digits)) return true;
  if (/^(400|800)-?\d{3}-?\d{4}$/.test(noSpaceOrParen)) return true;
  if (/^0\d{2,3}-?\d{7,8}(-?\d{1,6})?$/.test(noSpaceOrParen)) return true;
  if (phone.startsWith('+') && digits.length >= 8 && digits.length <= 15) return true;

  return false;
}

// In-memory cache
let cache: Record<string, unknown> | null = null;
let cacheAt = 0;
const CACHE_TTL = 30_000; // 30 seconds — fast propagation across workers

const SETTINGS_INVALIDATE_CHANNEL = 'cache:settings:invalidate';
const settingsSubscriber = redis.duplicate();

settingsSubscriber.on('error', () => {});
settingsSubscriber.subscribe(SETTINGS_INVALIDATE_CHANNEL).catch(() => {});
settingsSubscriber.on('message', (channel: string) => {
  if (channel === SETTINGS_INVALIDATE_CHANNEL) {
    cache = null;
    cacheAt = 0;
  }
});

function broadcastSettingsInvalidate(): void {
  redis.publish(SETTINGS_INVALIDATE_CHANNEL, '1').catch(() => {});
}

/**
 * 广播设置缓存失效（供备份恢复 worker 调用）。
 * worker 与主进程内存隔离，直接 import 的 clearSettingsCache 只清到 worker 自己的；
 * 走 Redis pub/sub 才能让所有主进程 worker（cluster 模式下多个）同步失效。
 */
export function broadcastSettingsInvalidationToAllWorkers(): void {
  broadcastSettingsInvalidate();
}

/** Clear the in-memory settings cache (used after restore) */
export function clearSettingsCache(): void {
  cache = null;
  cacheAt = 0;
}

/**
 * 同步读取内存里的设置快照（供 generateThumbnail / sendAcceleratedFile / CDN 中间件等
 * 同步消费者使用）。快照尚未加载（启动初期）或被失效时返回空对象 —— 调用方需对缺失值
 * 自行回退到默认。设置变更通过 redis 广播在 30s 内（CACHE_TTL）刷新到所有 worker。
 */
export function getCachedSettings(): Record<string, unknown> {
  return cache ?? {};
}

export async function getAllSettings(options: { forceRefresh?: boolean } = {}): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (!options.forceRefresh && cache && now - cacheAt < CACHE_TTL) return cache;

  if (!prisma) return normalizeRuntimeBackedSettings({ ...DEFAULTS });

  try {
    const rows = await prisma.setting.findMany();
    const result: Record<string, unknown> = { ...DEFAULTS };
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        result[row.key] = row.value;
      }
    }
    normalizeRuntimeBackedSettings(result);
    cache = result;
    cacheAt = now;
    return result;
  } catch {
    return normalizeRuntimeBackedSettings({ ...DEFAULTS });
  }
}

export async function getSetting<T = unknown>(key: string): Promise<T> {
  const all = await getAllSettings();
  return all[key] as T;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  if (!prisma) return;
  await prisma.setting.upsert({
    where: { key },
    update: { value: JSON.stringify(value) },
    create: { key, value: JSON.stringify(value) },
  });
  // Invalidate cache
  cache = null;
  await cacheDel('cache:settings:public');
  broadcastSettingsInvalidate();
}

const SETTINGS_KEYS = new Set(SETTINGS_SCHEMA.map((s) => s.key));

const NUMERIC_KEYS = new Set([
  'daily_download_limit',
  'smtp_port',
  'maintenance_auto_queue_threshold',
  'conversion_worker_concurrency',
  'mat_default_metalness',
  'mat_default_roughness',
  'mat_default_envMapIntensity',
  'mat_metal_metalness',
  'mat_metal_roughness',
  'mat_metal_envMapIntensity',
  'mat_plastic_metalness',
  'mat_plastic_roughness',
  'mat_plastic_envMapIntensity',
  'mat_glass_metalness',
  'mat_glass_roughness',
  'mat_glass_envMapIntensity',
  'mat_glass_transmission',
  'mat_glass_ior',
  'mat_glass_thickness',
  'viewer_exposure',
  'viewer_ambient_intensity',
  'viewer_main_light_intensity',
  'viewer_fill_light_intensity',
  'viewer_hemisphere_intensity',
  'viewer_edge_threshold_angle',
  'viewer_edge_vertex_limit',
  'viewer_edge_opacity',
  'viewer_edge_width',
  'viewer_measure_record_limit',
  'security_email_code_cooldown_seconds',
  'security_email_code_ttl_seconds',
  'security_captcha_ttl_seconds',
  'security_password_min_length',
  'security_username_min_length',
  'security_username_max_length',
  'share_default_expire_days',
  'share_max_expire_days',
  'share_default_download_limit',
  'share_max_download_limit',
  'auto_theme_dark_hour',
  'auto_theme_light_hour',
  'product_wall_max_image_mb',
  'product_wall_max_batch_count',
  'product_wall_max_zip_extract',
  'redis_db',
  'cache_public_settings_ttl_seconds',
  'cache_model_list_ttl_seconds',
  'cache_model_detail_ttl_seconds',
  'cache_search_ttl_seconds',
  'cache_selection_ttl_seconds',
  'cache_static_asset_max_age_days',
  'storage_signed_url_ttl_seconds',
  'storage_upload_multipart_mb',
  'storage_upload_concurrency',
  'image_thumbnail_quality',
  'image_large_max_width',
  'image_cache_max_age_days',
  'resource_cache_max_age_days',
  'download_token_ttl_minutes',
  'ticket_attachment_max_mb',
  'api_rate_limit',
  'backup_retention_count',
  'audit_log_retention_days',
]);

const BOOLEAN_KEYS = new Set([
  'require_login_download',
  'require_login_browse',
  'allow_register',
  'auth_modal_enabled',
  'login_dialog_enabled',
  'login_dialog_favorites',
  'login_dialog_downloads',
  'login_dialog_my_shares',
  'login_dialog_profile',
  'login_dialog_support',
  'login_dialog_my_tickets',
  'login_dialog_my_inquiries',
  'login_dialog_projects',
  'footer_copyright_follow_site_title',
  'model_detail_copyright_follow_site_title',
  'show_watermark',
  'announcement_enabled',
  'maintenance_enabled',
  'maintenance_auto_enabled',
  'smtp_secure',
  'auto_theme_enabled',
  'user_interface_theme_enabled',
  'ui_follow_browser_locale',
  'viewer_edge_enabled',
  'selection_enable_match',
  'share_allow_password',
  'share_allow_custom_expiry',
  'share_allow_preview',
  'feature_selection_enabled',
  'feature_inquiry_enabled',
  'feature_product_wall_enabled',
  'feature_tickets_enabled',
  'feature_favorites_enabled',
  'feature_shares_enabled',
  'feature_downloads_enabled',
  'feature_password_reset_enabled',
  'feature_temp_viewer_enabled',
  'feature_category_nav_enabled',
  'cache_enabled',
  'redis_tls_enabled',
  'storage_use_ssl',
  'storage_force_path_style',
  'storage_signed_url_enabled',
  'storage_sync_enabled',
  'storage_sync_delete_extra_enabled',
  'image_cdn_enabled',
  'image_optimize_enabled',
  'image_webp_enabled',
  'resource_cdn_enabled',
  'resource_download_acceleration_enabled',
  'anti_proxy_enabled',
  'hotlink_protection_enabled',
  'backup_auto_enabled',
  'backup_mirror_enabled',
]);

function getSupportedInterfaceThemes(): Set<string> {
  const configured = process.env.INTERFACE_THEME_KEYS;
  if (!configured) return new Set(DEFAULT_INTERFACE_THEME_KEYS);
  const keys = configured
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^[a-z][a-z0-9-]{0,48}$/.test(item));
  return new Set(keys.length ? keys : DEFAULT_INTERFACE_THEME_KEYS);
}

function getSupportedMobileThemes(): Set<string> {
  const configured = process.env.MOBILE_THEME_KEYS;
  if (!configured) return new Set(DEFAULT_MOBILE_THEME_KEYS);
  const keys = configured
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^[a-z][a-z0-9-]{0,48}$/.test(item));
  return new Set(keys.length ? keys : DEFAULT_MOBILE_THEME_KEYS);
}

function normalizeJsonObjectSetting(key: string, value: unknown, maxLength = MAX_CUSTOM_COLOR_JSON_LENGTH): unknown {
  if (typeof value === 'string' && value.length > maxLength) return DEFAULTS[key];

  let parsed = value;
  if (typeof value === 'string') {
    if (!value.trim()) return DEFAULTS[key];
    try {
      parsed = JSON.parse(value);
    } catch {
      return DEFAULTS[key];
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULTS[key];

  const serialized = JSON.stringify(parsed);
  if (serialized.length > maxLength) return DEFAULTS[key];
  return JSON.stringify(parsed, null, 2);
}

function normalizeTrimmedStringSetting(value: unknown, fallback = ''): string {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeStoragePrefixSetting(key: string, value: unknown): string {
  const fallback = String(DEFAULTS[key] ?? '').trim();
  const normalized = String(value ?? fallback)
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
  return normalized || fallback;
}

function clampNumericSetting(key: string, value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number(DEFAULTS[key]);
  return Math.min(max, Math.max(min, n));
}

export function validateSettingValue(key: string, value: unknown): unknown {
  if (key === 'footer_links') return normalizeFooterLinksSetting(value);
  if (key === 'category_nav_config') return normalizeCategoryNavConfigSetting(value);
  // 品牌类文本：去首尾空白 + 限长，防止把标签页标题 / PWA 安装名称撑爆
  if (key === 'site_title' || key === 'site_browser_title' || key === 'site_app_name') {
    const trimmed = String(value ?? '').trim();
    return trimmed.slice(0, 60);
  }
  // PWA 应用描述（manifest description）：稍宽松的限长
  if (key === 'site_app_desc') {
    return String(value ?? '')
      .trim()
      .slice(0, 200);
  }
  // 图标类 URL：只允许站内相对路径或 http(s) 绝对地址（上传接口产物 / 外链 CDN）
  if (key === 'site_favicon' || key === 'site_app_icon') {
    const normalized = normalizeTrimmedStringSetting(value, String(DEFAULTS[key] ?? ''));
    if (!normalized) return normalized;
    if (normalized.startsWith('/static/') || normalized.startsWith('/')) return normalized;
    if (/^https?:\/\//i.test(normalized)) return normalized;
    return String(DEFAULTS[key] ?? '');
  }
  if (key === 'cache_driver') {
    const driver = String(value || '').trim();
    return (CACHE_DRIVER_KEYS as readonly string[]).includes(driver) ? driver : DEFAULTS[key];
  }
  if (key === 'storage_provider') {
    const provider = String(value || '').trim();
    return (STORAGE_PROVIDER_KEYS as readonly string[]).includes(provider) ? provider : DEFAULTS[key];
  }
  if (key === 'contact_phone') {
    const phone = normalizeContactPhoneSetting(value);
    return isValidContactPhoneSetting(phone) ? phone : DEFAULTS[key];
  }
  if (key === 'interface_theme') {
    const theme = String(value || '').trim();
    return getSupportedInterfaceThemes().has(theme) ? theme : DEFAULTS[key];
  }
  if (key === 'mobile_interface_theme') {
    const theme = String(value || '').trim();
    return getSupportedMobileThemes().has(theme) ? theme : DEFAULTS[key];
  }
  if (key === 'home_desktop_list_loading_mode' || key === 'home_mobile_list_loading_mode') {
    const mode = String(value || '').trim();
    return (HOME_LIST_LOADING_MODE_KEYS as readonly string[]).includes(mode) ? mode : DEFAULTS[key];
  }
  if (key === 'ui_default_locale') {
    const locale = String(value || '').trim();
    return (UI_LOCALE_KEYS as readonly string[]).includes(locale) ? locale : DEFAULTS[key];
  }
  if (key === 'ui_enabled_locales') {
    const locales = Array.from(
      new Set(
        String(value || '')
          .split(',')
          .map((item) => item.trim())
          .filter((item) => (UI_LOCALE_KEYS as readonly string[]).includes(item)),
      ),
    );
    return locales.length ? locales.join(',') : DEFAULTS[key];
  }
  if (key === 'color_scheme') {
    const scheme = String(value || '').trim();
    return (COLOR_SCHEME_KEYS as readonly string[]).includes(scheme) ? scheme : DEFAULTS[key];
  }
  if (key === 'color_custom_dark' || key === 'color_custom_light') {
    return normalizeJsonObjectSetting(key, value);
  }
  if (key === 'auto_theme_dark_hour' || key === 'auto_theme_light_hour') {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULTS[key];
    return Math.min(23, Math.max(0, Math.round(n)));
  }
  if (key === 'redis_db') return clampNumericSetting(key, value, 0, 15);
  if (key === 'backup_schedule_time') {
    // HH:MM（00:00–23:59），与 backup 执行时的 normalizeScheduleTime 一致；非法回默认 03:00，
    // 避免 admin 误填（如 25:99）被原样存入、执行时静默回退而难察觉
    const raw = typeof value === 'string' ? value.trim() : '';
    const match = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    return match ? `${match[1].padStart(2, '0')}:${match[2]}` : DEFAULTS[key];
  }
  if (
    key === 'cache_public_settings_ttl_seconds' ||
    key === 'cache_model_list_ttl_seconds' ||
    key === 'cache_model_detail_ttl_seconds' ||
    key === 'cache_search_ttl_seconds' ||
    key === 'cache_selection_ttl_seconds'
  ) {
    return clampNumericSetting(key, value, 0, 86400);
  }
  if (
    key === 'cache_static_asset_max_age_days' ||
    key === 'image_cache_max_age_days' ||
    key === 'resource_cache_max_age_days'
  ) {
    return clampNumericSetting(key, value, 0, 365);
  }
  if (key === 'storage_signed_url_ttl_seconds') return clampNumericSetting(key, value, 60, 86400);
  if (key === 'storage_upload_multipart_mb') return clampNumericSetting(key, value, 5, 512);
  if (key === 'storage_upload_concurrency') return clampNumericSetting(key, value, 1, 16);
  if (key === 'image_thumbnail_quality') return clampNumericSetting(key, value, 1, 100);
  if (key === 'image_large_max_width') return clampNumericSetting(key, value, 320, 12000);
  if (key.startsWith('storage_') && key.endsWith('_prefix')) return normalizeStoragePrefixSetting(key, value);
  if (
    key === 'redis_url' ||
    key === 'redis_key_prefix' ||
    key === 'storage_endpoint' ||
    key === 'storage_region' ||
    key === 'storage_bucket' ||
    key === 'storage_access_key_id' ||
    key === 'storage_public_base_url' ||
    key === 'storage_cdn_base_url'
  ) {
    return normalizeTrimmedStringSetting(value, String(DEFAULTS[key] ?? ''));
  }
  if (NUMERIC_KEYS.has(key)) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULTS[key];
    return n;
  }
  if (BOOLEAN_KEYS.has(key)) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      // Fix: "false" should return false, but other truthy strings like "yes", "1" should return true
      if (value.toLowerCase() === 'false') return false;
      if (value === 'true' || value === 'yes') return true;
      // For other strings, fall through to Boolean()
    }
    return Boolean(value);
  }
  if (typeof value === 'string' && value.length > 1_000_000) {
    return value.slice(0, 1_000_000);
  }
  return value;
}

export async function setSettings(settings: Record<string, unknown>): Promise<void> {
  if (!prisma) return;
  const shouldPreserveSecrets = Object.entries(settings).some(
    ([key, value]) => SENSITIVE_SETTING_KEYS.has(key) && value === MASKED_SECRET_VALUE,
  );
  const existingSettings = shouldPreserveSecrets ? await getAllSettings() : {};
  const filtered = Object.entries(settings)
    .filter(([key]) => SETTINGS_KEYS.has(key))
    .map(([key, value]) => {
      const nextValue =
        SENSITIVE_SETTING_KEYS.has(key) && value === MASKED_SECRET_VALUE
          ? (existingSettings[key] ?? DEFAULTS[key])
          : value;
      return [key, validateSettingValue(key, nextValue)] as [string, unknown];
    });
  if (filtered.length === 0) return;
  const ops = filtered.map(([key, value]) =>
    prisma.setting.upsert({
      where: { key },
      update: { value: JSON.stringify(value) },
      create: { key, value: JSON.stringify(value) },
    }),
  );
  await prisma.$transaction(ops);
  // Invalidate cache
  cache = null;
  await cacheDel('cache:settings:public');
  broadcastSettingsInvalidate();
}

export async function initDefaultSettings(): Promise<void> {
  if (!prisma) return;
  await prisma.setting.createMany({
    data: SETTINGS_SCHEMA.map((def) => ({ key: def.key, value: JSON.stringify(def.defaultValue) })),
    skipDuplicates: true,
  });
  cache = null;
}
