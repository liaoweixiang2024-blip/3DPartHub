import { Router, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { requireBrowseAccess } from '../middleware/browseAccess.js';
import { buildModelMatchMap } from '../lib/modelMatch.js';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ component: 'selection-shares' });

const router = Router();

// ========== Create selection share (authenticated) ==========

router.post('/api/selection-shares', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { categorySlug, specs, productIds } = req.body;

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
      },
    });

    res.json({
      success: true,
      data: { id: share.id, token: share.token },
    });
  } catch (err: any) {
    log.error({ err }, 'Create selection share error');
    res.status(500).json({ detail: '创建分享失败' });
  }
});

// ========== Get selection share (public) ==========

router.get('/api/selection-shares/:token', async (req: Request, res: Response) => {
  if (!(await requireBrowseAccess(req, res))) return;
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
      .catch(() => {});

    const [category, products] = await Promise.all([
      prisma.selectionCategory.findUnique({
        where: { slug: share.categorySlug },
      }),
      (async () => {
        const ids = share.productIds as string[];
        return ids.length > 0
          ? await prisma.selectionProduct.findMany({
              where: { id: { in: ids } },
              orderBy: { sortOrder: 'asc' },
            })
          : [];
      })(),
    ]);

    // Auto-match models (fuzzy, prefer primary version)
    const { selectionEnableMatch } = await getBusinessConfig();
    const modelNos = selectionEnableMatch ? (products.map((p) => p.modelNo).filter(Boolean) as string[]) : [];
    const modelMap = selectionEnableMatch
      ? await buildModelMatchMap(modelNos)
      : new Map<string, { id: string; thumbnailUrl: string | null }>();

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
        categoryName: category?.name || '',
        groupId: (category?.groupId as string) || null,
        specs: share.specs,
        columns: category?.columns || [],
        optionOrder: category?.optionOrder || null,
        products: productsWithMatch,
      },
    });
  } catch (err: any) {
    log.error({ err }, 'Get selection share error');
    res.status(500).json({ detail: '获取分享失败' });
  }
});

export default router;
