/**
 * 批量导入模型脚本
 *
 * 用法:
 *   # 导入单个目录下所有 STEP 文件，分类为"储气罐"
 *   npx tsx scripts/batch_import.mts --dir /path/to/models --category "储气罐"
 *
 *   # 递归扫描，每个子文件夹名作为分类名
 *   npx tsx scripts/batch_import.mts --dir /path/to/models --category-by-folder
 *
 *   # 指定管理员邮箱（默认 admin@model.com）
 *   npx tsx scripts/batch_import.mts --dir /path/to/models --category "储气罐" --admin user@example.com
 *
 *   # 只注册已存在的 glTF 文件（跳过转换，用于恢复数据）
 *   npx tsx scripts/batch_import.mts --dir /path/to/models --skip-convert --category "储气罐"
 */

import { readdirSync, statSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { convertStepToGltf } from "../src/services/converter.js";
import { generateThumbnail } from "../src/services/thumbnail.js";

const prisma = new PrismaClient();

// ─── Parse args ───
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const SOURCE_DIR = getArg("dir");
const CATEGORY_NAME = getArg("category");
const CATEGORY_BY_FOLDER = hasFlag("category-by-folder");
const SKIP_CONVERT = hasFlag("skip-convert");
const ADMIN_EMAIL = getArg("admin") || "admin@model.com";

if (!SOURCE_DIR || !existsSync(SOURCE_DIR)) {
  console.error("Usage: npx tsx scripts/batch_import.mts --dir /path/to/models [--category NAME] [--category-by-folder] [--skip-convert]");
  process.exit(1);
}

const ACCEPTED = new Set([".step", ".stp", ".iges", ".igs", ".xt", ".x_t"]);

// ─── Resolve admin ID ───
const admin = await prisma.user.findFirst({ where: { email: ADMIN_EMAIL } });
if (!admin) {
  console.error(`Admin user not found: ${ADMIN_EMAIL}`);
  process.exit(1);
}
console.log(`Admin: ${admin.username} (${admin.id})`);

// ─── Resolve or create category ───
async function getOrCreateCategory(name: string): Promise<string> {
  const existing = await prisma.category.findFirst({ where: { name } });
  if (existing) return existing.id;
  const created = await prisma.category.create({
    data: { id: name, name, icon: "folder", createdAt: new Date(), updatedAt: new Date() },
  });
  console.log(`  Created category: ${name}`);
  return created.id;
}

let defaultCategoryId: string | null = null;
if (CATEGORY_NAME) {
  defaultCategoryId = await getOrCreateCategory(CATEGORY_NAME);
}

// ─── Scan STEP files ───
interface ModelEntry {
  filePath: string;
  fileName: string;
  fileSize: number;
  categoryName: string | null;
  folderName: string;
}

function scanDir(dir: string, folderName: string | null = null): ModelEntry[] {
  const results: ModelEntry[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      results.push(...scanDir(fullPath, CATEGORY_BY_FOLDER ? entry.name : folderName));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (!ACCEPTED.has(ext)) continue;

      const stat = statSync(fullPath);
      results.push({
        filePath: fullPath,
        fileName: entry.name,
        fileSize: stat.size,
        categoryName: CATEGORY_BY_FOLDER ? folderName : null,
        folderName: folderName || basename(dir),
      });
    }
  }
  return results;
}

console.log(`\nScanning: ${SOURCE_DIR} ...`);
const models = scanDir(SOURCE_DIR);
console.log(`Found ${models.length} model files\n`);

if (models.length === 0) {
  console.log("Nothing to import.");
  process.exit(0);
}

// ─── Process models ───
const STATIC_MODELS = join(process.cwd(), "static/models");
const STATIC_THUMBS = join(process.cwd(), "static/thumbnails");
const STATIC_ORIGS = join(process.cwd(), "static/originals");
const META_DIR = join(process.cwd(), "uploads/.metadata");

mkdirSync(STATIC_MODELS, { recursive: true });
mkdirSync(STATIC_THUMBS, { recursive: true });
mkdirSync(STATIC_ORIGS, { recursive: true });
mkdirSync(META_DIR, { recursive: true });

let success = 0;
let skipped = 0;
let failed = 0;

for (let i = 0; i < models.length; i++) {
  const model = models[i];
  const { filePath, fileName, fileSize, categoryName, folderName } = model;
  const ext = extname(fileName).slice(1).toLowerCase();
  const modelId = randomUUID().slice(0, 12);
  const displayName = folderName || fileName.replace(/\.[^.]+$/, "");

  console.log(`[${i + 1}/${models.length}] ${displayName} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);

  // Resolve category
  let categoryId = defaultCategoryId;
  if (categoryName && !defaultCategoryId) {
    categoryId = await getOrCreateCategory(categoryName);
  }

  try {
    // Save original file
    const origDest = join(STATIC_ORIGS, `${modelId}.${ext}`);
    copyFileSync(filePath, origDest);

    // Save metadata
    const meta = {
      model_id: modelId,
      original_name: fileName,
      original_size: fileSize,
      format: ext,
      status: "converting",
      created_at: new Date().toISOString(),
      upload_path: origDest,
      created_by_id: admin.id,
    };
    writeFileSync(join(META_DIR, `${modelId}.json`), JSON.stringify(meta, null, 2));

    // Convert to glTF
    let gltfUrl = "";
    let gltfSize = 0;
    let thumbnailUrl: string | null = null;

    if (SKIP_CONVERT) {
      // Check if glTF already exists (for recovery)
      const existingGltf = join(STATIC_MODELS, `${modelId}.gltf`);
      if (existsSync(existingGltf)) {
        gltfUrl = `/static/models/${modelId}.gltf`;
        gltfSize = statSync(existingGltf).size;
        const binFile = join(STATIC_MODELS, `${modelId}.bin`);
        if (existsSync(binFile)) gltfSize += statSync(binFile).size;
      } else {
        console.log(`  ✗ glTF not found (skip-convert mode)`);
        failed++;
        continue;
      }
    } else {
      const result = await convertStepToGltf(filePath, STATIC_MODELS, modelId, fileName);
      gltfUrl = result.gltfUrl;
      gltfSize = result.gltfSize;
    }

    // Generate thumbnail
    const gltfPath = join(STATIC_MODELS, `${modelId}.gltf`);
    if (existsSync(gltfPath)) {
      try {
        const thumb = generateThumbnail(gltfPath, STATIC_THUMBS, modelId);
        thumbnailUrl = thumb.thumbnailUrl;
      } catch {
        // thumbnail failure is non-critical
      }
    }

    // Insert into database
    await prisma.model.upsert({
      where: { id: modelId },
      create: {
        id: modelId,
        name: displayName,
        originalName: fileName,
        originalFormat: ext,
        originalSize: fileSize,
        gltfUrl,
        gltfSize,
        thumbnailUrl,
        format: ext,
        status: "completed",
        uploadPath: origDest,
        categoryId,
        createdById: admin.id,
      },
      update: {
        status: "completed",
        gltfUrl,
        gltfSize,
        thumbnailUrl,
        categoryId,
      },
    });

    // Update metadata
    meta.status = "completed";
    meta.gltf_url = gltfUrl;
    meta.gltf_size = gltfSize;
    meta.thumbnail_url = thumbnailUrl;
    writeFileSync(join(META_DIR, `${modelId}.json`), JSON.stringify(meta, null, 2));

    console.log(`  ✓ ${gltfUrl} (${(gltfSize / 1024).toFixed(0)}KB)${thumbnailUrl ? " +thumb" : ""}`);
    success++;
  } catch (err: any) {
    console.log(`  ✗ ${err.message?.slice(0, 120) || "failed"}`);
    failed++;
  }
}

console.log(`\n━━━ Import Complete ━━━`);
console.log(`  Success: ${success}`);
console.log(`  Skipped: ${skipped}`);
console.log(`  Failed:  ${failed}`);
console.log(`  Total:   ${models.length}`);

await prisma.$disconnect();
