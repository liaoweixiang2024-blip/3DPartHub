/**
 * 迁移 STEP 原文件到统一目录 static/originals/{id}.step
 *
 * 将数据库中所有 upload_path 不是 /app/static/originals/ 开头的模型，
 * 复制源 STEP 文件到 static/originals/{id}.step，并更新数据库路径。
 *
 * 用法: npx tsx scripts/migrate-originals.ts
 */
import "dotenv/config";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { config } from "../src/lib/config.js";

const prisma = new PrismaClient();
const STATIC_ORIGINALS = join(config.staticDir, "originals");
mkdirSync(STATIC_ORIGINALS, { recursive: true });

async function main() {
  console.log("=== 迁移 STEP 原文件到 static/originals/ ===\n");

  const models = await prisma.model.findMany({
    where: { status: "completed" },
    select: { id: true, uploadPath: true, format: true },
  });

  console.log(`共 ${models.length} 个模型需要检查`);

  let copied = 0, skipped = 0, failed = 0, alreadyCorrect = 0;

  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const targetPath = `/app/static/originals/${m.id}.${m.format || "step"}`;
    const localTargetPath = join(STATIC_ORIGINALS, `${m.id}.${m.format || "step"}`);

    // Already in correct location?
    if (m.uploadPath === targetPath || m.uploadPath === localTargetPath) {
      alreadyCorrect++;
      continue;
    }

    // Target file already exists?
    if (existsSync(localTargetPath)) {
      // Just update DB path
      await prisma.model.update({ where: { id: m.id }, data: { uploadPath: targetPath } });
      copied++;
      if (copied <= 10 || copied % 100 === 0) {
        console.log(`[${i + 1}/${models.length}] path updated: ${m.id}`);
      }
      continue;
    }

    // Try to find source file
    const sourceCandidates = [
      m.uploadPath,                                    // as-is from DB
      m.uploadPath?.replace(/^\/import\//, "../零件库_extracted/"),  // /import → host path
    ].filter(Boolean) as string[];

    let sourcePath: string | null = null;
    for (const candidate of sourceCandidates) {
      if (existsSync(candidate)) {
        sourcePath = candidate;
        break;
      }
    }

    if (!sourcePath) {
      failed++;
      if (failed <= 20) {
        console.log(`[${i + 1}/${models.length}] ❌ source not found: ${m.uploadPath}`);
      }
      continue;
    }

    try {
      copyFileSync(sourcePath, localTargetPath);
      await prisma.model.update({ where: { id: m.id }, data: { uploadPath: targetPath } });
      copied++;
      if (copied <= 10 || copied % 100 === 0) {
        console.log(`[${i + 1}/${models.length}] ✅ copied: ${m.id} (${(require("fs").statSync(localTargetPath).size / 1024).toFixed(0)}KB)`);
      }
    } catch (err: any) {
      failed++;
      if (failed <= 20) {
        console.log(`[${i + 1}/${models.length}] ❌ copy failed: ${m.id}: ${err.message}`);
      }
    }
  }

  console.log(`\n=== 迁移完成 ===`);
  console.log(`复制: ${copied}  已正确: ${alreadyCorrect}  失败: ${failed}  跳过: ${skipped}  总计: ${models.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("迁移异常:", err);
  prisma.$disconnect();
  process.exit(1);
});
