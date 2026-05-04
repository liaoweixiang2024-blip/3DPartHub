import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RequestValidationError,
  booleanFlag,
  firstString,
  numericValue,
  optionalString,
  paginationQuery,
  requiredString,
  routeParam,
  stringArray,
} from './requestValidation.js';

test('firstString accepts plain strings and first array item', () => {
  assert.equal(firstString('abc'), 'abc');
  assert.equal(firstString(['abc', 'def']), 'abc');
  assert.equal(firstString([1, 'def']), undefined);
  assert.equal(firstString(undefined), undefined);
});

test('optionalString trims and bounds strings', () => {
  assert.equal(optionalString('  abc  '), 'abc');
  assert.equal(optionalString('  '), undefined);
  assert.equal(optionalString('abcdef', { maxLength: 3 }), 'abc');
  assert.equal(optionalString('  abc  ', { trim: false }), '  abc  ');
});

test('requiredString throws validation errors for missing fields', () => {
  assert.equal(requiredString('abc', 'name'), 'abc');
  assert.throws(() => requiredString('', 'name'), RequestValidationError);
  assert.throws(() => requiredString(undefined, 'name'), /缺少 name/);
});

test('booleanFlag accepts common truthy values only', () => {
  assert.equal(booleanFlag('1'), true);
  assert.equal(booleanFlag('true'), true);
  assert.equal(booleanFlag('yes'), true);
  assert.equal(booleanFlag('on'), true);
  assert.equal(booleanFlag('0'), false);
  assert.equal(booleanFlag(undefined), false);
});

test('numericValue clamps and falls back', () => {
  assert.equal(numericValue('5', 1, 1, 10), 5);
  assert.equal(numericValue('999', 1, 1, 10), 10);
  assert.equal(numericValue('-1', 1, 1, 10), 1);
  assert.equal(numericValue('bad', 7, 1, 10), 7);
});

test('routeParam requires a bounded string', () => {
  assert.equal(routeParam('abc'), 'abc');
  assert.equal(routeParam(['abc', 'def']), 'abc');
  assert.throws(() => routeParam(undefined), /缺少 id/);
});

test('stringArray normalizes arrays and enforces limits', () => {
  assert.deepEqual(stringArray([' a ', '', 3, 'abcdef'], { limit: 2, maxLength: 3 }), ['a', '3']);
});

test('paginationQuery returns page, size, skip, and take', () => {
  assert.deepEqual(paginationQuery({ page: '3', page_size: '25' }, { maxPageSize: 30 }), {
    page: 3,
    pageSize: 25,
    skip: 50,
    take: 25,
  });
  assert.deepEqual(
    paginationQuery({ page: 'x', size: '200' }, { pageSizeKey: 'size', defaultPageSize: 50, maxPageSize: 100 }),
    {
      page: 1,
      pageSize: 100,
      skip: 0,
      take: 100,
    },
  );
});
