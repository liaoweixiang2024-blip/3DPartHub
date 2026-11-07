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
  claimModelDownloadRecordMark,
  releaseModelDownloadRecordMark,
  consumeProtectedResourceToken,
  verifyModelDownloadToken,
  verifyProtectedResourceToken,
} = await import('./downloadTokenStore.js');

test.after(() => {
  rmSync(root, { recursive: true, force: true });
});

test('model download tokens are reusable within TTL and bound to payload', async () => {
  const created = await createModelDownloadToken({
    modelId: 'model-1',
    format: 'original',
    userId: 'user-1',
  });

  assert.ok(created.token.length >= 32);
  assert.ok(created.expiresAt > Date.now());

  // 同一令牌可重复校验：华为/鸿蒙等浏览器的下载管理器会对同一 URL 发起多次请求
  // （重拉 / Range 续传），一次性令牌第二次请求即 401 → 下载器报「下载失败」。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const payload = verifyModelDownloadToken(created.token);
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
  }
});

test('record mark is claimed once per token and releasable after limit rejection', async () => {
  const created = await createModelDownloadToken({
    modelId: 'model-2',
    format: 'original',
  });

  // 第一个到达的请求赢得打点权
  assert.equal(claimModelDownloadRecordMark(created.token, created.expiresAt), true);
  // 同令牌的后续请求（下载器二次拉取）不再重复打点
  assert.equal(claimModelDownloadRecordMark(created.token, created.expiresAt), false);
  // 每日限额拒绝时归还标记，重试请求需重新过限额检查
  releaseModelDownloadRecordMark(created.token);
  assert.equal(claimModelDownloadRecordMark(created.token, created.expiresAt), true);
});

test('invalid token names are rejected', () => {
  assert.equal(verifyModelDownloadToken('../not-a-token'), null);
  assert.equal(verifyModelDownloadToken('short'), null);
  assert.equal(claimModelDownloadRecordMark('../not-a-token', Date.now() + 60_000), false);
  assert.equal(claimModelDownloadRecordMark('short', Date.now() + 60_000), false);
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
