import assert from 'node:assert/strict';
import test from 'node:test';
import { modelDownloadBaseName, modelDownloadFileName, modelDownloadSourceName } from './modelDownloadName.js';

test('download name equals original filename (SLF-2寸x3_4)', () => {
  // 回归：曾把「寸」字所在前缀误判为分类前缀，下载名截成分数分母「4.step」
  assert.equal(modelDownloadFileName('SLF-2寸x3_4.step', 'step'), 'SLF-2寸x3_4.step');
});

test('download name keeps fraction model codes (JCW-1_4-4-30L)', () => {
  assert.equal(modelDownloadFileName('JCW-1_4-4-30L.STEP', 'step'), 'JCW-1_4-4-30L.step');
});

test('download name keeps Chinese category prefix verbatim (不锈钢快速接头_1寸-A型)', () => {
  // 下载名 = 上传原名（所见即所得），不再剥离分类前缀
  assert.equal(modelDownloadFileName('不锈钢快速接头_1寸-A型.STEP', 'step'), '不锈钢快速接头_1寸-A型.step');
});

test('download name keeps pure-fraction suffix (双向止回式波纹管吸油装置_1_2)', () => {
  assert.equal(modelDownloadFileName('双向止回式波纹管吸油装置_1_2.STEP', 'step'), '双向止回式波纹管吸油装置_1_2.step');
});

test('download name sanitizes illegal path characters', () => {
  assert.equal(modelDownloadFileName('零件:名/含*非法?.step', 'step'), '零件_名_含_非法_.step');
});

test('download name replaces extension with requested format', () => {
  assert.equal(modelDownloadFileName('SLF-2寸x3_4.step', 'glb'), 'SLF-2寸x3_4.glb');
});

test('source name prefers the original filename', () => {
  assert.equal(modelDownloadSourceName('显示名', 'SLF-2寸x3_4.step'), 'SLF-2寸x3_4.step');
});

test('source name falls back to model display name when original missing', () => {
  assert.equal(modelDownloadSourceName('显示名', null), '显示名');
  assert.equal(modelDownloadSourceName(null, null, 'fallback'), 'fallback');
});

test('batch fingerprint still strips Chinese category prefix (upload dedup only)', () => {
  // 分割逻辑仅供批量上传内容指纹，下载路径不再使用
  assert.equal(modelDownloadBaseName('不锈钢快速接头_1寸-A型.STEP', 'model'), '1寸-A型');
});

test('batch fingerprint keeps fraction names intact', () => {
  assert.equal(modelDownloadBaseName('SLF-2寸x3_4.step', 'model'), 'SLF-2寸x3_4');
  assert.equal(modelDownloadBaseName('竹节管主体-POM-1_4.STEP', 'model'), '竹节管主体-POM-1_4');
  assert.equal(modelDownloadBaseName('双向止回式波纹管吸油装置_1_2.STEP', 'model'), '双向止回式波纹管吸油装置_1_2');
});
