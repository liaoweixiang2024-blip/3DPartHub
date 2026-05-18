import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_UPLOAD_POLICY, normalizeUploadPolicy } from './businessConfig.js';
import {
  batchArchiveMaxSizeMb,
  modelDrawingMaxSizeMb,
  modelMaxSizeMb,
  productArchiveExtractMaxFiles,
  ticketAttachmentExts,
  ticketAttachmentMaxSizeMb,
} from './uploadLimits.js';

test('normalizes upload policy limits from one source of truth', () => {
  const policy = normalizeUploadPolicy({
    ...DEFAULT_UPLOAD_POLICY,
    modelMaxSizeMb: 0,
    modelDrawingMaxSizeMb: 200000,
    batchArchiveMaxSizeMb: 200000,
    productWallArchiveExtractMaxFiles: 200000,
    ticketAttachmentMaxSizeMb: 0,
  });

  assert.equal(modelMaxSizeMb(policy), 1);
  assert.equal(modelDrawingMaxSizeMb(policy), 102400);
  assert.equal(batchArchiveMaxSizeMb(policy), 102400);
  assert.equal(productArchiveExtractMaxFiles(policy), 500);
  assert.equal(ticketAttachmentMaxSizeMb(policy), 1);
});

test('normalizes upload formats and attachment extensions from strings', () => {
  const policy = normalizeUploadPolicy({
    ...DEFAULT_UPLOAD_POLICY,
    modelFormats: 'STEP, stp, html, step' as unknown as string[],
    ticketAttachmentExts: 'jpg, .png, PDF, jpg' as unknown as string[],
  });

  assert.deepEqual(policy.modelFormats, ['step', 'stp']);
  assert.deepEqual(ticketAttachmentExts(policy), ['.jpg', '.png', '.pdf']);
});
