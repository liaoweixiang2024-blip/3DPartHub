import assert from 'node:assert/strict';
import test from 'node:test';

const { clearActiveModelDownloadLocksForTest, hasActiveModelDownload, trackActiveModelDownload } =
  await import('./activeModelDownloads.js');

test('tracks and releases active model downloads', () => {
  clearActiveModelDownloadLocksForTest();

  const releaseOne = trackActiveModelDownload('model-a');
  const releaseTwo = trackActiveModelDownload('model-a');

  assert.equal(hasActiveModelDownload('model-a'), true);
  assert.equal(hasActiveModelDownload('model-b'), false);

  releaseOne();
  assert.equal(hasActiveModelDownload('model-a'), true);

  releaseTwo();
  assert.equal(hasActiveModelDownload('model-a'), false);
});

test('release is idempotent', () => {
  clearActiveModelDownloadLocksForTest();

  const release = trackActiveModelDownload('model-c');
  release();
  release();

  assert.equal(hasActiveModelDownload('model-c'), false);
});
