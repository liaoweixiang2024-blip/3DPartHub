import { Router, Response } from "express";
import { readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { config } from "../../lib/config.js";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { adminOnly } from "./common.js";
import { prisma } from "../../lib/prisma.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger({ component: "cleanup" });

export function createSettingsCleanupRouter() {
  const router = Router();

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  function collectFiles(dir: string, recursive = true): string[] {
    if (!existsSync(dir)) return [];
    const files: string[] = [];
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && recursive) {
          files.push(...collectFiles(full, recursive));
        } else if (entry.isFile()) {
          files.push(full);
        }
      }
    } catch {}
    return files;
  }

  function fileAgeDays(fullPath: string): number {
    try {
      const mtime = statSync(fullPath).mtimeMs;
      return (Date.now() - mtime) / (1000 * 60 * 60 * 24);
    } catch {
      return 999;
    }
  }

  router.get("/api/settings/cleanup/scan", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;

    try {
      const cwd = process.cwd();
      const staticDir = join(cwd, config.staticDir);
      const uploadDir = join(cwd, config.uploadDir);

      // Collect DB-known IDs
      const dbModelIds = new Set<string>();
      const dbThumbnails = new Set<string>();
      const dbOriginals = new Set<string>();
      const dbUploadPaths = new Set<string>();
      const dbGltfUrls = new Set<string>();
      const dbDrawingUrls = new Set<string>();
      const dbVersionKeys = new Set<string>();

      if (prisma) {
        const models = await prisma.model.findMany({
          select: {
            id: true,
            thumbnailUrl: true,
            uploadPath: true,
            gltfUrl: true,
            drawingUrl: true,
            versions: { select: { fileKey: true } },
          },
        });
        for (const m of models) {
          dbModelIds.add(m.id);
          if (m.thumbnailUrl) dbThumbnails.add(m.thumbnailUrl.split("?")[0]);
          if (m.uploadPath) dbUploadPaths.add(m.uploadPath);
          if (m.gltfUrl) dbGltfUrls.add(m.gltfUrl.split("?")[0]);
          if (m.drawingUrl) dbDrawingUrls.add(m.drawingUrl.split("?")[0]);
          for (const v of m.versions) {
            if (v.fileKey) dbVersionKeys.add(v.fileKey.split("?")[0]);
          }
        }
      }

      const categories: Array<{
        key: string;
        label: string;
        items: Array<{ path: string; size: number; age: number }>;
        totalSize: number;
      }> = [];

      function addCategory(key: string, label: string, files: string[]) {
        const items = files.map((f) => ({
          path: f,
          size: statSync(f).size,
          age: fileAgeDays(f),
        }));
        const totalSize = items.reduce((s, i) => s + i.size, 0);
        if (items.length > 0) {
          categories.push({ key, label, items, totalSize });
        }
      }

      // 1. Orphan GLTF files in static/models/
      const modelsDir = join(staticDir, "models");
      const allModelFiles = collectFiles(modelsDir, false);
      const orphanModels = allModelFiles.filter((f) => {
        const rel = "/static/" + f.slice(staticDir.length + 1).replace(/\\/g, "/");
        const cleanRel = rel.split("?")[0];
        // Keep if referenced by any model gltfUrl or version fileKey
        if (dbGltfUrls.has(cleanRel)) return false;
        if (dbVersionKeys.has(cleanRel)) return false;
        // Also check by model ID prefix: {id}.gltf, {id}.glb, {id}_*/
        const base = f.slice(modelsDir.length + 1);
        const modelId = base.split(/[._/]/)[0];
        if (dbModelIds.has(modelId)) return false;
        return true;
      });
      addCategory("orphan_models", "孤立模型文件 (static/models)", orphanModels);

      // 2. Orphan thumbnails in static/thumbnails/
      const thumbsDir = join(staticDir, "thumbnails");
      const allThumbs = collectFiles(thumbsDir, false);
      const orphanThumbs = allThumbs.filter((f) => {
        const rel = "/static/" + f.slice(staticDir.length + 1).replace(/\\/g, "/");
        if (dbThumbnails.has(rel)) return false;
        const base = f.slice(thumbsDir.length + 1);
        const modelId = base.split(/[._]/)[0];
        if (dbModelIds.has(modelId)) return false;
        return true;
      });
      addCategory("orphan_thumbnails", "孤立缩略图 (static/thumbnails)", orphanThumbs);

      // 3. Orphan originals
      const originalsDir = join(staticDir, "originals");
      const allOriginals = collectFiles(originalsDir, false);
      const orphanOriginals = allOriginals.filter((f) => {
        const rel = "/static/" + f.slice(staticDir.length + 1).replace(/\\/g, "/");
        if (dbUploadPaths.has(rel)) return false;
        const base = f.slice(originalsDir.length + 1);
        const modelId = base.split(/[._]/)[0];
        if (dbModelIds.has(modelId)) return false;
        return true;
      });
      addCategory("orphan_originals", "孤立原始文件 (static/originals)", orphanOriginals);

      // 4. Stale upload chunks (> 1 day old)
      const chunksDir = join(uploadDir, "chunks");
      const allChunks = collectFiles(chunksDir, true);
      const staleChunks = allChunks.filter((f) => fileAgeDays(f) > 1);
      addCategory("stale_chunks", "过期的上传分片 (> 1天)", staleChunks);

      // 5. Stale batch temp files (> 1 day old)
      const batchDir = join(uploadDir, "batch");
      const allBatch = collectFiles(batchDir, true);
      const staleBatch = allBatch.filter((f) => fileAgeDays(f) > 1);
      addCategory("stale_batch", "过期的批量导入临时文件 (> 1天)", staleBatch);

      // 6. Old safety snapshots (> 7 days)
      const snapshotsDir = join(staticDir, "_safety_snapshots");
      const allSnapshots = collectFiles(snapshotsDir, true);
      const oldSnapshots = allSnapshots.filter((f) => fileAgeDays(f) > 7);
      addCategory("old_snapshots", "旧安全快照 (> 7天)", oldSnapshots);

      const totalFiles = categories.reduce((s, c) => s + c.items.length, 0);
      const totalSize = categories.reduce((s, c) => s + c.totalSize, 0);

      res.json({
        categories: categories.map((c) => ({
          key: c.key,
          label: c.label,
          count: c.items.length,
          totalSize: c.totalSize,
          totalSizeText: formatBytes(c.totalSize),
          samplePaths: c.items.slice(0, 5).map((i) => i.path.split("/").pop() || i.path),
        })),
        totalFiles,
        totalSize,
        totalSizeText: formatBytes(totalSize),
      });
    } catch (err: any) {
      log.error({ err }, "Scan failed");
      res.status(500).json({ detail: "扫描失败" });
    }
  });

  router.post("/api/settings/cleanup/execute", authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;

    const targets = req.body.targets as string[] | undefined;
    if (!targets || !Array.isArray(targets) || targets.length === 0) {
      res.status(400).json({ detail: "请指定要清理的分类" });
      return;
    }

    // Validate targets against allowed keys
    const allowedKeys = new Set([
      "orphan_models",
      "orphan_thumbnails",
      "orphan_originals",
      "stale_chunks",
      "stale_batch",
      "old_snapshots",
    ]);
    for (const key of targets) {
      if (!allowedKeys.has(key)) {
        res.status(400).json({ detail: `不允许清理分类: ${key}` });
        return;
      }
    }

    try {
      const cwd = process.cwd();
      const staticDir = join(cwd, config.staticDir);
      const uploadDir = join(cwd, config.uploadDir);

      // Re-scan to get fresh file lists (reuse same logic)
      const dbModelIds = new Set<string>();
      const dbThumbnails = new Set<string>();
      const dbUploadPaths = new Set<string>();
      const dbGltfUrls = new Set<string>();
      const dbVersionKeys = new Set<string>();

      if (prisma) {
        const models = await prisma.model.findMany({
          select: {
            id: true,
            thumbnailUrl: true,
            uploadPath: true,
            gltfUrl: true,
            versions: { select: { fileKey: true } },
          },
        });
        for (const m of models) {
          dbModelIds.add(m.id);
          if (m.thumbnailUrl) dbThumbnails.add(m.thumbnailUrl.split("?")[0]);
          if (m.uploadPath) dbUploadPaths.add(m.uploadPath);
          if (m.gltfUrl) dbGltfUrls.add(m.gltfUrl.split("?")[0]);
          for (const v of m.versions) {
            if (v.fileKey) dbVersionKeys.add(v.fileKey.split("?")[0]);
          }
        }
      }

      let deletedCount = 0;
      let freedBytes = 0;
      let failedCount = 0;
      const errors: string[] = [];

      function safeDelete(files: string[]) {
        for (const f of files) {
          try {
            const size = statSync(f).size;
            rmSync(f, { force: true });
            deletedCount++;
            freedBytes += size;
          } catch (err: any) {
            failedCount++;
            if (errors.length < 5) errors.push(`${f}: ${err.message}`);
          }
        }
      }

      const modelsDir = join(staticDir, "models");
      const thumbsDir = join(staticDir, "thumbnails");
      const originalsDir = join(staticDir, "originals");

      if (targets.includes("orphan_models")) {
        const all = collectFiles(modelsDir, false);
        const orphans = all.filter((f) => {
          const rel = "/static/" + f.slice(staticDir.length + 1).replace(/\\/g, "/");
          if (dbGltfUrls.has(rel) || dbVersionKeys.has(rel)) return false;
          const modelId = f.slice(modelsDir.length + 1).split(/[._/]/)[0];
          return !dbModelIds.has(modelId);
        });
        safeDelete(orphans);
      }

      if (targets.includes("orphan_thumbnails")) {
        const all = collectFiles(thumbsDir, false);
        const orphans = all.filter((f) => {
          const rel = "/static/" + f.slice(staticDir.length + 1).replace(/\\/g, "/");
          if (dbThumbnails.has(rel)) return false;
          const modelId = f.slice(thumbsDir.length + 1).split(/[._]/)[0];
          return !dbModelIds.has(modelId);
        });
        safeDelete(orphans);
      }

      if (targets.includes("orphan_originals")) {
        const all = collectFiles(originalsDir, false);
        const orphans = all.filter((f) => {
          const rel = "/static/" + f.slice(staticDir.length + 1).replace(/\\/g, "/");
          if (dbUploadPaths.has(rel)) return false;
          const modelId = f.slice(originalsDir.length + 1).split(/[._]/)[0];
          return !dbModelIds.has(modelId);
        });
        safeDelete(orphans);
      }

      if (targets.includes("stale_chunks")) {
        const all = collectFiles(join(uploadDir, "chunks"), true);
        safeDelete(all.filter((f) => fileAgeDays(f) > 1));
      }

      if (targets.includes("stale_batch")) {
        const all = collectFiles(join(uploadDir, "batch"), true);
        safeDelete(all.filter((f) => fileAgeDays(f) > 1));
      }

      if (targets.includes("old_snapshots")) {
        const all = collectFiles(join(staticDir, "_safety_snapshots"), true);
        safeDelete(all.filter((f) => fileAgeDays(f) > 7));
      }

      log.info({ deletedCount, freedBytes, freedSizeText: formatBytes(freedBytes), failedCount }, "Cleanup completed");
      res.json({
        deletedCount,
        freedBytes,
        freedSizeText: formatBytes(freedBytes),
        failedCount,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (err: any) {
      log.error({ err }, "Execute failed");
      res.status(500).json({ detail: "清理执行失败" });
    }
  });

  return router;
}
