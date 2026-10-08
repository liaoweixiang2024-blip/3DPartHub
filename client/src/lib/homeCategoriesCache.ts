import type { CategoryItem } from '../api/categories';

/**
 * 首页分类树（含模型数量）的 localStorage 快缓存。
 *
 * 作用：刷新首页时首帧直接用上次的数据渲染（SWR fallbackData，stale-while-revalidate），
 * 避免「—」占位 → 数据到达跳成「xxxx 个模型」的数量跳动。后台请求回来后原地更新。
 *
 * 按访客身份分桶（user.id / 匿名），防止受限分类树跨身份闪现。
 */

const CACHE_PREFIX = 'home-categories:v1:';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedCategoryTree {
  items: CategoryItem[];
  total: number;
  savedAt: number;
}

function isValidTree(value: unknown): value is { items: CategoryItem[]; total: number } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { items?: unknown; total?: unknown };
  return Array.isArray(candidate.items) && candidate.items.length > 0 && typeof candidate.total === 'number';
}

export function readCachedCategoryTree(ownerId: string): { items: CategoryItem[]; total: number } | undefined {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + ownerId);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<CachedCategoryTree>;
    // 过期缓存视为无缓存：分类结构可能早已大改，宁可不显示也别显示远古数据
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > MAX_AGE_MS) return undefined;
    if (!isValidTree(parsed)) return undefined;
    return { items: parsed.items, total: parsed.total };
  } catch {
    return undefined;
  }
}

export function writeCachedCategoryTree(ownerId: string, tree: { items: CategoryItem[]; total: number }): void {
  try {
    const payload: CachedCategoryTree = { items: tree.items, total: tree.total, savedAt: Date.now() };
    window.localStorage.setItem(CACHE_PREFIX + ownerId, JSON.stringify(payload));
  } catch {
    // 隐私模式/配额满：缓存写不进就算了，回退到「—」占位行为
  }
}
