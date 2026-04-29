import { Router, Response } from "express";
import { cacheGetOrSet, TTL } from "../../lib/cache.js";
import { prisma } from "../../lib/prisma.js";
import { requireBrowseAccess } from "../../middleware/browseAccess.js";
import { CATEGORY_CACHE_PREFIX, type CategoryTreeNode } from "./common.js";

export function createPublicCategoriesRouter() {
  const router = Router();

  router.get("/api/categories", async (req, res: Response) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const { value: result, hit } = await cacheGetOrSet(`${CATEGORY_CACHE_PREFIX}tree`, TTL.CATEGORIES, async () => {
        const categories = await prisma.category.findMany({
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        });

        const modelCounts: { category_id: string; cnt: bigint }[] =
          await prisma.$queryRaw`SELECT category_id, COUNT(*) as cnt FROM models WHERE status = 'completed' AND category_id IS NOT NULL GROUP BY category_id`;
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

        for (const root of roots) {
          if (root.children.length > 0) {
            let childTotal = 0;
            for (const child of root.children) {
              childTotal += child.count;
            }
            root.count = (countMap.get(root.id) || 0) + childTotal;
          }
        }

        const totalModels = await prisma.model.count({ where: { status: "completed" } });

        return { data: roots, total: totalModels };
      });
      res.set("X-Cache", hit ? "HIT" : "MISS");
      res.json(result);
    } catch (err) {
      console.error("[categories] Error:", err);
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
