import { Router, Response } from "express";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";
import { buildModelMatchMap } from "../lib/modelMatch.js";

const router = Router();

function adminOnly(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ detail: "需要管理员权限" });
    return false;
  }
  return true;
}

// Option image upload config
const optImgDir = join(process.cwd(), "static", "option-images");
if (!existsSync(optImgDir)) mkdirSync(optImgDir, { recursive: true });
const optImgUpload = multer({
  dest: optImgDir,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (/image\/(png|jpe?g|gif|webp|svg\+xml)/.test(file.mimetype)) cb(null, true);
    else cb(new Error("仅支持图片文件"));
  },
});

// ========== Public endpoints ==========

// List all categories
router.get("/api/selections/categories", async (_req, res) => {
  try {
    const categories = await prisma.selectionCategory.findMany({
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { products: true } } },
    });
    res.json(categories.map((c) => ({
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
      kind: c.kind,
      productCount: c._count.products,
    })));
  } catch (err) {
    console.error("[Selections] List categories error:", err);
    res.status(500).json({ detail: "获取分类列表失败" });
  }
});

// Get category by slug
router.get("/api/selections/categories/:slug", async (req, res) => {
  try {
    const slug = req.params.slug as string;
    const category = await prisma.selectionCategory.findUnique({
      where: { slug },
    });
    if (!category) {
      res.status(404).json({ detail: "分类不存在" });
      return;
    }
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
      kind: category.kind,
    });
  } catch (err) {
    console.error("[Selections] Get category error:", err);
    res.status(500).json({ detail: "获取分类详情失败" });
  }
});

// List products by category slug
router.get("/api/selections/categories/:slug/products", async (req, res) => {
  try {
    const slug = req.params.slug as string;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(5000, Math.max(1, Number(req.query.page_size) || 50));
    const search = (req.query.search as string) || "";

    const category = await prisma.selectionCategory.findUnique({
      where: { slug },
    });
    if (!category) {
      res.status(404).json({ detail: "分类不存在" });
      return;
    }

    const where = search
      ? {
          categoryId: category.id,
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { modelNo: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : { categoryId: category.id };

    const [total, items] = await Promise.all([
      prisma.selectionProduct.count({ where }),
      prisma.selectionProduct.findMany({
        where,
        orderBy: { sortOrder: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // Auto-match models by modelNo → partNumber (fuzzy)
    const modelNos = items.map((p) => p.modelNo).filter(Boolean) as string[];
    const modelMap = await buildModelMatchMap(modelNos);

    res.json({
      total,
      page,
      pageSize,
      items: items.map((p) => {
        const matched = p.modelNo ? modelMap.get(p.modelNo) : undefined;
        return {
          id: p.id,
          categoryId: p.categoryId,
          name: p.name,
          modelNo: p.modelNo,
          specs: p.specs,
          image: p.image,
          pdfUrl: p.pdfUrl,
          sortOrder: p.sortOrder,
          isKit: p.isKit,
          components: p.components,
          matchedModelId: matched?.id ?? null,
          matchedModelThumbnail: matched?.thumbnailUrl ?? null,
        };
      }),
    });
  } catch (err) {
    console.error("[Selections] List products error:", err);
    res.status(500).json({ detail: "获取产品列表失败" });
  }
});

// ========== Admin endpoints ==========

// Create category
router.post("/api/admin/selections/categories", authMiddleware, async (req: AuthRequest, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const { name, slug, description, icon, sortOrder, columns, image, optionImages, optionOrder, groupId, groupName, groupIcon, kind } = req.body;
    if (!name || !slug) {
      res.status(400).json({ detail: "分类名称和标识不能为空" });
      return;
    }
    if (!Array.isArray(columns)) {
      res.status(400).json({ detail: "columns 必须是数组" });
      return;
    }

    const category = await prisma.selectionCategory.create({
      data: { name, slug, description, icon, sortOrder: sortOrder ?? 0, columns, image, optionImages, optionOrder, groupId, groupName, groupIcon, kind },
    });
    res.status(201).json(category);
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(409).json({ detail: "slug 已存在" });
      return;
    }
    console.error("[Selections] Create category error:", err);
    res.status(500).json({ detail: "创建分类失败" });
  }
});

// Update category
router.put("/api/admin/selections/categories/:id", authMiddleware, async (req: AuthRequest, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const id = req.params.id as string;
    const { name, slug, description, icon, sortOrder, columns, image, optionImages, optionOrder, groupId, groupName, groupIcon, kind } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (slug !== undefined) data.slug = slug;
    if (description !== undefined) data.description = description;
    if (icon !== undefined) data.icon = icon;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (columns !== undefined) {
      if (!Array.isArray(columns)) {
        res.status(400).json({ detail: "columns 必须是数组" });
        return;
      }
      data.columns = columns;
    }
    if (image !== undefined) data.image = image;
    if (optionImages !== undefined) data.optionImages = optionImages;
    if (optionOrder !== undefined) data.optionOrder = optionOrder;
    if (groupId !== undefined) data.groupId = groupId;
    if (groupName !== undefined) data.groupName = groupName;
    if (groupIcon !== undefined) data.groupIcon = groupIcon;
    if (kind !== undefined) data.kind = kind;

    const category = await prisma.selectionCategory.update({
      where: { id },
      data,
    });
    res.json(category);
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ detail: "分类不存在" });
      return;
    }
    console.error("[Selections] Update category error:", err);
    res.status(500).json({ detail: "更新分类失败" });
  }
});

// Delete category
router.delete("/api/admin/selections/categories/:id", authMiddleware, async (req: AuthRequest, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const id = req.params.id as string;
    await prisma.selectionCategory.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ detail: "分类不存在" });
      return;
    }
    console.error("[Selections] Delete category error:", err);
    res.status(500).json({ detail: "删除分类失败" });
  }
});

// Create product
router.post("/api/admin/selections/products", authMiddleware, async (req: AuthRequest, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const { categoryId, name, modelNo, specs, image, pdfUrl, sortOrder, isKit, components } = req.body;
    if (!categoryId || !name) {
      res.status(400).json({ detail: "分类 ID 和产品名称不能为空" });
      return;
    }

    const product = await prisma.selectionProduct.create({
      data: {
        categoryId, name, modelNo, specs: specs ?? {}, image, pdfUrl,
        sortOrder: sortOrder ?? 0,
        isKit: isKit ?? false,
        components: components ?? undefined,
      },
    });
    res.status(201).json(product);
  } catch (err) {
    console.error("[Selections] Create product error:", err);
    res.status(500).json({ detail: "创建产品失败" });
  }
});

// Update product
router.put("/api/admin/selections/products/:id", authMiddleware, async (req: AuthRequest, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const id = req.params.id as string;
    const { name, modelNo, specs, image, pdfUrl, sortOrder, isKit, components } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (modelNo !== undefined) data.modelNo = modelNo;
    if (specs !== undefined) data.specs = specs;
    if (image !== undefined) data.image = image;
    if (pdfUrl !== undefined) data.pdfUrl = pdfUrl;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (isKit !== undefined) data.isKit = isKit;
    if (components !== undefined) data.components = components;

    const product = await prisma.selectionProduct.update({
      where: { id },
      data,
    });
    res.json(product);
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ detail: "产品不存在" });
      return;
    }
    console.error("[Selections] Update product error:", err);
    res.status(500).json({ detail: "更新产品失败" });
  }
});

// Delete product
router.delete("/api/admin/selections/products/:id", authMiddleware, async (req: AuthRequest, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const id = req.params.id as string;
    await prisma.selectionProduct.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ detail: "产品不存在" });
      return;
    }
    console.error("[Selections] Delete product error:", err);
    res.status(500).json({ detail: "删除产品失败" });
  }
});

// Batch import products
router.post("/api/admin/selections/products/batch", authMiddleware, async (req: AuthRequest, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const { categoryId, products } = req.body;
    if (!categoryId) {
      res.status(400).json({ detail: "categoryId 不能为空" });
      return;
    }
    if (!Array.isArray(products) || products.length === 0) {
      res.status(400).json({ detail: "products 必须是非空数组" });
      return;
    }

    const category = await prisma.selectionCategory.findUnique({ where: { id: categoryId } });
    if (!category) {
      res.status(404).json({ detail: "分类不存在" });
      return;
    }

    const data = products.map((p: any, i: number) => ({
      categoryId,
      name: p.name || `产品 ${i + 1}`,
      modelNo: p.modelNo || null,
      specs: p.specs ?? {},
      image: p.image || null,
      pdfUrl: p.pdfUrl || null,
      sortOrder: p.sortOrder ?? i,
      isKit: p.isKit ?? false,
      components: p.components ?? undefined,
    }));

    const result = await prisma.selectionProduct.createMany({ data });
    res.status(201).json({ created: result.count });
  } catch (err) {
    console.error("[Selections] Batch import error:", err);
    res.status(500).json({ detail: "批量导入失败" });
  }
});

// Sort categories
router.put("/api/admin/selections/categories-sort", authMiddleware, async (req: AuthRequest, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const { items }: { items: { id: string; sortOrder: number }[] } = req.body;
    if (!Array.isArray(items)) {
      res.status(400).json({ detail: "items 必须是数组" });
      return;
    }
    await prisma.$transaction(
      items.map((item) =>
        prisma.selectionCategory.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("[Selections] Sort categories error:", err);
    res.status(500).json({ detail: "排序失败" });
  }
});

// Upload option image
router.post("/api/admin/selections/option-image", authMiddleware, optImgUpload.single("file"), async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ detail: "请选择图片文件" });
      return;
    }
    const ext = file.originalname?.split(".").pop() || "png";
    const filename = `${randomUUID()}.${ext}`;
    const { renameSync } = await import("node:fs");
    renameSync(file.path, join(optImgDir, filename));
    const url = `/static/option-images/${filename}`;
    res.json({ url });
  } catch (err) {
    console.error("[Selections] Upload option image error:", err);
    res.status(500).json({ detail: "上传失败" });
  }
});

// Batch rename option value across all products in a category
router.put("/api/admin/selections/categories/:id/rename-option", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  try {
    const { id } = req.params;
    const { field, oldValue, newValue } = req.body;
    if (!field || !oldValue || !newValue) {
      res.status(400).json({ detail: "缺少参数" });
      return;
    }
    if (oldValue === newValue) {
      res.json({ updated: 0 });
      return;
    }

    // Find category to get product scope
    const category = await prisma.selectionCategory.findUnique({ where: { id } });
    if (!category) {
      res.status(404).json({ detail: "分类不存在" });
      return;
    }

    // Batch update products
    const products = await prisma.selectionProduct.findMany({
      where: { categoryId: id },
      select: { id: true, specs: true },
    });

    let updated = 0;
    for (const p of products) {
      const specs = p.specs as Record<string, string>;
      if (specs[field] === oldValue) {
        specs[field] = newValue;
        await prisma.selectionProduct.update({
          where: { id: p.id },
          data: { specs },
        });
        updated++;
      }
    }

    // Also update optionImages if exists
    const optImages = category.optionImages as Record<string, Record<string, string>> | null;
    if (optImages?.[field]?.[oldValue] !== undefined) {
      const updatedImages = { ...optImages };
      updatedImages[field] = { ...updatedImages[field] };
      updatedImages[field][newValue] = updatedImages[field][oldValue];
      delete updatedImages[field][oldValue];
      await prisma.selectionCategory.update({
        where: { id },
        data: { optionImages: updatedImages },
      });
    }

    res.json({ updated });
  } catch (err) {
    console.error("[Selections] Rename option error:", err);
    res.status(500).json({ detail: "修改失败" });
  }
});

export default router;
