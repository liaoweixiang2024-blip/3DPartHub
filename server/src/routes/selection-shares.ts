import { Router, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";
import { buildModelMatchMap } from "../lib/modelMatch.js";

const router = Router();

// ========== Create selection share (authenticated) ==========

router.post("/api/selection-shares", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { categorySlug, specs, productIds } = req.body;

    if (!categorySlug || !specs) {
      res.status(400).json({ detail: "缺少必要参数" });
      return;
    }

    const ids = Array.isArray(productIds) ? productIds : [];

    const token = randomBytes(12).toString("hex");

    const share = await prisma.selectionShare.create({
      data: {
        token,
        categorySlug,
        specs,
        productIds: ids,
        createdById: userId,
      },
    });

    res.json({
      success: true,
      data: { id: share.id, token: share.token },
    });
  } catch (err: any) {
    console.error("Create selection share error:", err);
    res.status(500).json({ detail: "创建分享失败" });
  }
});

// ========== Get selection share (public) ==========

router.get("/api/selection-shares/:token", async (req: Request, res: Response) => {
  try {
    const shareToken = req.params.token as string;

    const share = await prisma.selectionShare.findUnique({ where: { token: shareToken } });
    if (!share) {
      res.status(404).json({ detail: "分享不存在" });
      return;
    }

    // Increment view count
    await prisma.selectionShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 } },
    });

    // Get category info
    const category = await prisma.selectionCategory.findUnique({
      where: { slug: share.categorySlug },
    });

    // Get products by IDs
    const ids = share.productIds as string[];
    const products = ids.length > 0
      ? await prisma.selectionProduct.findMany({
          where: { id: { in: ids } },
          orderBy: { sortOrder: "asc" },
        })
      : [];

    // Auto-match models (fuzzy, prefer primary version)
    const modelNos = products.map((p) => p.modelNo).filter(Boolean) as string[];
    const modelMap = await buildModelMatchMap(modelNos);

    const productsWithMatch = products.map((p) => {
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
    });

    res.json({
      success: true,
      data: {
        categorySlug: share.categorySlug,
        categoryName: category?.name || "",
        specs: share.specs,
        columns: category?.columns || [],
        products: productsWithMatch,
      },
    });
  } catch (err: any) {
    console.error("Get selection share error:", err);
    res.status(500).json({ detail: "获取分享失败" });
  }
});

export default router;
