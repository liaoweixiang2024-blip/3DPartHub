import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const {
  buildBackupPolicyReport,
  encryptBackupArchiveInPlace,
  evictCompleted,
  isEncryptedBackupArchiveFile,
  isUnsafeBackupArchiveVerboseEntry,
  isUnsafeBackupArchiveEntry,
  materializeReadableBackupArchive,
  MODULE_BACKUP_TABLE_KEYS,
  normalizeBackupArchiveEntryList,
} = await import('./backup.js');

function makeJob(stage: string, updatedAt?: number) {
  return { stage, updatedAt };
}

test('evictCompleted removes done jobs older than 1 hour', () => {
  const map = new Map<string, { stage: string; updatedAt?: number }>();
  const oneHourAgo = Date.now() - 61 * 60 * 1000;
  map.set('old-done', makeJob('done', oneHourAgo));
  map.set('old-error', makeJob('error', oneHourAgo));
  map.set('recent-done', makeJob('done', Date.now() - 1000));
  map.set('running', makeJob('running', oneHourAgo));

  evictCompleted(map);

  assert.equal(map.has('old-done'), false);
  assert.equal(map.has('old-error'), false);
  assert.equal(map.has('recent-done'), true);
  assert.equal(map.has('running'), true);
});

test('evictCompleted keeps jobs without updatedAt timestamp if old', () => {
  const map = new Map<string, { stage: string; updatedAt?: number }>();
  map.set('no-timestamp-done', makeJob('done'));
  map.set('no-timestamp-running', makeJob('running'));

  evictCompleted(map);

  assert.equal(map.has('no-timestamp-done'), false);
  assert.equal(map.has('no-timestamp-running'), true);
});

test('evictCompleted keeps recently completed jobs', () => {
  const map = new Map<string, { stage: string; updatedAt?: number }>();
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  map.set('recent', makeJob('done', fiveMinAgo));

  evictCompleted(map);

  assert.equal(map.has('recent'), true);
});

test('evictCompleted handles empty map', () => {
  const map = new Map<string, { stage: string; updatedAt?: number }>();
  evictCompleted(map);
  assert.equal(map.size, 0);
});

test('evictCompleted handles map with only active jobs', () => {
  const map = new Map<string, { stage: string; updatedAt?: number }>();
  map.set('a', makeJob('uploading'));
  map.set('b', makeJob('packaging'));

  evictCompleted(map);

  assert.equal(map.size, 2);
});

test('backup archive entries reject unsafe paths before restore', () => {
  assert.equal(isUnsafeBackupArchiveEntry('../database.sql'), true);
  assert.equal(isUnsafeBackupArchiveEntry('_backup_db/../../database.sql'), true);
  assert.equal(isUnsafeBackupArchiveEntry('/tmp/database.sql'), true);
  assert.equal(isUnsafeBackupArchiveEntry('C:/tmp/database.sql'), true);
  assert.equal(isUnsafeBackupArchiveEntry('C:\\tmp\\database.sql'), true);
  assert.equal(isUnsafeBackupArchiveEntry('_backup_db/\0/database.sql'), true);
  assert.equal(isUnsafeBackupArchiveEntry('_backup_db/database.sql'), false);
  assert.equal(isUnsafeBackupArchiveEntry('./originals/model.step'), false);
});

test('backup archive verbose entries reject links and special files before extraction', () => {
  assert.equal(isUnsafeBackupArchiveVerboseEntry('-rw-r--r-- root/root 12 2026-05-23 _backup_db/database.sql'), false);
  assert.equal(isUnsafeBackupArchiveVerboseEntry('drwxr-xr-x root/root 0 2026-05-23 originals/'), false);
  assert.equal(isUnsafeBackupArchiveVerboseEntry('lrwxrwxrwx root/root 0 2026-05-23 originals/link -> /etc'), true);
  assert.equal(
    isUnsafeBackupArchiveVerboseEntry('hrw-r--r-- root/root 0 2026-05-23 originals/hard link to file'),
    true,
  );
  assert.equal(isUnsafeBackupArchiveVerboseEntry('crw-r--r-- root/root 0 2026-05-23 originals/device'), true);
  assert.equal(isUnsafeBackupArchiveVerboseEntry(''), false);
});

test('backup archive entry list normalizes lines and removes blank entries', () => {
  assert.deepEqual(
    normalizeBackupArchiveEntryList(
      [
        './_backup_db/database.sql',
        '',
        './originals/model.step',
        './_backup_db/manifest.json',
        './_backup_db/meta.json',
        '   ./uploads/files/model.pdf   ',
      ].join('\n'),
    ),
    [
      '_backup_db/database.sql',
      'originals/model.step',
      '_backup_db/manifest.json',
      '_backup_db/meta.json',
      'uploads/files/model.pdf',
    ],
  );
});

test('module backups include user-facing dependent records', () => {
  assert.deepEqual(MODULE_BACKUP_TABLE_KEYS.models, [
    'categories',
    'modelGroups',
    'models',
    'modelVersions',
    'favorites',
    'downloads',
    'comments',
    'shareLinks',
  ]);
  assert.deepEqual(MODULE_BACKUP_TABLE_KEYS.selection, [
    'selectionCategories',
    'selectionProducts',
    'threadSizeEntries',
    'selectionShares',
  ]);
  assert.deepEqual(MODULE_BACKUP_TABLE_KEYS.product_wall, [
    'productWallCategories',
    'productWallImages',
    'productWallImageFavorites',
  ]);
  assert.deepEqual(MODULE_BACKUP_TABLE_KEYS.config, ['settings', 'categories']);
});

test('backup policy report summarizes blockers and next actions', () => {
  const report = buildBackupPolicyReport([
    { key: 'local_dir', label: '本地备份目录可写', status: 'error', message: '目录不可写' },
    { key: 'mirror', label: '外部镜像备份', status: 'warning', message: '未开启' },
    { key: 'latest_backup', label: '最近备份可用性', status: 'ok', message: '校验通过' },
  ]);

  assert.equal(report.riskLevel, 'high');
  assert.equal(report.blockers.length, 1);
  assert.equal(report.warnings.length, 1);
  assert.match(report.summary, /阻断风险/);
  assert.equal(report.nextActions[0], '本地备份目录可写失败，请检查目录挂载和读写权限。');
});

test('backup policy report returns low risk when all checks pass', () => {
  const report = buildBackupPolicyReport([
    { key: 'latest_backup', label: '最近备份可用性', status: 'ok', message: '校验通过' },
    { key: 'schedule', label: '自动备份计划', status: 'ok', message: '已开启' },
  ]);

  assert.equal(report.riskLevel, 'low');
  assert.equal(report.blockers.length, 0);
  assert.equal(report.warnings.length, 0);
  assert.match(report.summary, /体检通过/);
  assert.equal(report.nextActions.length, 1);
});

test('backup encryption stores archive bytes encrypted and materializes readable copy', async () => {
  const previousSecret = process.env.BACKUP_ENCRYPTION_SECRET;
  const dir = mkdtempSync(join(tmpdir(), '3dparthub-backup-enc-'));
  try {
    process.env.BACKUP_ENCRYPTION_SECRET = 'unit-test-backup-encryption-secret';
    const archive = join(dir, 'sample.tar.gz');
    const readableCopyDir = join(dir, 'readable');
    const plainText = 'plain backup archive payload';
    writeFileSync(archive, plainText);

    assert.equal(await encryptBackupArchiveInPlace(archive), true);
    assert.equal(isEncryptedBackupArchiveFile(archive), true);
    assert.equal(readFileSync(archive, 'utf-8').includes(plainText), false);

    const readableArchive = await materializeReadableBackupArchive(archive, readableCopyDir);
    assert.equal(readFileSync(readableArchive, 'utf-8'), plainText);
  } finally {
    if (previousSecret === undefined) delete process.env.BACKUP_ENCRYPTION_SECRET;
    else process.env.BACKUP_ENCRYPTION_SECRET = previousSecret;
    rmSync(dir, { recursive: true, force: true });
  }
});
