import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { normalizeUploadFileName, resolveUploadPathInsideRoot } from './uploadPath.js';

test('normalizeUploadFileName rejects traversal and path separators', () => {
  assert.equal(normalizeUploadFileName('model.step'), 'model.step');
  assert.equal(normalizeUploadFileName('  model.step  '), 'model.step');
  assert.equal(normalizeUploadFileName('../model.step'), null);
  assert.equal(normalizeUploadFileName('C:relative.step'), null);
  assert.equal(normalizeUploadFileName('nested/model.step'), null);
  assert.equal(normalizeUploadFileName('nested\\model.step'), null);
  assert.equal(normalizeUploadFileName('.'), null);
  assert.equal(normalizeUploadFileName('..'), null);
  assert.equal(normalizeUploadFileName('model\0.step'), null);
});

test('resolveUploadPathInsideRoot keeps merged files inside upload root', () => {
  const root = join(tmpdir(), '3dparthub-upload-root');
  assert.equal(resolveUploadPathInsideRoot(root, 'upload_1.step'), resolve(root, 'upload_1.step'));
  assert.equal(resolveUploadPathInsideRoot(root, '../upload_1.step'), null);
  assert.equal(resolveUploadPathInsideRoot(root, '/tmp/upload_1.step'), null);
  assert.equal(resolveUploadPathInsideRoot(root, 'nested/upload_1.step'), null);
});
