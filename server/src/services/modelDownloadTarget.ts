import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../lib/config.js";
import { findPreviewAssetPath, getPreviewAssetExtension, previewAssetFileName, resolveFileUrlPath } from "./gltfAsset.js";
import { findOriginalModelPath, resolveStoredPath, type ModelFileRef } from "./modelFiles.js";

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

function resolvePreviewUrlPath(value: string): string {
  const clean = value.split(/[?#]/)[0];
  if (clean.startsWith("/static/")) {
    return join(config.staticDir, clean.slice("/static/".length));
  }
  return resolveFileUrlPath(value);
}

export function resolveDbModelDownloadTarget(model: ModelFileRef & {
  name?: string | null;
  originalName?: string | null;
  gltfUrl?: string | null;
  gltfSize?: number | null;
  originalSize?: number | null;
}, requestedFormat?: string): ModelDownloadTarget | null {
  const displayName = model.name || model.originalName || model.id;
  const originalFormat = model.originalFormat || model.format || "step";

  if (requestedFormat === "original") {
    const originalPath = findOriginalModelPath(model);
    if (originalPath) {
      return {
        filePath: originalPath,
        fileName: `${displayName}.${originalFormat}`,
        contentType: "application/octet-stream",
        record: {
          modelId: model.id,
          format: model.format || originalFormat,
          fileSize: Number(model.originalSize || 0),
        },
      };
    }
  }

  const previewPath = findPreviewAssetPath(join(config.staticDir, "models"), model.id, model.gltfUrl);
  if (!previewPath) return null;

  return {
    filePath: previewPath,
    fileName: previewAssetFileName(displayName, previewPath),
    contentType: "application/octet-stream",
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
  requestedFormat?: string
): ModelDownloadTarget | null {
  if (requestedFormat === "original" && meta.upload_path) {
    const originalPath = resolveStoredPath(meta.upload_path as string);
    if (originalPath && existsSync(originalPath)) {
      return {
        filePath: originalPath,
        fileName: (meta.original_name as string) || `${id}.${meta.format}`,
        contentType: "application/octet-stream",
      };
    }
  }

  const gltfUrl = meta.gltf_url as string | undefined;
  if (!gltfUrl) return null;

  const filePath = resolvePreviewUrlPath(gltfUrl);
  return {
    filePath,
    fileName: (meta.original_name as string)
      ? (meta.original_name as string).replace(/\.[^.]+$/, `.${getPreviewAssetExtension(gltfUrl)}`)
      : previewAssetFileName(id, gltfUrl),
    contentType: "application/octet-stream",
  };
}
