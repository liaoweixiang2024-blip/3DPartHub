import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createCanvas, loadImage } from 'canvas';

const prisma = new PrismaClient();
const THUMBNAILS_DIR = join(process.cwd(), 'static', 'thumbnails');
const FULL_QUALITY = 0.88;
const SMALL_QUALITY = 0.82;
const SMALL_SIZE = 256;

async function main() {
  if (!existsSync(THUMBNAILS_DIR)) {
    console.log('Thumbnails directory not found:', THUMBNAILS_DIR);
    return;
  }

  const files = readdirSync(THUMBNAILS_DIR).filter((f) => extname(f).toLowerCase() === '.png');
  console.log(`Found ${files.length} PNG thumbnails to convert to JPEG`);

  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const pngFilePath = join(THUMBNAILS_DIR, file);
    const modelId = file.replace(/\.png$/i, '');
    const jpgFilePath = join(THUMBNAILS_DIR, `${modelId}.jpg`);
    const smFilePath = join(THUMBNAILS_DIR, `${modelId}_sm.jpg`);

    if (existsSync(jpgFilePath) && existsSync(smFilePath)) {
      skipped++;
      continue;
    }

    try {
      const image = await loadImage(readFileSync(pngFilePath));
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);

      if (!existsSync(jpgFilePath)) {
        writeFileSync(jpgFilePath, canvas.toBuffer('image/jpeg', { quality: FULL_QUALITY }));
      }

      if (!existsSync(smFilePath)) {
        const smCanvas = createCanvas(SMALL_SIZE, SMALL_SIZE);
        const smCtx = smCanvas.getContext('2d');
        smCtx.drawImage(canvas, 0, 0, image.width, image.height, 0, 0, SMALL_SIZE, SMALL_SIZE);
        writeFileSync(smFilePath, smCanvas.toBuffer('image/jpeg', { quality: SMALL_QUALITY }));
      }

      converted++;
      if (converted % 50 === 0) {
        const pngSize = readFileSync(pngFilePath).length;
        const jpgSize = readFileSync(jpgFilePath).length;
        const savings = Math.round((1 - jpgSize / pngSize) * 100);
        console.log(`Progress: ${converted}/${files.length} (latest: ${file} → ${savings}% smaller)`);
      }
    } catch (err) {
      failed++;
      console.error(`Failed to convert ${file}:`, err);
    }
  }

  console.log(`\nConversion complete: ${converted} converted, ${skipped} skipped (already exist), ${failed} failed`);

  const rawResult = await prisma.$executeRawUnsafe(
    `UPDATE models SET thumbnail_url = REPLACE(thumbnail_url, '.png', '.jpg') WHERE thumbnail_url LIKE '%.png'`,
  );
  console.log(`Updated ${rawResult} database records`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
