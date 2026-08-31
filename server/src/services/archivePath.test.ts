import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeZipEntryNameForUpload, structuredArchivePath } from './archivePath.js';

test('maps category folder with direct model file to that category', () => {
  assert.deepEqual(structuredArchivePath('不锈钢接头/SCFH-1.2寸-45x40L.STEP'), {
    categoryName: '不锈钢接头',
    subcategoryName: null,
    modelName: 'SCFH-1.2寸-45x40L',
    modelDirKey: '不锈钢接头/scfh-1.2寸-45x40l',
    isBelowModelDir: false,
  });
});

test('maps category and subcategory folders when model file is directly under subcategory', () => {
  assert.deepEqual(structuredArchivePath('不锈钢接头/304焊直通/SCFH-1.2寸-45x40L.STEP'), {
    categoryName: '不锈钢接头',
    subcategoryName: '304焊直通',
    modelName: 'SCFH-1.2寸-45x40L',
    modelDirKey: '不锈钢接头/304焊直通/scfh-1.2寸-45x40l',
    isBelowModelDir: false,
  });
});

test('keeps explicit model folder title under category and subcategory', () => {
  assert.deepEqual(
    structuredArchivePath('不锈钢接头/304焊直通/不锈钢焊直通(双头内丝)_SCFH-1.2寸-45x40L/SCFH-1.2寸-45x40L.STEP'),
    {
      categoryName: '不锈钢接头',
      subcategoryName: '304焊直通',
      modelName: '不锈钢焊直通(双头内丝)_SCFH-1.2寸-45x40L',
      modelDirKey: '不锈钢接头/304焊直通/不锈钢焊直通(双头内丝)_scfh-1.2寸-45x40l',
      isBelowModelDir: false,
    },
  );
});

test('keeps model folder when second folder looks like a model name', () => {
  assert.deepEqual(
    structuredArchivePath('不锈钢接头/不锈钢焊直通(双头内丝)_SCFH-1.2寸-45x40L/SCFH-1.2寸-45x40L.STEP'),
    {
      categoryName: '不锈钢接头',
      subcategoryName: null,
      modelName: '不锈钢焊直通(双头内丝)_SCFH-1.2寸-45x40L',
      modelDirKey: '不锈钢接头/不锈钢焊直通(双头内丝)_scfh-1.2寸-45x40l',
      isBelowModelDir: false,
    },
  );
});

test('uses known child categories to disambiguate category slash second folder slash file', () => {
  assert.deepEqual(
    structuredArchivePath('不锈钢接头/304焊直通/SCFH-1.2寸-45x40L.STEP', {
      isKnownSubcategory: () => true,
    }),
    {
      categoryName: '不锈钢接头',
      subcategoryName: '304焊直通',
      modelName: 'SCFH-1.2寸-45x40L',
      modelDirKey: '不锈钢接头/304焊直通/scfh-1.2寸-45x40l',
      isBelowModelDir: false,
    },
  );
});

test('keeps second folder as model folder when known category has no matching child', () => {
  assert.deepEqual(
    structuredArchivePath('不锈钢接头/普通直通/SCFH-1.2寸-45x40L.STEP', {
      isKnownSubcategory: () => false,
    }),
    {
      categoryName: '不锈钢接头',
      subcategoryName: null,
      modelName: '普通直通',
      modelDirKey: '不锈钢接头/普通直通',
      isBelowModelDir: false,
    },
  );
});

test('keeps model folder when it contains internal asset folders', () => {
  assert.deepEqual(structuredArchivePath('钢管/镀锌钢管_1.2寸-80mm/STEP/镀锌钢管_1.2寸-80mm.STEP'), {
    categoryName: '钢管',
    subcategoryName: null,
    modelName: '镀锌钢管_1.2寸-80mm',
    modelDirKey: '钢管/镀锌钢管_1.2寸-80mm',
    isBelowModelDir: true,
  });
});

test('ignores arbitrary folders inside a model folder', () => {
  assert.deepEqual(structuredArchivePath('钢管/普通直通/客户资料/SCFH-1.2寸-45x40L.STEP'), {
    categoryName: '钢管',
    subcategoryName: null,
    modelName: '普通直通',
    modelDirKey: '钢管/普通直通',
    isBelowModelDir: true,
  });
});

test('keeps non-matching known child segment as model folder even when nested', () => {
  assert.deepEqual(
    structuredArchivePath('不锈钢接头/普通直通/客户资料/SCFH-1.2寸-45x40L.STEP', {
      isKnownSubcategory: () => false,
    }),
    {
      categoryName: '不锈钢接头',
      subcategoryName: null,
      modelName: '普通直通',
      modelDirKey: '不锈钢接头/普通直通',
      isBelowModelDir: true,
    },
  );
});

test('keeps known subcategory and ignores internal folders below model folder', () => {
  assert.deepEqual(
    structuredArchivePath('不锈钢接头/304焊直通/不锈钢焊直通(双头内丝)_SCFH-1.2寸-45x40L/STEP/SCFH-1.2寸-45x40L.STEP', {
      isKnownSubcategory: () => true,
    }),
    {
      categoryName: '不锈钢接头',
      subcategoryName: '304焊直通',
      modelName: '不锈钢焊直通(双头内丝)_SCFH-1.2寸-45x40L',
      modelDirKey: '不锈钢接头/304焊直通/不锈钢焊直通(双头内丝)_scfh-1.2寸-45x40l',
      isBelowModelDir: true,
    },
  );
});

test('decodes GBK encoded zip entry names before path parsing', () => {
  const gbkName = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x2f, 0xb2, 0xe2, 0xca, 0xd4, 0x2e, 0x53, 0x54, 0x45, 0x50]);
  const decoded = decodeZipEntryNameForUpload({
    entryName: gbkName.toString('utf8'),
    rawEntryName: gbkName,
  });
  assert.equal(decoded, '中文/测试.STEP');
});

test('EFS flag (UTF-8 names) wins over GBK heuristic scoring', () => {
  // Python/macOS 打的中文 ZIP 设 EFS 位且文件名为 UTF-8。此前启发式打分会把 UTF-8 字节
  // 按 GBK 解出更多乱码汉字（仍在 CJK 计分区）导致得分反超，正确名被乱码覆盖。
  const utf8Name = Buffer.from('气动接头/SP-6.STEP', 'utf8');
  const decoded = decodeZipEntryNameForUpload({
    entryName: utf8Name.toString('utf8'),
    rawEntryName: utf8Name,
    header: { flags: 0x800 },
  });
  assert.equal(decoded, '气动接头/SP-6.STEP');
});

test('keeps UTF-8 encoded zip entry names unchanged', () => {
  const entryName = '不锈钢接头/304焊直通/SCFH-1.2寸-45x40L.STEP';
  const decoded = decodeZipEntryNameForUpload({
    entryName,
    rawEntryName: Buffer.from(entryName, 'utf-8'),
  });
  assert.equal(decoded, entryName);
});

test('repairs mojibake archive paths such as legacy RAR header names', async () => {
  const { normalizeBatchArchiveEntryName } = await import('./archivePath.js');
  assert.equal(normalizeBatchArchiveEntryName('ÖÐÎÄ\\²âÊÔ.STEP'), '中文/测试.STEP');
  assert.deepEqual(structuredArchivePath('ÖÐÎÄ/²âÊÔ.STEP'), {
    categoryName: '中文',
    subcategoryName: null,
    modelName: '测试',
    modelDirKey: '中文/测试',
    isBelowModelDir: false,
  });
});

// ---- isBelowModelDir：零件目录子文件夹嵌套判定（批量上传「零件目录优先」规则依据） ----

test('marks revision subfolder below model folder as nested (no subcategory)', () => {
  const result = structuredArchivePath('环喷/电镀圆形环喷_KTHP-8出-160内径/2023-11-24更新/KTHP-8出-160内径.STEP');
  assert.equal(result?.isBelowModelDir, true);
  assert.equal(result?.modelName, '电镀圆形环喷_KTHP-8出-160内径');
});

test('marks accessory-combo subfolder below model folder as nested (with subcategory)', () => {
  const result = structuredArchivePath(
    '不锈钢接头/环喷/电镀圆形环喷_KTHP-8出-160内径/含喷嘴/KTHP-8出-160内径+JCW-1_8-4-70L.STEP',
    { isKnownSubcategory: () => true },
  );
  assert.equal(result?.isBelowModelDir, true);
  assert.equal(result?.modelName, '电镀圆形环喷_KTHP-8出-160内径');
});

test('direct file under model folder is not nested regardless of category shape', () => {
  // 无子分类：分类/零件目录/文件
  assert.equal(
    structuredArchivePath('环喷/电镀圆形环喷_KTHP-8出-160内径/KTHP-8出-160内径.STEP')?.isBelowModelDir,
    false,
  );
  // 有子分类：分类/子分类/零件目录/文件
  assert.equal(
    structuredArchivePath('不锈钢接头/环喷/电镀圆形环喷_KTHP-8出-160内径/KTHP-8出-160内径.STEP', {
      isKnownSubcategory: () => true,
    })?.isBelowModelDir,
    false,
  );
});

test('file directly under category or subcategory is never nested', () => {
  // 分类/文件（无零件目录）
  assert.equal(structuredArchivePath('不锈钢接头/SCFH-1.2寸-45x40L.STEP')?.isBelowModelDir, false);
  // 分类/子分类/文件（无零件目录，子分类被已知分类表识别）
  assert.equal(
    structuredArchivePath('不锈钢接头/304焊直通/SCFH-1.2寸-45x40L.STEP', {
      isKnownSubcategory: () => true,
    })?.isBelowModelDir,
    false,
  );
});
