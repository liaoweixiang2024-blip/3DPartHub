import { Router } from "express";
import { cacheGetOrSet, TTL } from "../../lib/cache.js";
import { getBusinessConfig } from "../../lib/businessConfig.js";
import { buildModelMatchMap } from "../../lib/modelMatch.js";
import { prisma } from "../../lib/prisma.js";
import { normalizeSearchParam, searchCacheToken } from "../../lib/searchQuery.js";
import { numericValue, optionalString, stringArray } from "../../lib/requestValidation.js";
import { requireBrowseAccess } from "../../middleware/browseAccess.js";

function cacheKeyPart(value: string): string {
  return encodeURIComponent(value);
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function normalizeSpecsBody(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const specs: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const field = optionalString(key, { maxLength: 80 });
    const specValue = optionalString(rawValue, { maxLength: 200 });
    if (field && specValue) specs[field] = specValue;
  }
  return specs;
}

function specValue(specs: Record<string, unknown>, field: string): string {
  const value = specs[field];
  if (typeof value === "string" && value) return value;
  return "—";
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
          { name: { contains: search, mode: "insensitive" as const } },
          { modelNo: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : { categoryId };
}

function selectionSpecsWhere(
  categoryId: string,
  specs: Record<string, string>,
  manualFields: Set<string>
) {
  const filters = Object.entries(specs)
    .filter(([key]) => !manualFields.has(key))
    .map(([key, value]) => ({
      specs: { path: [key], equals: value },
    }));
  return filters.length ? { AND: [{ categoryId }, ...filters] } : { categoryId };
}

export function createSelectionPublicRouter() {
  const router = Router();

  // List all categories
  router.get("/api/selections/categories", async (req, res) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const { value: categories, hit } = await cacheGetOrSet("cache:selections:categories", TTL.SELECTION_CATEGORIES, async () => {
        const rows = await prisma.selectionCategory.findMany({
          orderBy: { sortOrder: "asc" },
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
          productCount: c._count.products,
        }));
      }, { lockTtlMs: 10_000, waitTimeoutMs: 5_000, pollMs: 50 });
      res.set("X-Cache", hit ? "HIT" : "MISS");
      res.json(categories);
    } catch (err) {
      console.error("[Selections] List categories error:", err);
      res.status(500).json({ detail: "获取分类列表失败" });
    }
  });

  router.post("/api/selections/model-matches", async (req, res) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const modelNos = stringArray(req.body?.modelNos, { limit: 500, maxLength: 200 });
      const modelMap = await buildModelMatchMap(modelNos);
      res.json(Object.fromEntries(modelMap.entries()));
    } catch (err) {
      console.error("[Selections] Match models error:", err);
      res.status(500).json({ detail: "匹配模型失败" });
    }
  });

  router.post("/api/selections/categories/:slug/filter", async (req, res) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const slug = req.params.slug as string;
      const specs = normalizeSpecsBody(req.body?.specs);
      const field = optionalString(req.body?.field, { maxLength: 80 }) || "";
      const search = normalizeSearchParam(req.body?.search);
      const includeItems = req.body?.includeItems !== false;
      const page = numericValue(req.body?.page, 1, 1, 100_000);
      const { pageSizePolicy } = await getBusinessConfig();
      const pageSize = Math.min(
        pageSizePolicy.selectionMax,
        numericValue(req.body?.pageSize ?? req.body?.page_size, 80, 1, pageSizePolicy.selectionMax)
      );

      const cacheKey = [
        "cache:selections:filter:v1",
        cacheKeyPart(slug),
        searchCacheToken(stableJson(specs)),
        cacheKeyPart(field),
        searchCacheToken(search),
        includeItems ? "items" : "summary",
        page,
        pageSize,
      ].join(":");

      const { value: result, hit } = await cacheGetOrSet(cacheKey, TTL.SELECTION_PRODUCTS, async () => {
        const category = await prisma.selectionCategory.findUnique({
          where: { slug },
          select: { id: true, columns: true },
        });
        if (!category) return null;

        const columns = Array.isArray(category.columns)
          ? category.columns as Array<{ key?: string; inputType?: string }>
          : [];
        const manualFields = new Set(
          columns
            .filter((col) => col.inputType === "manual" && col.key)
            .map((col) => col.key as string)
        );
        const where = search
          ? selectionSearchWhere(category.id, search)
          : selectionSpecsWhere(category.id, specs, manualFields);
        const shouldLoadOptions = Boolean(field) && !search && !manualFields.has(field);

        const optionRows = shouldLoadOptions
          ? await prisma.selectionProduct.findMany({ where, select: { specs: true } })
          : [];
        const total = shouldLoadOptions ? optionRows.length : await prisma.selectionProduct.count({ where });
        const items = includeItems
          ? await prisma.selectionProduct.findMany({
              where,
              orderBy: { sortOrder: "asc" },
              skip: (page - 1) * pageSize,
              take: pageSize,
            })
          : [];

        const counts = new Map<string, number>();
        if (shouldLoadOptions) {
          for (const row of optionRows) {
            const value = specValue(row.specs as Record<string, unknown>, field);
            if (value !== "—") counts.set(value, (counts.get(value) || 0) + 1);
          }
        }

        return {
          total,
          page,
          pageSize,
          options: Array.from(counts.entries()).map(([val, count]) => ({ val, count })),
          items: items.map((item) => selectionProductPayload(item)),
        };
      }, { lockTtlMs: 30_000, waitTimeoutMs: 20_000, pollMs: 50 });

      if (!result) {
        res.status(404).json({ detail: "分类不存在" });
        return;
      }
      res.set("X-Cache", hit ? "HIT" : "MISS");
      res.json(result);
    } catch (err) {
      console.error("[Selections] Filter products error:", err);
      res.status(500).json({ detail: "筛选产品失败" });
    }
  });

  // Get category by slug
  router.get("/api/selections/categories/:slug", async (req, res) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const slug = req.params.slug as string;
      const { value: category, hit } = await cacheGetOrSet(
        `cache:selections:category:${cacheKeyPart(slug)}`,
        TTL.SELECTION_CATEGORIES,
        () => prisma.selectionCategory.findUnique({ where: { slug } }),
        { lockTtlMs: 10_000, waitTimeoutMs: 5_000, pollMs: 50 }
      );
      if (!category) {
        res.status(404).json({ detail: "分类不存在" });
        return;
      }
      res.set("X-Cache", hit ? "HIT" : "MISS");
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
      console.error("[Selections] Get category error:", err);
      res.status(500).json({ detail: "获取分类详情失败" });
    }
  });

  // List products by category slug
  router.get("/api/selections/categories/:slug/products", async (req, res) => {
    if (!(await requireBrowseAccess(req, res))) return;
    try {
      const slug = req.params.slug as string;
      const page = Math.max(1, Number(req.query.page) || 1);
      const { pageSizePolicy, selectionEnableMatch } = await getBusinessConfig();
      const pageSize = Math.min(pageSizePolicy.selectionMax, Math.max(1, Number(req.query.page_size) || pageSizePolicy.selectionDefault));
      const search = normalizeSearchParam(req.query.search);
      const includeMatch = selectionEnableMatch && req.query.include_match !== "0";

      const cacheKey = [
        "cache:selections:products",
        cacheKeyPart(slug),
        page,
        pageSize,
        includeMatch ? "match" : "plain",
        searchCacheToken(search),
      ].join(":");

      const { value: result, hit } = await cacheGetOrSet(cacheKey, TTL.SELECTION_PRODUCTS, async () => {
        const category = await prisma.selectionCategory.findUnique({ where: { slug }, select: { id: true } });
        if (!category) return null;

        const where = selectionSearchWhere(category.id, search);

        const [total, items] = await Promise.all([
          prisma.selectionProduct.count({ where }),
          prisma.selectionProduct.findMany({
            where,
            orderBy: { sortOrder: "asc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
        ]);

        // Auto-match models by modelNo -> partNumber (fuzzy)
        const modelNos = includeMatch ? items.map((p) => p.modelNo).filter(Boolean) as string[] : [];
        const modelMap = includeMatch ? await buildModelMatchMap(modelNos) : new Map<string, { id: string; thumbnailUrl: string | null }>();

        return {
          total,
          page,
          pageSize,
          items: items.map((p) => selectionProductPayload(p, modelMap)),
        };
      }, { lockTtlMs: 60_000, waitTimeoutMs: 45_000, pollMs: 50 });

      if (!result) {
        res.status(404).json({ detail: "分类不存在" });
        return;
      }
      res.set("X-Cache", hit ? "HIT" : "MISS");
      res.json(result);
    } catch (err) {
      console.error("[Selections] List products error:", err);
      res.status(500).json({ detail: "获取产品列表失败" });
    }
  });

  return router;
}
