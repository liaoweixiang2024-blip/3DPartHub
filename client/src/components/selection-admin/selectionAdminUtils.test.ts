import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  parseGenerateEntries,
  renderGenerateTemplate,
  renderModelTemplate,
  buildGeneratedProductDrafts,
} from './selectionAdminUtils';
import type { ColumnDef } from '../../api/selections';

const columns: ColumnDef[] = [
  { key: '型号', label: '型号', unit: '' },
  { key: '枪体类型', label: '枪体类型', unit: '' },
  { key: '配管长度', label: '配管长度', unit: '' },
  { key: '球阀开关', label: '球阀开关', unit: '' },
  { key: '外螺纹接头', label: '外螺纹接头', unit: '' },
];

describe('parseGenerateEntries', () => {
  it('纯值（无竖线）时 code=value，行为与旧语法一致', () => {
    assert.deepEqual(parseGenerateEntries('SQB\nSQF, SQG'), [
      { value: 'SQB', code: 'SQB' },
      { value: 'SQF', code: 'SQF' },
      { value: 'SQG', code: 'SQG' },
    ]);
  });

  it('代码|显示名：value 存显示名，code 存型号代码', () => {
    assert.deepEqual(parseGenerateEntries('02|2分 (1/4)\n03|3分 (3/8)'), [
      { value: '2分 (1/4)', code: '02' },
      { value: '3分 (3/8)', code: '03' },
    ]);
  });

  it('竖线前留空 = 代码为空（型号里不出现该段）', () => {
    assert.deepEqual(parseGenerateEntries('|无球阀开关'), [{ value: '无球阀开关', code: '' }]);
  });

  it('按显示名去重；竖线后为空的行跳过；显示名可含竖线（第一段之后全算显示名）', () => {
    assert.deepEqual(parseGenerateEntries('4M\n4M\n02|\nA|B|C'), [
      { value: '4M', code: '4M' },
      { value: 'B|C', code: 'A' },
    ]);
  });
});

describe('renderModelTemplate', () => {
  it('代码齐全时直接替换，不动字面分隔符', () => {
    assert.equal(
      renderModelTemplate('[枪体类型]-PAU1208-[配管长度]-[外螺纹接头]', {
        枪体类型: 'SQB',
        配管长度: '6M',
        外螺纹接头: '02',
      }),
      'SQB-PAU1208-6M-02',
    );
  });

  it('某段代码为空时收缩连续分隔符（球阀「无」不进型号）', () => {
    assert.equal(
      renderModelTemplate('[枪体类型]-PAU1208-[配管长度]-[球阀开关]-[外螺纹接头]', {
        枪体类型: 'SQB',
        配管长度: '4M',
        球阀开关: '',
        外螺纹接头: '02',
      }),
      'SQB-PAU1208-4M-02',
    );
    assert.equal(
      renderModelTemplate('[枪体类型]-PAU1208-[配管长度]-[球阀开关]-[外螺纹接头]', {
        枪体类型: 'SQB',
        配管长度: '4M',
        球阀开关: 'MK',
        外螺纹接头: '02',
      }),
      'SQB-PAU1208-4M-MK-02',
    );
  });

  it('空代码段在首尾时裁掉多余分隔符', () => {
    assert.equal(renderModelTemplate('[球阀开关]-[配管长度]', { 球阀开关: '', 配管长度: '4M' }), '4M');
    assert.equal(renderModelTemplate('[配管长度]-[球阀开关]', { 球阀开关: '', 配管长度: '4M' }), '4M');
  });

  it('没有空段时不收缩字面连续横线（避免破坏故意写的分隔符）', () => {
    assert.equal(renderModelTemplate('A--B-[配管长度]', { 配管长度: '4M' }), 'A--B-4M');
  });
});

describe('buildGeneratedProductDrafts（代码|显示名）', () => {
  it('水枪场景：型号用代码、参数存显示名（SQB-PAU1208-6M-02）', () => {
    const drafts = buildGeneratedProductDrafts({
      columns,
      optionTexts: {
        枪体类型: 'SQB',
        配管长度: '6M',
        球阀开关: '|无球阀开关\nMK|有球阀开关',
        外螺纹接头: '02|2分 (1/4)',
      },
      modelTemplate: '[枪体类型]-PAU1208-[配管长度]-[球阀开关]-[外螺纹接头]',
      nameTemplate: '',
      excludeRules: '',
    });
    assert.deepEqual(
      drafts.map((d) => d.modelNo),
      ['SQB-PAU1208-6M-02', 'SQB-PAU1208-6M-MK-02'],
    );
    assert.equal(drafts[0].specs['外螺纹接头'], '2分 (1/4)');
    assert.equal(drafts[0].specs['球阀开关'], '无球阀开关');
    assert.equal(drafts[1].specs['球阀开关'], '有球阀开关');
    // 名称模板兜底用型号；名称模板引用字段时用显示名
    assert.equal(drafts[0].name, 'SQB-PAU1208-6M-02');
  });

  it('名称模板引用字段时替换显示名（不是代码）', () => {
    const drafts = buildGeneratedProductDrafts({
      columns,
      optionTexts: { 外螺纹接头: '02|2分 (1/4)' },
      modelTemplate: '[外螺纹接头]',
      nameTemplate: '水枪 [外螺纹接头]',
      excludeRules: '',
    });
    assert.equal(drafts[0].name, '水枪 2分 (1/4)');
    assert.equal(drafts[0].modelNo, '02');
  });

  it('排除规则按显示名匹配（与 specs 一致）', () => {
    const drafts = buildGeneratedProductDrafts({
      columns,
      optionTexts: {
        球阀开关: '|无球阀开关\nMK|有球阀开关',
        外螺纹接头: '02|2分 (1/4)\n03|3分 (3/8)',
      },
      modelTemplate: '[球阀开关]-[外螺纹接头]',
      nameTemplate: '',
      excludeRules: '球阀开关=无球阀开关 && 外螺纹接头=3分 (3/8)',
    });
    assert.deepEqual(
      drafts.map((d) => d.modelNo),
      ['02', 'MK-02', 'MK-03'],
    );
  });

  it('旧语法（纯值）行为不变', () => {
    const drafts = buildGeneratedProductDrafts({
      columns,
      optionTexts: { 枪体类型: 'SQB', 配管长度: '4M\n6M' },
      modelTemplate: '[枪体类型]-[配管长度]',
      nameTemplate: '',
      excludeRules: '',
    });
    assert.deepEqual(
      drafts.map((d) => d.modelNo),
      ['SQB-4M', 'SQB-6M'],
    );
  });
});

describe('renderGenerateTemplate（名称模板仍用显示名）', () => {
  it('替换 specs 值', () => {
    assert.equal(renderGenerateTemplate('水枪 [外螺纹接头]', { 外螺纹接头: '2分 (1/4)' }), '水枪 2分 (1/4)');
  });
});
