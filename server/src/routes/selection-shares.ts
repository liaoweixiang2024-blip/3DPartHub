import { randomBytes } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { createLogger } from '../lib/logger.js';
import { buildModelMatchMap } from '../lib/modelMatch.js';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { optionCatalogUrl } from './selections/common.js';

const log = createLogger({ component: 'selection-shares' });

const router = Router();

// ========== Create selection share (authenticated) ==========

router.post('/api/selection-shares', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    // 分享总开关 feature_shares_enabled 由 main.ts 的 featureGuard 在路由入口统一拦截
    const { categorySlug, specs, productIds, autoCreated } = req.body;

    if (!categorySlug || !specs) {
      res.status(400).json({ detail: '缺少必要参数' });
      return;
    }

    if (typeof specs !== 'object' || Array.isArray(specs) || JSON.stringify(specs).length > 10000) {
      res.status(400).json({ detail: '规格参数无效或过大' });
      return;
    }

    const categoryExists = await prisma.selectionCategory.findUnique({ where: { slug: categorySlug } });
    if (!categoryExists) {
      res.status(400).json({ detail: '分类不存在' });
      return;
    }

    const ids = Array.isArray(productIds) ? productIds : [];
    if (ids.length > 500) {
      res.status(400).json({ detail: '产品数量不能超过 500' });
      return;
    }

    const token = randomBytes(12).toString('hex');

    const share = await prisma.selectionShare.create({
      data: {
        token,
        categorySlug,
        specs,
        productIds: ids,
        createdById: userId,
        // 提交工单时自动创建的快照标记为 auto，用户分享列表不展示
        autoCreated: autoCreated === true,
      },
    });

    res.json({
      success: true,
      data: { id: share.id, token: share.token },
    });
  } catch (err: unknown) {
    log.error({ err }, 'Create selection share error');
    res.status(500).json({ detail: '创建分享失败' });
  }
});

// ========== Get selection share (public) ==========
// 注意：分享详情不套 requireBrowseAccess——分享链接本身就凭 token 授权（与模型分享一致），
// 叠加登录门槛会让开启「需登录浏览」的站点在微信等未登录环境里分享链接直接 401。

router.get('/api/selection-shares/:token', async (req: Request, res: Response) => {
  try {
    const shareToken = req.params.token as string;

    const share = await prisma.selectionShare.findUnique({ where: { token: shareToken } });
    if (!share) {
      res.status(404).json({ detail: '分享不存在' });
      return;
    }

    // Increment view count (fire-and-forget)
    prisma.selectionShare
      .update({
        where: { id: share.id },
        data: { viewCount: { increment: 1 } },
      })
      .catch((err) => {
        log.warn({ err }, '浏览量更新失败');
      });

    const [category, products] = await Promise.all([
      // 隐藏分类连带其分享一起下线（404），与公开选型页不可见口径一致
      prisma.selectionCategory.findFirst({
        where: { slug: share.categorySlug, hidden: false },
      }),
      (async () => {
        const ids = share.productIds as string[];
        return ids.length > 0
          ? await prisma.selectionProduct.findMany({
              where: { id: { in: ids }, hidden: false },
              orderBy: { sortOrder: 'asc' },
            })
          : [];
      })(),
    ]);

    if (!category) {
      res.status(404).json({ detail: '分享不存在' });
      return;
    }

    // Auto-match models (fuzzy, prefer primary version)
    const { selectionEnableMatch } = await getBusinessConfig();
    const modelNos = selectionEnableMatch ? (products.map((p) => p.modelNo).filter(Boolean) as string[]) : [];
    const modelMap = selectionEnableMatch
      ? await buildModelMatchMap(modelNos)
      : new Map<string, { id: string; thumbnailUrl: string | null }>();

    /* 画册解析（与 filter 路由同规则）：选项级 optionCatalogs 命中 → 分类自带 catalogPdf
       → 按接头形态共享兜底；分享页此前漏了整段，画册内容在分享链接里不展示 */
    const specsOf = (value: unknown): Record<string, unknown> =>
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const optionCatalogs = (category.optionCatalogs || {}) as Record<string, Record<string, unknown>>;
    const ownPdf = category.catalogPdf || null;
    let sharedPdfMap: Record<string, string> | null = null;
    if (!ownPdf && products.length) {
      const sharedCategories = await prisma.selectionCategory.findMany({
        where: { catalogShared: true, catalogPdf: { not: null } },
        select: { id: true, catalogPdf: true },
      });
      if (sharedCategories.length > 0) {
        const catPdfById = new Map(sharedCategories.map((c) => [c.id, c.catalogPdf!]));
        const sharedProducts = await prisma.selectionProduct.findMany({
          where: { categoryId: { in: sharedCategories.map((c) => c.id) } },
          select: { categoryId: true, specs: true },
        });
        sharedPdfMap = {};
        for (const p of sharedProducts) {
          const specs = specsOf(p.specs);
          const jt = typeof specs['接头形态'] === 'string' ? specs['接头形态'] : null;
          const pdf = catPdfById.get(p.categoryId);
          if (jt && pdf) sharedPdfMap[jt] = pdf;
        }
      }
    }
    const resolveCatalogPdf = (p: (typeof products)[number]): string | null => {
      const specs = specsOf(p.specs);
      for (const [field, valueMap] of Object.entries(optionCatalogs)) {
        const specVal = typeof specs[field] === 'string' ? specs[field] : null;
        const catalogUrl = specVal ? optionCatalogUrl(valueMap[specVal as string]) : null;
        if (specVal && catalogUrl) return catalogUrl;
      }
      if (ownPdf) return ownPdf;
      const jointShape = typeof specs['接头形态'] === 'string' ? specs['接头形态'] : '';
      return (sharedPdfMap && sharedPdfMap[jointShape]) || null;
    };

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
        categoryCatalogPdf: resolveCatalogPdf(p),
        matchedModelId: matched?.id ?? null,
        matchedModelThumbnail: matched?.thumbnailUrl ?? null,
      };
    });

    res.json({
      success: true,
      data: {
        categorySlug: share.categorySlug,
        categoryName: category?.name || '',
        groupId: (category?.groupId as string) || null,
        specs: share.specs,
        columns: category?.columns || [],
        optionOrder: category?.optionOrder || null,
        products: productsWithMatch,
      },
    });
  } catch (err: unknown) {
    log.error({ err }, 'Get selection share error');
    res.status(500).json({ detail: '获取分享失败' });
  }
});

export default router;
