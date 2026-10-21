/**
 * 图片墙预览修复脚本。
 *
 * 背景：历史遗留行 preview_image_url 为空或被粘性标记成原图本身（preview = image），
 * 图片管理/图片墙页因此直接加载 2-4MB 原图，滚动卡顿。磁盘 previews/ 目录可能已有
 * 现成预览文件（DB 快照旧于文件时），优先复用，没有的现场生成（canvas 缩到 640px JPEG）。
 *
 * 运行：npm run product-wall:repair-previews
 * 幂等：可重复执行；preview 已指向 previews/ 的行自动跳过。
 */
import { existsSync, statSync } from 'node:fs';
import { prisma } from '../src/lib/prisma.js';
import {
  generatePreviewImage,
  productWallLocalPathFromUrl,
  productWallPreviewUrlFromImageUrl,
  PRODUCT_WALL_PREVIEW_MIN_SOURCE_BYTES,
} from '../src/routes/product-wall/shared.js';

const MIN_SOURCE_BYTES = PRODUCT_WALL_PREVIEW_MIN_SOURCE_BYTES;

async function main() {
  const rows = await prisma.productWallImage.findMany({ where: { deletedAt: null } });
  let reused = 0;
  let generated = 0;
  let keptOriginal = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.previewImageUrl && row.previewImageUrl !== row.imageUrl) {
      skipped++;
      continue;
    }
    if (!row.imageUrl.startsWith('/static/product-wall/')) {
      skipped++;
      continue;
    }

    const deterministicUrl = productWallPreviewUrlFromImageUrl(row.imageUrl);
    const deterministicPath = deterministicUrl ? productWallLocalPathFromUrl(deterministicUrl) : null;
    if (deterministicUrl && deterministicPath && existsSync(deterministicPath)) {
      await prisma.productWallImage.update({
        where: { id: row.id },
        data: { previewImageUrl: deterministicUrl },
      });
      reused++;
      continue;
    }

    const sourcePath = productWallLocalPathFromUrl(row.imageUrl);
    if (!sourcePath || !existsSync(sourcePath)) {
      console.warn(`[skip] 源文件不存在: ${row.id} ${row.imageUrl}`);
      failed++;
      continue;
    }
    let sourceSize = 0;
    try {
      sourceSize = statSync(sourcePath).size;
    } catch {
      /* fallthrough */
    }
    if (sourceSize < MIN_SOURCE_BYTES) {
      // 小图：原图即可（与运行时 backfill 同阈值语义）
      if (row.previewImageUrl !== row.imageUrl) {
        await prisma.productWallImage.update({
          where: { id: row.id },
          data: { previewImageUrl: row.imageUrl },
        });
      }
      keptOriginal++;
      continue;
    }

    try {
      const previewUrl = await generatePreviewImage(sourcePath, row.imageUrl);
      if (!previewUrl) {
        console.warn(`[warn] 生成返回空: ${row.id} ${row.imageUrl}`);
        failed++;
        continue;
      }
      await prisma.productWallImage.update({
        where: { id: row.id },
        data: { previewImageUrl: previewUrl },
      });
      generated++;
    } catch (err) {
      console.warn(`[fail] ${row.id} ${row.imageUrl}:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  const summary = { total: rows.length, reused, generated, keptOriginal, skipped, failed };
  console.log(JSON.stringify(summary, null, 2));
  if (failed > 0) process.exitCode = 1;
  // import 链会拉起 redis 客户端等常驻连接，$disconnect 后事件循环仍不空——
  // 显式退出（与 server 单测 --test-force-exit 同款问题）
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
