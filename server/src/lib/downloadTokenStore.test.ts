import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-secret';

const root = mkdtempSync(join(tmpdir(), 'download-token-store-test-'));
process.env.UPLOAD_DIR = join(root, 'uploads');

const {
  createModelDownloadToken,
  createProtectedResourceToken,
  consumeModelDownloadToken,
  consumeProtectedResourceToken,
  verifyProtectedResourceToken,
} = await import('./downloadTokenStore.js');

test.after(() => {
  rmSync(root, { recursive: true, force: true });
});

test('model download tokens are single-use and bound to payload', async () => {
  const created = await createModelDownloadToken({
    modelId: 'model-1',
    format: 'original',
    userId: 'user-1',
  });

  assert.ok(created.token.length >= 32);
  assert.ok(created.expiresAt > Date.now());

  const payload = consumeModelDownloadToken(created.token);
  assert.deepEqual(
    payload && {
      modelId: payload.modelId,
      format: payload.format,
      userId: payload.userId,
    },
    {
      modelId: 'model-1',
      format: 'original',
      userId: 'user-1',
    },
  );

  assert.equal(consumeModelDownloadToken(created.token), null);
});

test('invalid token names are rejected', () => {
  assert.equal(consumeModelDownloadToken('../not-a-token'), null);
  assert.equal(consumeModelDownloadToken('short'), null);
  assert.equal(consumeProtectedResourceToken('../not-a-token', 'backup-download', 'backup-1'), null);
  assert.equal(consumeProtectedResourceToken('short', 'backup-download', 'backup-1'), null);
});

test('single-use protected resource tokens are consumed once', () => {
  const created = createProtectedResourceToken({
    type: 'model-drawing',
    resourceId: 'model-1',
    userId: 'user-1',
  });

  const payload = consumeProtectedResourceToken(created.token, 'model-drawing', 'model-1');
  assert.equal(payload?.userId, 'user-1');
  assert.equal(consumeProtectedResourceToken(created.token, 'model-drawing', 'model-1'), null);
});

test('multi-use protected resource tokens remain valid until expiry', () => {
  const created = createProtectedResourceToken({
    type: 'ticket-attachment',
    resourceId: 'ticket-1:file.png',
    userId: 'user-1',
    role: 'USER',
    singleUse: false,
  });

  assert.equal(verifyProtectedResourceToken(created.token, 'ticket-attachment', 'ticket-1:file.png')?.role, 'USER');
  assert.equal(verifyProtectedResourceToken(created.token, 'ticket-attachment', 'ticket-1:file.png')?.userId, 'user-1');
  assert.equal(verifyProtectedResourceToken(created.token, 'ticket-attachment', 'other:file.png'), null);
});

test('backup download resource tokens are multi-use (download-tool friendly) and resource bound', () => {
  // 备份下载走 verify（非 consume）：下载工具（迅雷/IDM）先 HEAD 探测再分段 Range
  // 拉取，一次性令牌第一次请求就被烧掉，工具端报「无法从网站上提取文件」。
  const created = createProtectedResourceToken({
    type: 'backup-download',
    resourceId: 'backup-1',
    userId: 'admin-1',
    role: 'ADMIN',
    ttlMs: 24 * 60 * 60 * 1000,
    singleUse: false,
  });

  assert.equal(verifyProtectedResourceToken(created.token, 'backup-download', 'other-backup'), null);
  // 同一令牌可被 HEAD 探测 + 多次分段请求重复校验
  assert.equal(verifyProtectedResourceToken(created.token, 'backup-download', 'backup-1')?.userId, 'admin-1');
  assert.equal(verifyProtectedResourceToken(created.token, 'backup-download', 'backup-1')?.role, 'ADMIN');
  assert.equal(verifyProtectedResourceToken(created.token, 'backup-download', 'backup-1')?.userId, 'admin-1');
});

test('share access resource tokens can be verified multiple times until expiry', () => {
  const created = createProtectedResourceToken({
    type: 'share-access',
    resourceId: 'share-1',
    userId: 'anonymous',
    singleUse: false,
  });

  assert.equal(verifyProtectedResourceToken(created.token, 'share-access', 'share-1')?.resourceId, 'share-1');
  assert.equal(verifyProtectedResourceToken(created.token, 'share-access', 'share-1')?.userId, 'anonymous');
  assert.equal(verifyProtectedResourceToken(created.token, 'share-access', 'other-share'), null);
});
