import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_STATUS, isModelStatus } from './modelStatus.js';

test('defines stable model status values', () => {
  assert.equal(MODEL_STATUS.QUEUED, 'queued');
  assert.equal(MODEL_STATUS.PROCESSING, 'processing');
  assert.equal(MODEL_STATUS.COMPLETED, 'completed');
  assert.equal(MODEL_STATUS.FAILED, 'failed');
  assert.equal(MODEL_STATUS.DELETED, 'deleted');
  assert.equal(MODEL_STATUS.PURGING, 'purging');
});

test('validates model status values', () => {
  assert.equal(isModelStatus('queued'), true);
  assert.equal(isModelStatus('completed'), true);
  assert.equal(isModelStatus('deleted'), true);
  assert.equal(isModelStatus('purging'), true);
  assert.equal(isModelStatus('unknown'), false);
  assert.equal(isModelStatus(null), false);
});
