import assert from 'node:assert/strict';
import test from 'node:test';

const { evictCompleted } = await import('./backup.js');

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
