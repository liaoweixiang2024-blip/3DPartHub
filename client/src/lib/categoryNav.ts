/**
 * 分类选型导航页（/category-nav）共享类型与工具。
 *
 * 配置存于服务端 Setting 键 `category_nav_config`（JSON 字符串），模型库与
 * 选型各一个 section，结构完全一致。服务端 normalizeCategoryNavConfigSetting
 * 保证每个节点都有 1~6 个分类项（items）；这里做客户端解析与展示辅助。
 *
 * 当前页面为 SMC 拓扑图静态复刻 + 数据驱动叠加：节点定义静态布局里的
 * 哪个卡位，hover 浮窗展示 items（图片+分类列表）。
 */

export interface CategoryNavGroup {
  id: string;
  name: string;
  color: string;
}

/** 节点内挂的分类项：hover 浮窗里的一行 */
export interface CategoryNavItem {
  categoryId: string | null;
  customName?: string;
  imageUrl?: string;
  /** 合并名：弹窗里与另一 section 同名行合并成一行（如选型「竹节管」alias=万向管） */
  alias?: string;
}

export interface CategoryNavNode {
  id: string;
  groupId: string;
  categoryId?: string | null;
  customName?: string;
  /** 节点级图标图（拓扑图卡位插画位）；优先于 SMC 默认插画 */
  imageUrl?: string;
  /** 节点显示名（拓扑图卡位标签）；未设置时前台回退默认文案 */
  label?: string;
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

export type CategoryNavTab = 'model' | 'selection';

/** 读取节点的分类项列表（服务端已迁移为 items，兜底旧结构单分类） */
export function navNodeItems(node: CategoryNavNode): CategoryNavItem[] {
  if (Array.isArray(node.items) && node.items.length) return node.items;
  return [{ categoryId: node.categoryId ?? null, customName: node.customName, imageUrl: node.imageUrl }];
}

/** 解析导航配置；任何失败返回 null（页面退回纯静态展示） */
export function parseCategoryNavConfig(raw: unknown): CategoryNavConfig | null {
  let parsed = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const candidate = parsed as CategoryNavConfig | null | undefined;
  if (!candidate || typeof candidate !== 'object') return null;
  if (!candidate.model || typeof candidate.model !== 'object') return null;
  if (!candidate.selection || typeof candidate.selection !== 'object') return null;
  if (!Array.isArray(candidate.model.groups) || !Array.isArray(candidate.model.nodes)) return null;
  if (!Array.isArray(candidate.selection.groups) || !Array.isArray(candidate.selection.nodes)) return null;
  return candidate;
}

/** 生成不与现有 id 冲突的节点/组 id（保存前服务端仍会校验） */
export function nextNavId(existing: string[], prefix: string): string {
  let n = existing.length + 1;
  let candidate = `${prefix}-${n}`;
  const used = new Set(existing);
  while (used.has(candidate) && n < 10000) {
    n += 1;
    candidate = `${prefix}-${n}`;
  }
  return candidate;
}
