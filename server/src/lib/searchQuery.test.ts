import assert from 'node:assert/strict';
import test from 'node:test';
import { getSearchTermAliases, modelTextSearchWhere } from './searchQuery.js';

test('expands pipe fraction search terms across common notations', () => {
  const aliases = getSearchTermAliases('1/8');

  assert.ok(aliases.includes('1/8'));
  assert.ok(aliases.includes('1_8'));
  assert.ok(aliases.includes('1分'));
});

test('expands embedded pipe fraction search terms without losing surrounding model code', () => {
  const aliases = getSearchTermAliases('JCW-1/8-4');

  assert.ok(aliases.includes('JCW-1/8-4'));
  assert.ok(aliases.includes('JCW-1_8-4'));
  assert.ok(aliases.includes('JCW-1分-4'));
});

test('expands Chinese pipe size names back to fraction and filename-safe forms', () => {
  const oneFenAliases = getSearchTermAliases('1分');
  const sixFenAliases = getSearchTermAliases('6分');
  const oneInchAliases = getSearchTermAliases('1寸');

  assert.ok(oneFenAliases.includes('1/8'));
  assert.ok(oneFenAliases.includes('1_8'));
  assert.ok(sixFenAliases.includes('3/4'));
  assert.ok(sixFenAliases.includes('3_4'));
  assert.ok(oneInchAliases.includes('8分'));
});

test('expands size multiply symbols across common model-code spellings', () => {
  const symbolAliases = getSearchTermAliases('*');
  const embeddedAliases = getSearchTermAliases('10*20');

  assert.ok(symbolAliases.includes('x'));
  assert.ok(symbolAliases.includes('X'));
  assert.ok(symbolAliases.includes('叉'));
  assert.ok(symbolAliases.includes('×'));
  assert.ok(embeddedAliases.includes('10x20'));
  assert.ok(embeddedAliases.includes('10X20'));
  assert.ok(embeddedAliases.includes('10叉20'));
  assert.ok(embeddedAliases.includes('10×20'));
});

test('model text search preserves AND semantics while each term gets aliases', () => {
  const where = modelTextSearchWhere('JCW 1分') as { AND: Array<{ OR: unknown[] }> };

  assert.equal(where.AND.length, 2);
  assert.ok(JSON.stringify(where.AND[1]).includes('1_8'));
  assert.ok(JSON.stringify(where.AND[1]).includes('1/8'));
});
