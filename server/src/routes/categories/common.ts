import { cacheDelByPrefix } from "../../lib/cache.js";

export const CATEGORY_CACHE_PREFIX = "cache:categories:";

export type CategoryTreeNode = {
  id: string;
  name: string;
  icon: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  count: number;
  totalCount: number;
  children: CategoryTreeNode[];
};

export async function clearCategoryCache() {
  await cacheDelByPrefix(CATEGORY_CACHE_PREFIX);
}
