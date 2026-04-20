/**
 * 批量导入零件库模型脚本 (v4 - 图片库分类结构 + 文件夹名模型名)
 *
 * 改进：
 * 1. 使用图片库目录结构作为标准分类树（非 STEP 文件目录）
 * 2. 自动匹配 STEP 文件到正确分类/子分类
 * 3. 模型名称使用 STEP 文件所在文件夹名
 * 4. 去重：同名模型保留最新修改时间的版本
 *
 * 用法: npx tsx scripts/batch-import-v2.ts [STEP源目录] [图片库目录]
 */
import "dotenv/config";
import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { convertStepToGltf } from "../src/services/converter.js";
import { generateThumbnail } from "../src/services/thumbnail.js";
import { config } from "../src/lib/config.js";

const prisma = new PrismaClient();

const STEP_DIR = process.argv[2] || join(process.cwd(), "..", "零件库_extracted", "零件库");
const IMAGE_DIR = process.argv[3] || join(process.cwd(), "..", "图片库");
const STATIC_MODELS = join(config.staticDir, "models");
const STATIC_THUMBS = join(config.staticDir, "thumbnails");
const STATIC_ORIGINALS = join(config.staticDir, "originals");
mkdirSync(STATIC_MODELS, { recursive: true });
mkdirSync(STATIC_THUMBS, { recursive: true });
mkdirSync(STATIC_ORIGINALS, { recursive: true });

// Category icon mapping
const CATEGORY_ICONS: Record<string, string> = {
  "万向管": "hose",
  "不锈钢接头": "connector",
  "储气罐": "gas_canister",
  "其他辅料": "package",
  "气动元件": "cog",
  "气动接头": "plug",
  "润滑配件": "oil",
  "管道": "pipe",
  "组装成品类": "assembly",
  "配件": "wrench",
  "铁&液压接头": "bolt",
  "铜接头": "nut",
  "阀门": "valve",
  "高压喷嘴": "spray",
};

// ─── 1. Build canonical category tree from 图片库 ───

interface CanonCategory {
  name: string;
  icon: string;
  subcategories: string[];
}

function buildCanonicalTree(imageDir: string): CanonCategory[] {
  const categories: CanonCategory[] = [];
  const rootEntries = readdirSync(imageDir, { withFileTypes: true });

  for (const entry of rootEntries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const catPath = join(imageDir, entry.name);
    const catName = entry.name;

    const subcategories: string[] = [];
    const subEntries = readdirSync(catPath, { withFileTypes: true });
    for (const sub of subEntries) {
      if (sub.isDirectory() && !sub.name.startsWith(".")) {
        subcategories.push(sub.name);
      }
    }

    categories.push({
      name: catName,
      icon: CATEGORY_ICONS[catName] || "folder",
      subcategories,
    });
  }

  return categories;
}

// ─── 2. Build subcategory → parent mapping ───

function buildSubcatParentMap(categories: CanonCategory[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const cat of categories) {
    for (const sub of cat.subcategories) {
      map.set(sub, cat.name);
    }
  }
  return map;
}

// ─── 3. Scan STEP files and match to canonical categories ───

interface StepFile {
  path: string;
  name: string;           // 文件夹名（名称+型号）
  fileName: string;       // STEP 文件名（仅型号）
  categoryName: string;   // 标准分类名
  subcategoryName?: string; // 子分类（如果有）
  mtime: Date;
}

function scanStepFiles(
  stepDir: string,
  categories: CanonCategory[],
  subcatParentMap: Map<string, string>,
): StepFile[] {
  const results: StepFile[] = [];
  const topCatNames = new Set(categories.map(c => c.name));
  const subCatNames = new Set(subcatParentMap.keys());

  // Build a map: topCatName → Set of subcategory names
  const catSubcats = new Map<string, Set<string>>();
  for (const cat of categories) {
    catSubcats.set(cat.name, new Set(cat.subcategories));
  }

  const rootEntries = readdirSync(stepDir, { withFileTypes: true });

  for (const rootEntry of rootEntries) {
    if (!rootEntry.isDirectory() || rootEntry.name.startsWith(".")) continue;
    const rootPath = join(stepDir, rootEntry.name);
    const rootName = rootEntry.name;

    // Determine the top-level category for this root folder
    let categoryName: string;
    let isSubcategory = false;

    if (topCatNames.has(rootName)) {
      // This root folder IS a top-level category
      categoryName = rootName;
    } else if (subcatParentMap.has(rootName)) {
      // This root folder is actually a subcategory in the canonical tree
      // e.g., 高压喷嘴 is under 不锈钢接头
      categoryName = subcatParentMap.get(rootName)!;
      isSubcategory = true;
    } else {
      // Unknown folder — skip or assign to "其他"
      continue;
    }

    function walk(current: string, pathParts: string[]) {
      const entries = readdirSync(current, { withFileTypes: true });
      const stepFiles: string[] = [];
      const subdirs: string[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "Thumbs.db" || entry.name === "GPUCache") continue;
        if (entry.isDirectory()) {
          subdirs.push(entry.name);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (ext === ".step" || ext === ".stp") {
            stepFiles.push(entry.name);
          }
        }
      }

      if (stepFiles.length > 0) {
        for (const stepName of stepFiles) {
          const fullPath = join(current, stepName);
          const stat = statSync(fullPath);
          const nameWithoutExt = stepName.replace(/\.[sS][tT][eE][pP]$/, "").replace(/\.[sS][tT][pP]$/, "");
          const modelName = basename(current);

          // Determine subcategory
          let subcategoryName: string | undefined;

          if (isSubcategory) {
            // The root folder itself is a subcategory (e.g., 高压喷嘴 → 不锈钢接头/高压喷嘴)
            subcategoryName = rootName;
          } else {
            // Check intermediate folders for canonical subcategory match
            const subs = catSubcats.get(categoryName);
            if (subs) {
              for (const part of pathParts) {
                if (subs.has(part)) {
                  subcategoryName = part;
                  break;
                }
              }
            }
          }

          results.push({
            path: fullPath,
            name: modelName,
            fileName: nameWithoutExt,
            categoryName,
            subcategoryName,
            mtime: stat.mtime,
          });
        }
      }

      for (const subdir of subdirs) {
        walk(join(current, subdir), [...pathParts, subdir]);
      }
    }

    walk(rootPath, []);
  }

  // Deduplicate by name + category: keep newest mtime
  const uniqueMap = new Map<string, StepFile>();
  for (const f of results) {
    const key = `${f.categoryName}::${f.subcategoryName || ""}::${f.name}`;
    const existing = uniqueMap.get(key);
    if (!existing || f.mtime > existing.mtime) {
      uniqueMap.set(key, f);
    }
  }

  return Array.from(uniqueMap.values());
}

// ─── Main ───

async function main() {
  console.log("=== 零件库批量导入 v4 (图片库分类结构) ===\n");

  if (!existsSync(STEP_DIR)) {
    console.error(`STEP 源目录不存在: ${STEP_DIR}`);
    process.exit(1);
  }
  if (!existsSync(IMAGE_DIR)) {
    console.error(`图片库目录不存在: ${IMAGE_DIR}`);
    process.exit(1);
  }

  // Get or create admin user
  let user = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!user) user = await prisma.user.findFirst({});
  if (!user) {
    console.error("数据库中没有用户，请先注册一个用户");
    process.exit(1);
  }
  console.log(`导入用户: ${user.username} (${user.email})`);

  // Build canonical category tree from 图片库
  const categories = buildCanonicalTree(IMAGE_DIR);
  const subcatParentMap = buildSubcatParentMap(categories);

  console.log(`\n标准分类树 (来自图片库):`);
  for (const cat of categories) {
    if (cat.subcategories.length > 0) {
      console.log(`  ${cat.icon.padEnd(12)} ${cat.name}: ${cat.subcategories.join(", ")}`);
    } else {
      console.log(`  ${cat.icon.padEnd(12)} ${cat.name}`);
    }
  }

  // Scan STEP files
  const stepFiles = scanStepFiles(STEP_DIR, categories, subcatParentMap);

  // Count by category
  const catCounts = new Map<string, number>();
  const subcatCounts = new Map<string, number>();
  for (const f of stepFiles) {
    catCounts.set(f.categoryName, (catCounts.get(f.categoryName) || 0) + 1);
    if (f.subcategoryName) {
      const key = `${f.categoryName}/${f.subcategoryName}`;
      subcatCounts.set(key, (subcatCounts.get(key) || 0) + 1);
    }
  }

  console.log(`\n扫描到 ${stepFiles.length} 个 STEP 文件（去重后）`);
  for (const [cat, count] of catCounts) {
    const subcats = Array.from(subcatCounts.entries()).filter(([k]) => k.startsWith(cat + "/"));
    if (subcats.length > 0) {
      console.log(`  ${cat}: ${count} (子分类: ${subcats.map(([k, c]) => `${k.split("/")[1]}(${c})`).join(", ")})`);
    } else {
      console.log(`  ${cat}: ${count}`);
    }
  }
  console.log();

  if (stepFiles.length === 0) {
    console.log("没有找到 STEP 文件");
    process.exit(0);
  }

  // Create all parent categories first
  const categoryMap = new Map<string, string>(); // name -> id
  for (const cat of categories) {
    let existing = await prisma.category.findFirst({ where: { name: cat.name, parentId: null } });
    if (!existing) {
      existing = await prisma.category.create({
        data: { name: cat.name, icon: cat.icon },
      });
      console.log(`  创建分类: ${cat.name} (${cat.icon})`);
    }
    categoryMap.set(cat.name, existing.id);
  }

  // Create subcategories
  const subcategoryMap = new Map<string, string>(); // "parentName/subcatName" -> id
  for (const [key, _count] of subcatCounts) {
    const [parentName, subcatName] = key.split("/");
    const parentId = categoryMap.get(parentName);
    if (!parentId) continue;

    let subcat = await prisma.category.findFirst({
      where: { name: subcatName, parentId },
    });
    if (!subcat) {
      subcat = await prisma.category.create({
        data: { name: subcatName, icon: "folder", parentId },
      });
      console.log(`  创建子分类: ${parentName} > ${subcatName}`);
    }
    subcategoryMap.set(key, subcat.id);
  }
  console.log();

  // Import each file
  let success = 0, failed = 0, skipped = 0;

  for (let i = 0; i < stepFiles.length; i++) {
    const sf = stepFiles[i];

    // Determine category: prefer subcategory if exists, else parent
    let catId: string;
    if (sf.subcategoryName) {
      const subcatKey = `${sf.categoryName}/${sf.subcategoryName}`;
      catId = subcategoryMap.get(subcatKey) || categoryMap.get(sf.categoryName)!;
    } else {
      catId = categoryMap.get(sf.categoryName)!;
    }

    try {
      // Check if already imported by name + category
      const existing = await prisma.model.findFirst({
        where: { name: sf.name, categoryId: catId },
      });
      if (existing) {
        skipped++;
        if (skipped <= 10 || skipped % 100 === 0) {
          console.log(`[${i + 1}/${stepFiles.length}] ⏭ 已存在: ${sf.name}`);
        }
        continue;
      }

      const modelId = randomUUID().slice(0, 12);

      // Convert STEP → glTF
      const result = await convertStepToGltf(
        sf.path,
        STATIC_MODELS,
        modelId,
        sf.fileName + ".STEP"
      );

      // Generate thumbnail (no PNG fallback — use generated thumbnail)
      let thumbnailUrl: string | null = null;
      try {
        const thumb = await generateThumbnail(result.gltfPath, STATIC_THUMBS, modelId);
        thumbnailUrl = thumb.thumbnailUrl;
      } catch {
        // Thumbnail failure is not fatal
      }

      // Copy STEP original to static/originals/{id}.step for unified storage
      const originalDest = join(STATIC_ORIGINALS, `${modelId}.step`);
      try {
        copyFileSync(sf.path, originalDest);
      } catch {
        // Copy failure is not fatal — download will fall back to glTF
      }

      // Save to database
      await prisma.model.create({
        data: {
          id: modelId,
          name: sf.name,
          originalName: sf.fileName + ".step",
          originalFormat: "step",
          originalSize: result.originalSize,
          gltfUrl: result.gltfUrl,
          gltfSize: result.gltfSize,
          thumbnailUrl,
          format: "step",
          status: "completed",
          uploadPath: `/app/static/originals/${modelId}.step`,
          categoryId: catId,
          category: sf.subcategoryName || sf.categoryName,
          createdById: user.id,
        },
      });

      success++;
      if (success <= 20 || success % 50 === 0) {
        console.log(`[${i + 1}/${stepFiles.length}] ✅ ${sf.name} (${sf.subcategoryName ? sf.subcategoryName + " > " : ""}${sf.categoryName}) — ${(result.gltfSize / 1024).toFixed(0)}KB`);
      }
    } catch (err: any) {
      failed++;
      if (failed <= 20) {
        console.error(`[${i + 1}/${stepFiles.length}] ❌ ${sf.name}: ${err.message?.slice(0, 100) || err}`);
      }
    }
  }

  console.log(`\n=== 导入完成 ===`);
  console.log(`成功: ${success}  失败: ${failed}  跳过: ${skipped}  总计: ${stepFiles.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("导入脚本异常:", err);
  prisma.$disconnect();
  process.exit(1);
});
