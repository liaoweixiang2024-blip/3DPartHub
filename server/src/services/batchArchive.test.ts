import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAttachExternalGltfBin, shouldDownloadOriginalBatchFormat } from './batchArchive.js';

test('batch favorites treats step/original/unknown formats as original downloads', () => {
  assert.equal(shouldDownloadOriginalBatchFormat(), true);
  assert.equal(shouldDownloadOriginalBatchFormat('original'), true);
  assert.equal(shouldDownloadOriginalBatchFormat('step'), true);
  assert.equal(shouldDownloadOriginalBatchFormat('.STEP'), true);
  assert.equal(shouldDownloadOriginalBatchFormat('binary'), true);
});

test('batch favorites only treats explicit preview formats as preview downloads', () => {
  assert.equal(shouldDownloadOriginalBatchFormat('preview'), false);
  assert.equal(shouldDownloadOriginalBatchFormat('gltf'), false);
  assert.equal(shouldDownloadOriginalBatchFormat('.glb'), false);
});

test('batch archive does not add gltf bin beside a step-named original file', () => {
  assert.equal(
    shouldAttachExternalGltfBin({
      filePath: '/tmp/TKN-PLF12-03.gltf',
      fileName: 'TKN-PLF12-03.step',
      binPath: '/tmp/TKN-PLF12-03.bin',
    }),
    false,
  );
});

test('batch archive adds gltf bin only for a gltf archive entry', () => {
  assert.equal(
    shouldAttachExternalGltfBin({
      filePath: '/tmp/TKN-PLF12-03.gltf',
      fileName: 'TKN-PLF12-03.gltf',
      binPath: '/tmp/TKN-PLF12-03.bin',
    }),
    true,
  );
  assert.equal(
    shouldAttachExternalGltfBin({
      filePath: '/tmp/TKN-PLF12-03.glb',
      fileName: 'TKN-PLF12-03.glb',
      binPath: '/tmp/TKN-PLF12-03.bin',
    }),
    false,
  );
});
