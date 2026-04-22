import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

// Full-text search with filters
router.get("/api/search", async (req, res: Response) => {
  const q = (req.query.q as string) || "";
  const tags = req.query.tags as string | undefined;
  const format = req.query.format as string | undefined;
  const project = req.query.project as string | undefined;
  const sort = (req.query.sort as string) || "relevance";
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(50, Math.max(1, Number(req.query.page_size) || 20));

  if (!prisma) {
    res.status(503).json({ detail: "数据库未连接" });
    return;
  }

  try {
    const where: any = { status: "completed" };

    // Text search
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { originalName: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { partNumber: { contains: q, mode: "insensitive" } },
      ];
    }

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
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        const tagConditions = tagList.map((tag) => ({
          OR: [
            { name: { contains: tag, mode: "insensitive" } },
            { description: { contains: tag, mode: "insensitive" } },
            { category: { contains: tag, mode: "insensitive" } },
          ],
        }));
        // Combine with existing OR or add as AND
        if (where.OR) {
          const textOr = where.OR;
          delete where.OR;
          where.AND = [
            { OR: textOr },
            ...tagConditions.map((tc) => tc),
          ];
        } else {
          where.AND = tagConditions;
        }
      }
    }

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
