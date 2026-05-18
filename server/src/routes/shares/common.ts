import { Response } from 'express';
import { verifyProtectedResourceToken } from '../../lib/downloadTokenStore.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';

export const SHARE_ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

export function asSingleString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return undefined;
}

export function adminOnly(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ detail: '需要管理员权限' });
    return false;
  }
  return true;
}

export function hasShareAccess(shareId: string, hashedPassword: string | null, accessToken: unknown): boolean {
  if (!hashedPassword) return true;
  const token = asSingleString(accessToken);
  if (!token) return false;
  return Boolean(verifyProtectedResourceToken(token, 'share-access', shareId));
}

let shareAllowDrawingColumnPromise: Promise<boolean> | null = null;
let selectionSharesTablePromise: Promise<boolean> | null = null;

async function publicTableExists(tableName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
    ) AS "exists"
  `;
  return Boolean(rows[0]?.exists);
}

async function publicColumnExists(tableName: string, columnName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS "exists"
  `;
  return Boolean(rows[0]?.exists);
}

export async function hasShareAllowDrawingColumn(): Promise<boolean> {
  shareAllowDrawingColumnPromise ??= publicColumnExists('share_links', 'allow_drawing').catch((err) => {
    logger.warn({ err }, '[Shares] Failed to inspect share_links.allow_drawing column');
    return true;
  });
  return shareAllowDrawingColumnPromise;
}

export async function hasSelectionSharesTable(): Promise<boolean> {
  selectionSharesTablePromise ??= publicTableExists('selection_shares').catch((err) => {
    logger.warn({ err }, '[Shares] Failed to inspect selection_shares table');
    return true;
  });
  return selectionSharesTablePromise;
}

type SelectionShareNameRow = {
  id: string;
  categorySlug: string;
  productIds: unknown;
};

function asProductIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function productDisplayName(product: { name: string; modelNo: string | null }) {
  const name = product.name?.trim();
  const modelNo = product.modelNo?.trim();
  if (name && modelNo && name !== modelNo) return `${name} ${modelNo}`;
  return name || modelNo || '选型结果';
}

export async function buildSelectionShareNameMap(
  rows: SelectionShareNameRow[],
  categoryNameMap: Map<string, string>,
): Promise<Map<string, string>> {
  const productIds = Array.from(new Set(rows.flatMap((row) => asProductIds(row.productIds)))).slice(0, 2000);
  const products = productIds.length
    ? await prisma.selectionProduct.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, modelNo: true },
      })
    : [];
  const productMap = new Map(products.map((product) => [product.id, product]));

  return new Map(
    rows.map((row) => {
      const resultProducts = asProductIds(row.productIds)
        .map((id) => productMap.get(id))
        .filter((item): item is { id: string; name: string; modelNo: string | null } => Boolean(item));
      if (resultProducts.length === 1) {
        return [row.id, productDisplayName(resultProducts[0])];
      }
      if (resultProducts.length > 1) {
        return [row.id, `${productDisplayName(resultProducts[0])} 等 ${resultProducts.length} 个结果`];
      }
      return [row.id, categoryNameMap.get(row.categorySlug) || row.categorySlug || '产品选型'];
    }),
  );
}
