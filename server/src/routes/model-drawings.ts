import { Router, Request, Response } from "express";
import multer from "multer";
import { copyFileSync, existsSync, mkdirSync, openSync, readSync, closeSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import { cacheDelByPrefix } from "../lib/cache.js";
import { sendAcceleratedFile } from "../lib/acceleratedDownload.js";
import { consumeProtectedResourceToken } from "../lib/downloadTokenStore.js";
import { authMiddleware, verifyRequestToken, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { optionalString, requiredString } from "../lib/requestValidation.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger({ component: "model-drawings" });

const upload = multer({
  dest: config.uploadDir,
  limits: { fileSize: config.maxFileSize },
});

const router = Router();

function drawingDownloadUrl(modelId: string, drawingUrl?: string | null): string | null {
  return drawingUrl ? `/api/models/${encodeURIComponent(modelId)}/drawing/download` : null;
}

function resolveDrawingPath(modelId: string, drawingUrl?: string | null): string | null {
  let candidate: string;
  if (drawingUrl?.startsWith("/static/")) {
    candidate = join(config.staticDir, drawingUrl.slice("/static/".length));
  } else {
    candidate = join(config.staticDir, "drawings", `${modelId}.pdf`);
  }
  const resolved = resolve(candidate);
  const staticRoot = resolve(config.staticDir);
  if (resolved !== staticRoot && !resolved.startsWith(`${staticRoot}${sep}`)) return null;
  return resolved;
}

// Upload drawing (PDF) for a model.
router.post("/api/models/:id/drawing", authMiddleware, requireRole("ADMIN"), upload.single("file"), async (req: AuthRequest, res: Response) => {
  const id = requiredString(req.params.id, "id");
  const file = req.file;

  if (!file) {
    res.status(400).json({ detail: "没有文件" });
    return;
  }

  if (file.mimetype !== "application/pdf") {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: "仅支持 PDF 格式" });
    return;
  }

  try {
    const buf = Buffer.alloc(5);
    const fd = openSync(file.path, "r");
    readSync(fd, buf, 0, 5, 0);
    closeSync(fd);
    if (buf.toString() !== "%PDF-") {
      rmSync(file.path, { force: true });
      res.status(400).json({ detail: "文件内容不是有效的 PDF" });
      return;
    }
  } catch {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: "无法读取文件内容" });
    return;
  }

  try {
    const m = await prisma.model.findUnique({ where: { id } });
    if (!m) {
      rmSync(file.path, { force: true });
      res.status(404).json({ detail: "模型不存在" });
      return;
    }

    const drawingDir = join(config.staticDir, "drawings");
    mkdirSync(drawingDir, { recursive: true });
    const drawingPath = join(drawingDir, `${id}.pdf`);
    copyFileSync(file.path, drawingPath);
    rmSync(file.path, { force: true });

    const drawingUrl = `/static/drawings/${id}.pdf`;
    const { size: drawingSize } = statSync(drawingPath);

    await prisma.model.update({ where: { id }, data: { drawingUrl, drawingName: file.originalname, drawingSize } });
    await cacheDelByPrefix("cache:models:");

    res.json({ success: true, data: { model_id: id, drawing_url: drawingDownloadUrl(id, drawingUrl) } });
  } catch (err: any) {
    try { rmSync(file.path, { force: true }); } catch {}
    try {
      const orphanPath = join(config.staticDir, "drawings", `${id}.pdf`);
      if (existsSync(orphanPath)) rmSync(orphanPath, { force: true });
    } catch {}
    log.error({ err, modelId: id }, "Upload error");
    res.status(500).json({ detail: "上传图纸失败" });
  }
});

// Authenticated drawing download. Static /drawings is intentionally not public.
router.get("/api/models/:id/drawing/download", async (req: Request, res: Response) => {
  const id = requiredString(req.params.id, "id");
  const queryToken = optionalString(req.query.download_token, { maxLength: 160 });
  const tokenPayload = queryToken ? consumeProtectedResourceToken(queryToken, "model-drawing", id) : null;
  if (queryToken && !tokenPayload) {
    res.status(401).json({ detail: "图纸访问令牌无效或已过期" });
    return;
  }
  const user = tokenPayload || verifyRequestToken(req);
  if (!user) {
    res.status(401).json({ detail: "需要登录后才能查看图纸" });
    return;
  }

  try {
    const m = await prisma.model.findUnique({
      where: { id },
      select: { id: true, name: true, drawingUrl: true, drawingName: true },
    });
    if (!m?.drawingUrl) {
      res.status(404).json({ detail: "图纸不存在" });
      return;
    }

    const drawingPath = resolveDrawingPath(id, m.drawingUrl);
    if (!drawingPath || !existsSync(drawingPath)) {
      res.status(404).json({ detail: "图纸文件不存在" });
      return;
    }

    const fileName = m.drawingName || `${m.name || id}.pdf`;
    sendAcceleratedFile(req, res, {
      filePath: drawingPath,
      fileName,
      contentType: "application/pdf",
      disposition: "inline",
    });
  } catch (err: any) {
    log.error({ err, modelId: id }, "Download error");
    res.status(500).json({ detail: "读取图纸失败" });
  }
});

// Delete drawing (PDF) for a model.
router.delete("/api/models/:id/drawing", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const id = requiredString(req.params.id, "id");

  try {
    const m = await prisma.model.findUnique({ where: { id } });
    if (!m) {
      res.status(404).json({ detail: "模型不存在" });
      return;
    }

    const drawingPath = resolveDrawingPath(id, m.drawingUrl);

    await prisma.model.update({ where: { id }, data: { drawingUrl: null, drawingName: null, drawingSize: null } });
    await cacheDelByPrefix("cache:models:");

    if (drawingPath && existsSync(drawingPath)) rmSync(drawingPath, { force: true });

    res.json({ success: true, data: { model_id: id, drawing_url: null } });
  } catch (err: any) {
    log.error({ err, modelId: id }, "Delete error");
    res.status(500).json({ detail: "删除图纸失败" });
  }
});

export default router;
