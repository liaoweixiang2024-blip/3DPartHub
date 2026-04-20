/**
 * Re-convert all existing models with higher tessellation quality
 * and regenerate thumbnails with Gouraud shading.
 *
 * Usage (inside API container or locally):
 *   npx tsx scripts/reconvert.mts
 */

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { convertStepToGltf } from "../src/services/converter.js";
import { generateThumbnail } from "../src/services/thumbnail.js";

const prisma = new PrismaClient();

const STATIC_MODELS = join(process.cwd(), "static/models");
const STATIC_THUMBS = join(process.cwd(), "static/thumbnails");
const STATIC_ORIGS = join(process.cwd(), "static/originals");

async function main() {
  const models = await prisma.model.findMany({
    where: { status: "completed" },
    select: { id: true, name: true, format: true, uploadPath: true },
  });

  console.log(`Found ${models.length} completed models to re-convert\n`);

  let success = 0, failed = 0;

  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    console.log(`[${i + 1}/${models.length}] ${m.name} (${m.id})`);

    // Find original file
    const origPath = m.uploadPath && existsSync(m.uploadPath)
      ? m.uploadPath
      : join(STATIC_ORIGS, `${m.id}.${m.format}`);

    if (!existsSync(origPath)) {
      console.log(`  ✗ Original file not found: ${origPath}`);
      failed++;
      continue;
    }

    try {
      // Re-convert with higher tessellation quality
      const result = await convertStepToGltf(origPath, STATIC_MODELS, m.id, `${m.id}.${m.format}`);

      // Regenerate thumbnail with Gouraud shading
      let thumbnailUrl: string | null = null;
      const gltfPath = join(STATIC_MODELS, `${m.id}.gltf`);
      if (existsSync(gltfPath)) {
        try {
          const thumb = generateThumbnail(gltfPath, STATIC_THUMBS, m.id);
          thumbnailUrl = thumb.thumbnailUrl;
        } catch {
          // non-critical
        }
      }

      // Update DB with new sizes
      await prisma.model.update({
        where: { id: m.id },
        data: {
          gltfSize: result.gltfSize,
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
        },
      });

      console.log(`  ✓ glTF ${(result.gltfSize / 1024).toFixed(0)}KB${thumbnailUrl ? " +thumb" : ""}`);
      success++;
    } catch (err: any) {
      console.log(`  ✗ ${err.message?.slice(0, 120) || "failed"}`);
      failed++;
    }
  }

  console.log(`\n━━━ Re-convert Complete ━━━`);
  console.log(`  Success: ${success}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Total:   ${models.length}`);

  await prisma.$disconnect();
}

main().catch(console.error);
