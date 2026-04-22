import { Router, Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";

let prisma: any = null;
try {
  const mod = await import("../lib/prisma.js");
  prisma = mod.prisma;
} catch {}

const router = Router();

// Create group
router.post("/api/model-groups", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { name, description, modelIds } = req.body;
  if (!name || !modelIds || !Array.isArray(modelIds) || modelIds.length === 0) {
    res.status(400).json({ detail: "需要 name 和 modelIds" });
    return;
  }

  try {
    const group = await prisma.modelGroup.create({
      data: {
        name,
        description: description || null,
        primaryId: modelIds[0],
        models: { connect: modelIds.map((id: string) => ({ id })) },
      },
      include: { models: { select: { id: true, name: true, thumbnailUrl: true, originalName: true } } },
    });
    // Clear model list cache
    const { cacheDelByPrefix } = await import("../lib/cache.js");
    await cacheDelByPrefix("cache:models:");
    res.json({ success: true, data: group });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// List all groups
router.get("/api/model-groups", async (_req, res: Response) => {
  if (!prisma) { res.json({ success: true, data: [] }); return; }
  const groups = await prisma.modelGroup.findMany({
    include: {
      primary: { select: { id: true, name: true, thumbnailUrl: true } },
      models: { select: { id: true, name: true, thumbnailUrl: true, originalName: true, originalSize: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const result = groups.map((g: any) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    primary: g.primary,
    model_count: g.models.length,
    models: g.models,
    created_at: g.createdAt,
  }));
  res.json({ success: true, data: result });
});

// Get merge suggestions — groups of models with same name, not yet grouped
router.get("/api/model-groups/suggestions", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  if (!prisma) { res.json({ success: true, data: [], total: 0 }); return; }
  try {
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.page_size) || 20;

    const dupes = await prisma.$queryRaw`
      SELECT name, COUNT(*)::int as cnt
      FROM models
      WHERE group_id IS NULL AND status = 'completed'
      GROUP BY name
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC, name ASC
    ` as { name: string; cnt: number }[];

    const total = dupes.length;
    const paged = dupes.slice((page - 1) * pageSize, page * pageSize);

    const items = [];
    for (const d of paged) {
      const models = await prisma.model.findMany({
        where: { name: d.name, groupId: null, status: "completed" },
        select: { id: true, name: true, thumbnailUrl: true, originalName: true, originalSize: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      items.push({ name: d.name, count: d.cnt, models });
    }

    res.json({ success: true, data: items, total, page, page_size: pageSize });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Batch merge — create groups from multiple name sets
router.post("/api/model-groups/batch-merge", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { items } = req.body as { items: { name: string; modelIds: string[] }[] };
  if (!items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ detail: "需要 items 数组" });
    return;
  }

  try {
    const results = [];
    for (const item of items) {
      if (!item.name || !item.modelIds || item.modelIds.length < 2) continue;
      const group = await prisma.modelGroup.create({
        data: {
          name: item.name,
          primaryId: item.modelIds[0],
          models: { connect: item.modelIds.map((id: string) => ({ id })) },
        },
      });
      results.push({ name: item.name, group_id: group.id, model_count: item.modelIds.length });
    }
    const { cacheDelByPrefix } = await import("../lib/cache.js");
    await cacheDelByPrefix("cache:models:");
    res.json({ success: true, data: { merged: results.length, groups: results } });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Get group detail
router.get("/api/model-groups/:id", async (req, res: Response) => {
  if (!prisma) { res.status(404).json({ detail: "Not found" }); return; }
  const group = await prisma.modelGroup.findUnique({
    where: { id: req.params.id },
    include: {
      primary: true,
      models: {
        select: {
          id: true, name: true, thumbnailUrl: true, originalName: true,
          originalFormat: true, originalSize: true, gltfUrl: true, createdAt: true,
        },
      },
    },
  });
  if (!group) { res.status(404).json({ detail: "分组不存在" }); return; }
  res.json({ success: true, data: group });
});

// Update group
router.put("/api/model-groups/:id", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { name, description, primaryId } = req.body;
  try {
    const group = await prisma.modelGroup.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(primaryId !== undefined && { primaryId }),
      },
    });
    const { cacheDelByPrefix } = await import("../lib/cache.js");
    await cacheDelByPrefix("cache:models:");
    res.json({ success: true, data: group });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Delete group (unlink all models, don't delete models)
router.delete("/api/model-groups/:id", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    // Unlink models first
    await prisma.model.updateMany({
      where: { groupId: req.params.id },
      data: { groupId: null },
    });
    await prisma.modelGroup.delete({ where: { id: req.params.id } });
    const { cacheDelByPrefix } = await import("../lib/cache.js");
    await cacheDelByPrefix("cache:models:");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Add models to group
router.post("/api/model-groups/:id/models", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { modelIds } = req.body;
  if (!modelIds || !Array.isArray(modelIds)) {
    res.status(400).json({ detail: "需要 modelIds" });
    return;
  }
  try {
    await prisma.model.updateMany({
      where: { id: { in: modelIds } },
      data: { groupId: req.params.id },
    });
    const { cacheDelByPrefix } = await import("../lib/cache.js");
    await cacheDelByPrefix("cache:models:");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Remove model from group
router.delete("/api/model-groups/:id/models/:modelId", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.model.update({
      where: { id: req.params.modelId },
      data: { groupId: null },
    });
    const { cacheDelByPrefix } = await import("../lib/cache.js");
    await cacheDelByPrefix("cache:models:");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

export default router;
