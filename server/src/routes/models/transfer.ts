/**
 * 模型库搬运（本地站 ↔ 服务器站）：
 * - POST /api/models/export          勾选模型流式打包下载（archiver）
 * - POST /api/models/import-analyze  上传导出包，解析模型清单（暂存，不落盘内容）
 * - POST /api/models/import-commit   按清单 + 分类映射逐个入库（直接 COMPLETED，不走转换队列）
 *
 * 包结构（导出/导入同构）：
 *   manifest.json                     [{ index, name, description, categoryName, files, ... }]
 *   models/{原id}/model.json          模型元信息（名称/描述/分类名/previewMeta）
 *   models/{原id}/model.glb           预览产物
 *   models/{原id}/thumbnail.png       缩略图
 *   models/{原id}/original.step       原始文件
 *   models/{原id}/drawings/*.pdf      图纸
 *
 * 场景：服务器内存不足转不动的模型，在本地（内存充足）站点转换完成后，
 * 整批搬运到服务器；导入时可重新指定分类（本地分类树在服务器上可能不存在）。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { Router, Response, type NextFunction } from 'express';
import multer from 'multer';
import { cacheDelByPrefix } from '../../lib/cache.js';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { UPLOAD_REQUEST_TIMEOUT_MS } from '../../lib/uploadLimits.js';
import { persistFile } from '../../lib/storageProvider.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { createNotification } from '../notifications.js';
import { findOriginalModelPath } from '../../services/modelFiles.js';
import { MODEL_STATUS } from '../../services/modelStatus.js';
import { generateThumbnail } from '../../services/thumbnail.js';

const TRANSFER_EXPORT_MAX_MODELS = 100;
const TRANSFER_IMPORT_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 上传包上限 2GB
const TRANSFER_IMPORT_EXTRACT_MAX_BYTES = 4 * 1024 * 1024 * 1024; // 单模型解压量上限
const TRANSFER_STALE_MS = 60 * 60 * 1000; // 暂存包保留 1 小时

const importTransferDir = join(process.cwd(), config.uploadDir, 'import-transfer');

type TransferManifestItem = {
  index: number;
  name: string;
  description?: string | null;
  categoryName: string | null;
  originalFormat: string;
  originalSize: number;
  createdAt?: string;
  previewMeta?: unknown;
  files: {
    glb?: string;
    thumbnail?: string;
    original?: string;
    drawings?: string[];
  };
};

function staticPathFromUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith('/static/')) return null;
  return join(config.staticDir, url.split('?')[0].slice('/static/'.length));
}

function cleanupStaleImports() {
  if (!existsSync(importTransferDir)) return;
  const now = Date.now();
  try {
    for (const name of readdirSync(importTransferDir)) {
      const path = join(importTransferDir, name);
      try {
        if (now - statSync(path).mtimeMs > TRANSFER_STALE_MS) rmSync(path, { force: true });
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* best-effort */
  }
}

export function createModelTransferRouter({ prisma }: { prisma: PrismaClient | null }) {
  const router = Router();

  cleanupStaleImports();
  setInterval(cleanupStaleImports, 15 * 60 * 1000).unref?.();

  // ── 导出：勾选模型流式打包 ──
  router.post('/api/models/export', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
    if (!prisma) {
      res.status(503).json({ detail: '数据库未连接' });
      return;
    }
    const ids = Array.isArray(req.body?.ids)
      ? (req.body.ids as unknown[])
          .filter((id): id is string => typeof id === 'string')
          .slice(0, TRANSFER_EXPORT_MAX_MODELS)
      : [];
    if (ids.length === 0) {
      res.status(400).json({ detail: '请先选择要导出的模型' });
      return;
    }

    const models = await prisma.model.findMany({
      where: { id: { in: ids }, status: MODEL_STATUS.COMPLETED },
      include: {
        categoryRef: { select: { name: true } },
        drawings: { orderBy: { createdAt: 'asc' }, select: { fileKey: true, name: true, size: true } },
      },
    });
    if (models.length === 0) {
      res.status(400).json({ detail: '选中的模型中没有可导出的已完成模型' });
      return;
    }

    const manifest: TransferManifestItem[] = [];
    const archive = archiver('zip', { zlib: { level: 5 } });
    const missing: string[] = [];

    models.forEach((m, index) => {
      const dir = `models/${m.id}`;
      const files: TransferManifestItem['files'] = {};

      const glbPath = join(config.staticDir, 'models', `${m.id}.glb`);
      if (existsSync(glbPath)) {
        archive.file(glbPath, { name: `${dir}/model.glb` });
        files.glb = `${dir}/model.glb`;
      } else {
        missing.push(m.name);
        return; // 无预览产物的模型不进清单
      }

      const thumbPath = staticPathFromUrl(m.thumbnailUrl);
      if (thumbPath && existsSync(thumbPath)) {
        const ext = thumbPath.split('.').pop() || 'png';
        archive.file(thumbPath, { name: `${dir}/thumbnail.${ext}` });
        files.thumbnail = `${dir}/thumbnail.${ext}`;
      }

      const originalPath = findOriginalModelPath(m);
      if (originalPath && existsSync(originalPath)) {
        const ext = originalPath.split('.').pop() || m.originalFormat || 'step';
        archive.file(originalPath, { name: `${dir}/original.${ext}` });
        files.original = `${dir}/original.${ext}`;
      }

      files.drawings = [];
      for (const drawing of m.drawings) {
        const drawingPath = staticPathFromUrl(drawing.fileKey);
        if (!drawingPath || !existsSync(drawingPath)) continue;
        const entryName = `${dir}/drawings/${randomUUID().slice(0, 8)}-${drawing.name || 'drawing.pdf'}`;
        archive.file(drawingPath, { name: entryName });
        files.drawings.push(entryName);
      }

      archive.append(
        JSON.stringify(
          {
            name: m.name,
            description: m.description,
            categoryName: m.categoryRef?.name || null,
            originalFormat: m.originalFormat,
            originalSize: m.originalSize,
            createdAt: m.createdAt.toISOString(),
            gltfSize: m.gltfSize,
            previewMeta: m.previewMeta ?? null,
          },
          null,
          2,
        ),
        { name: `${dir}/model.json` },
      );

      manifest.push({
        index,
        name: m.name,
        description: m.description,
        categoryName: m.categoryRef?.name || null,
        originalFormat: m.originalFormat,
        originalSize: m.originalSize,
        createdAt: m.createdAt.toISOString(),
        previewMeta: m.previewMeta ?? null,
        files,
      });
    });

    if (manifest.length === 0) {
      res.status(400).json({
        detail: `选中的模型都缺少预览文件，无法导出${missing.length ? `（${missing.slice(0, 3).join('、')}...）` : ''}`,
      });
      return;
    }

    archive.append(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), models: manifest }, null, 2), {
      name: 'manifest.json',
    });

    logger.info({ count: manifest.length, skippedMissing: missing.length }, '[transfer] Export models archive');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="models-export.zip"; filename*=UTF-8''${encodeURIComponent(`模型导出-${manifest.length}个-${new Date().toISOString().slice(0, 10)}.zip`)}`,
    );
    archive.on('error', (err) => {
      logger.error({ err }, '[transfer] Export archive error');
      if (!res.headersSent) res.status(500).json({ detail: '打包导出失败' });
      else res.destroy(err);
    });
    archive.pipe(res);
    await archive.finalize();
  });

  // ── 导入第一步：上传包并解析清单（暂存 zip，不落盘内容） ──
  router.post(
    '/api/models/import-analyze',
    authMiddleware,
    requireRole('ADMIN'),
    (req: AuthRequest, res: Response, next: NextFunction) => {
      req.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS);
      res.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS);
      next();
    },
    multer({ dest: importTransferDir, limits: { fileSize: TRANSFER_IMPORT_MAX_BYTES } }).single('file'),
    async (req: AuthRequest, res: Response) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({ detail: '没有文件' });
        return;
      }
      const cleanup = () => rmSync(file.path, { force: true });

      let manifestModels: TransferManifestItem[] | null = null;
      let zip: InstanceType<typeof AdmZip> | null = null;
      try {
        zip = new AdmZip(file.path);
        const manifestEntry = zip.getEntry('manifest.json');
        if (!manifestEntry) {
          cleanup();
          res.status(400).json({ detail: '包内缺少 manifest.json，请确认是「导出模型」产出的包' });
          return;
        }
        const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as {
          models?: TransferManifestItem[];
        };
        if (!Array.isArray(manifest.models) || manifest.models.length === 0) {
          cleanup();
          res.status(400).json({ detail: '包内没有模型数据' });
          return;
        }
        manifestModels = manifest.models;
      } catch {
        cleanup();
        res.status(400).json({ detail: '无法读取压缩包或 manifest 损坏' });
        return;
      }

      // 条目存在性校验（只查目录项，不解压内容）
      const items = [];
      let dropped = 0;
      for (const m of manifestModels!) {
        if (!m || typeof m.name !== 'string' || !m.files?.glb || !zip!.getEntry(m.files.glb)) {
          dropped += 1;
          continue;
        }
        items.push({
          index: m.index,
          name: m.name,
          original_format: m.originalFormat || 'step',
          original_size: m.originalSize || 0,
          category_name: typeof m.categoryName === 'string' ? m.categoryName : null,
          has_original: Boolean(m.files.original && zip!.getEntry(m.files.original)),
          drawings: (m.files.drawings || []).filter((name) => zip!.getEntry(name)).length,
        });
      }
      if (items.length === 0) {
        cleanup();
        res.status(400).json({ detail: `包内 ${manifestModels!.length} 个模型都缺少预览文件，无法导入` });
        return;
      }

      // multer 临时文件已落到 importTransferDir，重命名为 importId.zip 作暂存
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

      logger.info({ importId, items: items.length, dropped }, '[transfer] Import package analyzed');
      res.json({
        import_id: importId,
        total: manifestModels!.length,
        dropped_no_preview: dropped,
        models: items,
      });
    },
  );

  // ── 导入第二步：按清单 + 分类映射入库（新 id，直接 COMPLETED） ──
  router.post(
    '/api/models/import-commit',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      if (!prisma) {
        res.status(503).json({ detail: '数据库未连接' });
        return;
      }
      const importId = typeof req.body?.importId === 'string' ? req.body.importId : '';
      const stagedPath = join(importTransferDir, `${importId}.zip`);
      if (!/^[0-9a-f-]{36}$/i.test(importId) || !existsSync(stagedPath)) {
        res.status(404).json({ detail: '导入会话不存在或已过期，请重新上传' });
        return;
      }
      const itemsInput = Array.isArray(req.body?.items) ? req.body.items : [];
      const categoryByIndex = new Map<number, string | null>();
      for (const item of itemsInput) {
        if (item && typeof item.index === 'number') {
          categoryByIndex.set(
            item.index,
            typeof item.categoryId === 'string' && item.categoryId ? item.categoryId : null,
          );
        }
      }

      let zip: InstanceType<typeof AdmZip>;
      let manifestModels: TransferManifestItem[];
      try {
        zip = new AdmZip(stagedPath);
        const manifest = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf8')) as {
          models: TransferManifestItem[];
        };
        manifestModels = manifest.models;
      } catch {
        res.status(400).json({ detail: '导入包已损坏，请重新导出' });
        return;
      }

      const imported: string[] = [];
      const importedIds: string[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];
      const failed: Array<{ name: string; reason: string }> = [];
      let extractedBytes = 0;

      for (const m of manifestModels) {
        const name = String(m.name || '').slice(0, 200) || '未命名模型';
        if (!m.files?.glb || !zip.getEntry(m.files.glb)) {
          skipped.push({ name, reason: '缺少预览文件' });
          continue;
        }

        const glbData = zip.getEntry(m.files.glb)!.getData();
        extractedBytes += glbData.length;
        if (extractedBytes > TRANSFER_IMPORT_EXTRACT_MAX_BYTES) {
          failed.push({ name, reason: '解压总量超限（4GB），请分批导出' });
          break;
        }
        if (glbData.length < 4 || glbData.subarray(0, 4).toString('latin1') !== 'glTF') {
          skipped.push({ name, reason: '预览文件无效' });
          continue;
        }

        const categoryId = categoryByIndex.has(m.index) ? categoryByIndex.get(m.index)! : null;
        // 去重口径与批量上传一致：同分类 + 同名 + 同原文件大小 且已完成 → 跳过
        const existing = await prisma.model.findFirst({
          where: {
            name,
            status: MODEL_STATUS.COMPLETED,
            originalSize: m.originalSize || 0,
            ...(categoryId ? { categoryId } : { categoryId: null }),
          },
          select: { id: true },
        });
        if (existing) {
          skipped.push({ name, reason: '该分类下已存在同名且内容相同的模型' });
          continue;
        }

        const modelId = randomUUID().slice(0, 12);
        const modelsDir = join(config.staticDir, 'models');
        const thumbsDir = join(config.staticDir, 'thumbnails');
        mkdirSync(modelsDir, { recursive: true });
        mkdirSync(thumbsDir, { recursive: true });

        try {
          const glbPath = join(modelsDir, `${modelId}.glb`);
          writeFileSync(glbPath, glbData);
          await persistFile(glbPath);

          // 缩略图：包里的优先，缺省从 glb 现场生成
          let thumbnailUrl: string | null = null;
          const thumbEntryName = m.files.thumbnail;
          const thumbData = thumbEntryName ? zip.getEntry(thumbEntryName)?.getData() : undefined;
          if (thumbData && thumbData.length > 0) {
            const ext = (thumbEntryName!.split('.').pop() || 'png').toLowerCase();
            if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
              const thumbPath = join(thumbsDir, `${modelId}.${ext === 'jpeg' ? 'jpg' : ext}`);
              writeFileSync(thumbPath, thumbData);
              await persistFile(thumbPath);
              thumbnailUrl = `/static/thumbnails/${modelId}.${ext === 'jpeg' ? 'jpg' : ext}`;
            }
          }
          if (!thumbnailUrl) {
            try {
              const thumb = await generateThumbnail(glbPath, thumbsDir, modelId);
              if (existsSync(thumb.thumbnailPath)) {
                await persistFile(thumb.thumbnailPath);
                thumbnailUrl = thumb.thumbnailUrl;
              }
            } catch {
              /* 缩略图失败不阻塞导入 */
            }
          }

          // 原始文件（可选）
          let uploadPath: string | null = null;
          let originalFormat = m.originalFormat || 'step';
          let originalSize = m.originalSize || 0;
          if (m.files.original && zip.getEntry(m.files.original)) {
            const originalData = zip.getEntry(m.files.original)!.getData();
            originalFormat = (m.files.original.split('.').pop() || originalFormat).toLowerCase();
            originalSize = originalData.length;
            const originalsDir = join(config.staticDir, 'originals');
            mkdirSync(originalsDir, { recursive: true });
            uploadPath = join(originalsDir, `${modelId}.${originalFormat}`);
            writeFileSync(uploadPath, originalData);
            await persistFile(uploadPath);
          }

          const ts = Date.now();
          const gltfUrl = `/static/models/${modelId}.glb?v=${ts.toString(36)}`;
          const previewMeta =
            m.previewMeta && typeof m.previewMeta === 'object' && !Array.isArray(m.previewMeta)
              ? (m.previewMeta as Prisma.InputJsonValue)
              : undefined;

          await prisma.model.create({
            data: {
              id: modelId,
              name,
              description: typeof m.description === 'string' ? m.description : null,
              originalName: `${name}.${originalFormat}`,
              originalFormat,
              originalSize,
              gltfUrl,
              gltfSize: glbData.length,
              format: originalFormat,
              status: MODEL_STATUS.COMPLETED,
              uploadPath,
              thumbnailUrl: thumbnailUrl ? `${thumbnailUrl.split('?')[0]}?t=${ts}` : null,
              previewMeta: previewMeta ?? Prisma.JsonNull,
              createdById: req.user!.userId,
              ...(categoryId ? { categoryId } : {}),
            },
          });

          // 图纸
          for (const drawingEntryName of m.files.drawings || []) {
            const entry = zip.getEntry(drawingEntryName);
            if (!entry) continue;
            const drawingData = entry.getData();
            if (drawingData.length === 0 || drawingData.subarray(0, 5).toString('latin1') !== '%PDF-') continue;
            const drawingId = randomUUID();
            const drawingName = drawingEntryName.split('/').pop() || `${drawingId}.pdf`;
            const drawingsDir = join(config.staticDir, 'drawings', modelId);
            mkdirSync(drawingsDir, { recursive: true });
            const drawingPath = join(drawingsDir, `${drawingId}.pdf`);
            writeFileSync(drawingPath, drawingData);
            await persistFile(drawingPath);
            await prisma.modelDrawing.create({
              data: {
                id: drawingId,
                modelId,
                fileKey: `/static/drawings/${modelId}/${drawingId}.pdf`,
                name: drawingName,
                size: drawingData.length,
              },
            });
          }

          imported.push(name);
          importedIds.push(modelId);
        } catch (err) {
          logger.error({ err, name, modelId }, '[transfer] Import single model failed');
          failed.push({ name, reason: '导入失败（服务器日志有详情）' });
        }
      }

      rmSync(stagedPath, { force: true });
      if (imported.length > 0) {
        await cacheDelByPrefix('cache:models:');
        await createNotification({
          userId: req.user!.userId,
          title: '模型导入完成',
          message: `已导入 ${imported.length} 个模型${skipped.length ? `，跳过 ${skipped.length} 个` : ''}${failed.length ? `，失败 ${failed.length} 个` : ''}。`,
          type: 'model_conversion',
          audience: 'user',
          // 恰好导入 1 个时带上模型 id：通知「打开详情」直达模型详情页（多个时无唯一目标，不附链接）
          ...(importedIds.length === 1 ? { relatedId: importedIds[0] } : {}),
        }).catch(() => {});
      }
      logger.info(
        { importId, imported: imported.length, skipped: skipped.length, failed: failed.length },
        '[transfer] Import committed',
      );
      res.json({
        imported: imported.length,
        skipped: skipped.length,
        failed: failed.length,
        details: [...skipped, ...failed].slice(0, 20),
      });
    },
  );

  return router;
}
