import { Router, Request, Response } from 'express';
import { getBusinessConfig } from '../../lib/businessConfig.js';
import { cacheGetOrSet, TTL } from '../../lib/cache.js';
import { logger } from '../../lib/logger.js';
import {
  MAX_MODEL_PAGE,
  enumQuery,
  modelTextSearchWhere,
  normalizeSearchParam,
  numericQuery,
  searchCacheToken,
} from '../../lib/searchQuery.js';
import { requireBrowseAccess } from '../../middleware/browseAccess.js';
import { withAssetVersion } from '../../services/gltfAsset.js';
import { MODEL_STATUS } from '../../services/modelStatus.js';
import { groupedVisibleModelWhere } from '../../services/modelVisibility.js';

type ModelListContext = {
  prisma: any;
  drawingDownloadUrl: (modelId: string, drawingUrl?: string | null) => string | null;
};

export function createModelListRouter({ prisma, drawingDownloadUrl }: ModelListContext) {
  const router = Router();

  // List models (public, with optional pagination/search/category)
  router.get('/api/models', async (req: Request, res: Response) => {
    if (!(await requireBrowseAccess(req, res))) return;

    const page = numericQuery(req.query.page, 1, 1, MAX_MODEL_PAGE);
    const search = normalizeSearchParam(req.query.search);
    const format = normalizeSearchParam(req.query.format, 20).toLowerCase();
    const category = normalizeSearchParam(req.query.category, 100);
    const categoryId = normalizeSearchParam(req.query.category_id, 80);
    const sort = enumQuery(req.query.sort, 'created_at', ['created_at', 'name', 'file_size'] as const);
    const order = enumQuery(req.query.order, 'desc', ['asc', 'desc'] as const);
    const grouped = req.query.grouped !== 'false';

    // Compute page size — needed to build cache key
    const { pageSizePolicy } = await getBusinessConfig();
    const defaultPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.homeDefault) || 20));
    const maxPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.homeMax) || 10000));
    const pageSize = numericQuery(req.query.page_size, defaultPageSize, 1, maxPageSize);

    const cacheKey = `cache:models:${page}:${pageSize}:${searchCacheToken(search)}:${format}:${categoryId || category}:${sort}:${order}:${grouped}`;

    if (prisma) {
      try {
        const { value: responseData, hit } = await cacheGetOrSet(cacheKey, TTL.MODELS_LIST, async () => {
          const where: any = { status: MODEL_STATUS.COMPLETED };
          const andConditions: Record<string, unknown>[] = [];
          const searchCond = modelTextSearchWhere(search);
          if (searchCond) andConditions.push(searchCond);
          if (format) {
            where.format = format;
          }
          if (categoryId) {
            const catIds = await cacheGetOrSet<string[]>(`cat-tree:${categoryId}`, TTL.CATEGORIES, async () => {
              const catIdsRaw = await prisma.$queryRaw<Array<{ id: string }>>`
                  WITH RECURSIVE cat_tree AS (
                    SELECT id FROM categories WHERE id = ${categoryId}
                    UNION ALL
                    SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_id = ct.id
                  ) SELECT id FROM cat_tree
                `;
              return catIdsRaw.map((c: any) => c.id);
            }).then((r) => r.value);
            if (catIds.length > 0) {
              where.categoryId = { in: catIds };
            } else {
              where.categoryId = categoryId;
            }
          } else if (category) {
            const cat = await prisma.category.findFirst({ where: { name: category } });
            if (cat) {
              const catIds = await cacheGetOrSet<string[]>(`cat-tree:${cat.id}`, TTL.CATEGORIES, async () => {
                const catIdsRaw = await prisma.$queryRaw<Array<{ id: string }>>`
                    WITH RECURSIVE cat_tree AS (
                      SELECT id FROM categories WHERE id = ${cat.id}
                      UNION ALL
                      SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_id = ct.id
                    ) SELECT id FROM cat_tree
                  `;
                return catIdsRaw.map((c: { id: string }) => c.id);
              }).then((r) => r.value);
              where.categoryId = { in: catIds };
            } else {
              where.category = category;
            }
          }

          if (grouped) {
            andConditions.push(await groupedVisibleModelWhere(prisma));
          }
          if (andConditions.length) where.AND = andConditions;

          const total = await prisma.model.count({ where });

          const orderBy: any = {};
          if (sort === 'name') orderBy.name = order;
          else if (sort === 'file_size') orderBy.gltfSize = order;
          else orderBy.createdAt = order;

          const models = await prisma.model.findMany({
            where,
            orderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: {
              categoryRef: { select: { name: true } },
              group: { select: { id: true, name: true, primaryId: true, _count: { select: { models: true } } } },
            },
          });

          const items = models.map((m: any) => ({
            model_id: m.id,
            name: m.name || m.originalName,
            format: m.format,
            thumbnail_url: withAssetVersion(m.thumbnailUrl, m.updatedAt),
            gltf_url: withAssetVersion(m.gltfUrl, m.updatedAt),
            file_size: m.gltfSize,
            original_size: m.originalSize,
            category: m.categoryRef?.name || null,
            category_id: m.categoryId || null,
            download_count: m.downloadCount || 0,
            created_at: m.createdAt,
            drawing_url: drawingDownloadUrl(m.id, m.drawingUrl),
            drawing_name: m.drawingName || null,
            drawing_size: m.drawingSize || null,
            group: m.group
              ? {
                  id: m.group.id,
                  name: m.group.name,
                  is_primary: m.id === m.group.primaryId,
                  variant_count: m.group._count.models,
                }
              : null,
          }));

          return { total, items, page, page_size: pageSize };
        });
        res.set('X-Cache', hit ? 'HIT' : 'MISS');
        res.set('Cache-Control', 'public, max-age=30');
        res.json(responseData);
        return;
      } catch (err) {
        logger.error({ err }, '[models/list] Failed to list models');
        res.status(500).json({ detail: 'Failed to list models' });
        return;
      }
    }

    res.status(503).json({ detail: 'Database not available' });
  });

  return router;
}
