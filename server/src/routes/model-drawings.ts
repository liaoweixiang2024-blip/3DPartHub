import { Router, Request, Response } from "express";
import multer from "multer";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import { cacheDelByPrefix } from "../lib/cache.js";
import { sendAcceleratedFile } from "../lib/acceleratedDownload.js";
import { consumeProtectedResourceToken } from "../lib/downloadTokenStore.js";
import { authMiddleware, verifyRequestToken, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { optionalString, requiredString } from "../lib/requestValidation.js";

const upload = multer({
  dest: config.uploadDir,
  limits: { fileSize: config.maxFileSize },
});

const router = Router();

function drawingDownloadUrl(modelId: string, drawingUrl?: string | null): string | null {
  return drawingUrl ? `/api/models/${encodeURIComponent(modelId)}/drawing/download` : null;
}

function resolveDrawingPath(modelId: string, drawingUrl?: string | null): string {
  if (drawingUrl?.startsWith("/static/")) {
    return join(config.staticDir, drawingUrl.slice("/static/".length));
  }
  return join(config.staticDir, "drawings", `${modelId}.pdf`);
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
    rmSync(file.path, { force: true });
    res.status(500).json({ detail: err.message || "上传图纸失败" });
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
    if (!existsSync(drawingPath)) {
      res.status(404).json({ detail: "图纸文件不存在" });
      return;
    }

    const fileName = m.drawingName || `${m.name || id}.pdf`;
    sendAcceleratedFile(req, res, {
      filePath: resolve(drawingPath),
      fileName,
      contentType: "application/pdf",
      disposition: "inline",
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message || "读取图纸失败" });
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
    if (existsSync(drawingPath)) rmSync(drawingPath, { force: true });

    await prisma.model.update({ where: { id }, data: { drawingUrl: null } });
    await cacheDelByPrefix("cache:models:");

    res.json({ success: true, data: { model_id: id, drawing_url: null } });
  } catch (err: any) {
    res.status(500).json({ detail: err.message || "删除图纸失败" });
  }
});

export default router;
