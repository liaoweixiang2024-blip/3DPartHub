import assert from 'node:assert/strict';
import test from 'node:test';

const { normalizeVersionTag } = await import('./update.js');

test('normalizeVersionTag keeps release tags comparable without changing dev labels', () => {
  assert.equal(normalizeVersionTag('3.1.4'), 'v3.1.4');
  assert.equal(normalizeVersionTag('v3.1.4'), 'v3.1.4');
  assert.equal(normalizeVersionTag('dev-local'), 'dev-local');
  assert.equal(normalizeVersionTag(''), '');
});
