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
// checkAndRevokeRefreshFamily：轮换记账 + Redis 故障放行
//
// 用内存 Map 顶掉 redis.eval（cache.ts 导出的同一实例），验证五种场景：
//   1. 首次轮换 → ok=true, usedBefore=false
//   2. 宽限窗口内并发重放（第二个标签页）→ ok=true, usedBefore=true
//   3. 宽限窗口外重放（grace 已过期、used 仍在）→ ok=false
//      （注意：返回值只做记账——refresh 端点对已轮换 family 的重放一律自愈换发，
//       吊销只认 revoked 标记，见下方 revokeRefreshFamily 测试）
//   4. 已轮换 family 的重放（used 终态标记）→ ok=false
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
    assert.equal(REFRESH_REUSE_GRACE_SECONDS, 120);

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

    // 4. 已轮换 family 的重放：只有 used 标记 → 记账意义上的 ok=false
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

// ---------------------------------------------------------------------------
// revokeRefreshFamily / isRefreshFamilyRevoked：登出语义
// 登出写 revoked 终态标记（refresh 端点见到即 401，登出过的令牌不得复活）；
// 只吊销本 family——单设备登出不清算其他设备/浏览器的独立 cookie 罐。
// ---------------------------------------------------------------------------
test('revokeRefreshFamily writes revoked marker; isRefreshFamilyRevoked detects it per-family', async () => {
  const store = new Map<string, string>();
  const { revokeRefreshFamily, isRefreshFamilyRevoked } = await import('./jwt.js');
  const { redis } = await import('./cache.js');

  const originalEval = redis.eval;
  const originalGet = redis.get;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (redis as any).eval = async (
    _script: string,
    _numKeys: number,
    revokedKey: string,
    usedKey: string,
    graceKey: string,
    _ttl: string,
  ): Promise<number> => {
    store.set(revokedKey, '1');
    store.delete(usedKey);
    store.delete(graceKey);
    return 1;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (redis as any).get = async (key: string): Promise<string | null> => store.get(key) ?? null;

  try {
    assert.equal(await isRefreshFamilyRevoked('user-2', 'fam_a'), false);
    await revokeRefreshFamily('user-2', 'fam_a');
    assert.equal(await isRefreshFamilyRevoked('user-2', 'fam_a'), true);
    // 其他 family（其他设备/PWA 罐）不受单设备登出影响
    assert.equal(await isRefreshFamilyRevoked('user-2', 'fam_b'), false);
    // Redis 抖动 → fail-open，不挡正常刷新
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (redis as any).get = async () => {
      throw new Error('Command timed out');
    };
    assert.equal(await isRefreshFamilyRevoked('user-2', 'fam_b'), false);
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (redis as any).eval = originalEval;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (redis as any).get = originalGet;
  }
});
