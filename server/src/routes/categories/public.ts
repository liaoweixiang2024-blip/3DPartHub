import { Router, Response } from "express";
import { cacheGetOrSet, TTL } from "../../lib/cache.js";
import { prisma } from "../../lib/prisma.js";
import { requireBrowseAccess } from "../../middleware/browseAccess.js";
import { CATEGORY_CACHE_PREFIX, type CategoryTreeNode } from "./common.js";
import { MODEL_STATUS } from "../../services/modelStatus.js";
import { groupedVisibleModelSql } from "../../services/modelVisibility.js";
import { logger } from "../../lib/logger.js";

export function createPublicCategoriesRouter() {
  const router = Router();

  // Clear stale category cache keys on startup
  import("../../lib/cache.js").then(({ cacheDel }) => {
    cacheDel("cache:categories:tree").catch(() => {});
    cacheDel("cache:categories:tree:v2").catch(() => {});
  });

  router.get("/api/categories", async (req, res: Response) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const visibleModelSql = groupedVisibleModelSql();
      const { value: result, hit } = await cacheGetOrSet(`${CATEGORY_CACHE_PREFIX}tree:v3`, TTL.CATEGORIES, async () => {
        const categories = await prisma.category.findMany({
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        });

        const modelCounts: { category_id: string; cnt: bigint }[] =
          await prisma.$queryRaw`
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
          for (const child of (node.children || [])) {
            total += aggregateCounts(child);
          }
          node.totalCount = total;
          return total;
        }
        for (const root of roots) aggregateCounts(root);

        const totalRows: { cnt: number }[] = await prisma.$queryRaw`
          SELECT COUNT(*)::int as cnt
          FROM models
          WHERE status = ${MODEL_STATUS.COMPLETED}
            AND ${visibleModelSql}
        `;
        const totalModels = Number(totalRows[0]?.cnt || 0);

        return { data: roots, total: totalModels };
      });
      res.set("X-Cache", hit ? "HIT" : "MISS");
      res.json(result);
    } catch (err) {
      logger.error({ err }, "[categories] Error");
      res.status(500).json({ detail: "获取分类失败" });
    }
  });

  router.get("/api/categories/flat", async (req, res: Response) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const { value: result, hit } = await cacheGetOrSet(`${CATEGORY_CACHE_PREFIX}flat`, TTL.CATEGORIES, async () => {
        const categories = await prisma.category.findMany({
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        });
        return { data: categories };
      });
      res.set("X-Cache", hit ? "HIT" : "MISS");
      res.json(result);
    } catch {
      res.status(500).json({ detail: "获取分类失败" });
    }
  });

  return router;
}
