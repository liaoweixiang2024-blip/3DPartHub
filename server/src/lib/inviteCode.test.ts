import assert from 'node:assert/strict';
import test from 'node:test';

const { assessInviteCode, generateInviteCode, INVITE_REASON_MSG } = await import('./inviteCode.js');

const NOW = new Date('2026-07-31T00:00:00Z');
const FUTURE = new Date('2026-12-31T00:00:00Z');
const PAST = new Date('2020-01-01T00:00:00Z');

test('assessInviteCode: null → not_found', () => {
  assert.deepEqual(assessInviteCode(null, NOW), { ok: false, reason: 'not_found' });
});

test('assessInviteCode: active + no expiry → ok', () => {
  assert.deepEqual(assessInviteCode({ status: 'active', expiresAt: null, usedById: null }, NOW), { ok: true });
});

test('assessInviteCode: active + future expiry → ok', () => {
  assert.deepEqual(assessInviteCode({ status: 'active', expiresAt: FUTURE, usedById: null }, NOW), { ok: true });
});

test('assessInviteCode: status used → used', () => {
  assert.deepEqual(assessInviteCode({ status: 'used', expiresAt: null, usedById: 'u-1' }, NOW), {
    ok: false,
    reason: 'used',
  });
});

test('assessInviteCode: usedById set (even if status active) → used', () => {
  assert.deepEqual(assessInviteCode({ status: 'active', expiresAt: null, usedById: 'u-1' }, NOW), {
    ok: false,
    reason: 'used',
  });
});

test('assessInviteCode: revoked → revoked', () => {
  assert.deepEqual(assessInviteCode({ status: 'revoked', expiresAt: null, usedById: null }, NOW), {
    ok: false,
    reason: 'revoked',
  });
});

test('assessInviteCode: expired → expired', () => {
  assert.deepEqual(assessInviteCode({ status: 'active', expiresAt: PAST, usedById: null }, NOW), {
    ok: false,
    reason: 'expired',
  });
});

test('generateInviteCode: 8 chars, base64url charset, no padding', () => {
  for (let i = 0; i < 16; i++) {
    const code = generateInviteCode();
    assert.equal(code.length, 8, `attempt ${i}: got ${code}`);
    assert.match(code, /^[A-Za-z0-9_-]{8}$/);
  }
});

test('INVITE_REASON_MSG covers all reasons with non-empty text', () => {
  const reasons = ['not_found', 'expired', 'used', 'revoked'] as const;
  for (const r of reasons) {
    assert.ok(typeof INVITE_REASON_MSG[r] === 'string', `missing message for ${r}`);
    assert.ok(INVITE_REASON_MSG[r].length > 0, `empty message for ${r}`);
  }
});
