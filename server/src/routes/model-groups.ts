import { Router, Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { MODEL_STATUS } from "../services/modelStatus.js";
import { clearCategoryCache } from "./categories/common.js";

let prisma: any = null;
try {
  const mod = await import("../lib/prisma.js");
  prisma = mod.prisma;
} catch {}

const router = Router();
const MAX_GROUP_MODEL_IDS = 200;
const MAX_BATCH_MERGE_ITEMS = 50;
const MAX_SUGGESTION_PAGE_SIZE = 100;

function numericQuery(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

// Create group
router.post("/api/model-groups", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { name, description, modelIds } = req.body;
  if (!name || !modelIds || !Array.isArray(modelIds) || modelIds.length === 0) {
    res.status(400).json({ detail: "需要 name 和 modelIds" });
    return;
  }
  if (modelIds.length > MAX_GROUP_MODEL_IDS) {
    res.status(400).json({ detail: `单个分组最多支持 ${MAX_GROUP_MODEL_IDS} 个模型` });
    return;
  }

  try {
    // Pick the newest model as primary
    const newest = await prisma.model.findFirst({
      where: { id: { in: modelIds } },
      orderBy: [{ fileModifiedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: { id: true },
    });
    const group = await prisma.modelGroup.create({
      data: {
        name,
        description: description || null,
        primaryId: newest?.id || modelIds[0],
        models: { connect: modelIds.map((id: string) => ({ id })) },
      },
      include: { models: { select: { id: true, name: true, thumbnailUrl: true, originalName: true } } },
    });
    // Clear model list cache
    const { cacheDelByPrefix, cacheDel } = await import("../lib/cache.js");
    await cacheDelByPrefix("cache:models:");
    await cacheDel("cache:model-groups:list");
    await clearCategoryCache();
    res.json({ success: true, data: group });
  } catch (err: any) {
    console.error("[model-groups] Error:", err);
    res.status(500).json({ detail: "操作失败" });
  }
});

// List all groups
router.get("/api/model-groups", authMiddleware, requireRole("ADMIN"), async (_req: AuthRequest, res: Response) => {
  if (!prisma) { res.json({ success: true, data: [] }); return; }
  try {
    const { cacheGetOrSet, TTL } = await import("../lib/cache.js");
    const data = await cacheGetOrSet("cache:model-groups:list", TTL.MODELS_LIST, async () => {
      const groups = await prisma.modelGroup.findMany({
        include: {
          primary: { select: { id: true, name: true, thumbnailUrl: true } },
          models: {
            select: {
              id: true,
              name: true,
              thumbnailUrl: true,
              originalName: true,
              originalSize: true,
              createdAt: true,
              fileModifiedAt: true,
            },
            orderBy: [{ fileModifiedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return groups.map((g: any) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        primary: g.primary,
        model_count: g.models.length,
        models: g.models.map((m: any) => ({
          id: m.id,
          name: m.name,
          thumbnailUrl: m.thumbnailUrl,
          originalName: m.originalName,
          originalSize: m.originalSize,
          createdAt: m.createdAt,
          fileModifiedAt: m.fileModifiedAt,
        })),
        created_at: g.createdAt,
      }));
    });
    res.json({ success: true, data });
  } catch (err: any) {
    console.error("[model-groups] Error:", err);
    res.status(500).json({ detail: "操作失败" });
  }
});

// Get merge suggestions — groups of models with same name, not yet grouped
router.get("/api/model-groups/suggestions", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  if (!prisma) { res.json({ success: true, data: { items: [], total: 0, page: 1, page_size: 20 } }); return; }
  try {
    const page = numericQuery(req.query.page, 1, 1, 100000);
    const pageSize = numericQuery(req.query.page_size, 20, 1, MAX_SUGGESTION_PAGE_SIZE);

    const COMPLETED = MODEL_STATUS.COMPLETED;
    const offset = (page - 1) * pageSize;
    const dupes = await prisma.$queryRaw<
      Array<{ name: string; cnt: number }>
    >`
      SELECT name, COUNT(*)::int as cnt
      FROM models
      WHERE group_id IS NULL AND status = ${COMPLETED}
      GROUP BY name
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC, name ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const totalResult = await prisma.$queryRaw<
      Array<{ total: number }>
    >`
      SELECT COUNT(*)::int as total FROM (
        SELECT name FROM models
        WHERE group_id IS NULL AND status = ${COMPLETED}
        GROUP BY name HAVING COUNT(*) > 1
      ) sub
    `;
    const total = totalResult[0]?.total || 0;
    const paged = dupes;

    const items = [];
    if (paged.length > 0) {
      // Batch query: fetch all models for paged names in one go
      const allModels = await prisma.model.findMany({
        where: {
          name: { in: paged.map((d: any) => d.name) },
          groupId: null,
          status: MODEL_STATUS.COMPLETED,
        },
        select: { id: true, name: true, thumbnailUrl: true, originalName: true, originalSize: true, createdAt: true },
        orderBy: [{ fileModifiedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      });
      // Group by name
      const byName = new Map<string, typeof allModels>();
      for (const m of allModels) {
        let arr = byName.get(m.name);
        if (!arr) { arr = []; byName.set(m.name, arr); }
        arr.push(m);
      }
      for (const d of paged) {
        items.push({ name: d.name, count: d.cnt, models: byName.get(d.name) || [] });
      }
    }

    res.json({ success: true, data: { items, total, page, page_size: pageSize } });
  } catch (err: any) {
    console.error("[model-groups] Error:", err);
    res.status(500).json({ detail: "操作失败" });
  }
});

router.get("/api/model-groups/count", authMiddleware, requireRole("ADMIN"), async (_req: AuthRequest, res: Response) => {
  if (!prisma) { res.json({ success: true, data: { total: 0 } }); return; }
  try {
    const total = await prisma.modelGroup.count();
    res.json({ success: true, data: { total } });
  } catch (err: any) {
    console.error("[model-groups] Error:", err);
    res.status(500).json({ detail: "操作失败" });
  }
});

// Batch merge — create groups from multiple name sets
router.post("/api/model-groups/batch-merge", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { items } = req.body as { items: { name: string; modelIds: string[] }[] };
  if (!items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ detail: "需要 items 数组" });
    return;
  }
  if (items.length > MAX_BATCH_MERGE_ITEMS) {
    res.status(400).json({ detail: `单次最多合并 ${MAX_BATCH_MERGE_ITEMS} 组` });
    return;
  }
  if (items.some((item) => item && Array.isArray(item.modelIds) && item.modelIds.length > MAX_GROUP_MODEL_IDS)) {
    res.status(400).json({ detail: `单个分组最多支持 ${MAX_GROUP_MODEL_IDS} 个模型` });
    return;
  }

  try {
    const results: Array<{ name: string; group_id: string; model_count: number }> = [];
    await prisma.$transaction(async (tx: any) => {
      for (const item of items) {
        if (!item.name || !Array.isArray(item.modelIds) || item.modelIds.length < 2) continue;
        const newest = await tx.model.findFirst({
          where: { id: { in: item.modelIds } },
          orderBy: [{ fileModifiedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
          select: { id: true },
        });
        const group = await tx.modelGroup.create({
          data: {
            name: item.name,
            primaryId: newest?.id || item.modelIds[0],
            models: { connect: item.modelIds.map((id: string) => ({ id })) },
          },
        });
        results.push({ name: item.name, group_id: group.id, model_count: item.modelIds.length });
      }
    });
    const { cacheDelByPrefix, cacheDel } = await import("../lib/cache.js");
    await cacheDelByPrefix("cache:models:");
    await cacheDel("cache:model-groups:list");
    await clearCategoryCache();
    res.json({ success: true, data: { merged: results.length, groups: results } });
  } catch (err: any) {
    console.error("[model-groups] Error:", err);
    res.status(500).json({ detail: "操作失败" });
  }
});

// Get group detail
router.get("/api/model-groups/:id", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  if (!prisma) { res.status(404).json({ detail: "Not found" }); return; }
  const group = await prisma.modelGroup.findUnique({
    where: { id: req.params.id },
    include: {
      primary: true,
      models: {
        select: {
          id: true, name: true, thumbnailUrl: true, originalName: true,
          originalFormat: true, originalSize: true, gltfUrl: true, createdAt: true, fileModifiedAt: true,
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
    if (primaryId !== undefined && primaryId !== null) {
      const member = await prisma.model.findFirst({
        where: { id: primaryId, groupId: req.params.id },
        select: { id: true },
      });
      if (!member) {
        res.status(400).json({ detail: "主版本必须是当前分组内的模型" });
        return;
      }
    }
    const group = await prisma.modelGroup.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(primaryId !== undefined && { primaryId }),
      },
      include: {
        primary: { select: { id: true, name: true, thumbnailUrl: true } },
        models: {
          select: { id: true, name: true, thumbnailUrl: true, originalName: true, originalSize: true, createdAt: true, fileModifiedAt: true },
          orderBy: [{ fileModifiedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        },
      },
    });
    const { cacheDelByPrefix, cacheDel } = await import("../lib/cache.js");
    await cacheDelByPrefix("cache:models:");
    await cacheDel("cache:model-groups:list");
    await clearCategoryCache();
    res.json({
      success: true,
      data: {
        id: group.id,
        name: group.name,
        description: group.description,
        primary: group.primary,
        model_count: group.models.length,
        models: group.models,
        created_at: group.createdAt,
      },
    });
  } catch (err: any) {
    console.error("[model-groups] Error:", err);
    res.status(500).json({ detail: "操作失败" });
  }
});

// Delete group (unlink all models, don't delete models)
router.delete("/api/model-groups/:id", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    // Unlink models first
    await prisma.$transaction([
      prisma.model.updateMany({
        where: { groupId: req.params.id },
        data: { groupId: null },
      }),
      prisma.modelGroup.delete({ where: { id: req.params.id } }),
    ]);
    const { cacheDelByPrefix, cacheDel } = await import("../lib/cache.js");
    await cacheDelByPrefix("cache:models:");
    await cacheDel("cache:model-groups:list");
    await clearCategoryCache();
    res.json({ success: true });
  } catch (err: any) {
    console.error("[model-groups] Error:", err);
    res.status(500).json({ detail: "操作失败" });
  }
});

// Add models to group
router.post("/api/model-groups/:id/models", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { modelIds } = req.body;
  if (!modelIds || !Array.isArray(modelIds)) {
    res.status(400).json({ detail: "需要 modelIds" });
    return;
  }
    if (modelIds.length > MAX_GROUP_MODEL_IDS) {
    res.status(400).json({ detail: `单次最多添加 ${MAX_GROUP_MODEL_IDS} 个模型` });
    return;
  }
  try {
    const group = await prisma.modelGroup.findUnique({ where: { id: req.params.id } });
    if (!group) {
      res.status(404).json({ detail: "分组不存在" });
      return;
    }
    await prisma.$transaction(async (tx: any) => {
      const existingCount = await tx.model.count({ where: { groupId: req.params.id } });
      const alreadyInGroup = await tx.model.count({ where: { id: { in: modelIds }, groupId: req.params.id } });
      if (existingCount + modelIds.length - alreadyInGroup > MAX_GROUP_MODEL_IDS) {
        throw new Error(`EXCEEDS_LIMIT:${existingCount}`);
      }
      const oldGroups = await tx.model.findMany({
        where: { id: { in: modelIds }, groupId: { not: null } },
        select: { id: true, groupId: true },
      });
      await tx.model.updateMany({
        where: { id: { in: modelIds } },
        data: { groupId: req.params.id },
      });
      const affectedGroupIds = [...new Set(oldGroups.map((m: any) => m.groupId).filter(Boolean))];
      for (const oldGroupId of affectedGroupIds) {
        const oldGroup = await tx.modelGroup.findUnique({ where: { id: oldGroupId } });
        if (oldGroup) {
          const remaining = await tx.model.count({ where: { groupId: oldGroupId } });
          if (remaining === 0) {
            await tx.modelGroup.delete({ where: { id: oldGroupId } });
          } else if (oldGroup.primaryId && modelIds.includes(oldGroup.primaryId)) {
            const newest = await tx.model.findFirst({
              where: { groupId: oldGroupId },
              orderBy: [{ fileModifiedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
              select: { id: true },
            });
            await tx.modelGroup.update({ where: { id: oldGroupId }, data: { primaryId: newest?.id || null } });
          }
        }
      }
    });
    const { cacheDelByPrefix, cacheDel } = await import("../lib/cache.js");
    await cacheDelByPrefix("cache:models:");
    await cacheDel("cache:model-groups:list");
    await clearCategoryCache();
    res.json({ success: true });
  } catch (err: any) {
    if (err.message?.startsWith("EXCEEDS_LIMIT:")) {
      const current = err.message.split(":")[1];
      res.status(400).json({ detail: `分组最多支持 ${MAX_GROUP_MODEL_IDS} 个模型，当前已有 ${current} 个` });
      return;
    }
    console.error("[model-groups] Error:", err);
    res.status(500).json({ detail: "操作失败" });
  }
});

// Remove model from group
router.delete("/api/model-groups/:id/models/:modelId", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.$transaction(async (tx: any) => {
      const group = await tx.modelGroup.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          primaryId: true,
          models: { select: { id: true, fileModifiedAt: true, createdAt: true } },
        },
      });
      if (!group) {
        throw new Error("NOT_FOUND");
      }
      const current = group.models.some((m: any) => m.id === req.params.modelId);
      if (!current) {
        throw new Error("NOT_IN_GROUP");
      }
      const remaining = group.models.filter((m: any) => m.id !== req.params.modelId);
      if (remaining.length === 0) {
        await tx.model.update({ where: { id: req.params.modelId }, data: { groupId: null } });
        await tx.modelGroup.delete({ where: { id: req.params.id } });
      } else {
        if (group.primaryId === req.params.modelId) {
          remaining.sort((a: any, b: any) => {
            const toTime = (m: any) => m.fileModifiedAt ? new Date(m.fileModifiedAt).getTime() : new Date(m.createdAt).getTime();
            return toTime(b) - toTime(a);
          });
          await tx.modelGroup.update({
            where: { id: req.params.id },
            data: { primaryId: remaining[0]?.id ?? null },
          });
        }
        await tx.model.update({
          where: { id: req.params.modelId },
          data: { groupId: null },
        });
      }
    });
    const { cacheDelByPrefix, cacheDel } = await import("../lib/cache.js");
    await cacheDelByPrefix("cache:models:");
    await cacheDel("cache:model-groups:list");
    await clearCategoryCache();
    res.json({ success: true });
  } catch (err: any) {
    if (err.message === "NOT_FOUND") {
      res.status(404).json({ detail: "分组不存在" });
      return;
    }
    if (err.message === "NOT_IN_GROUP") {
      res.status(404).json({ detail: "模型不在当前分组中" });
      return;
    }
    console.error("[model-groups] Error:", err);
    res.status(500).json({ detail: "操作失败" });
  }
});

export default router;
