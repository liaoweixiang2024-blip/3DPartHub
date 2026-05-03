import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import {
  MAX_MODEL_PAGE,
  enumQuery,
  modelTextSearchWhere,
  normalizeSearchParam,
  numericQuery,
  searchCacheToken,
} from "../lib/searchQuery.js";
import { withAssetVersion } from "../services/gltfAsset.js";
import { requireBrowseAccess } from "../middleware/browseAccess.js";
import { MODEL_STATUS } from "../services/modelStatus.js";
import { groupedVisibleModelWhere } from "../services/modelVisibility.js";
import { cacheGetOrSet, TTL } from "../lib/cache.js";

const router = Router();

// Full-text search with filters
router.get("/api/search", async (req, res: Response) => {
  if (!(await requireBrowseAccess(req, res))) return;

  const q = normalizeSearchParam(req.query.q);
  const tags = normalizeSearchParam(req.query.tags);
  const format = normalizeSearchParam(req.query.format, 20).toLowerCase();
  const project = normalizeSearchParam(req.query.project, 80);
  const sort = enumQuery(req.query.sort, "relevance", ["relevance", "name", "size", "downloads"] as const);
  const page = numericQuery(req.query.page, 1, 1, MAX_MODEL_PAGE);
  const size = numericQuery(req.query.page_size, 20, 1, 50);

  if (!prisma) {
    res.status(503).json({ detail: "数据库未连接" });
    return;
  }

  const grouped = req.query.grouped !== "false";

  const cacheKey = [
    "cache:models:search",
    page,
    size,
    searchCacheToken(q),
    searchCacheToken(tags),
    format,
    searchCacheToken(project),
    sort,
    grouped,
  ].join(":");

  try {
    const { value: responseData, hit } = await cacheGetOrSet(cacheKey, TTL.MODELS_SEARCH, async () => {
      const where: any = { status: MODEL_STATUS.COMPLETED };
      const andConditions: Record<string, unknown>[] = [];

      // Text search
      const searchCond = modelTextSearchWhere(q);
      if (searchCond) andConditions.push(searchCond);

      // Format filter
      if (format) {
        where.format = format.toLowerCase();
      }

      // Project filter
      if (project) {
        where.projectId = project;
      }

      // Tag filter (search in description/name for tag keywords)
      if (tags) {
        const tagList = tags.split(",").map((t) => normalizeSearchParam(t, 40)).filter(Boolean).slice(0, 10);
        if (tagList.length > 0) {
          const tagConditions = tagList.map((tag) => ({
            OR: [
              { name: { contains: tag, mode: "insensitive" } },
              { description: { contains: tag, mode: "insensitive" } },
              { partNumber: { contains: tag, mode: "insensitive" } },
              { category: { contains: tag, mode: "insensitive" } },
              { categoryRef: { is: { name: { contains: tag, mode: "insensitive" } } } },
            ],
          }));
          andConditions.push(...tagConditions);
        }
      }
      if (andConditions.length) where.AND = andConditions;

      // Grouped visibility filter (consistent with homepage count)
      if (grouped) {
        andConditions.push(await groupedVisibleModelWhere(prisma));
        if (andConditions.length) where.AND = andConditions;
      }

      // Sort
      let orderBy: any = { createdAt: "desc" };
      if (sort === "name") orderBy = { name: "asc" };
      else if (sort === "size") orderBy = { gltfSize: "desc" };
      else if (sort === "downloads") orderBy = { downloadCount: "desc" };
      else if (sort === "relevance" && q) orderBy = { name: "asc" };

      const [total, models] = await Promise.all([
        prisma.model.count({ where }),
        prisma.model.findMany({
          where,
          orderBy,
          skip: (page - 1) * size,
          take: size,
          include: {
            categoryRef: { select: { name: true } },
            project: { select: { id: true, name: true } },
          },
        }),
      ]);
      const userIds = Array.from(new Set(models.map((model: any) => model.createdById).filter(Boolean)));
      const users = userIds.length
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, username: true, avatar: true },
          })
        : [];
      const usersById = new Map(users.map((user: any) => [user.id, user]));

      const items = models.map((m: any) => ({
        model_id: m.id,
        name: m.name,
        original_name: m.originalName,
        description: m.description,
        format: m.format,
        thumbnail_url: withAssetVersion(m.thumbnailUrl, m.updatedAt),
        gltf_url: withAssetVersion(m.gltfUrl, m.updatedAt),
        file_size: m.gltfSize,
        original_size: m.originalSize,
        category: m.categoryRef?.name || null,
        download_count: m.downloadCount || 0,
        created_at: m.createdAt,
        created_by: usersById.get(m.createdById) || null,
        project: m.project,
      }));

      return {
        total,
        items,
        page,
        page_size: size,
        total_pages: Math.ceil(total / size),
      };
    });

    res.set("X-Cache", hit ? "HIT" : "MISS");
    res.json(responseData);
  } catch (err) {
    res.status(500).json({ detail: "搜索失败" });
  }
});

export default router;
