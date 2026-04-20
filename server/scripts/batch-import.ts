/**
 * 批量导入储气罐模型脚本
 *
 * 用法: npx tsx scripts/batch-import.ts
 *
 * 从 RAR 解压目录中扫描所有 STEP 文件，逐个上传到系统。
 * 会自动创建"储气罐"分类并将模型归入。
 */
import "dotenv/config";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { convertStepToGltf } from "../src/services/converter.js";
import { generateThumbnail } from "../src/services/thumbnail.js";
import { config } from "../src/lib/config.js";

const prisma = new PrismaClient();

// RAR 解压后的根目录
const SOURCE_DIR = process.argv[2] || join(process.cwd(), "..", "2025-11-22后新汇");
const STATIC_MODELS = join(config.staticDir, "models");
const STATIC_THUMBS = join(config.staticDir, "thumbnails");

// 确保 static 目录存在
import { mkdirSync } from "node:fs";
mkdirSync(STATIC_MODELS, { recursive: true });
mkdirSync(STATIC_THUMBS, { recursive: true });

// 默认管理员用户（导入模型的归属用户）
const DEFAULT_USER_EMAIL = process.env.IMPORT_USER_EMAIL || "admin@example.com";

interface StepFile {
  path: string;
  name: string;       // 不含扩展名的模型名
  folderName: string; // 所在文件夹名（用于推断分类）
  pngPath?: string;   // 同目录下的 PNG 缩略图
}

/** 递归扫描目录，收集所有 STEP 文件 */
function scanStepFiles(dir: string): StepFile[] {
  const results: StepFile[] = [];
  const seen = new Set<string>(); // 去重：同名的 STEP 只取最新版本

  function walk(current: string) {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "Thumbs.db" || entry.name === "GPUCache") continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (ext === ".step" || ext === ".stp") {
          // Remove extension case-insensitively
          const name = entry.name.replace(/\.[sS][tT][eE][pP]$/, '').replace(/\.[sS][tT][pP]$/, '');
          // 优先取"更新"目录中的版本，跳过旧版本
          const isUpdated = current.includes("更新") || current.includes("更新");
          const key = name;
          if (seen.has(key)) {
            // 已存在，如果不是更新版本就跳过
            if (!isUpdated) continue;
          }
          seen.add(key);

          // 查找同目录下的 PNG 缩略图
          const pngName = name + ".PNG";
          const pngPath = existsSync(join(current, pngName)) ? join(current, pngName) : undefined;

          results.push({
            path: fullPath,
            name,
            folderName: basename(current),
            pngPath,
          });
        }
      }
    }
  }

  walk(dir);

  // 去重：如果同名文件有多个（更新版本），保留在"更新"目录中的
  const uniqueMap = new Map<string, StepFile>();
  for (const f of results) {
    const existing = uniqueMap.get(f.name);
    if (!existing || f.path.includes("更新")) {
      uniqueMap.set(f.name, f);
    }
  }

  return Array.from(uniqueMap.values());
}

async function main() {
  console.log("=== 储气罐模型批量导入 ===\n");

  // 1. 检查源目录
  if (!existsSync(SOURCE_DIR)) {
    console.error(`源目录不存在: ${SOURCE_DIR}`);
    console.log("请先解压 RAR 文件，或指定目录路径：");
    console.log("  npx tsx scripts/batch-import.ts /path/to/extracted");
    process.exit(1);
  }

  // 2. 获取或创建导入用户
  let user = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!user) {
    user = await prisma.user.findFirst({});
  }
  if (!user) {
    console.error("数据库中没有用户，请先注册一个用户");
    process.exit(1);
  }
  console.log(`导入用户: ${user.username} (${user.email})`);

  // 3. 获取或创建"储气罐"分类
  let category = await prisma.category.findFirst({ where: { name: "储气罐" } });
  if (!category) {
    category = await prisma.category.create({
      data: { name: "储气罐", icon: "gas_canister" },
    });
    console.log(`已创建分类: 储气罐 (${category.id})`);
  } else {
    console.log(`分类已存在: 储气罐 (${category.id})`);
  }

  // 4. 扫描 STEP 文件
  const stepFiles = scanStepFiles(SOURCE_DIR);
  console.log(`\n扫描到 ${stepFiles.length} 个 STEP 文件\n`);

  if (stepFiles.length === 0) {
    console.log("没有找到 STEP 文件，退出");
    process.exit(0);
  }

  // 5. 逐个导入
  let success = 0;
  let failed = 0;

  for (let i = 0; i < stepFiles.length; i++) {
    const sf = stepFiles[i];
    console.log(`[${i + 1}/${stepFiles.length}] 导入: ${sf.name}`);
    console.log(`  文件: ${sf.path}`);

    try {
      // 检查是否已导入（按名称去重）
      const existing = await prisma.model.findFirst({
        where: { name: sf.name, categoryId: category.id },
      });
      if (existing) {
        console.log(`  ⏭ 已存在，跳过 (${existing.id})`);
        continue;
      }

      const modelId = randomUUID().slice(0, 12);

      // 转换 STEP → GLTF
      console.log(`  转换中...`);
      const result = await convertStepToGltf(
        sf.path,
        STATIC_MODELS,
        modelId,
        sf.name + ".STEP"
      );

      // 生成缩略图
      let thumbnailUrl: string | null = null;
      try {
        const thumb = generateThumbnail(result.gltfPath, STATIC_THUMBS, modelId);
        thumbnailUrl = thumb.thumbnailUrl;
      } catch (e) {
        console.log(`  ⚠ 缩略图生成失败: ${e}`);
      }

      // 如果有 PNG 预览图，可以额外保存（暂不处理，使用自动生成的）

      // 写入数据库
      const model = await prisma.model.create({
        data: {
          id: modelId,
          name: sf.name,
          originalName: sf.name + ".step",
          originalFormat: "step",
          originalSize: result.originalSize,
          gltfUrl: result.gltfUrl,
          gltfSize: result.gltfSize,
          thumbnailUrl,
          format: "step",
          status: "completed",
          uploadPath: sf.path,
          categoryId: category.id,
          createdById: user.id,
        },
      });

      console.log(`  ✅ 成功 (${model.id}) — GLTF: ${(result.gltfSize / 1024).toFixed(0)}KB`);
      success++;
    } catch (err) {
      console.error(`  ❌ 失败: ${err}`);
      failed++;
    }
  }

  console.log(`\n=== 导入完成 ===`);
  console.log(`成功: ${success}  失败: ${failed}  跳过: ${stepFiles.length - success - failed}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("导入脚本异常:", err);
  prisma.$disconnect();
  process.exit(1);
});
