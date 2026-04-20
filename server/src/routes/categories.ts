import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { cacheGet, cacheSet, cacheDelByPrefix, TTL } from "../lib/cache.js";

const router = Router();

// Get all categories as tree (public, with model counts)
router.get("/api/categories", async (_req, res: Response) => {
  try {
    const cached = await cacheGet("cache:categories:tree");
    if (cached) { res.json(cached); return; }
    const categories = await prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    // Count models per category using raw SQL
    const modelCounts: { category_id: string; cnt: bigint }[] =
      await prisma.$queryRaw`SELECT category_id, COUNT(*) as cnt FROM models WHERE status = 'completed' AND category_id IS NOT NULL GROUP BY category_id`;
    const countMap = new Map<string, number>();
    for (const mc of modelCounts) {
      countMap.set(mc.category_id, Number(mc.cnt));
    }

    // Build tree
    const map = new Map<string, any>();
    const roots: any[] = [];

    for (const cat of categories) {
      const plainCat = {
        id: cat.id,
        name: cat.name,
        icon: cat.icon,
        parentId: cat.parentId,
        sortOrder: cat.sortOrder,
        createdAt: cat.createdAt,
        updatedAt: cat.updatedAt,
      };
      const count = countMap.get(cat.id) || 0;
      map.set(cat.id, {
        ...plainCat,
        count: count,
        children: [] as any[],
      });
    }

    for (const cat of categories) {
      const node = map.get(cat.id);
      if (cat.parentId && map.has(cat.parentId)) {
        map.get(cat.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // Aggregate child counts into parent (keep parent's own direct models too)
    for (const root of roots) {
      if (root.children.length > 0) {
        let childTotal = 0;
        for (const child of root.children) {
          childTotal += child.count;
        }
        root.count = (countMap.get(root.id) || 0) + childTotal;
      }
    }

    // Total completed models (not just categorized ones)
    const totalModels = await prisma.model.count({ where: { status: "completed" } });

    const result = { data: roots, total: totalModels };
    await cacheSet("cache:categories:tree", result, TTL.CATEGORIES);
    res.json(result);
  } catch (err) {
    console.error("[categories] Error:", err);
    res.status(500).json({ detail: "获取分类失败" });
  }
});

// Get flat list (public)
router.get("/api/categories/flat", async (_req, res: Response) => {
  try {
    const cached = await cacheGet("cache:categories:flat");
    if (cached) { res.json(cached); return; }
    const categories = await prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const result = { data: categories };
    await cacheSet("cache:categories:flat", result, TTL.CATEGORIES);
    res.json(result);
  } catch {
    res.status(500).json({ detail: "获取分类失败" });
  }
});

// Create category (auth required)
router.post("/api/categories", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { name, icon, parentId, sortOrder } = req.body;

  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ detail: "分类名称不能为空" });
    return;
  }
  if (name.length > 50) {
    res.status(400).json({ detail: "分类名称不能超过50个字符" });
    return;
  }

  try {
    const category = await prisma.category.create({
      data: {
        name: name.trim(),
        icon: icon || "folder",
        parentId: parentId || null,
        sortOrder: sortOrder ?? 0,
      },
    });
    await cacheDelByPrefix("cache:categories:");
    res.json({ data: category });
  } catch {
    res.status(500).json({ detail: "创建分类失败" });
  }
});

// Update category (auth required)
router.put("/api/categories/:id", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const { name, icon, parentId, sortOrder } = req.body;

  try {
    // Prevent circular reference
    if (parentId) {
      let current: string | null = parentId;
      const visited = new Set<string>();
      while (current) {
        if (current === id) {
          res.status(400).json({ detail: "不能将分类设置为自己的子分类" });
          return;
        }
        if (visited.has(current)) break;
        visited.add(current);
        const parent = await prisma.category.findUnique({ where: { id: current }, select: { parentId: true } });
        current = parent?.parentId ?? null;
      }
    }

    const category = await prisma.category.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(icon !== undefined && { icon }),
        ...(parentId !== undefined && { parentId: parentId || null }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    });
    await cacheDelByPrefix("cache:categories:");
    res.json({ data: category });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ detail: "分类不存在" });
      return;
    }
    res.status(500).json({ detail: "更新分类失败" });
  }
});

// Delete category (auth required)
router.delete("/api/categories/:id", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  try {
    // Check if category has children
    const childCount = await prisma.category.count({ where: { parentId: id } });
    if (childCount > 0) {
      res.status(400).json({ detail: "请先删除子分类" });
      return;
    }

    await prisma.category.delete({ where: { id } });
    await cacheDelByPrefix("cache:categories:");
    res.json({ message: "分类已删除" });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ detail: "分类不存在" });
      return;
    }
    res.status(500).json({ detail: "删除分类失败" });
  }
});

// Batch update sort order (auth required)
router.put("/api/categories/reorder", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { items }: { items: { id: string; sortOrder: number }[] } = req.body;

  if (!Array.isArray(items)) {
    res.status(400).json({ detail: "参数格式错误" });
    return;
  }

  try {
    await prisma.$transaction(
      items.map((item) =>
        prisma.category.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );
    await cacheDelByPrefix("cache:categories:");
    res.json({ message: "排序已更新" });
  } catch {
    res.status(500).json({ detail: "排序更新失败" });
  }
});

export default router;
