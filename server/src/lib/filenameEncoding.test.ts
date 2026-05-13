import assert from 'node:assert/strict';
import test from 'node:test';
import { fixMojibakeText, normalizeCadLabel, normalizeUploadFilename } from './filenameEncoding.js';

test('normalizes mojibake upload filenames', () => {
  assert.equal(normalizeUploadFilename('æµè¯é¶ä»¶.step'), '测试零件.step');
});

test('preserves slash fractions in uploaded model names', () => {
  assert.equal(normalizeUploadFilename('不锈钢内外牙直通_SCFM-1/2.step'), '不锈钢内外牙直通_SCFM-1/2.step');
});

test('strips legacy Windows fake paths from uploaded names', () => {
  assert.equal(normalizeUploadFilename('C:\\fakepath\\pump.step'), 'pump.step');
});

test('repairs common GBK text read as latin1', () => {
  assert.equal(fixMojibakeText('ÖÐÎÄÃû³Æ'), '中文名称');
});

test('decodes STEP unicode escapes in CAD labels', () => {
  assert.equal(normalizeCadLabel('\\X2\\6D4B8BD5\\X0\\'), '测试');
  assert.equal(normalizeCadLabel('Part-\\X4\\00004E2D00006587\\X0\\'), 'Part-中文');
});

test('uses fallback for empty CAD labels', () => {
  assert.equal(normalizeCadLabel('', 'Part 1'), 'Part 1');
});
