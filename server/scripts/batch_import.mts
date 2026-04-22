/**
 * 批量导入模型脚本（使用图片库分类结构）
 *
 * 用法:
 *   # 使用图片库目录结构创建分类
 *   npx tsx scripts/batch_import.mts \
 *     --dir /path/to/step_files \
 *     --categories-dir /path/to/图片库 \
 *     --admin admin@model.com
 *
 *   # 跳过转换（用于恢复已有 glTF 文件）
 *   npx tsx scripts/batch_import.mts \
 *     --dir /path/to/step_files \
 *     --categories-dir /path/to/图片库 \
 *     --skip-convert
 */

import { readdirSync, statSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename, extname, resolve } from "node:path";
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
const CATEGORIES_DIR = getArg("categories-dir");
const SKIP_CONVERT = hasFlag("skip-convert");
const ADMIN_EMAIL = getArg("admin") || "admin@model.com";

if (!SOURCE_DIR || !existsSync(SOURCE_DIR)) {
  console.error("Usage: npx tsx scripts/batch_import.mts --dir /path/to/models --categories-dir /path/to/图片库 [--skip-convert] [--admin email]");
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

// ─── Build category hierarchy from image archive ───
// Maps parent category name → Set of sub-category names
const categoryHierarchy = new Map<string, Set<string>>();

if (CATEGORIES_DIR && existsSync(CATEGORIES_DIR)) {
  const topDirs = readdirSync(CATEGORIES_DIR, { withFileTypes: true });
  for (const d of topDirs) {
    if (!d.isDirectory()) continue;
    const subDirs = readdirSync(join(CATEGORIES_DIR, d.name), { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
    categoryHierarchy.set(d.name, new Set(subDirs));
  }
  console.log(`\nCategory hierarchy loaded from: ${CATEGORIES_DIR}`);
  for (const [parent, subs] of categoryHierarchy) {
    if (subs.size > 0) {
      console.log(`  ${parent}: ${[...subs].join(", ")}`);
    } else {
      console.log(`  ${parent}: (no sub-categories)`);
    }
  }
} else {
  console.log(`\nNo categories directory specified, files will have no category.`);
}

// ─── Category creation with caching ───
const categoryCache = new Map<string, string>();

async function getOrCreateCategory(name: string, parentName?: string): Promise<string> {
  const cacheKey = parentName ? `${parentName}/${name}` : name;
  if (categoryCache.has(cacheKey)) return categoryCache.get(cacheKey)!;

  const existing = await prisma.category.findFirst({ where: { name } });
  if (existing) {
    categoryCache.set(cacheKey, existing.id);
    return existing.id;
  }

  let parentId: string | undefined;
  if (parentName) {
    parentId = await getOrCreateCategory(parentName);
  }

  const created = await prisma.category.create({
    data: { id: name, name, icon: "folder", parentId, createdAt: new Date(), updatedAt: new Date() },
  });
  console.log(`  Created ${parentId ? "sub-" : ""}category: ${name}${parentId ? ` (under ${parentName})` : ""}`);
  categoryCache.set(cacheKey, created.id);
  return created.id;
}

// ─── Resolve category for a STEP file based on its path ───
function resolveCategory(
  level1Dir: string,
  level2Dir: string | null,
): { parent: string; sub: string | null } {
  // Special case: 高压喷嘴 in STEP archive → 不锈钢接头/高压喷嘴 in image archive
  if (level1Dir === "高压喷嘴") {
    return { parent: "不锈钢接头", sub: "高压喷嘴" };
  }

  // Check if this parent has sub-categories in the image archive
  const subs = categoryHierarchy.get(level1Dir);
  if (subs && subs.size > 0 && level2Dir && subs.has(level2Dir)) {
    return { parent: level1Dir, sub: level2Dir };
  }

  // No matching sub-category → just parent category
  return { parent: level1Dir, sub: null };
}

// ─── Scan STEP files ───
interface ModelEntry {
  filePath: string;
  fileName: string;
  fileSize: number;
  level1Dir: string;         // top-level directory name (e.g., 不锈钢接头)
  level2Dir: string | null;  // second-level directory name (e.g., 不锈钢管件)
  parentDirName: string;     // immediate parent directory name (for display name)
}

function scanDir(dir: string, relativePath: string = ""): ModelEntry[] {
  const results: ModelEntry[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const subPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      results.push(...scanDir(fullPath, subPath));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (!ACCEPTED.has(ext)) continue;

      const stat = statSync(fullPath);
      const parts = relativePath.split("/");

      results.push({
        filePath: fullPath,
        fileName: entry.name,
        fileSize: stat.size,
        level1Dir: parts[0] || "",
        level2Dir: parts.length > 1 ? parts[1] : null,
        parentDirName: basename(dir),
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
  const { filePath, fileName, fileSize, level1Dir, level2Dir, parentDirName } = model;
  const ext = extname(fileName).slice(1).toLowerCase();
  const modelId = randomUUID().slice(0, 12);

  // Display name: use immediate parent directory name, replace + → _ and fractions
  const displayName = parentDirName
    .replace(/\+/g, "_")
    .replace(/1分/g, "1_8")
    .replace(/2分/g, "1_4")
    .replace(/3分/g, "3_8")
    .replace(/4分/g, "1_2")
    .replace(/6分/g, "3_4");

  console.log(`[${i + 1}/${models.length}] ${displayName} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);

  // Resolve category from path + image archive hierarchy
  const { parent: parentCat, sub: subCat } = resolveCategory(level1Dir, level2Dir);
  let categoryId: string | null = null;
  if (CATEGORIES_DIR) {
    if (subCat) {
      categoryId = await getOrCreateCategory(subCat, parentCat);
    } else {
      categoryId = await getOrCreateCategory(parentCat);
    }
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

    console.log(`  ✓ ${gltfUrl} (${(gltfSize / 1024).toFixed(0)}KB)${thumbnailUrl ? " +thumb" : ""} [${parentCat}${subCat ? `/${subCat}` : ""}]`);
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
