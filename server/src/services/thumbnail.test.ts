import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { generateThumbnail } = await import('./thumbnail.js');

test('generateThumbnail writes a placeholder by default when the preview asset is invalid', () => {
  const root = mkdtempSync(join(tmpdir(), 'thumbnail-test-'));
  try {
    const invalidGlb = join(root, 'invalid.glb');
    const outputDir = join(root, 'thumbs');
    writeFileSync(invalidGlb, 'not a glb');

    const result = generateThumbnail(invalidGlb, outputDir, 'placeholder-model');

    assert.ok(existsSync(result.thumbnailPath));
    assert.ok(existsSync(join(outputDir, 'placeholder-model_sm.jpg')));
    assert.equal(result.thumbnailUrl, '/static/thumbnails/placeholder-model.jpg');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('generateThumbnail can reject invalid preview assets without overwriting a thumbnail', () => {
  const root = mkdtempSync(join(tmpdir(), 'thumbnail-test-'));
  try {
    const invalidGlb = join(root, 'invalid.glb');
    const outputDir = join(root, 'thumbs');
    writeFileSync(invalidGlb, 'not a glb');

    assert.throws(() => {
      generateThumbnail(invalidGlb, outputDir, 'keep-existing-model', 512, 512, { fallbackToPlaceholder: false });
    }, /Invalid GLB header/);
    assert.equal(existsSync(join(outputDir, 'keep-existing-model.jpg')), false);
    assert.equal(existsSync(join(outputDir, 'keep-existing-model_sm.jpg')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
