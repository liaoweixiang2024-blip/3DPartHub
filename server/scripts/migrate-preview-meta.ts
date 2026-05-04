import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/lib/config.js';
import { prisma } from '../src/lib/prisma.js';

const shouldDeleteFiles = process.argv.includes('--delete-files');
const modelDir = join(config.staticDir, 'models');

function isPreviewMeta(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const meta = value as Record<string, any>;
  return meta.version === 2 && Boolean(meta.totals) && Boolean(meta.bounds);
}

async function main() {
  if (!existsSync(modelDir)) {
    console.log(JSON.stringify({ modelDir, imported: 0, deleted: 0, skipped: 0, missingDir: true }, null, 2));
    return;
  }

  const files = readdirSync(modelDir).filter((file) => file.endsWith('.meta.json'));
  let imported = 0;
  let deleted = 0;
  let skipped = 0;

  for (const file of files) {
    const modelId = file.replace(/\.meta\.json$/, '');
    const filePath = join(modelDir, file);

    try {
      const meta = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (!isPreviewMeta(meta)) {
        skipped++;
        continue;
      }

      const result = await prisma.model.updateMany({
        where: { id: modelId },
        data: { previewMeta: meta },
      });

      if (result.count > 0) {
        imported++;
        if (shouldDeleteFiles) {
          rmSync(filePath, { force: true });
          deleted++;
        }
      } else {
        skipped++;
      }
    } catch (err) {
      skipped++;
      console.warn(`[preview-meta:migrate] skipped ${file}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(JSON.stringify({ modelDir, scanned: files.length, imported, deleted, skipped }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
