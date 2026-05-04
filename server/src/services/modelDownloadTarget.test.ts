import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-secret';

const root = mkdtempSync(join(tmpdir(), 'model-download-target-test-'));
process.env.STATIC_DIR = join(root, 'static');
process.env.UPLOAD_DIR = join(root, 'uploads');

const { resolveDbModelDownloadTarget, resolveMetadataModelDownloadTarget } = await import('./modelDownloadTarget.js');

test.after(() => {
  rmSync(root, { recursive: true, force: true });
});

test('resolves original DB model download target', () => {
  const uploadPath = join(root, 'uploads', 'pump.step');
  mkdirSync(join(root, 'uploads'), { recursive: true });
  writeFileSync(uploadPath, 'step');

  const target = resolveDbModelDownloadTarget(
    {
      id: 'pump',
      name: 'Pump',
      originalName: 'pump-source.step',
      format: 'step',
      originalFormat: 'step',
      uploadPath,
      originalSize: 123,
    },
    'original',
  );

  assert.equal(target?.filePath, uploadPath);
  assert.equal(target?.fileName, 'Pump.step');
  assert.deepEqual(target?.record, { modelId: 'pump', format: 'step', fileSize: 123 });
});

test('resolves preview DB model download target when original is not requested', () => {
  const previewPath = join(process.env.STATIC_DIR!, 'models', 'pump.glb');
  mkdirSync(join(process.env.STATIC_DIR!, 'models'), { recursive: true });
  writeFileSync(previewPath, 'glb');

  const target = resolveDbModelDownloadTarget({
    id: 'pump',
    name: 'Pump',
    originalName: 'pump-source.step',
    format: 'step',
    gltfUrl: '/static/models/pump.glb',
    gltfSize: 456,
  });

  assert.equal(target?.filePath, previewPath);
  assert.equal(target?.fileName, 'Pump.glb');
  assert.deepEqual(target?.record, { modelId: 'pump', format: 'glb', fileSize: 456 });
});

test('falls back to preview target if original DB file is missing', () => {
  const previewPath = join(process.env.STATIC_DIR!, 'models', 'fallback.glb');
  mkdirSync(join(process.env.STATIC_DIR!, 'models'), { recursive: true });
  writeFileSync(previewPath, 'glb');

  const target = resolveDbModelDownloadTarget(
    {
      id: 'fallback',
      name: 'Fallback',
      format: 'step',
      uploadPath: join(root, 'missing.step'),
      gltfUrl: '/static/models/fallback.glb',
    },
    'original',
  );

  assert.equal(target?.filePath, previewPath);
  assert.equal(target?.fileName, 'Fallback.glb');
});

test('resolves metadata original and preview targets', () => {
  const originalPath = join(root, 'uploads', 'meta.step');
  const previewPath = join(process.env.STATIC_DIR!, 'models', 'meta.glb');
  mkdirSync(join(root, 'uploads'), { recursive: true });
  mkdirSync(join(process.env.STATIC_DIR!, 'models'), { recursive: true });
  writeFileSync(originalPath, 'step');
  writeFileSync(previewPath, 'glb');

  const meta = {
    upload_path: originalPath,
    original_name: 'meta.step',
    format: 'step',
    gltf_url: '/static/models/meta.glb',
  };

  const original = resolveMetadataModelDownloadTarget('meta', meta, 'original');
  const preview = resolveMetadataModelDownloadTarget('meta', meta);

  assert.equal(original?.filePath, originalPath);
  assert.equal(original?.fileName, 'meta.step');
  assert.equal(preview?.filePath, previewPath);
  assert.equal(preview?.fileName, 'meta.glb');
});
