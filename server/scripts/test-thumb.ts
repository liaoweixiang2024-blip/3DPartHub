/**
 * Quick test: generate a few thumbnails to verify quality
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { generateThumbnail } from "../src/services/thumbnail.js";
import { config } from "../src/lib/config.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();
const STATIC_MODELS = join(config.staticDir, "models");
const STATIC_THUMBS = join(config.staticDir, "thumbnails");

async function main() {
  // Test specific model
  const testId = "09ccc78c-5ab";
  const gltfPath = join(STATIC_MODELS, `${testId}.gltf`);
  if (existsSync(gltfPath)) {
    console.log("Generating test model:", testId);
    const result = await generateThumbnail(gltfPath, STATIC_THUMBS, testId);
    console.log("Result:", result.thumbnailUrl);
  } else {
    console.log("Model not found:", testId);
  }

  // Also test a few more
  const models = await prisma.model.findMany({
    select: { id: true, name: true },
    take: 2,
  });

  for (const m of models) {
    const gltfPath = join(STATIC_MODELS, `${m.id}.gltf`);
    if (!existsSync(gltfPath)) { console.log("Skip", m.id); continue; }
    console.log("Generating:", m.name, m.id);
    const result = await generateThumbnail(gltfPath, STATIC_THUMBS, m.id);
    console.log("Result:", result.thumbnailUrl);
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
