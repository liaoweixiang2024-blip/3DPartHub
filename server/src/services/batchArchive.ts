import { extname } from 'node:path';

const PREVIEW_BATCH_FORMATS = new Set(['preview', 'gltf', 'glb']);

export type BatchArchiveBinEntry = {
  filePath: string;
  fileName: string;
  binPath?: string | null;
};

export function shouldDownloadOriginalBatchFormat(format?: string | null): boolean {
  const normalized = String(format || 'original')
    .trim()
    .replace(/^\./, '')
    .toLowerCase();
  return !PREVIEW_BATCH_FORMATS.has(normalized);
}

export function shouldAttachExternalGltfBin(entry: BatchArchiveBinEntry): entry is BatchArchiveBinEntry & {
  binPath: string;
} {
  return (
    Boolean(entry.binPath) &&
    extname(entry.filePath).toLowerCase() === '.gltf' &&
    extname(entry.fileName).toLowerCase() === '.gltf'
  );
}
