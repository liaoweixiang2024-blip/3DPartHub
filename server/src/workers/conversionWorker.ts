import { join } from "node:path";
import { rmSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { convertStepToGltf } from "../services/converter.js";
import { convertXtToGltf } from "../services/xt-converter.js";
import { generateThumbnail } from "../services/thumbnail.js";
import { config } from "../lib/config.js";
import { createWorker } from "../lib/queue.js";
import { createNotification } from "../routes/notifications.js";
import { cacheDelByPrefix } from "../lib/cache.js";

// Try to import Prisma
let prisma: any = null;
try {
  const mod = await import("../lib/prisma.js");
  prisma = mod.prisma;
} catch { /* no db */ }

export const conversionWorker = createWorker(async (job) => {
  const { modelId, filePath, originalName, ext, userId } = job.data;

  await job.updateProgress(10);

  try {
    // Update status to processing
    if (prisma) {
      await prisma.model.update({
        where: { id: modelId },
        data: { status: "processing" },
      }).catch(() => {});
    }

    await job.updateProgress(20);

    // Convert
    let result;
    if (ext === "xt" || ext === "x_t") {
      result = await convertXtToGltf(filePath, join(config.staticDir, "models"), modelId, originalName);
    } else {
      result = await convertStepToGltf(filePath, join(config.staticDir, "models"), modelId, originalName);
    }

    await job.updateProgress(70);

    // Generate thumbnail
    const thumb = await generateThumbnail(result.gltfPath, join(config.staticDir, "thumbnails"), modelId);

    await job.updateProgress(90);

    // Update database
    if (prisma) {
      await prisma.model.update({
        where: { id: modelId },
        data: {
          status: "completed",
          gltfUrl: result.gltfUrl,
          gltfSize: result.gltfSize,
          thumbnailUrl: `${thumb.thumbnailUrl}?t=${Date.now()}`,
        },
      });
    }

    // Move original file to persistent storage instead of deleting
    if (existsSync(filePath)) {
      const originalsDir = join(config.staticDir, "originals");
      mkdirSync(originalsDir, { recursive: true });
      const destPath = join(originalsDir, `${modelId}.${ext}`);
      copyFileSync(filePath, destPath);

      // Update DB with original file path
      if (prisma) {
        await prisma.model.update({
          where: { id: modelId },
          data: { uploadPath: destPath },
        }).catch(() => {});
      }

      // Remove temp file
      rmSync(filePath, { force: true });
    }

    await job.updateProgress(100);

    // Invalidate model list cache
    await cacheDelByPrefix("cache:models:");

    // Notify user
    await createNotification({
      userId,
      title: "模型转换完成",
      message: `${originalName} 已成功转换，可以预览和下载。`,
      type: "success",
      relatedId: modelId,
    });

    job.log(`Conversion completed: ${modelId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "转换失败";

    // Clean up temp upload file on failure
    if (existsSync(filePath)) {
      try { rmSync(filePath, { force: true }); } catch {}
    }

    if (prisma) {
      await prisma.model.update({
        where: { id: modelId },
        data: { status: "failed" },
      }).catch(() => {});
      await cacheDelByPrefix("cache:models:");
    }

    // Notify user of failure
    await createNotification({
      userId,
      title: "模型转换失败",
      message: `${originalName} 转换失败: ${message}`,
      type: "error",
      relatedId: modelId,
    });

    throw new Error(message);
  }
});

conversionWorker.on("completed", (job) => {
  console.log(`  ✅ Conversion job ${job.id} completed (model: ${job.data.modelId})`);
});

conversionWorker.on("failed", (job, err) => {
  console.error(`  ❌ Conversion job ${job?.id} failed:`, err.message);
});
