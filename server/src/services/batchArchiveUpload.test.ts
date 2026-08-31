// selectBatchModelEntries「零件目录优先，子文件夹跳过」规则的单元测试。
// 该函数是 ZIP/RAR 批量上传共用的模型条目选择器，直接测纯函数，不依赖 zip/prisma。
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-secret';

const { selectBatchModelEntries } = await import('./batchArchiveUpload.js');
const { structuredArchivePath } = await import('./archivePath.js');

type Entry = {
  ext: string;
  originalName: string;
  structuredPath: ReturnType<typeof structuredArchivePath>;
  cleanName?: string;
  modelNameOverride?: string;
  modelFolderKey?: string;
  isNestedModelFile?: boolean;
};

const ACCEPTED = ['step', 'stp'];

// 用真实 structuredArchivePath 构造条目（保证 modelDirKey 折叠与 isBelowModelDir 判定与生产一致），
// isNestedModelFile 与 ZIP/RAR 构造处同源：structuredPath.isBelowModelDir
function structuredEntry(cleanName: string): Entry {
  const structuredPath = structuredArchivePath(cleanName);
  return {
    ext: 'step',
    originalName: cleanName.split('/').at(-1)!,
    structuredPath,
    cleanName,
    isNestedModelFile: structuredPath?.isBelowModelDir || false,
  };
}

test('skips subfolder variants when part dir has a direct model file', () => {
  const results: unknown[] = [];
  const entries: Entry[] = [
    structuredEntry('环喷/电镀圆形环喷_KTHP-8出-160内径/KTHP-8出-160内径.STEP'),
    // 改版变体（历史改版）
    structuredEntry('环喷/电镀圆形环喷_KTHP-8出-160内径/2023-11-24更新/KTHP-8出-160内径.STEP'),
    // 加配件组合变体（不同 stem）
    structuredEntry('环喷/电镀圆形环喷_KTHP-8出-160内径/含喷嘴/KTHP-8出-160内径+JCW-1_8-4-70L.STEP'),
  ];
  const selected = selectBatchModelEntries(entries as never, ACCEPTED, results as never);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].cleanName, '环喷/电镀圆形环喷_KTHP-8出-160内径/KTHP-8出-160内径.STEP');
  assert.equal(results.length, 2);
  for (const r of results as Array<{ status: string; error?: string }>) {
    assert.equal(r.status, 'skipped');
    assert.match(r.error || '', /子文件夹/);
  }
});

test('keeps subfolder files when part dir has no direct model file (no regression)', () => {
  const results: unknown[] = [];
  const entries: Entry[] = [
    // 零件目录本体没有直接 STEP：子文件夹是唯一来源，不同 stem 的都保留
    structuredEntry('环喷/定制环喷_4出180内径/装配体/定制环喷_4出180内径+JCW.STEP'),
    structuredEntry('环喷/定制环喷_4出180内径/2026-3-10更新/定制环喷_4出180内径+JCZ.STEP'),
  ];
  const selected = selectBatchModelEntries(entries as never, ACCEPTED, results as never);
  assert.equal(selected.length, 2);
  assert.equal(results.length, 0);
});

test('direct file wins over same-stem subfolder file without duplicate error', () => {
  const results: unknown[] = [];
  const entries: Entry[] = [
    structuredEntry('环喷/铝钢环喷195内径4出/铝钢环喷195内径4出.STEP'),
    structuredEntry('环喷/铝钢环喷195内径4出/2024-9-21改安装支架/铝钢环喷195内径4出.STEP'),
  ];
  const selected = selectBatchModelEntries(entries as never, ACCEPTED, results as never);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].isNestedModelFile, false);
  const skipped = results as Array<{ status: string }>;
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].status, 'skipped');
});

test('nested variants do not inflate multi-file detection for direct files', () => {
  // 零件目录里两个直接 STEP（不同 stem）+ 一个子文件夹变体：
  // 直接文件应触发 modelNameOverride（用文件名），子文件夹变体跳过且不参与计数
  const results: unknown[] = [];
  const entries: Entry[] = [
    structuredEntry('阀门/双型号零件_TQF/型号A.STEP'),
    structuredEntry('阀门/双型号零件_TQF/型号B.STEP'),
    structuredEntry('阀门/双型号零件_TQF/改版/型号A.STEP'),
  ];
  const selected = selectBatchModelEntries(entries as never, ACCEPTED, results as never);
  assert.equal(selected.length, 2);
  // 两个直接文件都被选（hasMultipleModelsInDir 基于直接文件计数）
  assert.equal((results as Array<{ status: string }>).length, 1);
  assert.equal((results as Array<{ status: string }>)[0].status, 'skipped');
});

test('single-folder archive: skips subfolder variants below the root part dir', () => {
  const results: unknown[] = [];
  const entries: Entry[] = [
    {
      ext: 'step',
      originalName: '零件A.STEP',
      structuredPath: null,
      cleanName: '零件A/零件A.STEP',
      modelNameOverride: '零件A',
      modelFolderKey: 'single-folder:零件a',
      isNestedModelFile: false,
    },
    {
      ext: 'step',
      originalName: '零件A+喷嘴.STEP',
      structuredPath: null,
      cleanName: '零件A/含喷嘴/零件A+喷嘴.STEP',
      modelFolderKey: 'single-folder:零件a',
      isNestedModelFile: true,
    },
  ];
  const selected = selectBatchModelEntries(entries as never, ACCEPTED, results as never);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].originalName, '零件A.STEP');
  assert.equal((results as Array<{ status: string }>)[0].status, 'skipped');
});

test('extension priority still applies among direct files across part dirs', () => {
  const results: unknown[] = [];
  const entries: Entry[] = [structuredEntry('分类/零件一/零件一.stp'), structuredEntry('分类/零件二/零件二.step')];
  const selected = selectBatchModelEntries(entries as never, ACCEPTED, results as never);
  assert.equal(selected.length, 2);
  assert.equal(results.length, 0);
});
