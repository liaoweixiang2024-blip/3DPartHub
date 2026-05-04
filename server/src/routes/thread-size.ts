import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';

const KINDS = new Set(['thread', 'pipe', 'hose', 'fitting']);

type EntryInput = {
  id?: unknown;
  kind?: unknown;
  family?: unknown;
  hoseKind?: unknown;
  primary?: unknown;
  secondary?: unknown;
  meta?: unknown;
  note?: unknown;
  data?: unknown;
  sortOrder?: unknown;
  enabled?: unknown;
};

function adminOnly(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ detail: '需要管理员权限' });
    return false;
  }
  return true;
}

function entryTable() {
  return (prisma as any).threadSizeEntry;
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function nullableText(value: unknown) {
  const next = text(value);
  return next || null;
}

function sortOrder(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function normalizeInput(input: EntryInput) {
  const kind = text(input.kind);
  const primary = text(input.primary);
  if (!KINDS.has(kind)) throw new Error('数据类型不正确');
  if (!primary) throw new Error('规格/型号不能为空');

  return {
    kind,
    family: nullableText(input.family),
    hoseKind: nullableText(input.hoseKind),
    primary,
    secondary: text(input.secondary),
    meta: text(input.meta),
    note: text(input.note),
    data: input.data && typeof input.data === 'object' ? input.data : null,
    sortOrder: sortOrder(input.sortOrder),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
  };
}

function orderBy() {
  return [{ sortOrder: 'asc' }, { kind: 'asc' }, { family: 'asc' }, { primary: 'asc' }];
}

const router = Router();

router.get('/api/thread-size', async (_req, res: Response) => {
  try {
    const { cacheGetOrSet, TTL } = await import('../lib/cache.js');
    const { value: rows } = await cacheGetOrSet('cache:thread-size:public', TTL.CATEGORIES, async () => {
      return entryTable().findMany({
        where: { enabled: true },
        orderBy: orderBy(),
        take: 500,
      });
    });
    res.json({ items: rows });
  } catch {
    res.json({ items: [] });
  }
});

async function invalidateThreadSizeCache() {
  try {
    const { cacheDel } = await import('../lib/cache.js');
    await cacheDel('cache:thread-size:list');
    await cacheDel('cache:thread-size:public');
  } catch {}
}

router.get('/api/admin/thread-size', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  try {
    const { cacheGetOrSet, TTL } = await import('../lib/cache.js');
    const { value: rows } = await cacheGetOrSet('cache:thread-size:list', TTL.CATEGORIES, async () => {
      return entryTable().findMany({ orderBy: orderBy(), take: 1000 });
    });
    res.json({ items: rows });
  } catch {
    res.json({ items: [] });
  }
});

router.post('/api/admin/thread-size', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  try {
    const data = normalizeInput(req.body || {});
    const row = await entryTable().create({ data });
    await invalidateThreadSizeCache();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(400).json({ detail: '新增失败' });
  }
});

router.put('/api/admin/thread-size/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  try {
    const data = normalizeInput(req.body || {});
    const row = await entryTable().update({ where: { id: req.params.id }, data });
    await invalidateThreadSizeCache();
    res.json(row);
  } catch (err: any) {
    res.status(400).json({ detail: '保存失败' });
  }
});

router.delete('/api/admin/thread-size/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  await entryTable().delete({ where: { id: req.params.id } });
  await invalidateThreadSizeCache();
  res.json({ ok: true });
});

router.post('/api/admin/thread-size/import', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!adminOnly(req, res)) return;
  if (req.body?.items?.length > 1000) {
    res.status(400).json({ detail: '单次最多导入 1000 条数据' });
    return;
  }
  const rows = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rows.length) {
    res.status(400).json({ detail: '没有可导入的数据' });
    return;
  }
  try {
    const table = entryTable();
    let imported = 0;
    await prisma.$transaction(async (tx) => {
      const txTable = (tx as any).threadSizeEntry;
      for (const [index, raw] of rows.entries()) {
        const data = normalizeInput({ ...raw, sortOrder: raw.sortOrder ?? index });
        const id = text(raw.id);
        if (id) {
          await txTable.upsert({
            where: { id },
            create: { id, ...data },
            update: data,
          });
        } else {
          await txTable.create({ data });
        }
        imported += 1;
      }
    });
    await invalidateThreadSizeCache();
    const total = await table.count();
    res.json({ imported, total });
  } catch (err: any) {
    res.status(400).json({ detail: err?.message || '导入失败' });
  }
});

export default router;
