import { cacheDelByPrefix } from '../../lib/cache.js';

export const CATEGORY_CACHE_PREFIX = 'cache:categories:';

export type CategoryTreeNode = {
  id: string;
  name: string;
  icon: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  /** 分类访问控制标记。allowedRoles/allowedUserIds 仅对 ADMIN 下发（管理页回显用），避免向普通用户泄露白名单 */
  restricted: boolean;
  allowedRoles?: string[];
  allowedUserIds?: string[];
  count: number;
  totalCount: number;
  children: CategoryTreeNode[];
};

export async function clearCategoryCache() {
  await cacheDelByPrefix(CATEGORY_CACHE_PREFIX);
}
