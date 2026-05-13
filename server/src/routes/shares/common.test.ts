import assert from 'node:assert/strict';
import test from 'node:test';

const { hasShareAccess, asSingleString } = await import('./common.js');

test('asSingleString returns string as-is', () => {
  assert.equal(asSingleString('abc'), 'abc');
});

test('asSingleString returns first element of array', () => {
  assert.equal(asSingleString(['first', 'second']), 'first');
});

test('asSingleString returns undefined for non-string input', () => {
  assert.equal(asSingleString(undefined), undefined);
  assert.equal(asSingleString(42), undefined);
  assert.equal(asSingleString([42, 'str']), undefined);
});

test('hasShareAccess returns true for shares without password', () => {
  assert.equal(hasShareAccess('share-1', null, undefined), true);
  assert.equal(hasShareAccess('share-1', null, 'some-token'), true);
});

test('hasShareAccess returns false for password-protected share without token', () => {
  assert.equal(hasShareAccess('share-1', 'hashed-password', undefined), false);
  assert.equal(hasShareAccess('share-1', 'hashed-password', null), false);
});

test('hasShareAccess returns false for short/invalid token', () => {
  assert.equal(hasShareAccess('share-1', 'hashed-password', 'short'), false);
  assert.equal(hasShareAccess('share-1', 'hashed-password', '../bad'), false);
});
