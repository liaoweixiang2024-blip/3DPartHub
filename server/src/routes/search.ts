import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import {
  MAX_MODEL_PAGE,
  enumQuery,
  modelTextSearchWhere,
  normalizeSearchParam,
  numericQuery,
} from "../lib/searchQuery.js";

const router = Router();

// Full-text search with filters
router.get("/api/search", async (req, res: Response) => {
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

  try {
    const where: any = { status: "completed" };
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

    // Sort
    let orderBy: any = { createdAt: "desc" };
    if (sort === "name") orderBy = { name: "asc" };
    else if (sort === "size") orderBy = { gltfSize: "desc" };
    else if (sort === "downloads") orderBy = { downloadCount: "desc" };

    const total = await prisma.model.count({ where });

    const models = await prisma.model.findMany({
      where,
      orderBy,
      skip: (page - 1) * size,
      take: size,
      include: {
        createdBy: { select: { id: true, username: true, avatar: true } },
        project: { select: { id: true, name: true } },
      },
    });

    const items = models.map((m: any) => ({
      model_id: m.id,
      name: m.name,
      original_name: m.originalName,
      description: m.description,
      format: m.format,
      thumbnail_url: m.thumbnailUrl,
      gltf_url: m.gltfUrl,
      file_size: m.gltfSize,
      original_size: m.originalSize,
      category: m.category,
      downloads: m.downloadCount,
      created_at: m.createdAt,
      created_by: m.createdBy,
      project: m.project,
    }));

    res.json({
      total,
      items,
      page,
      page_size: size,
      total_pages: Math.ceil(total / size),
    });
  } catch (err) {
    res.status(500).json({ detail: "搜索失败" });
  }
});

export default router;
