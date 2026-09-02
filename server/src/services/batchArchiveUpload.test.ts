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

// ---- PDF「零件目录优先」分组（collectPdfEntriesForPairing）----
// 生产事故回归：储气罐批传时，零件目录子文件夹里的 PDF（套装/改版图纸）全部挂到本体模型，
// 单个模型挂了 9 张图纸。规则与模型一致：目录有直接 PDF 时子夹 PDF 不挂。
const { collectPdfEntriesForPairing } = await import('./batchArchiveUpload.js');

type PdfEntry = { ext: string; pairKey: string; isNestedPdf?: boolean };

test('pdf pairing drops subfolder PDFs when part dir has a direct PDF', () => {
  const key = 'folder:储气罐/增压器用卧式储气罐（铭牌）_vbaqg-w-10l';
  const pdfs: PdfEntry[] = [
    { ext: 'pdf', pairKey: key }, // 直接层本体图纸
    { ext: 'pdf', pairKey: key, isNestedPdf: true }, // 子夹变体图纸
    { ext: 'pdf', pairKey: key, isNestedPdf: true },
    { ext: 'step', pairKey: key }, // 非模型 key 混入（模型条目同 key，但 ext 不是 pdf 应被忽略）
  ];
  const [byKey] = collectPdfEntriesForPairing(pdfs);
  assert.equal(byKey.get(key)?.length, 1);
});

test('pdf pairing keeps subfolder PDFs when part dir has no direct PDF', () => {
  // 目录本体图纸就在子夹里的场景：维持现状全部挂
  const key = 'folder:分类/零件b';
  const pdfs: PdfEntry[] = [
    { ext: 'pdf', pairKey: key, isNestedPdf: true },
    { ext: 'pdf', pairKey: key, isNestedPdf: true },
  ];
  const [byKey] = collectPdfEntriesForPairing(pdfs);
  assert.equal(byKey.get(key)?.length, 2);
});

test('pdf pairing does not affect other part dirs', () => {
  const dirA = 'folder:分类/零件a';
  const dirB = 'folder:分类/零件b';
  const pdfs: PdfEntry[] = [
    { ext: 'pdf', pairKey: dirA },
    { ext: 'pdf', pairKey: dirA, isNestedPdf: true },
    { ext: 'pdf', pairKey: dirB, isNestedPdf: true },
  ];
  const [byKey] = collectPdfEntriesForPairing(pdfs);
  assert.equal(byKey.get(dirA)?.length, 1);
  assert.equal(byKey.get(dirB)?.length, 1);
});

// ---- 单零件压缩包检测（detectSingleModelFolderArchive）----
// 生产问题回归：此前检测要求用户必须先选分类（selectedCategoryId 非空），
// 分类是可选项，未选时检测失效 → 根文件夹名被 structuredArchivePath 误判为分类名自动建根分类。
const { detectSingleModelFolderArchive } = await import('./batchArchiveUpload.js');

test('single-folder archive detected without a pre-selected category', () => {
  // 不选分类：包内单文件夹+唯一 stem 仍应识别为零件目录（标题=文件夹名，不建新分类）
  const names = ['半自锁公头_PM20/PM20.STEP', '半自锁公头_PM20/PM20.pdf'];
  const result = detectSingleModelFolderArchive(names, ACCEPTED, new Set());
  assert.equal(result?.rootName, '半自锁公头_PM20');
});

test('single-folder archive still rejected for multi-root or known-category collisions', () => {
  // 多根文件夹 → 不是单零件包
  assert.equal(detectSingleModelFolderArchive(['零件A/A.STEP', '零件B/B.STEP'], ACCEPTED, new Set()), null);
  // 根文件夹名撞已知根分类 → 不能当零件目录（会跟分类树冲突）
  assert.equal(detectSingleModelFolderArchive(['储气罐/VBAQG-W-10L.STEP'], ACCEPTED, new Set(['储气罐'])), null);
  // 根目录直接是模型文件（无文件夹）→ 不适用该检测（走文件名命名）
  assert.equal(detectSingleModelFolderArchive(['PM20.STEP'], ACCEPTED, new Set()), null);
});

test('single-folder detection ignores variant subfolders in stem uniqueness', () => {
  // 零件目录本体 + 变体子夹（含喷嘴）→ 仍是单零件包，标题=零件目录名，变体由 isNestedModelFile 跳过
  const names = ['零件A/零件A.STEP', '零件A/含喷嘴/零件A+喷嘴.STEP', '零件A/零件A.pdf'];
  const result = detectSingleModelFolderArchive(names, ACCEPTED, new Set());
  assert.equal(result?.rootName, '零件A');
});

test('single-folder detection rejects tree shape (model only in deeper dirs)', () => {
  // 首个模型文件在第三层（分类/零件目录/文件）：根文件夹是分类层，不能当零件目录
  assert.equal(detectSingleModelFolderArchive(['新分类XYZ/零件目录C/文件C.STEP'], ACCEPTED, new Set()), null);
  // 全部模型都在深层同理
  assert.equal(
    detectSingleModelFolderArchive(['新分类XYZ/零件D/文件D1.STEP', '新分类XYZ/零件E/文件E1.STEP'], ACCEPTED, new Set()),
    null,
  );
});

test('collectPdfEntriesForPairing reports skipped nested PDFs for feedback', () => {
  const key = 'folder:分类/零件a';
  const pdfs: PdfEntry[] = [
    { ext: 'pdf', pairKey: key },
    { ext: 'pdf', pairKey: key, isNestedPdf: true },
  ];
  const [byKey, skipped] = collectPdfEntriesForPairing(pdfs);
  assert.equal(byKey.get(key)?.length, 1);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].isNestedPdf, true);
});

test('single-folder detection tolerates stray root-level PDFs', () => {
  // 包根散落的说明.pdf 不应破坏单零件包识别（此前直接 return null，标题退化成文件名）
  const names = ['零件A/零件A.STEP', '零件A/零件A.pdf', '说明.pdf'];
  const result = detectSingleModelFolderArchive(names, ACCEPTED, new Set());
  assert.equal(result?.rootName, '零件A');
});

test('selectBatchModelEntries reports overflow beyond the per-archive cap', () => {
  // 构造 202 个不同目录的模型 → 前 200 选中，剩余 2 个产生 skipped 上限提示（不再静默丢弃）
  const entries: Entry[] = [];
  for (let i = 0; i < 202; i += 1) {
    entries.push(structuredEntry(`分类X/零件${i}/零件${i}.STEP`));
  }
  const results: unknown[] = [];
  const selected = selectBatchModelEntries(entries as never, ACCEPTED, results as never);
  assert.equal(selected.length, 200);
  const overflow = (results as Array<{ status: string; error?: string }>).filter((r) => r.error?.includes('上限'));
  assert.equal(overflow.length, 2);
  assert.equal(overflow[0].status, 'skipped');
});
