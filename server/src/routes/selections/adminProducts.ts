import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { adminOnly, invalidateSelectionCache } from "./common.js";
import { logger } from "../../lib/logger.js";

function cleanProductName(name: string, modelNo?: string | null) {
  if (!name || !modelNo) return name;
  return name.replace(modelNo, "").replace(/[\s\-—_]+$/g, "").replace(/^[\s\-—_]+/g, "").trim() || name;
}

export function createSelectionAdminProductsRouter() {
  const router = Router();

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
          categoryId, name: cleanProductName(name, modelNo), modelNo, specs: specs ?? {}, image, pdfUrl,
          sortOrder: sortOrder ?? 0,
          isKit: isKit ?? false,
          components: components ?? undefined,
        },
      });
      await invalidateSelectionCache();
      res.status(201).json(product);
    } catch (err) {
      logger.error({ err }, "[Selections] Create product error");
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
      if (modelNo !== undefined) data.modelNo = modelNo;
      if (name !== undefined) {
        const current = modelNo === undefined
          ? await prisma.selectionProduct.findUnique({ where: { id }, select: { modelNo: true } })
          : null;
        data.name = cleanProductName(name, modelNo ?? current?.modelNo);
      }
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
      await invalidateSelectionCache();
      res.json(product);
    } catch (err: any) {
      if (err.code === "P2025") {
        res.status(404).json({ detail: "产品不存在" });
        return;
      }
      logger.error({ err }, "[Selections] Update product error");
      res.status(500).json({ detail: "更新产品失败" });
    }
  });

  // Delete product
  router.delete("/api/admin/selections/products/:id", authMiddleware, async (req: AuthRequest, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = req.params.id as string;
      await prisma.selectionProduct.delete({ where: { id } });
      await invalidateSelectionCache();
      res.json({ ok: true });
    } catch (err: any) {
      if (err.code === "P2025") {
        res.status(404).json({ detail: "产品不存在" });
        return;
      }
      logger.error({ err }, "[Selections] Delete product error");
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
      if (products.length > 1000) {
        res.status(400).json({ detail: "单次最多导入 1000 个产品" });
        return;
      }

      const category = await prisma.selectionCategory.findUnique({ where: { id: categoryId } });
      if (!category) {
        res.status(404).json({ detail: "分类不存在" });
        return;
      }

      // Load existing products by modelNo for dedup
      const incomingModelNos = products.map((p: any) => p.modelNo).filter(Boolean) as string[];
      const existing = incomingModelNos.length > 0
        ? await prisma.selectionProduct.findMany({
            where: { categoryId, modelNo: { in: incomingModelNos } },
            select: { id: true, modelNo: true },
          })
        : [];
      const existingMap = new Map(existing.map((e) => [e.modelNo, e.id]));

      let created = 0;
      let updated = 0;

      await prisma.$transaction(async (tx: any) => {
        for (let i = 0; i < products.length; i++) {
          const p = products[i] as any;
          const modelNo = p.modelNo || null;
          const specs = p.specs ? { ...p.specs } : {};
          if (modelNo && specs && typeof specs === "object" && !Array.isArray(specs)) {
            specs["型号"] = modelNo;
          }
          const data = {
            name: cleanProductName(p.name || `产品 ${i + 1}`, modelNo),
            modelNo,
            specs,
            image: p.image || null,
            pdfUrl: p.pdfUrl || null,
            sortOrder: p.sortOrder ?? i,
            isKit: p.isKit ?? false,
            components: p.components ?? undefined,
          };

          if (modelNo && existingMap.has(modelNo)) {
            await tx.selectionProduct.update({
              where: { id: existingMap.get(modelNo)! },
              data,
            });
            updated++;
          } else {
            const createdProduct = await tx.selectionProduct.create({
              data: { categoryId, ...data },
            });
            if (modelNo) existingMap.set(modelNo, createdProduct.id);
            created++;
          }
        }
      });

      await invalidateSelectionCache();
      res.status(201).json({ created, updated });
    } catch (err) {
      logger.error({ err }, "[Selections] Batch import error");
      res.status(500).json({ detail: "批量导入失败" });
    }
  });

  return router;
}
