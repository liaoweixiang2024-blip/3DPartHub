import { existsSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { config } from '../lib/config.js';
import { modelDownloadFileName, modelDownloadSourceName } from '../lib/modelDownloadName.js';
import { findPreviewAssetPath, getPreviewAssetExtension, resolveFileUrlPath } from './gltfAsset.js';
import { findOriginalModelPath, resolveStoredPath, type ModelFileRef } from './modelFiles.js';

export type ModelDownloadRecord = {
  modelId: string;
  format: string;
  fileSize: number;
};

export type ModelDownloadTarget = {
  filePath: string;
  fileName: string;
  contentType: string;
  record?: ModelDownloadRecord;
};

function resolvePreviewUrlPath(value: string): string | null {
  const clean = value.split(/[?#]/)[0];
  let candidate: string;
  if (clean.startsWith('/static/')) {
    candidate = join(config.staticDir, clean.slice('/static/'.length));
  } else {
    return resolveFileUrlPath(value);
  }
  const resolved = resolve(candidate);
  const staticRoot = resolve(config.staticDir);
  if (resolved !== staticRoot && !resolved.startsWith(`${staticRoot}${sep}`)) return null;
  return resolved;
}

function normalizedExtensionFromName(value?: string | null): string {
  return extname(String(value || ''))
    .replace(/^\./, '')
    .toLowerCase();
}

function usableOriginalExtension(value?: string | null): string {
  const normalized = String(value || '')
    .trim()
    .replace(/^\./, '')
    .toLowerCase();
  return normalized && !['bin', 'binary', 'model', 'unknown'].includes(normalized) ? normalized : '';
}

function originalDownloadExtension(
  model: { originalName?: string | null; originalFormat?: string | null; format?: string | null },
  filePath?: string | null,
): string {
  return (
    usableOriginalExtension(normalizedExtensionFromName(model.originalName)) ||
    usableOriginalExtension(normalizedExtensionFromName(filePath)) ||
    usableOriginalExtension(model.originalFormat) ||
    usableOriginalExtension(model.format) ||
    'step'
  );
}

export function resolveDbModelDownloadTarget(
  model: ModelFileRef & {
    name?: string | null;
    originalName?: string | null;
    gltfUrl?: string | null;
    gltfSize?: number | null;
    originalSize?: number | null;
  },
  requestedFormat?: string,
): ModelDownloadTarget | null {
  const sourceName = modelDownloadSourceName(model.name, model.originalName, model.id);

  if (requestedFormat === 'original') {
    const originalPath = findOriginalModelPath(model);
    if (originalPath) {
      const originalFormat = originalDownloadExtension(model, originalPath);
      return {
        filePath: originalPath,
        fileName: modelDownloadFileName(sourceName, originalFormat, model.id),
        contentType: 'application/octet-stream',
        record: {
          modelId: model.id,
          format: originalFormat,
          fileSize: Number(model.originalSize || 0),
        },
      };
    }
  }

  const previewPath = findPreviewAssetPath(join(config.staticDir, 'models'), model.id, model.gltfUrl);
  if (!previewPath) return null;

  return {
    filePath: previewPath,
    fileName: modelDownloadFileName(sourceName, getPreviewAssetExtension(previewPath), model.id),
    contentType: 'application/octet-stream',
    record: {
      modelId: model.id,
      format: getPreviewAssetExtension(previewPath),
      fileSize: Number(model.gltfSize || 0),
    },
  };
}

export function resolveMetadataModelDownloadTarget(
  id: string,
  meta: Record<string, unknown>,
  requestedFormat?: string,
): ModelDownloadTarget | null {
  const sourceName = (meta.original_name as string | undefined) || id;

  if (requestedFormat === 'original' && meta.upload_path) {
    const originalPath = resolveStoredPath(meta.upload_path as string);
    if (originalPath && existsSync(originalPath)) {
      const originalFormat = originalDownloadExtension(
        {
          originalName: meta.original_name as string | undefined,
          originalFormat: meta.original_format as string | undefined,
          format: meta.format as string | undefined,
        },
        originalPath,
      );
      return {
        filePath: originalPath,
        fileName: modelDownloadFileName(sourceName, originalFormat, id),
        contentType: 'application/octet-stream',
      };
    }
  }

  const gltfUrl = meta.gltf_url as string | undefined;
  if (!gltfUrl) return null;

  const filePath = resolvePreviewUrlPath(gltfUrl);
  if (!filePath) return null;
  return {
    filePath,
    fileName: modelDownloadFileName(sourceName, getPreviewAssetExtension(gltfUrl), id),
    contentType: 'application/octet-stream',
  };
}
