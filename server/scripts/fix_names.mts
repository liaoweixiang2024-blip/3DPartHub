/**
 * 批量修正模型名称脚本
 * 读取 /tmp/模型名称替换清单.tsv，将名称不规范的模型改为原始文件名
 *
 * Usage: npx tsx scripts/fix_names.mts
 */

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TSV_PATH = "/tmp/模型名称替换清单.tsv";

const lines = readFileSync(TSV_PATH, "utf-8").split("\n").slice(1).filter(Boolean);

console.log(`读取到 ${lines.length} 条记录`);

let updated = 0;
let skipped = 0;
let failed = 0;

for (const line of lines) {
  const cols = line.split("\t");
  if (cols.length < 5) continue;

  const [, newName, , , id] = cols;
  if (!id || !newName) continue;

  try {
    const result = await prisma.model.updateMany({
      where: { id: id.trim() },
      data: { name: newName.trim() },
    });
    if (result.count > 0) {
      updated++;
      if (updated % 100 === 0) console.log(`  ... ${updated} updated`);
    } else {
      skipped++;
    }
  } catch (err: any) {
    console.error(`  ✗ ${id}: ${err.message}`);
    failed++;
  }
}

console.log(`\n━━━ Fix Complete ━━━`);
console.log(`  Updated: ${updated}`);
console.log(`  Skipped: ${skipped}`);
console.log(`  Failed:  ${failed}`);

await prisma.$disconnect();
