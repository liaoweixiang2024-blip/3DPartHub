/**
 * 离线转换 CLI：本地（内存充足的环境）转换服务器转不动的 STEP/IGES，
 * 产物打成 zip，供服务器「模型管理 → 转换失败 → 导入产物」一键导入。
 *
 * 用法：
 *   npm run convert:offline -- /path/零件.STEP [更多文件或目录...]
 *
 * 每个输入文件在原目录产出 <名称>.offline.zip，内容：
 *   - model.glb      转换产物（与服务器同款 occt 引擎、同款细分参数）
 *   - thumbnail.png  软件光栅化缩略图（与服务器同款生成器）
 *   - meta.json      转换元数据（顶点/面数、细分参数、耗时；导入时入库）
 *   - original.<ext> 原始文件副本（导入后服务器端「下载原文件」可用）
 *
 * 本地堆上限默认约 4GB（跟随主机内存）；服务器级大模型可再加：
 *   NODE_OPTIONS=--max-old-space-size=8192 npm run convert:offline -- ...
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { convertStepToGltf } from '../src/services/converter.js';
import { generateThumbnail } from '../src/services/thumbnail.js';

process.env.DATABASE_URL ||= 'postgresql://offline:offline@localhost:5432/offline';
process.env.JWT_SECRET ||= 'offline-convert';

const ACCEPTED_EXTS = new Set(['step', 'stp', 'iges', 'igs']);

function collectInputs(args: string[]): string[] {
  const files: string[] = [];
  for (const arg of args) {
    const abs = resolve(arg);
    let st;
    try {
      st = statSync(abs);
    } catch {
      console.error(`✗ 文件不存在: ${arg}`);
      process.exitCode = 1;
      continue;
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(abs)) {
        const ext = extname(name).slice(1).toLowerCase();
        if (ACCEPTED_EXTS.has(ext)) files.push(join(abs, name));
      }
    } else if (st.isFile()) {
      files.push(abs);
    }
  }
  return files;
}

async function convertOne(inputPath: string): Promise<boolean> {
  const originalName = basename(inputPath);
  const ext = extname(inputPath).slice(1).toLowerCase();
  if (!ACCEPTED_EXTS.has(ext)) {
    console.error(`✗ ${originalName}: 不支持的格式 .${ext}（仅 STEP/IGES）`);
    return false;
  }

  const sizeMb = (statSync(inputPath).size / 1024 / 1024).toFixed(1);
  console.log(`▶ ${originalName}（${sizeMb}MB）转换中...（复杂几何可能需要数分钟）`);
  const startedAt = Date.now();

  const workDir = join(process.cwd(), 'offline-convert-work', randomUUID().slice(0, 12));
  mkdirSync(workDir, { recursive: true });
  const modelId = 'offline';

  try {
    const result = await convertStepToGltf(inputPath, workDir, modelId, originalName);
    const thumb = generateThumbnail(result.gltfPath, workDir, modelId);

    const meta = {
      ...result.previewMeta,
      offlineImport: {
        convertedAt: new Date().toISOString(),
        conversionMs: Date.now() - startedAt,
        tool: 'convert-offline CLI',
      },
    };

    const zipPath = inputPath.replace(new RegExp(`${extname(inputPath)}$`), '') + '.offline.zip';
    const zip = new AdmZip();
    zip.addFile('model.glb', readFileSync(result.gltfPath));
    if (existsSync(thumb.thumbnailPath)) zip.addFile('thumbnail.png', readFileSync(thumb.thumbnailPath));
    zip.addFile('meta.json', Buffer.from(JSON.stringify(meta), 'utf8'));
    zip.addFile(`original.${ext}`, readFileSync(inputPath));
    zip.writeZip(zipPath);

    const glbMb = (result.gltfSize / 1024 / 1024).toFixed(1);
    console.log(
      `✓ ${originalName} → ${basename(zipPath)}（glb ${glbMb}MB，用时 ${((Date.now() - startedAt) / 1000).toFixed(0)}s）`,
    );
    console.log(`  上传到服务器：模型管理 → 转换失败 → 该模型行 → 「导入产物」`);
    return true;
  } catch (err) {
    console.error(`✗ ${originalName} 转换失败: ${err instanceof Error ? err.message : err}`);
    return false;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a && !a.startsWith('-'));
  if (args.length === 0) {
    console.log(
      [
        '离线转换：本地转换服务器转不动的模型，产物 zip 导入服务器。',
        '',
        '用法: npm run convert:offline -- <STEP/IGES 文件或目录...>',
        '',
        '产出 <名称>.offline.zip（model.glb + thumbnail.png + meta.json + original.<ext>），',
        '在服务器「模型管理 → 转换失败」对应模型行点「导入产物」上传即可。',
      ].join('\n'),
    );
    return;
  }

  const files = collectInputs(args);
  if (files.length === 0) return;

  let ok = 0;
  for (const file of files) {
    if (await convertOne(file)) ok += 1;
  }
  console.log(`\n完成：${ok}/${files.length} 个成功${ok < files.length ? '，失败项见上方日志' : ''}`);
  if (ok < files.length) process.exitCode = 1;
}

void main();
