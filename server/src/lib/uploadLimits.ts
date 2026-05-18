import { DEFAULT_UPLOAD_POLICY, type UploadPolicy } from './businessConfig.js';

export const MAX_UPLOAD_POLICY_SIZE_MB = 102400;
export const MAX_BATCH_ARCHIVE_SIZE_MB = MAX_UPLOAD_POLICY_SIZE_MB;
export const BACKUP_DIRECT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const BACKUP_UPLOAD_MAX_BYTES = 100 * 1024 * 1024 * 1024;
export const UPLOAD_REQUEST_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export function clampUploadMb(value: unknown, fallback: number, min = 1, max = MAX_UPLOAD_POLICY_SIZE_MB): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function uploadMbToBytes(valueMb: number): number {
  return clampUploadMb(valueMb, 1) * 1024 * 1024;
}

export function modelMaxSizeMb(uploadPolicy: UploadPolicy): number {
  return clampUploadMb(uploadPolicy.modelMaxSizeMb, DEFAULT_UPLOAD_POLICY.modelMaxSizeMb);
}

export function modelMaxBytes(uploadPolicy: UploadPolicy): number {
  return uploadMbToBytes(modelMaxSizeMb(uploadPolicy));
}

export function modelDrawingMaxSizeMb(uploadPolicy: UploadPolicy): number {
  return clampUploadMb(uploadPolicy.modelDrawingMaxSizeMb, DEFAULT_UPLOAD_POLICY.modelDrawingMaxSizeMb);
}

export function modelDrawingMaxBytes(uploadPolicy: UploadPolicy): number {
  return uploadMbToBytes(modelDrawingMaxSizeMb(uploadPolicy));
}

export function batchArchiveMaxSizeMb(uploadPolicy: UploadPolicy): number {
  return clampUploadMb(
    uploadPolicy.batchArchiveMaxSizeMb,
    DEFAULT_UPLOAD_POLICY.batchArchiveMaxSizeMb,
    1,
    MAX_BATCH_ARCHIVE_SIZE_MB,
  );
}

export function batchArchiveMaxBytes(uploadPolicy: UploadPolicy): number {
  return uploadMbToBytes(batchArchiveMaxSizeMb(uploadPolicy));
}

export function ticketAttachmentMaxSizeMb(uploadPolicy: UploadPolicy): number {
  return clampUploadMb(uploadPolicy.ticketAttachmentMaxSizeMb, DEFAULT_UPLOAD_POLICY.ticketAttachmentMaxSizeMb, 1, 100);
}

export function ticketAttachmentMaxBytes(uploadPolicy: UploadPolicy): number {
  return uploadMbToBytes(ticketAttachmentMaxSizeMb(uploadPolicy));
}

export function ticketAttachmentExts(uploadPolicy: UploadPolicy): string[] {
  const exts = uploadPolicy.ticketAttachmentExts?.length
    ? uploadPolicy.ticketAttachmentExts
    : DEFAULT_UPLOAD_POLICY.ticketAttachmentExts;
  return Array.from(
    new Set(
      exts
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean)
        .map((item) => (item.startsWith('.') ? item : `.${item}`)),
    ),
  );
}

export function productImageMaxSizeMb(uploadPolicy: UploadPolicy): number {
  return clampUploadMb(uploadPolicy.productWallImageMaxSizeMb, DEFAULT_UPLOAD_POLICY.productWallImageMaxSizeMb, 1, 50);
}

export function productImageMaxBytes(uploadPolicy: UploadPolicy): number {
  return uploadMbToBytes(productImageMaxSizeMb(uploadPolicy));
}

export function productImageUploadMaxFiles(uploadPolicy: UploadPolicy): number {
  return clampUploadMb(uploadPolicy.productWallUploadMaxFiles, DEFAULT_UPLOAD_POLICY.productWallUploadMaxFiles, 1, 50);
}

export function productArchiveExtractMaxFiles(uploadPolicy: UploadPolicy): number {
  return clampUploadMb(
    uploadPolicy.productWallArchiveExtractMaxFiles,
    DEFAULT_UPLOAD_POLICY.productWallArchiveExtractMaxFiles,
    1,
    500,
  );
}
