import { randomUUID } from 'node:crypto';
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
import { sendResourceError } from '../lib/resourceErrorPage.js';
import { deleteCloudFile, keyFromStaticUrl, persistFile } from '../lib/storageProvider.js';
import { modelDrawingMaxBytes, modelDrawingMaxSizeMb } from '../lib/uploadLimits.js';
import { authMiddleware, getVerifiedRequestUser, type AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { getInvisibleCategoryIds } from '../services/categoryAccess.js';

const log = createLogger({ component: 'model-drawings' });

const router = Router();

export type DrawingSummary = { id: string; name: string; size: number | null };

export function drawingSummaries(rows: Array<{ id: string; name: string; size: number | null }>): DrawingSummary[] {
  return rows.map((d) => ({ id: d.id, name: d.name, size: d.size }));
}

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

async function listModelDrawings(modelId: string) {
  return prisma.modelDrawing.findMany({
    where: { modelId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, size: true, fileKey: true },
  });
}

// Append drawing (PDF) for a model — each upload is a new row (multi-drawing support).
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

    const drawingId = randomUUID();
    const drawingPath = join(config.staticDir, 'drawings', id, `${drawingId}.pdf`);

    try {
      const m = await prisma.model.findUnique({ where: { id } });
      if (!m) {
        rmSync(file.path, { force: true });
        res.status(404).json({ detail: '模型不存在' });
        return;
      }

      mkdirSync(join(config.staticDir, 'drawings', id), { recursive: true });
      copyFileSync(file.path, drawingPath);
      await persistFile(drawingPath);
      rmSync(file.path, { force: true });

      const { size: drawingSize } = statSync(drawingPath);
      const drawingName = normalizeUploadFilename(file.originalname, 'drawing.pdf');

      await prisma.modelDrawing.create({
        data: {
          id: drawingId,
          modelId: id,
          fileKey: `/static/drawings/${id}/${drawingId}.pdf`,
          name: drawingName,
          size: drawingSize,
        },
      });
      await cacheDelByPrefix('cache:models:');
      await cacheDelByPrefix('cache:share:info:');

      const drawings = drawingSummaries(await listModelDrawings(id));
      res.json({
        success: true,
        data: {
          model_id: id,
          drawing_id: drawingId,
          // 兼容旧客户端：第一份图纸的下载入口
          drawing_url: drawingDownloadUrl(id, drawings[0] ? 'present' : null),
          drawings,
        },
      });
    } catch (err: unknown) {
      try {
        rmSync(file.path, { force: true });
      } catch {
        log.warn('Failed to clean up temp upload file');
      }
      try {
        if (existsSync(drawingPath)) rmSync(drawingPath, { force: true });
      } catch {
        log.warn('Failed to clean up orphan drawing file');
      }
      log.error({ err, modelId: id }, 'Upload error');
      res.status(500).json({ detail: '上传图纸失败' });
    }
  },
);

// 解析请求身份：优先 download_token 携带的（5 分钟短令牌），否则查库校验当前登录用户。
// 分类访问控制依赖 DB 实时角色，不能信任 token payload 里的 role 快照。
async function resolveDrawingViewer(req: Request, queryToken: string | undefined, modelId: string) {
  const tokenPayload = queryToken ? verifyProtectedResourceToken(queryToken, 'model-drawing', modelId) : null;
  if (queryToken && !tokenPayload) return { expired: true as const };

  let userId = tokenPayload?.userId ?? null;
  let role = tokenPayload?.role ?? null;
  if (!userId) {
    try {
      const verified = await getVerifiedRequestUser(req);
      userId = verified?.payload.userId ?? null;
      role = verified?.payload.role ?? null;
    } catch {
      userId = null;
      role = null;
    }
  }
  return { expired: false as const, userId, role };
}

async function sendDrawingFile(
  req: Request,
  res: Response,
  model: { id: string; name: string | null; originalName: string },
  drawing: { fileKey: string; name: string },
) {
  const drawingPath = resolveDrawingPath(model.id, drawing.fileKey);
  if (!drawingPath || !existsSync(drawingPath)) {
    await sendResourceError(req, res, 404, '图纸不存在或已被移除', { htmlTitle: '图纸不存在' });
    return;
  }
  const sourceName = modelDownloadSourceName(model.name || drawing.name, model.originalName, model.id);
  const fileName = modelDownloadFileName(sourceName, 'pdf', model.id);
  // ?download=1 → attachment（浏览器另存为文件）；默认 inline（浏览器内预览）
  const disposition: 'attachment' | 'inline' = req.query.download === '1' ? 'attachment' : 'inline';
  sendAcceleratedFile(req, res, {
    filePath: drawingPath,
    fileName,
    contentType: 'application/pdf',
    disposition,
  });
}

// Authenticated drawing download (specific drawing). Static /drawings is intentionally not public.
router.get('/api/models/:id/drawing/:drawingId/download', async (req: Request, res: Response) => {
  const id = requiredString(req.params.id, 'id');
  const drawingId = requiredString(req.params.drawingId, 'drawingId');
  const queryToken = optionalString(req.query.download_token, { maxLength: 160 });

  const viewer = await resolveDrawingViewer(req, queryToken, id);
  if (viewer.expired) {
    await sendResourceError(req, res, 401, '图纸访问链接已失效，请回到模型详情页重新打开图纸', {
      htmlTitle: '图纸链接已失效',
      hint: '图纸访问链接有效期为 5 分钟，过期后需从模型详情页重新获取',
    });
    return;
  }
  const { userId, role } = viewer;
  if (!userId) {
    await sendResourceError(req, res, 401, '需要登录后才能查看图纸', { htmlTitle: '请先登录' });
    return;
  }

  try {
    const m = await prisma.model.findUnique({
      where: { id },
      select: { id: true, name: true, originalName: true, categoryId: true },
    });
    if (!m) {
      res.status(404).json({ detail: '模型不存在' });
      return;
    }
    const drawing = await prisma.modelDrawing.findFirst({
      where: { id: drawingId, modelId: id },
      select: { fileKey: true, name: true },
    });
    if (!drawing) {
      await sendResourceError(req, res, 404, '图纸不存在', { htmlTitle: '图纸不存在' });
      return;
    }
    // 分类访问控制：受限分类的模型图纸同样拦截
    const invisible = await getInvisibleCategoryIds(role, userId);
    if (m.categoryId && invisible.has(m.categoryId)) {
      await sendResourceError(req, res, 403, '您没有查看该图纸的权限', { htmlTitle: '无权访问' });
      return;
    }

    await sendDrawingFile(req, res, m, drawing);
  } catch (err: unknown) {
    log.error({ err, modelId: id, drawingId }, 'Download error');
    res.status(500).json({ detail: '读取图纸失败' });
  }
});

// Legacy authenticated drawing download — serves the first drawing (kept for in-flight 5-min tokens).
router.get('/api/models/:id/drawing/download', async (req: Request, res: Response) => {
  const id = requiredString(req.params.id, 'id');
  const queryToken = optionalString(req.query.download_token, { maxLength: 160 });

  const viewer = await resolveDrawingViewer(req, queryToken, id);
  if (viewer.expired) {
    await sendResourceError(req, res, 401, '图纸访问链接已失效，请回到模型详情页重新打开图纸', {
      htmlTitle: '图纸链接已失效',
      hint: '图纸访问链接有效期为 5 分钟，过期后需从模型详情页重新获取',
    });
    return;
  }
  const { userId, role } = viewer;
  if (!userId) {
    await sendResourceError(req, res, 401, '需要登录后才能查看图纸', { htmlTitle: '请先登录' });
    return;
  }

  try {
    const m = await prisma.model.findUnique({
      where: { id },
      select: { id: true, name: true, originalName: true, categoryId: true },
    });
    if (!m) {
      res.status(404).json({ detail: '模型不存在' });
      return;
    }
    const drawing = await prisma.modelDrawing.findFirst({
      where: { modelId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { fileKey: true, name: true },
    });
    if (!drawing) {
      await sendResourceError(req, res, 404, '图纸不存在', { htmlTitle: '图纸不存在' });
      return;
    }
    // 分类访问控制：受限分类的模型图纸同样拦截
    const invisible = await getInvisibleCategoryIds(role, userId);
    if (m.categoryId && invisible.has(m.categoryId)) {
      await sendResourceError(req, res, 403, '您没有查看该图纸的权限', { htmlTitle: '无权访问' });
      return;
    }

    await sendDrawingFile(req, res, m, drawing);
  } catch (err: unknown) {
    log.error({ err, modelId: id }, 'Download error');
    res.status(500).json({ detail: '读取图纸失败' });
  }
});

// Delete one drawing (PDF) for a model.
router.delete(
  '/api/models/:id/drawing/:drawingId',
  authMiddleware,
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const id = requiredString(req.params.id, 'id');
    const drawingId = requiredString(req.params.drawingId, 'drawingId');

    try {
      const drawing = await prisma.modelDrawing.findFirst({ where: { id: drawingId, modelId: id } });
      if (!drawing) {
        res.status(404).json({ detail: '图纸不存在' });
        return;
      }

      await prisma.modelDrawing.delete({ where: { id: drawing.id } });
      await cacheDelByPrefix('cache:models:');
      await cacheDelByPrefix('cache:share:info:');

      const drawingPath = resolveDrawingPath(id, drawing.fileKey);
      if (drawingPath && existsSync(drawingPath)) rmSync(drawingPath, { force: true });
      // 双删：清理云端图纸副本（best-effort）
      const drawingUrlClean = drawing.fileKey.split('?')[0];
      if (drawingUrlClean.startsWith('/static/')) {
        await deleteCloudFile(keyFromStaticUrl(drawingUrlClean));
      }

      const drawings = drawingSummaries(await listModelDrawings(id));
      res.json({ success: true, data: { model_id: id, drawing_id: drawingId, drawings } });
    } catch (err: unknown) {
      log.error({ err, modelId: id, drawingId }, 'Delete error');
      res.status(500).json({ detail: '删除图纸失败' });
    }
  },
);

// Delete all drawings (PDF) for a model (legacy semantics).
router.delete(
  '/api/models/:id/drawing',
  authMiddleware,
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const id = requiredString(req.params.id, 'id');

    try {
      const drawings = await prisma.modelDrawing.findMany({ where: { modelId: id } });

      await prisma.modelDrawing.deleteMany({ where: { modelId: id } });
      await cacheDelByPrefix('cache:models:');
      await cacheDelByPrefix('cache:share:info:');

      for (const drawing of drawings) {
        const drawingPath = resolveDrawingPath(id, drawing.fileKey);
        if (drawingPath && existsSync(drawingPath)) rmSync(drawingPath, { force: true });
        const drawingUrlClean = drawing.fileKey.split('?')[0];
        if (drawingUrlClean.startsWith('/static/')) {
          await deleteCloudFile(keyFromStaticUrl(drawingUrlClean));
        }
      }

      res.json({ success: true, data: { model_id: id, drawing_url: null, drawings: [] } });
    } catch (err: unknown) {
      log.error({ err, modelId: id }, 'Delete error');
      res.status(500).json({ detail: '删除图纸失败' });
    }
  },
);

export default router;
