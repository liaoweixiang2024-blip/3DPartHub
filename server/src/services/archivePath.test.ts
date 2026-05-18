import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeZipEntryNameForUpload, structuredArchivePath } from './archivePath.js';

test('maps category folder with direct model file to that category', () => {
  assert.deepEqual(structuredArchivePath('不锈钢接头/SCFH-1.2寸-45x40L.STEP'), {
    categoryName: '不锈钢接头',
    subcategoryName: null,
    modelName: 'SCFH-1.2寸-45x40L',
    modelDirKey: '不锈钢接头/scfh-1.2寸-45x40l',
  });
});

test('maps category and subcategory folders when model file is directly under subcategory', () => {
  assert.deepEqual(structuredArchivePath('不锈钢接头/304焊直通/SCFH-1.2寸-45x40L.STEP'), {
    categoryName: '不锈钢接头',
    subcategoryName: '304焊直通',
    modelName: 'SCFH-1.2寸-45x40L',
    modelDirKey: '不锈钢接头/304焊直通/scfh-1.2寸-45x40l',
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
    },
  );
});

test('keeps model folder when it contains internal asset folders', () => {
  assert.deepEqual(structuredArchivePath('钢管/镀锌钢管_1.2寸-80mm/STEP/镀锌钢管_1.2寸-80mm.STEP'), {
    categoryName: '钢管',
    subcategoryName: null,
    modelName: '镀锌钢管_1.2寸-80mm',
    modelDirKey: '钢管/镀锌钢管_1.2寸-80mm',
  });
});

test('ignores arbitrary folders inside a model folder', () => {
  assert.deepEqual(structuredArchivePath('钢管/普通直通/客户资料/SCFH-1.2寸-45x40L.STEP'), {
    categoryName: '钢管',
    subcategoryName: null,
    modelName: '普通直通',
    modelDirKey: '钢管/普通直通',
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

test('keeps UTF-8 encoded zip entry names unchanged', () => {
  const entryName = '不锈钢接头/304焊直通/SCFH-1.2寸-45x40L.STEP';
  const decoded = decodeZipEntryNameForUpload({
    entryName,
    rawEntryName: Buffer.from(entryName, 'utf8'),
  });
  assert.equal(decoded, entryName);
});
