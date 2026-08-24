import { Prisma } from '@prisma/client';
import { Router, Response } from 'express';
import { cacheGetOrSet, TTL } from '../../lib/cache.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { requireBrowseAccess } from '../../middleware/browseAccess.js';
import { accessBucketKey, getInvisibleCategoryIdsForRequest } from '../../services/categoryAccess.js';
import { MODEL_STATUS } from '../../services/modelStatus.js';
import { groupedVisibleModelSql } from '../../services/modelVisibility.js';
import { CATEGORY_CACHE_PREFIX, type CategoryTreeNode } from './common.js';

export function createPublicCategoriesRouter() {
  const router = Router();

  // Clear stale category cache keys on startup
  import('../../lib/cache.js').then(({ cacheDel }) => {
    cacheDel('cache:categories:tree').catch(() => {});
    cacheDel('cache:categories:tree:v2').catch(() => {});
    cacheDel('cache:categories:tree:v3').catch(() => {});
  });

  router.get('/api/categories', async (req, res: Response) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const visibleModelSql = groupedVisibleModelSql();
      // 分类访问控制：不可见集合 → 缓存分桶（空桶 = 匿名/ADMIN/无受限，沿用原 key）
      const invisible = await getInvisibleCategoryIdsForRequest(req);
      const bucket = accessBucketKey(invisible);
      const excludedIds = [...invisible];
      const { value: result, hit } = await cacheGetOrSet(
        `${CATEGORY_CACHE_PREFIX}tree:v4${bucket ? `:${bucket}` : ''}`,
        TTL.CATEGORIES,
        async () => {
          const categories = await prisma.category.findMany({
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          });

          // 受限分类的模型计数直接在 SQL 里排除（含子树传播后的 id）
          const modelCounts: { category_id: string; cnt: bigint }[] = excludedIds.length
            ? await prisma.$queryRaw`
                SELECT category_id, COUNT(*)::int as cnt
                FROM models
                WHERE status = ${MODEL_STATUS.COMPLETED}
                  AND category_id IS NOT NULL
                  AND ${visibleModelSql}
                  AND category_id NOT IN (${Prisma.join(excludedIds)})
                GROUP BY category_id
              `
            : await prisma.$queryRaw`
                SELECT category_id, COUNT(*)::int as cnt
                FROM models
                WHERE status = ${MODEL_STATUS.COMPLETED}
                  AND category_id IS NOT NULL
                  AND ${visibleModelSql}
                GROUP BY category_id
              `;
          const countMap = new Map<string, number>();
          for (const mc of modelCounts) {
            countMap.set(mc.category_id, Number(mc.cnt));
          }

          const map = new Map<string, CategoryTreeNode>();
          const roots: CategoryTreeNode[] = [];

          for (const cat of categories) {
            // 不可见分类不进 map：自身不出现，children 也挂不上树，totalCount 聚合自动正确
            if (invisible.has(cat.id)) continue;
            const count = countMap.get(cat.id) || 0;
            map.set(cat.id, {
              id: cat.id,
              name: cat.name,
              icon: cat.icon,
              parentId: cat.parentId,
              sortOrder: cat.sortOrder,
              createdAt: cat.createdAt,
              updatedAt: cat.updatedAt,
              count,
              totalCount: count,
              children: [],
            });
          }

          for (const cat of categories) {
            const node = map.get(cat.id);
            if (!node) continue;
            if (cat.parentId && map.has(cat.parentId)) {
              const parent = map.get(cat.parentId);
              if (parent) parent.children.push(node);
            } else {
              roots.push(node);
            }
          }

          function aggregateCounts(node: CategoryTreeNode): number {
            let total = node.count || 0;
            for (const child of node.children || []) {
              total += aggregateCounts(child);
            }
            node.totalCount = total;
            return total;
          }
          for (const root of roots) aggregateCounts(root);

          const totalRows: { cnt: number }[] = excludedIds.length
            ? await prisma.$queryRaw`
                SELECT COUNT(*)::int as cnt
                FROM models
                WHERE status = ${MODEL_STATUS.COMPLETED}
                  AND ${visibleModelSql}
                  AND (category_id IS NULL OR category_id NOT IN (${Prisma.join(excludedIds)}))
              `
            : await prisma.$queryRaw`
                SELECT COUNT(*)::int as cnt
                FROM models
                WHERE status = ${MODEL_STATUS.COMPLETED}
                  AND ${visibleModelSql}
              `;
          const totalModels = Number(totalRows[0]?.cnt || 0);

          return { data: roots, total: totalModels };
        },
      );
      res.set('X-Cache', hit ? 'HIT' : 'MISS');
      res.json(result);
    } catch (err) {
      logger.error({ err }, '[categories] Error');
      res.status(500).json({ detail: '获取分类失败' });
    }
  });

  router.get('/api/categories/flat', async (req, res: Response) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      // 上传/编辑分类选择等多处使用 flat，同样按访问控制过滤（ADMIN 空桶全可见）
      const invisible = await getInvisibleCategoryIdsForRequest(req);
      const bucket = accessBucketKey(invisible);
      const { value: result, hit } = await cacheGetOrSet(
        `${CATEGORY_CACHE_PREFIX}flat${bucket ? `:${bucket}` : ''}`,
        TTL.CATEGORIES,
        async () => {
          const categories = await prisma.category.findMany({
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          });
          return { data: categories.filter((cat) => !invisible.has(cat.id)) };
        },
      );
      res.set('X-Cache', hit ? 'HIT' : 'MISS');
      res.json(result);
    } catch {
      res.status(500).json({ detail: '获取分类失败' });
    }
  });

  return router;
}
