import { Router } from 'express';
import { cacheGetOrSet, TTL } from '../../lib/cache.js';
import { getBusinessConfig } from '../../lib/businessConfig.js';
import { buildModelMatchMap } from '../../lib/modelMatch.js';
import { prisma } from '../../lib/prisma.js';
import { normalizeSearchParam, searchCacheToken } from '../../lib/searchQuery.js';
import { numericValue, optionalString, stringArray } from '../../lib/requestValidation.js';
import { requireBrowseAccess } from '../../middleware/browseAccess.js';
import { logger } from '../../lib/logger.js';

function cacheKeyPart(value: string): string {
  return encodeURIComponent(value);
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}

function normalizeSpecsBody(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const specs: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const field = optionalString(key, { maxLength: 80 });
    const specValue = optionalString(rawValue, { maxLength: 200 });
    if (field && specValue) specs[field] = specValue;
  }
  return specs;
}

function normalizeSkippedBody(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => optionalString(item, { maxLength: 80 })).filter((item): item is string => Boolean(item));
}

function specValue(specs: Record<string, unknown>, field: string): string {
  const value = specs[field];
  if (typeof value === 'string' && value) return value;
  return '—';
}

function selectionProductPayload(p: any, modelMap = new Map<string, { id: string; thumbnailUrl: string | null }>()) {
  const matched = p.modelNo ? modelMap.get(p.modelNo) : undefined;
  return {
    id: p.id,
    categoryId: p.categoryId,
    name: p.name,
    modelNo: p.modelNo,
    specs: p.specs,
    image: p.image,
    pdfUrl: p.pdfUrl,
    unit: p.unit,
    sortOrder: p.sortOrder,
    isKit: p.isKit,
    components: p.components,
    matchedModelId: matched?.id ?? null,
    matchedModelThumbnail: matched?.thumbnailUrl ?? null,
  };
}

function selectionSearchWhere(categoryId: string, search: string) {
  return search
    ? {
        categoryId,
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { modelNo: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : { categoryId };
}

function selectionSpecsWhere(categoryId: string, specs: Record<string, string>, manualFields: Set<string>) {
  const filters = Object.entries(specs)
    .filter(([key]) => !manualFields.has(key))
    .map(([key, value]) => ({
      specs: { path: [key], equals: value },
    }));
  return filters.length ? { AND: [{ categoryId }, ...filters] } : { categoryId };
}

type SelectionColumnDef = {
  key?: string;
  inputType?: string;
  displayOnly?: boolean;
  autoSelectSingle?: boolean;
  skipWhenNoOptions?: boolean;
  required?: boolean;
};

function nextSelectionField(columns: SelectionColumnDef[], specs: Record<string, string>, skipped: Set<string>) {
  return columns.find((col) => col.key && !col.displayOnly && !specs[col.key] && !skipped.has(col.key));
}

export function createSelectionPublicRouter() {
  const router = Router();

  // Global product search across all categories
  router.get('/api/selections/search', async (req, res) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const search = normalizeSearchParam(req.query.q);
      if (!search || search.length < 1) {
        res.json({ items: [], total: 0, query: search || '' });
        return;
      }
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(req.query.page_size) || 20));
      const { selectionEnableMatch } = await getBusinessConfig();

      const cacheKey = `cache:selections:search:${cacheKeyPart(search)}:${page}:${pageSize}`;
      const { value: result } = await cacheGetOrSet(cacheKey, TTL.SELECTION_PRODUCTS, async () => {
        const where = {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { modelNo: { contains: search, mode: 'insensitive' as const } },
          ],
        };

        const [total, items] = await Promise.all([
          prisma.selectionProduct.count({ where }),
          prisma.selectionProduct.findMany({
            where,
            orderBy: { sortOrder: 'asc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: {
              category: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  icon: true,
                  groupId: true,
                  groupName: true,
                  groupIcon: true,
                },
              },
            },
          }),
        ]);

        const modelNos = selectionEnableMatch ? (items.map((p) => p.modelNo).filter(Boolean) as string[]) : [];
        const modelMap = selectionEnableMatch
          ? await buildModelMatchMap(modelNos)
          : new Map<string, { id: string; thumbnailUrl: string | null }>();

        return {
          total,
          page,
          pageSize,
          items: items.map((p) => ({
            ...selectionProductPayload(p, modelMap),
            category: p.category,
          })),
        };
      });

      res.json(result || { items: [], total: 0, page: 1, pageSize, query: search });
    } catch (err) {
      logger.error({ err }, '[Selections] Global search error');
      res.status(500).json({ detail: '搜索失败' });
    }
  });

  // List all categories
  router.get('/api/selections/categories', async (req, res) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const { value: categories, hit } = await cacheGetOrSet(
        'cache:selections:categories',
        TTL.SELECTION_CATEGORIES,
        async () => {
          const rows = await prisma.selectionCategory.findMany({
            orderBy: { sortOrder: 'asc' },
            include: { _count: { select: { products: true } } },
          });
          return rows.map((c) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            description: c.description,
            icon: c.icon,
            sortOrder: c.sortOrder,
            columns: c.columns,
            image: c.image,
            optionImages: c.optionImages,
            optionOrder: c.optionOrder,
            groupId: c.groupId,
            groupName: c.groupName,
            groupIcon: c.groupIcon,
            groupImage: c.groupImage,
            groupImageFit: c.groupImageFit,
            kind: c.kind,
            catalogPdf: c.catalogPdf,
            catalogShared: c.catalogShared,
            optionCatalogs: c.optionCatalogs,
            productCount: c._count.products,
          }));
        },
        { lockTtlMs: 10_000, waitTimeoutMs: 5_000, pollMs: 50 },
      );
      res.set('X-Cache', hit ? 'HIT' : 'MISS');
      res.json(categories);
    } catch (err) {
      logger.error({ err }, '[Selections] List categories error');
      res.status(500).json({ detail: '获取分类列表失败' });
    }
  });

  router.post('/api/selections/model-matches', async (req, res) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const modelNos = stringArray(req.body?.modelNos, { limit: 500, maxLength: 200 });
      const modelMap = await buildModelMatchMap(modelNos);
      res.json(Object.fromEntries(modelMap.entries()));
    } catch (err) {
      logger.error({ err }, '[Selections] Match models error');
      res.status(500).json({ detail: '匹配模型失败' });
    }
  });

  router.post('/api/selections/categories/:slug/filter', async (req, res) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const slug = req.params.slug as string;
      const specs = normalizeSpecsBody(req.body?.specs);
      const requestedSkipped = normalizeSkippedBody(req.body?.skipped);
      const field = optionalString(req.body?.field, { maxLength: 80 }) || '';
      const search = normalizeSearchParam(req.body?.search);
      const includeItems = req.body?.includeItems !== false;
      const autoAdvance = req.body?.autoAdvance === true;
      const page = numericValue(req.body?.page, 1, 1, 100_000);
      const { pageSizePolicy } = await getBusinessConfig();
      const pageSize = Math.min(
        pageSizePolicy.selectionMax,
        numericValue(req.body?.pageSize ?? req.body?.page_size, 80, 1, pageSizePolicy.selectionMax),
      );

      const cacheKey = [
        'cache:selections:filter:v5',
        cacheKeyPart(slug),
        searchCacheToken(stableJson(specs)),
        searchCacheToken(stableJson(requestedSkipped)),
        cacheKeyPart(field),
        searchCacheToken(search),
        includeItems ? 'items' : 'summary',
        autoAdvance ? 'auto' : 'manual',
        page,
        pageSize,
      ].join(':');

      const { value: result, hit } = await cacheGetOrSet(
        cacheKey,
        TTL.SELECTION_PRODUCTS,
        async () => {
          const category = await prisma.selectionCategory.findUnique({
            where: { slug },
            select: { id: true, columns: true },
          });
          if (!category) return null;

          const columns = Array.isArray(category.columns) ? (category.columns as SelectionColumnDef[]) : [];
          const manualFields = new Set(
            columns.filter((col) => col.inputType === 'manual' && col.key).map((col) => col.key as string),
          );
          const resolvedSpecs = { ...specs };
          const resolvedSkipped = new Set(requestedSkipped);
          const autoAdvanced: Array<{ field: string; value?: string; reason: 'single' | 'empty' }> = [];

          if (autoAdvance && !search) {
            for (let guard = 0; guard < columns.length; guard += 1) {
              const nextField = nextSelectionField(columns, resolvedSpecs, resolvedSkipped);
              if (!nextField?.key || nextField.inputType === 'manual') break;

              const where = selectionSpecsWhere(category.id, resolvedSpecs, manualFields);
              const optionRows = await prisma.selectionProduct.findMany({ where, select: { specs: true } });
              const counts = new Map<string, number>();
              for (const row of optionRows) {
                const value = specValue(row.specs as Record<string, unknown>, nextField.key);
                if (value !== '—') counts.set(value, (counts.get(value) || 0) + 1);
              }

              if (counts.size === 1 && nextField.autoSelectSingle !== false) {
                const [value] = counts.keys();
                resolvedSpecs[nextField.key] = value;
                autoAdvanced.push({ field: nextField.key, value, reason: 'single' });
                continue;
              }

              if (counts.size === 0 && optionRows.length > 0 && nextField.required !== true) {
                resolvedSkipped.add(nextField.key);
                autoAdvanced.push({ field: nextField.key, reason: 'empty' });
                continue;
              }

              break;
            }
          }

          const effectiveField =
            autoAdvance && !search ? nextSelectionField(columns, resolvedSpecs, resolvedSkipped)?.key || '' : field;
          const where = search
            ? selectionSearchWhere(category.id, search)
            : selectionSpecsWhere(category.id, resolvedSpecs, manualFields);
          const shouldLoadOptions = Boolean(effectiveField) && !search && !manualFields.has(effectiveField);

          const optionRows = shouldLoadOptions
            ? await prisma.selectionProduct.findMany({ where, select: { specs: true } })
            : [];
          const total = shouldLoadOptions ? optionRows.length : await prisma.selectionProduct.count({ where });
          const items = includeItems
            ? await prisma.selectionProduct.findMany({
                where,
                orderBy: { sortOrder: 'asc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
              })
            : [];

          const counts = new Map<string, number>();
          if (shouldLoadOptions) {
            for (const row of optionRows) {
              const value = specValue(row.specs as Record<string, unknown>, effectiveField);
              if (value !== '—') counts.set(value, (counts.get(value) || 0) + 1);
            }
          }

          // Attach catalogPdf to items: from own category, or shared by joint type
          if (items.length) {
            const category = await prisma.selectionCategory.findUnique({
              where: { slug },
              select: { catalogPdf: true, optionCatalogs: true },
            });
            const ownPdf = category?.catalogPdf || null;
            const optionCatalogs = (category?.optionCatalogs || {}) as Record<string, Record<string, string>>;

            let sharedPdfMap: Record<string, string> | null = null;
            if (!ownPdf) {
              const sharedCategories = await prisma.selectionCategory.findMany({
                where: { catalogShared: true, catalogPdf: { not: null } },
                select: { id: true, catalogPdf: true, products: { select: { specs: true } } },
              });
              sharedPdfMap = {};
              for (const cat of sharedCategories) {
                for (const p of cat.products) {
                  const specs = p.specs as Record<string, unknown>;
                  const jt = typeof specs['接头形态'] === 'string' ? specs['接头形态'] : null;
                  if (jt && cat.catalogPdf) sharedPdfMap[jt] = cat.catalogPdf;
                }
              }
            }

            for (const item of items) {
              const specs = (item as any).specs as Record<string, string>;
              let matchedCatalog: string | null = null;
              for (const [field, valueMap] of Object.entries(optionCatalogs)) {
                const specVal = specs[field];
                if (specVal && valueMap[specVal]) {
                  matchedCatalog = valueMap[specVal];
                  break;
                }
              }
              (item as any).categoryCatalogPdf =
                matchedCatalog || ownPdf || (sharedPdfMap && sharedPdfMap[specs['接头形态']]) || null;
            }
          }

          return {
            total,
            page,
            pageSize,
            options: Array.from(counts.entries()).map(([val, count]) => ({ val, count })),
            items: items.map((item) => selectionProductPayload(item)),
            resolvedSpecs,
            resolvedSkipped: Array.from(resolvedSkipped),
            autoAdvanced,
          };
        },
        { lockTtlMs: 30_000, waitTimeoutMs: 20_000, pollMs: 50 },
      );

      if (!result) {
        res.status(404).json({ detail: '分类不存在' });
        return;
      }

      res.set('X-Cache', hit ? 'HIT' : 'MISS');
      res.json(result);
    } catch (err) {
      logger.error({ err }, '[Selections] Filter products error');
      res.status(500).json({ detail: '筛选产品失败' });
    }
  });

  // Get category by slug
  router.get('/api/selections/categories/:slug', async (req, res) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const slug = req.params.slug as string;
      const { value: category, hit } = await cacheGetOrSet(
        `cache:selections:category:${cacheKeyPart(slug)}`,
        TTL.SELECTION_CATEGORIES,
        () => prisma.selectionCategory.findUnique({ where: { slug } }),
        { lockTtlMs: 10_000, waitTimeoutMs: 5_000, pollMs: 50 },
      );
      if (!category) {
        res.status(404).json({ detail: '分类不存在' });
        return;
      }
      res.set('X-Cache', hit ? 'HIT' : 'MISS');
      res.json({
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        icon: category.icon,
        sortOrder: category.sortOrder,
        columns: category.columns,
        image: category.image,
        optionImages: category.optionImages,
        optionOrder: category.optionOrder,
        groupId: category.groupId,
        groupName: category.groupName,
        groupIcon: category.groupIcon,
        groupImage: category.groupImage,
        groupImageFit: category.groupImageFit,
        kind: category.kind,
      });
    } catch (err) {
      logger.error({ err }, '[Selections] Get category error');
      res.status(500).json({ detail: '获取分类详情失败' });
    }
  });

  // List products by category slug
  router.get('/api/selections/categories/:slug/products', async (req, res) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const slug = req.params.slug as string;
      const page = Math.max(1, Number(req.query.page) || 1);
      const { pageSizePolicy, selectionEnableMatch } = await getBusinessConfig();
      const pageSize = Math.min(
        pageSizePolicy.selectionMax,
        Math.max(1, Number(req.query.page_size) || pageSizePolicy.selectionDefault),
      );
      const search = normalizeSearchParam(req.query.search);
      const includeMatch = selectionEnableMatch && req.query.include_match !== '0';

      const cacheKey = [
        'cache:selections:products',
        cacheKeyPart(slug),
        page,
        pageSize,
        includeMatch ? 'match' : 'plain',
        searchCacheToken(search),
      ].join(':');

      const { value: result, hit } = await cacheGetOrSet(
        cacheKey,
        TTL.SELECTION_PRODUCTS,
        async () => {
          const category = await prisma.selectionCategory.findUnique({ where: { slug }, select: { id: true } });
          if (!category) return null;

          const where = selectionSearchWhere(category.id, search);

          const [total, items] = await Promise.all([
            prisma.selectionProduct.count({ where }),
            prisma.selectionProduct.findMany({
              where,
              orderBy: { sortOrder: 'asc' },
              skip: (page - 1) * pageSize,
              take: pageSize,
            }),
          ]);

          // Auto-match models by modelNo -> partNumber (fuzzy)
          const modelNos = includeMatch ? (items.map((p) => p.modelNo).filter(Boolean) as string[]) : [];
          const modelMap = includeMatch
            ? await buildModelMatchMap(modelNos)
            : new Map<string, { id: string; thumbnailUrl: string | null }>();

          return {
            total,
            page,
            pageSize,
            items: items.map((p) => selectionProductPayload(p, modelMap)),
          };
        },
        { lockTtlMs: 60_000, waitTimeoutMs: 45_000, pollMs: 50 },
      );

      if (!result) {
        res.status(404).json({ detail: '分类不存在' });
        return;
      }
      res.set('X-Cache', hit ? 'HIT' : 'MISS');
      res.json(result);
    } catch (err) {
      logger.error({ err }, '[Selections] List products error');
      res.status(500).json({ detail: '获取产品列表失败' });
    }
  });

  return router;
}
