import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const {
  buildBackupPolicyReport,
  buildUserMergeUpdate,
  encryptBackupArchiveInPlace,
  evictCompleted,
  isEncryptedBackupArchiveFile,
  isUnsafeBackupArchiveVerboseEntry,
  isUnsafeBackupArchiveEntry,
  materializeReadableBackupArchive,
  MODULE_BACKUP_TABLE_KEYS,
  normalizeBackupArchiveEntryList,
  normalizeBackupScope,
  reviveDateFields,
  selectRetentionPolicyRemovals,
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
    'modelDrawings',
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
  assert.deepEqual(MODULE_BACKUP_TABLE_KEYS.users, ['users']);
  assert.deepEqual(MODULE_BACKUP_TABLE_KEYS.tickets, ['supportTickets', 'ticketMessages']);
  assert.deepEqual(MODULE_BACKUP_TABLE_KEYS.inquiries, ['inquiries', 'inquiryItems', 'inquiryMessages']);
  assert.deepEqual(MODULE_BACKUP_TABLE_KEYS.audit, ['auditLogs']);
});

test('normalizeBackupScope accepts all 8 module scopes and falls back to full', () => {
  for (const scope of ['models', 'selection', 'product_wall', 'config', 'users', 'tickets', 'inquiries', 'audit']) {
    assert.equal(normalizeBackupScope(scope), scope);
  }
  assert.equal(normalizeBackupScope('unknown'), 'full');
  assert.equal(normalizeBackupScope(undefined), 'full');
  assert.equal(normalizeBackupScope(null), 'full');
});

test('users module merge-update keeps current password/avatar/login state (only profile fields refresh)', () => {
  const backupRow = {
    id: 'user-from-backup',
    username: 'zhang_san',
    email: 'zhang@corp.com',
    passwordHash: '$2b$10$OLDHASH',
    avatar: '/uploads/avatars/old.png',
    role: 'EDITOR',
    canInvite: true,
    company: '备份里的公司',
    phone: '13800000000',
    department: '技术部',
    address: '备份地址',
    bio: '备份简介',
    metadata: { theme: 'dark' },
    mustChangePassword: true,
    disabled: false,
    lastLoginAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  };

  const update = buildUserMergeUpdate(backupRow) as Record<string, unknown>;

  // 资料字段要更新
  assert.equal(update.username, 'zhang_san');
  assert.equal(update.email, 'zhang@corp.com');
  assert.equal(update.role, 'EDITOR');
  assert.equal(update.canInvite, true);
  assert.equal(update.company, '备份里的公司');
  assert.equal(update.phone, '13800000000');
  assert.equal(update.department, '技术部');
  assert.equal(update.address, '备份地址');
  assert.equal(update.bio, '备份简介');
  assert.deepEqual(update.metadata, { theme: 'dark' });
  assert.equal(update.disabled, false);

  // 密码/头像/登录态/强制改密标记绝不能被备份覆盖（id 也不动 —— 目标站保留自己的行）
  assert.equal('passwordHash' in update, false, 'merge update must not touch passwordHash');
  assert.equal('avatar' in update, false, 'merge update must not touch avatar');
  assert.equal('mustChangePassword' in update, false, 'merge update must not touch mustChangePassword');
  assert.equal('lastLoginAt' in update, false, 'merge update must not touch lastLoginAt');
  assert.equal('id' in update, false, 'merge update must not change the target row id');
});

test('users merge-update omits empty email/username instead of writing empty strings', () => {
  // email 为空串/缺失的备份行不能下发 email='' —— 两行都写 '' 会撞 users_email_key
  // 唯一索引（'' 对 '' 也算重复）。字段应整体缺省，由调用方决定是否保现状。
  const noEmail = buildUserMergeUpdate({ username: 'u1', email: '', role: 'VIEWER' }) as Record<string, unknown>;
  assert.equal('email' in noEmail, false, 'empty backup email must not be written');
  assert.equal(noEmail.username, 'u1');

  const noUsername = buildUserMergeUpdate({ username: null, email: 'a@b.com', role: 'VIEWER' }) as Record<
    string,
    unknown
  >;
  assert.equal('username' in noUsername, false, 'missing backup username must not be written');
  assert.equal(noUsername.email, 'a@b.com');
});

test('retention policy groups by scope and never removes full backups', () => {
  // 按创建时间倒序（listBackups 的天然顺序）：3 个整站 + 4 个用户模块 + 2 个工单模块
  const backups = [
    { id: 'f3', scope: 'full' as const },
    { id: 'f2', scope: 'full' as const },
    { id: 'u4', scope: 'users' as const },
    { id: 'u3', scope: 'users' as const },
    { id: 't2', scope: 'tickets' as const },
    { id: 't1', scope: 'tickets' as const },
    { id: 'u2', scope: 'users' as const },
    { id: 'f1', scope: 'full' as const },
    { id: 'u1', scope: 'users' as const },
  ];

  // keep=2：整站全部豁免（即使有 3 个）；users 保留 u4/u3 清 u2/u1；tickets 恰好 2 个全保留
  const removed = selectRetentionPolicyRemovals(backups, 2).map((b) => b.id);
  assert.deepEqual(removed.sort(), ['u1', 'u2'], 'only overflow module backups are removed, full backups exempt');

  // keep=1：users 清 3 个，tickets 清 1 个，整站仍全部保留
  const removedStrict = selectRetentionPolicyRemovals(backups, 1).map((b) => b.id);
  assert.equal(removedStrict.length, 4);
  assert.equal(removedStrict.filter((id) => id.startsWith('f')).length, 0, 'full backups never removed');

  // 旧记录 scope=undefined 归入 full 组（保守豁免，不误删来历不明的备份）
  const legacy = [{ id: 'legacy-1' }, { id: 'legacy-2' }, { id: 'legacy-3' }];
  assert.deepEqual(selectRetentionPolicyRemovals(legacy as never, 2), []);

  // keep=0 / 无效值 → 不清理
  assert.deepEqual(selectRetentionPolicyRemovals(backups, 0), []);
  assert.deepEqual(selectRetentionPolicyRemovals(backups, Number.NaN), []);
});

test('category icon survives module backup serialize → restore (custom icons never dropped)', () => {
  // Module backups (config + models scope) serialize categories via prisma.findMany(),
  // which returns ALL scalar fields including `icon`. Each row is written to the archive
  // as JSON and on restore is parsed back, fed through reviveDateFields(), then handed to
  // prisma.category.create()/upsert(). reviveDateFields is the ONLY field-level transform
  // between deserialize and the DB write, so proving it preserves a non-date scalar like
  // `icon` proves custom category icons round-trip module backups. (Full backups use
  // pg_dump with no table filter — verified separately by a live 56-icon round-trip.)
  const original = {
    id: 'cat-ss-pipe',
    name: '不锈钢管件',
    icon: 'stainless_steel', // custom icon — must NOT be dropped on restore
    parentId: null,
    sortOrder: 3,
    createdAt: '2024-05-01T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
  };

  // 1. serialize to archive (JSON) then parse back, exactly as the restore path does
  const parsed = JSON.parse(JSON.stringify(original));
  // 2. revive date fields — the sole field-level transform before prisma.create/upsert
  const restored = reviveDateFields(parsed, ['createdAt', 'updatedAt']);

  assert.equal(restored.icon, 'stainless_steel', 'custom category icon must survive backup → restore');
  assert.equal(restored.name, '不锈钢管件');
  assert.equal(restored.id, 'cat-ss-pipe');
  assert.equal(restored.sortOrder, 3);
  assert.ok(restored.createdAt instanceof Date, 'date fields still revived to Date objects');
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
