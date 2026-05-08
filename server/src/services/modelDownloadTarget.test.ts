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

test('uses model number suffix after underscore for DB download filenames', () => {
  const uploadPath = join(root, 'uploads', 'elbow.step');
  mkdirSync(join(root, 'uploads'), { recursive: true });
  writeFileSync(uploadPath, 'step');

  const target = resolveDbModelDownloadTarget(
    {
      id: 'elbow',
      name: '不锈钢弯宝塔_SLH-1寸x19',
      originalName: '不锈钢弯宝塔_SLH-1寸x19.step',
      format: 'step',
      originalFormat: 'step',
      uploadPath,
      originalSize: 123,
    },
    'original',
  );

  assert.equal(target?.fileName, 'SLH-1寸x19.step');
});

test('uses model folder title while downloading actual model file name for structured archive uploads', () => {
  const uploadPath = join(root, 'uploads', 'structured.step');
  mkdirSync(join(root, 'uploads'), { recursive: true });
  writeFileSync(uploadPath, 'step');

  const target = resolveDbModelDownloadTarget(
    {
      id: 'structured',
      name: '不锈钢弯宝塔_SLH-1寸x19',
      originalName: 'SLH-1寸x19.STEP',
      format: 'step',
      originalFormat: 'step',
      uploadPath,
      originalSize: 123,
    },
    'original',
  );

  assert.equal(target?.fileName, 'SLH-1寸x19.step');
});

test('keeps underscores inside model numbers when deriving download filenames', () => {
  const uploadPath = join(root, 'uploads', 'structured-sbu.step');
  mkdirSync(join(root, 'uploads'), { recursive: true });
  writeFileSync(uploadPath, 'step');

  const target = resolveDbModelDownloadTarget(
    {
      id: 'structured-sbu',
      name: '不锈钢补心_SBU-3_4x1_4',
      originalName: 'SBU-3_4x1_4.STEP',
      format: 'step',
      originalFormat: 'step',
      uploadPath,
      originalSize: 123,
    },
    'original',
  );

  assert.equal(target?.fileName, 'SBU-3_4x1_4.step');
});

test('uses original filename extension instead of generic binary format', () => {
  const uploadPath = join(root, 'uploads', 'multer-random-source');
  mkdirSync(join(root, 'uploads'), { recursive: true });
  writeFileSync(uploadPath, 'step');

  const target = resolveDbModelDownloadTarget(
    {
      id: 'binary-format',
      name: 'Binary Format',
      originalName: 'Binary Format.STEP',
      format: 'binary',
      originalFormat: 'binary',
      uploadPath,
      originalSize: 123,
    },
    'original',
  );

  assert.equal(target?.fileName, 'Binary Format.step');
  assert.equal(target?.record?.format, 'step');
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

test('metadata original target ignores generic binary format when original name has an extension', () => {
  const originalPath = join(root, 'uploads', 'legacy-binary-upload');
  mkdirSync(join(root, 'uploads'), { recursive: true });
  writeFileSync(originalPath, 'step');

  const target = resolveMetadataModelDownloadTarget(
    'legacy-binary-upload',
    {
      upload_path: originalPath,
      original_name: 'Legacy Binary.stp',
      format: 'binary',
    },
    'original',
  );

  assert.equal(target?.filePath, originalPath);
  assert.equal(target?.fileName, 'Legacy Binary.stp');
});
