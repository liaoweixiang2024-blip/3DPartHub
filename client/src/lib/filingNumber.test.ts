import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildPoliceFilingUrl } from './filingNumber';

describe('buildPoliceFilingUrl', () => {
  it('标准公安备案号（含 14 位数字）生成查询链接，剥离汉字与“号”字', () => {
    assert.equal(
      buildPoliceFilingUrl('京公网安备 11010102000101号'),
      'https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=11010102000101',
    );
  });

  it('保留超过 14 位的全部数字（不截断）', () => {
    assert.equal(
      buildPoliceFilingUrl('沪公网安备 3101010200010199'),
      'https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=3101010200010199',
    );
  });

  it('数字不足 14 位时返回空串（降级为纯文本、不可点）', () => {
    assert.equal(buildPoliceFilingUrl('京公网安备 110号'), '');
    assert.equal(buildPoliceFilingUrl('1234567890'), '');
  });

  it('恰为 14 位纯数字时生成链接（边界）', () => {
    assert.equal(
      buildPoliceFilingUrl('11010102000101'),
      'https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=11010102000101',
    );
  });

  it('无任何数字时返回空串', () => {
    assert.equal(buildPoliceFilingUrl('京公网安备号'), '');
  });

  it('剥离所有非数字字符（空格、连字符、字母、标点）', () => {
    assert.equal(
      buildPoliceFilingUrl('  京公网安备 110-1010-2000-101 号 '),
      'https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=11010102000101',
    );
  });

  it('空串 / null / undefined 安全，返回空串', () => {
    assert.equal(buildPoliceFilingUrl(''), '');
    assert.equal(buildPoliceFilingUrl(null), '');
    assert.equal(buildPoliceFilingUrl(undefined), '');
  });
});
