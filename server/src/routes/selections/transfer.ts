/**
 * 选型分类数据包搬运（本地站 ↔ 服务器站）：
 * - POST /api/admin/selections/export          勾选分类流式打包下载（archiver，含分类设置 + 产品 + 图片/PDF 资产）
 * - POST /api/admin/selections/transfer-analyze 上传导出包，解析分类清单（暂存，不落盘内容）
 * - POST /api/admin/selections/transfer-commit  资产落盘 + 分类按 slug 覆盖更新/新建 + 产品按 modelNo 合并
 *
 * 包结构（导出/导入同构）：
 *   manifest.json
 *   assets/<static 子目录>/<uuid>.<ext>     ← entry 名 = URL 去掉 /static/ 前缀（如 assets/option-images/xx.png）
 *
 * 数据决策（与用户确认）：
 *   - 同 slug 分类已存在 → 覆盖更新（设置全量更新，产品按 modelNo upsert）
 *   - 数据包里没有的型号 → 保留（只增改不删）
 *
 * 范本：models/transfer.ts（模型库搬运，同构实现）。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { Prisma } from '@prisma/client';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { Router, Response, type NextFunction } from 'express';
import multer from 'multer';
import { getBusinessConfig } from '../../lib/businessConfig.js';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { UPLOAD_REQUEST_TIMEOUT_MS } from '../../lib/uploadLimits.js';
import { persistFile } from '../../lib/storageProvider.js';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { adminOnly, invalidateSelectionCache } from './common.js';

const TRANSFER_EXPORT_MAX_CATEGORIES = 100;
const TRANSFER_STALE_MS = 60 * 60 * 1000; // 暂存包保留 1 小时
// zip-slip 防护：entry 名严格白名单 assets/<目录>/<文件>，文件段限定安全字符
const TRANSFER_ENTRY_PATTERN = /^assets\/(option-images|selection-assets)\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

const importTransferDir = join(process.cwd(), config.uploadDir, 'import-selection-transfer');

type TransferProduct = {
  name: string;
  modelNo?: string | null;
  specs?: Record<string, unknown>;
  image?: string | null;
  pdfUrl?: string | null;
  unit?: string | null;
  sortOrder?: number;
  isKit?: boolean;
  hidden?: boolean;
  components?: unknown;
};

type TransferCategory = {
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  sortOrder?: number;
  columns?: unknown;
  image?: string | null;
  optionImages?: Record<string, Record<string, string>> | null;
  optionOrder?: unknown;
  groupId?: string | null;
  groupName?: string | null;
  groupIcon?: string | null;
  groupImage?: string | null;
  groupImageFit?: string | null;
  kind?: string | null;
  hidden?: boolean;
  catalogPdf?: string | null;
  catalogShared?: boolean;
  optionCatalogs?: Record<string, Record<string, string>> | null;
  products: TransferProduct[];
};

type TransferManifest = {
  version: number;
  kind: string;
  exportedAt: string;
  categories: TransferCategory[];
};

function staticPathFromUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith('/static/')) return null;
  return join(process.cwd(), config.staticDir, url.split('?')[0].slice('/static/'.length));
}

/** 收集一个分类（含产品）引用到的全部资产 URL（/static/ 站内路径才有文件可打包） */
function collectAssetUrls(cat: TransferCategory): string[] {
  const urls: string[] = [];
  const push = (url: unknown) => {
    if (typeof url === 'string' && url.startsWith('/static/')) urls.push(url.split('?')[0]);
  };
  push(cat.image);
  push(cat.groupImage);
  push(cat.catalogPdf);
  for (const map of [cat.optionImages, cat.optionCatalogs]) {
    if (!map || typeof map !== 'object') continue;
    for (const values of Object.values(map)) {
      if (!values || typeof values !== 'object') continue;
      for (const url of Object.values(values)) push(url);
    }
  }
  for (const p of cat.products || []) {
    push(p.image);
    push(p.pdfUrl);
  }
  return urls;
}

function cleanupStaleImports() {
  if (!existsSync(importTransferDir)) return;
  const now = Date.now();
  try {
    for (const name of readdirSync(importTransferDir)) {
      const path = join(importTransferDir, name);
      try {
        if (path.endsWith('.zip') && now - statSync(path).mtimeMs > TRANSFER_STALE_MS) {
          rmSync(path, { force: true });
        }
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* best-effort */
  }
}

export function createSelectionTransferRouter() {
  const router = Router();

  setInterval(cleanupStaleImports, 15 * 60 * 1000).unref?.();

  // ── 导出：勾选分类流式打包 ──
  router.post('/api/admin/selections/export', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const ids = Array.isArray(req.body?.categoryIds)
      ? Array.from(
          new Set((req.body.categoryIds as unknown[]).filter((id): id is string => typeof id === 'string')),
        ).slice(0, TRANSFER_EXPORT_MAX_CATEGORIES)
      : [];
    if (ids.length === 0) {
      res.status(400).json({ detail: '请先选择要导出的分类' });
      return;
    }

    const cats = await prisma.selectionCategory.findMany({
      where: { id: { in: ids } },
      include: { products: true },
    });
    if (cats.length === 0) {
      res.status(400).json({ detail: '选中的分类不存在' });
      return;
    }

    const manifest: TransferManifest = {
      version: 1,
      kind: 'selection-categories',
      exportedAt: new Date().toISOString(),
      categories: cats.map((cat) => ({
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        icon: cat.icon,
        sortOrder: cat.sortOrder,
        columns: cat.columns,
        image: cat.image,
        optionImages: cat.optionImages as TransferCategory['optionImages'],
        optionOrder: cat.optionOrder,
        groupId: cat.groupId,
        groupName: cat.groupName,
        groupIcon: cat.groupIcon,
        groupImage: cat.groupImage,
        groupImageFit: cat.groupImageFit,
        kind: cat.kind,
        hidden: cat.hidden,
        catalogPdf: cat.catalogPdf,
        catalogShared: cat.catalogShared,
        optionCatalogs: cat.optionCatalogs as TransferCategory['optionCatalogs'],
        products: cat.products.map((p) => ({
          name: p.name,
          modelNo: p.modelNo,
          specs: p.specs as Record<string, unknown>,
          image: p.image,
          pdfUrl: p.pdfUrl,
          unit: p.unit,
          sortOrder: p.sortOrder,
          isKit: p.isKit,
          hidden: p.hidden,
          components: p.components,
        })),
      })),
    };

    // 资产收集 + 打包（URL 去重；manifest 引用按 URL 原值保留）
    const archive = archiver('zip', { zlib: { level: 5 } });
    const missing: string[] = [];
    const packed = new Set<string>();
    for (const cat of manifest.categories) {
      for (const url of collectAssetUrls(cat)) {
        if (packed.has(url)) continue;
        const absPath = staticPathFromUrl(url);
        if (!absPath || !existsSync(absPath)) {
          missing.push(url);
          continue;
        }
        archive.file(absPath, { name: `assets/${url.slice('/static/'.length)}` });
        packed.add(url);
      }
    }

    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.on('error', (err) => {
      logger.error({ err }, '[Selections] Transfer export archive error');
      if (!res.headersSent) res.status(500).json({ detail: '打包导出失败' });
      else res.destroy(err);
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="selection-export.zip"; filename*=UTF-8''${encodeURIComponent(
        `选型导出-${manifest.categories.length}个分类-${new Date().toISOString().slice(0, 10)}.zip`,
      )}`,
    );
    logger.info(
      { categories: manifest.categories.length, assets: packed.size, skippedMissing: missing.length },
      '[Selections] Transfer export archive',
    );
    archive.pipe(res);
    await archive.finalize();
  });

  // ── 导入第一步：上传包并解析清单（暂存 zip，不落盘内容） ──
  function transferPackageUpload(req: AuthRequest, res: Response, next: NextFunction) {
    getBusinessConfig()
      .then(({ uploadPolicy }) => {
        const maxBytes = Math.round(uploadPolicy.selectionTransferMaxSizeMb * 1024 * 1024);
        const upload = multer({
          defParamCharset: 'utf8',
          dest: importTransferDir,
          limits: { fileSize: maxBytes },
        }).single('file');
        upload(req, res, (err) => {
          if (!err) {
            next();
            return;
          }
          const uploadError = err as { code?: string; message?: string };
          if (uploadError.code === 'LIMIT_FILE_SIZE') {
            res.status(400).json({ detail: `数据包不能超过 ${uploadPolicy.selectionTransferMaxSizeMb}MB` });
            return;
          }
          res.status(400).json({ detail: uploadError.message || '上传数据包失败' });
        });
      })
      .catch(next);
  }

  router.post(
    '/api/admin/selections/transfer-analyze',
    authMiddleware,
    (req: AuthRequest, res: Response, next: NextFunction) => {
      if (!adminOnly(req, res)) return;
      req.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS);
      res.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS);
      next();
    },
    transferPackageUpload,
    async (req: AuthRequest, res: Response) => {
      try {
        await handleAnalyze(req, res);
      } catch (err) {
        logger.error({ err }, '[Selections] Transfer analyze error');
        if (!res.headersSent) res.status(500).json({ detail: '解析数据包失败' });
      }
    },
  );

  async function handleAnalyze(req: AuthRequest, res: Response) {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ detail: '没有文件' });
      return;
    }
    const cleanup = () => rmSync(file.path, { force: true });

    let zip: InstanceType<typeof AdmZip>;
    let manifest: TransferManifest;
    try {
      zip = new AdmZip(file.path);
      const manifestEntry = zip.getEntry('manifest.json');
      if (!manifestEntry) {
        cleanup();
        res.status(400).json({ detail: '包内缺少 manifest.json，请确认是「导出数据包」产出的包' });
        return;
      }
      manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as TransferManifest;
      if (manifest?.kind !== 'selection-categories' || !Array.isArray(manifest.categories)) {
        cleanup();
        res.status(400).json({ detail: 'manifest 格式不符，请确认是「导出数据包」产出的包' });
        return;
      }
      const valid = manifest.categories.filter(
        (c) => c && typeof c.slug === 'string' && typeof c.name === 'string' && Array.isArray(c.products),
      );
      if (valid.length === 0) {
        cleanup();
        res.status(400).json({ detail: '包内没有有效的分类数据' });
        return;
      }
      manifest.categories = valid;
    } catch {
      cleanup();
      res.status(400).json({ detail: '无法读取压缩包或 manifest 损坏' });
      return;
    }

    // 资产存在性核对（manifest 引用的 URL → 期望 entry 名）
    const wanted = new Set<string>();
    for (const cat of manifest.categories) {
      for (const url of collectAssetUrls(cat)) wanted.add(`assets/${url.slice('/static/'.length)}`);
    }
    let assetsMissing = 0;
    for (const name of wanted) if (!zip.getEntry(name)) assetsMissing += 1;

    // 与 DB 现状对比（slug 为准）
    const slugs = manifest.categories.map((c) => c.slug);
    const existingCats = await prisma.selectionCategory.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true, id: true, _count: { select: { products: true } } },
    });
    const existingBySlug = new Map(existingCats.map((c) => [c.slug, c]));

    // multer 临时文件重命名为 importId.zip 作暂存
    const importId = randomUUID();
    const stagedPath = join(importTransferDir, `${importId}.zip`);
    try {
      mkdirSync(importTransferDir, { recursive: true });
      renameSync(file.path, stagedPath);
    } catch {
      cleanup();
      res.status(500).json({ detail: '暂存导入包失败，请重试' });
      return;
    }

    logger.info(
      { importId, categories: manifest.categories.length, assets: wanted.size, assetsMissing },
      '[Selections] Transfer package analyzed',
    );
    res.json({
      import_id: importId,
      categories: manifest.categories.map((c) => {
        const existing = existingBySlug.get(c.slug);
        return {
          slug: c.slug,
          name: c.name,
          product_count: c.products.length,
          exists: Boolean(existing),
          current_product_count: existing?._count.products ?? 0,
        };
      }),
      assets: { total: wanted.size, missing: assetsMissing },
    });
  }

  // ── 导入第二步：资产落盘 + 分类/产品入库 ──
  router.post('/api/admin/selections/transfer-commit', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const importId = typeof req.body?.importId === 'string' ? req.body.importId : '';
    const stagedPath = join(importTransferDir, `${importId}.zip`);
    if (!/^[0-9a-f-]{36}$/i.test(importId) || !existsSync(stagedPath)) {
      res.status(404).json({ detail: '导入会话不存在或已过期，请重新上传' });
      return;
    }

    let zip: InstanceType<typeof AdmZip>;
    let manifest: TransferManifest;
    try {
      zip = new AdmZip(stagedPath);
      manifest = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf8')) as TransferManifest;
      if (manifest?.kind !== 'selection-categories' || !Array.isArray(manifest.categories)) {
        res.status(400).json({ detail: '导入包已损坏，请重新导出' });
        return;
      }
    } catch {
      res.status(400).json({ detail: '导入包已损坏，请重新导出' });
      return;
    }

    // 1) 资产落盘（先文件后数据：入库失败最多留孤儿文件，不会留 404 引用）
    let assetsRestored = 0;
    let assetsPersistFailed = 0;
    const staticRoot = resolve(process.cwd(), config.staticDir);
    for (const entry of zip.getEntries()) {
      const entryName = entry.entryName;
      if (!TRANSFER_ENTRY_PATTERN.test(entryName) || entry.isDirectory) continue;
      const rel = entryName.slice('assets/'.length);
      const target = resolve(process.cwd(), join(config.staticDir, rel));
      if (!target.startsWith(staticRoot + sep)) continue; // zip-slip 双保险
      try {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, entry.getData());
        assetsRestored++;
        try {
          await persistFile(target);
        } catch {
          assetsPersistFailed++; // 云备份失败不阻断本地导入
        }
      } catch (err) {
        logger.warn({ err, entryName }, '[Selections] Transfer asset restore failed');
      }
    }

    // 2) 分类（slug 覆盖更新/新建）+ 产品（categoryId+modelNo upsert，不删包外产品）
    let categoriesCreated = 0;
    let categoriesUpdated = 0;
    let productsCreated = 0;
    let productsUpdated = 0;
    const failed: Array<{ slug: string; reason: string }> = [];

    for (const cat of manifest.categories) {
      if (!cat || typeof cat.slug !== 'string' || typeof cat.name !== 'string' || !Array.isArray(cat.products)) {
        continue;
      }
      try {
        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const existing = await tx.selectionCategory.findUnique({ where: { slug: cat.slug }, select: { id: true } });
          const catData = {
            name: cat.name,
            description: cat.description ?? null,
            icon: cat.icon ?? null,
            sortOrder: cat.sortOrder ?? 0,
            columns: (cat.columns ?? []) as Prisma.InputJsonValue,
            image: cat.image ?? null,
            optionImages: (cat.optionImages ?? undefined) as Prisma.InputJsonValue | undefined,
            optionOrder: (cat.optionOrder ?? undefined) as Prisma.InputJsonValue | undefined,
            groupId: cat.groupId ?? null,
            groupName: cat.groupName ?? null,
            groupIcon: cat.groupIcon ?? null,
            groupImage: cat.groupImage ?? null,
            groupImageFit: cat.groupImageFit ?? null,
            kind: cat.kind ?? 'product',
            hidden: cat.hidden ?? false,
            catalogPdf: cat.catalogPdf ?? null,
            catalogShared: cat.catalogShared ?? false,
            optionCatalogs: (cat.optionCatalogs ?? undefined) as Prisma.InputJsonValue | undefined,
          };
          const categoryId = existing
            ? (await tx.selectionCategory.update({ where: { slug: cat.slug }, data: catData })).id
            : (await tx.selectionCategory.create({ data: { slug: cat.slug, ...catData } })).id;

          // 产品按 modelNo 合并（照 adminProducts batch import 的去重口径）
          const modelNos = cat.products.map((p) => p.modelNo).filter((m): m is string => Boolean(m));
          const existingProducts =
            modelNos.length > 0
              ? await tx.selectionProduct.findMany({
                  where: { categoryId, modelNo: { in: modelNos } },
                  select: { id: true, modelNo: true },
                })
              : [];
          const existingMap = new Map(existingProducts.map((e) => [e.modelNo, e.id]));

          let created = 0;
          let updated = 0;
          for (let i = 0; i < cat.products.length; i++) {
            const p = cat.products[i];
            const modelNo = typeof p.modelNo === 'string' && p.modelNo ? p.modelNo : null;
            const data: Prisma.SelectionProductUncheckedUpdateInput = {
              name: p.name || `产品 ${i + 1}`,
              modelNo,
              specs: (p.specs && typeof p.specs === 'object' ? p.specs : {}) as Prisma.InputJsonObject,
              image: p.image || null,
              pdfUrl: p.pdfUrl || null,
              unit: p.unit ?? '个',
              sortOrder: p.sortOrder ?? i,
              isKit: p.isKit ?? false,
              hidden: p.hidden ?? false,
              components: p.components === undefined ? undefined : (p.components as Prisma.InputJsonValue),
            };
            if (modelNo && existingMap.has(modelNo)) {
              await tx.selectionProduct.update({ where: { id: existingMap.get(modelNo)! }, data });
              updated++;
            } else {
              const createdProduct = await tx.selectionProduct.create({
                data: { categoryId, ...data } as Prisma.SelectionProductUncheckedCreateInput,
              });
              if (modelNo) existingMap.set(modelNo, createdProduct.id);
              created++;
            }
          }
          return { categoryId, created, updated, isNew: !existing };
        });
        if (result.isNew) categoriesCreated++;
        else categoriesUpdated++;
        productsCreated += result.created;
        productsUpdated += result.updated;
      } catch (err) {
        logger.error({ err, slug: cat.slug }, '[Selections] Transfer import category error');
        failed.push({ slug: cat.slug, reason: '导入失败，详见服务端日志' });
      }
    }

    await invalidateSelectionCache();
    rmSync(stagedPath, { force: true });

    logger.info(
      { categoriesCreated, categoriesUpdated, productsCreated, productsUpdated, assetsRestored, failed: failed.length },
      '[Selections] Transfer import committed',
    );
    res.json({
      categories: { created: categoriesCreated, updated: categoriesUpdated },
      products: { created: productsCreated, updated: productsUpdated },
      assets: { restored: assetsRestored, persistFailed: assetsPersistFailed },
      failed,
    });
  });

  return router;
}
