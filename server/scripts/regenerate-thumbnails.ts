/**
 * 批量重新生成模型预览图（使用 Three.js WebGL 渲染）
 *
 * 遍历数据库中所有已有模型，用 Puppeteer + Three.js 重新生成高质量预览图。
 *
 * 用法: npx tsx scripts/regenerate-thumbnails.ts
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { generateThumbnail } from "../src/services/thumbnail.js";
import { config } from "../src/lib/config.js";

const prisma = new PrismaClient();
const STATIC_MODELS = join(config.staticDir, "models");
const STATIC_THUMBS = join(config.staticDir, "thumbnails");

async function main() {
  console.log("=== 批量重新生成预览图 (Three.js WebGL) ===\n");

  const models = await prisma.model.findMany({
    where: { status: "completed" },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`共 ${models.length} 个模型需要重新生成预览图\n`);

  let success = 0, failed = 0, skipped = 0;

  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const gltfPath = join(STATIC_MODELS, `${m.id}.gltf`);

    if (!existsSync(gltfPath)) {
      skipped++;
      if (skipped <= 20) {
        console.log(`[${i + 1}/${models.length}] ⏭ glTF 不存在: ${m.id} (${m.name})`);
      }
      continue;
    }

    try {
      const result = await generateThumbnail(gltfPath, STATIC_THUMBS, m.id);

      if (result.thumbnailUrl) {
        await prisma.model.update({
          where: { id: m.id },
          data: { thumbnailUrl: result.thumbnailUrl },
        });
      }

      success++;
      if (success <= 10 || success % 50 === 0) {
        console.log(`[${i + 1}/${models.length}] ✅ ${m.name} (${m.id})`);
      }
    } catch (err: any) {
      failed++;
      if (failed <= 20) {
        console.error(`[${i + 1}/${models.length}] ❌ ${m.name}: ${err.message?.slice(0, 80)}`);
      }
    }
  }

  console.log(`\n=== 重新生成完成 ===`);
  console.log(`成功: ${success}  失败: ${failed}  跳过: ${skipped}  总计: ${models.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("重新生成异常:", err);
  prisma.$disconnect();
  process.exit(1);
});
