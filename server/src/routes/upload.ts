import { Router, Response } from "express";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync, existsSync, readdirSync, createReadStream, createWriteStream, rmSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { config } from "../lib/config.js";

const router = Router();

const CHUNKS_DIR = join(config.uploadDir, "chunks");
mkdirSync(CHUNKS_DIR, { recursive: true });

// In-memory upload sessions (use Redis in production)
const uploadSessions = new Map<string, {
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunkSize: number;
  userId: string;
  createdAt: number;
}>();

// Initialize chunked upload
router.post("/api/upload/init", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { fileName, fileSize, totalChunks } = req.body;

  if (!fileName || !fileSize || !totalChunks) {
    res.status(400).json({ detail: "缺少参数" });
    return;
  }

  const uploadId = randomUUID().slice(0, 16);
  const chunkSize = Math.ceil(fileSize / totalChunks);

  uploadSessions.set(uploadId, {
    fileName,
    fileSize,
    totalChunks,
    chunkSize,
    userId: req.user!.userId,
    createdAt: Date.now(),
  });

  mkdirSync(join(CHUNKS_DIR, uploadId), { recursive: true });

  res.json({
    uploadId,
    chunkSize,
  });
});

// Upload a chunk
router.put("/api/upload/chunk", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const uploadId = req.query.uploadId as string | undefined;
  const chunkIndex = req.query.chunkIndex as string | undefined;

  if (!uploadId || !chunkIndex) {
    res.status(400).json({ detail: "缺少参数" });
    return;
  }

  const ci = Number(chunkIndex);
  const session = uploadSessions.get(uploadId);

  if (!session) {
    res.status(404).json({ detail: "上传会话不存在" });
    return;
  }

  if (session.userId !== req.user!.userId) {
    res.status(403).json({ detail: "无权操作" });
    return;
  }

  const chunkPath = join(CHUNKS_DIR, uploadId, `${ci}`);

  // Write chunk data from request body
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(chunkPath, Buffer.concat(chunks));

  // Check progress
  const uploadedChunks = readdirSync(join(CHUNKS_DIR, uploadId)).length;

  res.json({
    uploadedChunks,
    totalChunks: session.totalChunks,
    complete: uploadedChunks >= session.totalChunks,
  });
});

// Complete chunked upload and start conversion
router.post("/api/upload/complete", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  const { uploadId } = req.body;

  if (!uploadId) {
    res.status(400).json({ detail: "缺少 uploadId" });
    return;
  }

  const session = uploadSessions.get(uploadId);
  if (!session) {
    res.status(404).json({ detail: "上传会话不存在" });
    return;
  }

  if (session.userId !== req.user!.userId) {
    res.status(403).json({ detail: "无权操作" });
    return;
  }

  const chunksDir = join(CHUNKS_DIR, uploadId);
  const mergedPath = join(config.uploadDir, `${uploadId}_${session.fileName}`);

  // Merge chunks
  const chunkFiles = readdirSync(chunksDir)
    .map(Number)
    .sort((a, b) => a - b);

  const ws = createWriteStream(mergedPath);
  for (const chunkIndex of chunkFiles) {
    const chunkPath = join(chunksDir, String(chunkIndex));
    const rs = createReadStream(chunkPath);
    await pipeline(rs, ws, { end: false });
  }
  ws.end();

  // Clean up chunks
  rmSync(chunksDir, { recursive: true, force: true });
  uploadSessions.delete(uploadId);

  // Return merged file info (caller should use this to create model + start conversion)
  res.json({
    filePath: mergedPath,
    fileName: session.fileName,
    fileSize: session.fileSize,
    ext: session.fileName.split(".").pop()?.toLowerCase() || "step",
  });
});

export default router;
