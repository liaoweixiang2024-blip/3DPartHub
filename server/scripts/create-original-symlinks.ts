/**
 * 创建以原始文件名命名的符号链接
 *
 * 在 static/models/ 中为每个模型创建符号链接：
 *   原始名.gltf -> {uuid}.gltf
 *   原始名.bin  -> {uuid}.bin
 *
 * 这样用户可以直接通过文件名找到对应的模型文件。
 *
 * 用法: cd server && npx tsx scripts/create-original-symlinks.ts
 */
import "dotenv/config";
import { existsSync, symlinkSync, unlinkSync, readlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { PrismaClient } from "@prisma/client";
import { config } from "../src/lib/config.js";

const prisma = new PrismaClient();
const STATIC_MODELS = join(config.staticDir, "models");

function sanitizeFilename(name: string): string {
  // Remove extension, replace unsafe chars
  return name
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/\.step$/i, "")
    .replace(/\.stp$/i, "");
}

async function main() {
  console.log("=== 创建原始文件名符号链接 ===\n");

  const models = await prisma.model.findMany({
    select: { id: true, originalName: true },
    orderBy: { createdAt: "asc" },
  });

  let created = 0, skipped = 0, failed = 0;

  for (const m of models) {
    const gltfPath = join(STATIC_MODELS, `${m.id}.gltf`);
    const binPath = join(STATIC_MODELS, `${m.id}.bin`);

    if (!existsSync(gltfPath)) {
      skipped++;
      continue;
    }

    const baseName = sanitizeFilename(m.originalName || m.id);

    // Create symlinks for .gltf and .bin
    for (const ext of [".gltf", ".bin"]) {
      const target = join(STATIC_MODELS, `${m.id}${ext}`);
      if (!existsSync(target)) continue;

      const linkPath = join(STATIC_MODELS, `${baseName}${ext}`);
      const relativeTarget = `${m.id}${ext}`;

      try {
        // Check if symlink already exists and points to correct target
        if (existsSync(linkPath)) {
          try {
            const existing = readlinkSync(linkPath);
            if (existing === relativeTarget) {
              continue; // Already correct
            }
          } catch {
            // Not a symlink, skip
            continue;
          }
          unlinkSync(linkPath);
        }
        symlinkSync(relativeTarget, linkPath);
      } catch (err: any) {
        // Might fail if filename collision, skip silently
        if (failed < 5) {
          console.warn(`  ⚠️ Failed: ${baseName}${ext}: ${err.message}`);
        }
        failed++;
        continue;
      }
    }

    created++;
    if (created <= 10 || created % 200 === 0) {
      console.log(`[${created}] ${baseName} -> ${m.id}`);
    }
  }

  console.log(`\n=== 完成 ===`);
  console.log(`创建: ${created}  跳过: ${skipped}  失败: ${failed}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("异常:", err);
  prisma.$disconnect();
  process.exit(1);
});
