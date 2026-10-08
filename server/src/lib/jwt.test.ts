import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-secret';

const { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } = await import('./jwt.js');

test('access and refresh tokens are type-bound', () => {
  const payload = { userId: 'user-1', role: 'VIEWER' };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  assert.equal(verifyAccessToken(accessToken).tokenType, 'access');
  assert.equal(verifyRefreshToken(refreshToken).tokenType, 'refresh');
  assert.throws(() => verifyRefreshToken(accessToken), /Invalid refresh token/);
  assert.throws(() => verifyAccessToken(refreshToken), /Invalid access token/);
});

test('refresh tokens preserve remember-login intent', () => {
  const rememberedToken = signRefreshToken({ userId: 'user-1', role: 'VIEWER', rememberMe: true });
  const sessionToken = signRefreshToken({ userId: 'user-1', role: 'VIEWER', rememberMe: false });

  assert.equal(verifyRefreshToken(rememberedToken).rememberMe, true);
  assert.equal(verifyRefreshToken(sessionToken).rememberMe, false);
});

// ---------------------------------------------------------------------------
// checkAndRevokeRefreshFamily：并发宽限 + 宽限过期重放拦截 + Redis 故障放行
//
// 用内存 Map 顶掉 redis.eval（cache.ts 导出的同一实例），验证五种场景：
//   1. 首次轮换 → ok=true, usedBefore=false
//   2. 宽限窗口内并发重放（第二个标签页）→ ok=true, usedBefore=true（不再吊销）
//   3. 宽限窗口外重放（grace 已过期、used 仍在）→ ok=false（曾是被绕过的安全洞）
//   4. 登出后的重放（used 终态标记）→ ok=false（保持顶下线）
//   5. Redis 抖动（eval 抛错）→ ok=true（fail-open，不把用户顶下线）
// ---------------------------------------------------------------------------
test('checkAndRevokeRefreshFamily: first rotation, grace replay, stale replay, revoked replay, redis outage', async () => {
  const store = new Map<string, string>();
  const KEY_PREFIX = (process.env.REDIS_KEY_PREFIX || process.env.NODE_ENV || 'dev') + ':';
  const { checkAndRevokeRefreshFamily, REFRESH_REUSE_GRACE_SECONDS } = await import('./jwt.js');
  const { redis } = await import('./cache.js');

  const originalEval = redis.eval;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (redis as any).eval = async (
    _script: string,
    _numKeys: number,
    graceKey: string,
    usedKey: string,
    _graceTtl: string,
    _usedTtl: string,
  ): Promise<number> => {
    if (store.get(graceKey) === 'grace') return 2;
    if (store.get(usedKey) === '1') return 0;
    store.set(graceKey, 'grace');
    store.set(usedKey, '1');
    return 1;
  };

  try {
    const family = `fam_test_grace`;

    // 1. 首次轮换
    const first = await checkAndRevokeRefreshFamily('user-1', family);
    assert.equal(first.ok, true);
    assert.equal(first.usedBefore, false);
    assert.equal(REFRESH_REUSE_GRACE_SECONDS, 30);

    // 2. 宽限窗口内的并发重放（第二个标签页/PWA 窗口）
    const second = await checkAndRevokeRefreshFamily('user-1', family);
    assert.equal(second.ok, true);
    assert.equal(second.usedBefore, true);

    // 3. 宽限窗口外的重放：grace 已自然过期，只剩 used 终态标记。
    //    修复前 key 会整个消失，重放被误判为首次轮换 → 重新签发 token（安全洞）
    store.delete(`${KEY_PREFIX}refresh_family:user-1:${family}`);
    const stale = await checkAndRevokeRefreshFamily('user-1', family);
    assert.equal(stale.ok, false);
    assert.equal(stale.usedBefore, false);

    // 4. 登出后的重放：只有 used 标记（revokeRefreshFamily 会清 grace）
    const logoutFamily = `fam_test_logout`;
    store.set(`${KEY_PREFIX}refresh_family_used:user-1:${logoutFamily}`, '1');
    const afterLogout = await checkAndRevokeRefreshFamily('user-1', logoutFamily);
    assert.equal(afterLogout.ok, false);

    // 5. Redis 抖动 → fail-open
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (redis as any).eval = async () => {
      throw new Error('Command timed out');
    };
    const outage = await checkAndRevokeRefreshFamily('user-1', 'fam_test_outage');
    assert.equal(outage.ok, true);
    assert.equal(outage.usedBefore, false);
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (redis as any).eval = originalEval;
  }
});
