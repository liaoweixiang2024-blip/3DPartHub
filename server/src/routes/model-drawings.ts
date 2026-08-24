import { copyFileSync, existsSync, mkdirSync, openSync, readSync, closeSync, rmSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Router, Request, Response, type NextFunction } from 'express';
import multer from 'multer';
import { sendAcceleratedFile } from '../lib/acceleratedDownload.js';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { cacheDelByPrefix } from '../lib/cache.js';
import { config } from '../lib/config.js';
import { verifyProtectedResourceToken } from '../lib/downloadTokenStore.js';
import { normalizeUploadFilename } from '../lib/filenameEncoding.js';
import { createLogger } from '../lib/logger.js';
import { modelDownloadFileName, modelDownloadSourceName } from '../lib/modelDownloadName.js';
import { prisma } from '../lib/prisma.js';
import { optionalString, requiredString } from '../lib/requestValidation.js';
import { deleteCloudFile, keyFromStaticUrl, persistFile } from '../lib/storageProvider.js';
import { modelDrawingMaxBytes, modelDrawingMaxSizeMb } from '../lib/uploadLimits.js';
import { authMiddleware, verifyRequestToken, type AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { getInvisibleCategoryIds } from '../services/categoryAccess.js';

const log = createLogger({ component: 'model-drawings' });

const router = Router();

function drawingUpload(req: Request, res: Response, next: NextFunction) {
  getBusinessConfig()
    .then(({ uploadPolicy }) => {
      const maxMb = modelDrawingMaxSizeMb(uploadPolicy);
      const upload = multer({
        dest: config.uploadDir,
        limits: { fileSize: modelDrawingMaxBytes(uploadPolicy) },
      }).single('file');

      upload(req, res, (err) => {
        if (!err) {
          next();
          return;
        }

        const uploadError = err as { code?: string; message?: string };
        if (uploadError.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ detail: `PDF 图纸过大，最大支持 ${maxMb}MB` });
          return;
        }
        res.status(400).json({ detail: uploadError.message || '图纸上传失败' });
      });
    })
    .catch(next);
}

function drawingDownloadUrl(modelId: string, drawingUrl?: string | null): string | null {
  return drawingUrl ? `/api/models/${encodeURIComponent(modelId)}/drawing/download` : null;
}

function resolveDrawingPath(modelId: string, drawingUrl?: string | null): string | null {
  let candidate: string;
  if (drawingUrl?.startsWith('/static/')) {
    candidate = join(config.staticDir, drawingUrl.slice('/static/'.length));
  } else {
    candidate = join(config.staticDir, 'drawings', `${modelId}.pdf`);
  }
  const resolved = resolve(candidate);
  const staticRoot = resolve(config.staticDir);
  if (resolved !== staticRoot && !resolved.startsWith(`${staticRoot}${sep}`)) return null;
  return resolved;
}

// Upload drawing (PDF) for a model.
router.post(
  '/api/models/:id/drawing',
  authMiddleware,
  requireRole('ADMIN'),
  drawingUpload,
  async (req: AuthRequest, res: Response) => {
    const id = requiredString(req.params.id, 'id');
    const file = req.file;

    if (!file) {
      res.status(400).json({ detail: '没有文件' });
      return;
    }

    if (file.mimetype !== 'application/pdf') {
      rmSync(file.path, { force: true });
      res.status(400).json({ detail: '仅支持 PDF 格式' });
      return;
    }

    try {
      const buf = Buffer.alloc(5);
      const fd = openSync(file.path, 'r');
      readSync(fd, buf, 0, 5, 0);
      closeSync(fd);
      if (buf.toString() !== '%PDF-') {
        rmSync(file.path, { force: true });
        res.status(400).json({ detail: '文件内容不是有效的 PDF' });
        return;
      }
    } catch {
      rmSync(file.path, { force: true });
      res.status(400).json({ detail: '无法读取文件内容' });
      return;
    }

    try {
      const m = await prisma.model.findUnique({ where: { id } });
      if (!m) {
        rmSync(file.path, { force: true });
        res.status(404).json({ detail: '模型不存在' });
        return;
      }

      const drawingDir = join(config.staticDir, 'drawings');
      mkdirSync(drawingDir, { recursive: true });
      const drawingPath = join(drawingDir, `${id}.pdf`);
      copyFileSync(file.path, drawingPath);
      await persistFile(drawingPath);
      rmSync(file.path, { force: true });

      const drawingUrl = `/static/drawings/${id}.pdf`;
      const { size: drawingSize } = statSync(drawingPath);
      const drawingName = normalizeUploadFilename(file.originalname, 'drawing.pdf');

      await prisma.model.update({ where: { id }, data: { drawingUrl, drawingName, drawingSize } });
      await cacheDelByPrefix('cache:models:');

      res.json({ success: true, data: { model_id: id, drawing_url: drawingDownloadUrl(id, drawingUrl) } });
    } catch (err: unknown) {
      try {
        rmSync(file.path, { force: true });
      } catch {
        log.warn('Failed to clean up temp upload file');
      }
      try {
        const orphanPath = join(config.staticDir, 'drawings', `${id}.pdf`);
        if (existsSync(orphanPath)) rmSync(orphanPath, { force: true });
      } catch {
        log.warn('Failed to clean up orphan drawing file');
      }
      log.error({ err, modelId: id }, 'Upload error');
      res.status(500).json({ detail: '上传图纸失败' });
    }
  },
);

// Authenticated drawing download. Static /drawings is intentionally not public.
router.get('/api/models/:id/drawing/download', async (req: Request, res: Response) => {
  const id = requiredString(req.params.id, 'id');
  const queryToken = optionalString(req.query.download_token, { maxLength: 160 });
  const tokenPayload = queryToken ? verifyProtectedResourceToken(queryToken, 'model-drawing', id) : null;
  if (queryToken && !tokenPayload) {
    res.status(401).json({ detail: '图纸访问令牌无效或已过期' });
    return;
  }
  const user = tokenPayload || verifyRequestToken(req);
  if (!user) {
    res.status(401).json({ detail: '需要登录后才能查看图纸' });
    return;
  }

  try {
    const m = await prisma.model.findUnique({
      where: { id },
      select: { id: true, name: true, originalName: true, drawingUrl: true, drawingName: true, categoryId: true },
    });
    if (!m?.drawingUrl) {
      res.status(404).json({ detail: '图纸不存在' });
      return;
    }
    // 分类访问控制：受限分类的模型图纸同样拦截
    const invisible = await getInvisibleCategoryIds(user.role ?? null, user.userId ?? null);
    if (m.categoryId && invisible.has(m.categoryId)) {
      res.status(403).json({ detail: '无权访问该图纸' });
      return;
    }

    const drawingPath = resolveDrawingPath(id, m.drawingUrl);
    if (!drawingPath || !existsSync(drawingPath)) {
      res.status(404).json({ detail: '图纸文件不存在' });
      return;
    }

    const sourceName = modelDownloadSourceName(m.name || m.drawingName, m.originalName, id);
    const fileName = modelDownloadFileName(sourceName, 'pdf', id);
    sendAcceleratedFile(req, res, {
      filePath: drawingPath,
      fileName,
      contentType: 'application/pdf',
      disposition: 'inline',
    });
  } catch (err: unknown) {
    log.error({ err, modelId: id }, 'Download error');
    res.status(500).json({ detail: '读取图纸失败' });
  }
});

// Delete drawing (PDF) for a model.
router.delete(
  '/api/models/:id/drawing',
  authMiddleware,
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const id = requiredString(req.params.id, 'id');

    try {
      const m = await prisma.model.findUnique({ where: { id } });
      if (!m) {
        res.status(404).json({ detail: '模型不存在' });
        return;
      }

      const drawingPath = resolveDrawingPath(id, m.drawingUrl);

      await prisma.model.update({ where: { id }, data: { drawingUrl: null, drawingName: null, drawingSize: null } });
      await cacheDelByPrefix('cache:models:');

      if (drawingPath && existsSync(drawingPath)) rmSync(drawingPath, { force: true });
      // 双删：清理云端图纸副本（best-effort）
      const drawingUrlClean = m.drawingUrl?.split('?')[0];
      if (drawingUrlClean?.startsWith('/static/')) {
        await deleteCloudFile(keyFromStaticUrl(drawingUrlClean));
      }

      res.json({ success: true, data: { model_id: id, drawing_url: null } });
    } catch (err: unknown) {
      log.error({ err, modelId: id }, 'Delete error');
      res.status(500).json({ detail: '删除图纸失败' });
    }
  },
);

export default router;
