import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-secret';

const root = mkdtempSync(join(tmpdir(), 'model-files-test-'));
process.env.STATIC_DIR = join(root, 'static');
process.env.UPLOAD_DIR = join(root, 'uploads');

const {
  findOriginalModelPath,
  isDeprecatedHtmlPreviewFormat,
  modelManagedFilePaths,
  normalizeModelFormat,
  removeExistingFiles,
  removeModelFiles,
  resolveStoredPath,
} = await import('./modelFiles.js');

test.after(() => {
  rmSync(root, { recursive: true, force: true });
});

test('normalizes model formats consistently', () => {
  assert.equal(normalizeModelFormat('.STEP'), 'step');
  assert.equal(normalizeModelFormat(' x_t '), 'x_t');
  assert.equal(normalizeModelFormat(null), '');
  assert.equal(isDeprecatedHtmlPreviewFormat('HTML'), true);
  assert.equal(isDeprecatedHtmlPreviewFormat('step'), false);
});

test('resolves stored paths only inside managed model directories', () => {
  const absolute = join(root, 'uploads', 'part.step');
  assert.equal(resolveStoredPath(absolute), absolute);
  assert.equal(resolveStoredPath('uploads/part.step'), join(process.cwd(), 'uploads/part.step'));
  assert.equal(resolveStoredPath(join(root, 'outside', 'secret.step')), null);
  assert.equal(resolveStoredPath(null), null);
});

test('finds upload path before static original fallback', () => {
  const uploadPath = join(root, 'uploads', 'abc.step');
  const fallbackPath = join(process.env.STATIC_DIR!, 'originals', 'abc.step');
  mkdirSync(join(root, 'uploads'), { recursive: true });
  mkdirSync(join(process.env.STATIC_DIR!, 'originals'), { recursive: true });
  writeFileSync(uploadPath, 'upload');
  writeFileSync(fallbackPath, 'fallback');

  assert.equal(findOriginalModelPath({ id: 'abc', format: 'step', uploadPath }), uploadPath);
});

test('falls back to static original by normalized format', () => {
  const fallbackPath = join(process.env.STATIC_DIR!, 'originals', 'fallback.x_t');
  mkdirSync(join(process.env.STATIC_DIR!, 'originals'), { recursive: true });
  writeFileSync(fallbackPath, 'fallback');

  assert.equal(findOriginalModelPath({ id: 'fallback', format: '.X_T' }), fallbackPath);
});

test('builds managed model paths from one source of truth', () => {
  const paths = modelManagedFilePaths({
    id: 'm1',
    format: 'step',
    originalFormat: 'iges',
    uploadPath: join(root, 'uploads', 'm1.step'),
  });
  const relativePaths = paths.map((path) => relative(process.env.STATIC_DIR!, path));

  assert.ok(paths.includes(join(root, 'uploads', 'm1.step')));
  assert.ok(relativePaths.includes('models/m1.glb'));
  assert.ok(relativePaths.includes('models/m1.meta.json'));
  assert.ok(relativePaths.includes('thumbnails/m1.png'));
  assert.ok(relativePaths.includes('originals/m1.step'));
  assert.ok(relativePaths.includes('originals/m1.iges'));
});

test('removeExistingFiles reports removed, skipped, and failed paths', () => {
  const filePath = join(root, 'cleanup', 'file.txt');
  const missingPath = join(root, 'cleanup', 'missing.txt');
  const directoryPath = join(root, 'cleanup', 'dir');
  mkdirSync(directoryPath, { recursive: true });
  writeFileSync(filePath, 'delete me');

  const result = removeExistingFiles([filePath, filePath, missingPath, directoryPath]);

  assert.deepEqual(result.removed, [filePath]);
  assert.deepEqual(result.skipped, [missingPath]);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].path, directoryPath);
});

test('removeModelFiles deletes all managed files it finds', () => {
  const modelId = 'remove-me';
  const uploadPath = join(root, 'uploads', `${modelId}.step`);
  const managedFiles = [
    uploadPath,
    join(process.env.STATIC_DIR!, 'models', `${modelId}.glb`),
    join(process.env.STATIC_DIR!, 'models', `${modelId}.meta.json`),
    join(process.env.STATIC_DIR!, 'thumbnails', `${modelId}.png`),
    join(process.env.STATIC_DIR!, 'originals', `${modelId}.step`),
  ];
  for (const filePath of managedFiles) {
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, 'managed');
  }

  const result = removeModelFiles({ id: modelId, format: 'step', uploadPath });

  assert.equal(result.failed.length, 0);
  for (const filePath of managedFiles) {
    assert.ok(result.removed.includes(filePath));
  }
});
