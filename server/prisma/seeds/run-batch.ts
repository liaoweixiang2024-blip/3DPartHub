/**
 * 产品批次脚本通用入口
 *
 * 用法:
 *   npx tsx prisma/seeds/run-batch.ts 30
 *   npm run prisma:seed:batch 30
 */
import { resolve } from "path";

const batchNum = process.argv[2];
if (!batchNum || !/^\d+$/.test(batchNum)) {
  console.error("用法: tsx prisma/seeds/run-batch.ts <批次号>");
  console.error("示例: tsx prisma/seeds/run-batch.ts 30");
  process.exit(1);
}

// 批次脚本存放在项目根 data/seeds/products/ 目录
// npm scripts 的 cwd 是 server/，所以 data 在 ../data/
const scriptPath = resolve(process.cwd(), "../data/seeds/products", `batch${batchNum}.ts`);

try {
  await import(scriptPath);
} catch (err: any) {
  if (err.code === "ERR_MODULE_NOT_FOUND" || err.message?.includes("Cannot find") || err.message?.includes("ERR_MODULE_NOT_FOUND")) {
    console.error(`批次脚本不存在: ${scriptPath}`);
    process.exit(1);
  }
  throw err;
}
