import { existsSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { config } from '../lib/config.js';
import { deleteCloudFiles, deriveStorageKey, getCloudProvider, keyFromStaticUrl } from '../lib/storageProvider.js';

export type ModelFileRef = {
  id: string;
  format?: string | null;
  originalFormat?: string | null;
  uploadPath?: string | null;
};

export type FileCleanupResult = {
  removed: string[];
  skipped: string[];
  failed: Array<{ path: string; message: string }>;
};

export function normalizeModelFormat(format?: string | null): string {
  return String(format || '')
    .trim()
    .replace(/^\./, '')
    .toLowerCase();
}

export function isDeprecatedHtmlPreviewFormat(format?: string | null): boolean {
  return ['html', 'htm'].includes(normalizeModelFormat(format));
}

function pathInside(filePath: string, root: string): boolean {
  const rel = relative(root, filePath);
  return (
    rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.includes('\0') && !rel.startsWith(`${sep}`))
  );
}

export function isManagedModelFilePath(filePath: string): boolean {
  const absolutePath = resolve(filePath);
  const roots = [
    resolve(process.cwd(), config.uploadDir),
    resolve(process.cwd(), 'uploads'),
    resolve(process.cwd(), config.staticDir, 'originals'),
  ];
  return roots.some((root) => pathInside(absolutePath, root));
}

export function resolveStoredPath(filePath?: string | null): string | null {
  if (!filePath) return null;
  const resolved = resolve(process.cwd(), filePath);
  return isManagedModelFilePath(resolved) ? resolved : null;
}

export function findOriginalModelPath(model: ModelFileRef): string | null {
  const uploadPath = resolveStoredPath(model.uploadPath);
  if (uploadPath && existsSync(uploadPath)) return uploadPath;

  const format = normalizeModelFormat(model.originalFormat || model.format);
  if (!format) return null;

  const fallback = join(config.staticDir, 'originals', `${model.id}.${format}`);
  return existsSync(fallback) ? fallback : null;
}

export function modelManagedFilePaths(model: ModelFileRef): string[] {
  const paths = new Set<string>();
  const uploadPath = resolveStoredPath(model.uploadPath);
  if (uploadPath) paths.add(uploadPath);

  for (const ext of ['glb', 'gltf', 'bin']) {
    paths.add(join(config.staticDir, 'models', `${model.id}.${ext}`));
  }
  paths.add(join(config.staticDir, 'models', `${model.id}.meta.json`));
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    paths.add(join(config.staticDir, 'thumbnails', `${model.id}.${ext}`));
    paths.add(join(config.staticDir, 'thumbnails', `${model.id}_sm.${ext}`));
  }
  paths.add(join(config.staticDir, 'html-previews', `${model.id}.html`));
  paths.add(join(config.staticDir, 'html-previews', `${model.id}.htm`));

  for (const format of new Set([normalizeModelFormat(model.originalFormat), normalizeModelFormat(model.format)])) {
    if (format) paths.add(join(config.staticDir, 'originals', `${model.id}.${format}`));
  }

  return Array.from(paths);
}

export function removeExistingFiles(paths: Array<string | null | undefined>): FileCleanupResult {
  const result: FileCleanupResult = { removed: [], skipped: [], failed: [] };
  const uniquePaths = Array.from(new Set(paths.filter(Boolean) as string[]));

  for (const path of uniquePaths) {
    try {
      if (!existsSync(path)) {
        result.skipped.push(path);
        continue;
      }
      if (!statSync(path).isFile()) {
        result.failed.push({ path, message: '不是文件，已跳过' });
        continue;
      }
      rmSync(path, { force: true });
      result.removed.push(path);
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除失败';
      result.failed.push({ path, message });
    }
  }

  return result;
}

export function removeModelFiles(model: ModelFileRef): FileCleanupResult {
  return removeExistingFiles(modelManagedFilePaths(model));
}

/**
 * 删除模型在云端的副本（双删）。仅删除 static/ 下的对象（models/thumbnails/originals/html-previews），
 * uploads/ 下的原始上传文件不在云端（派生出 `..` 的 key 会被过滤）。provider 为 local 时 no-op。
 * best-effort：失败只记日志，不影响本地删除结果。
 */
export async function purgeModelFromCloud(
  model: ModelFileRef,
  extraStaticUrls: Array<string | null | undefined> = [],
): Promise<void> {
  if (!(await getCloudProvider())) return;
  const localKeys = modelManagedFilePaths(model).map(deriveStorageKey);
  const extraKeys = extraStaticUrls
    .map((url) => {
      if (!url) return null;
      const clean = String(url).split('?')[0];
      return clean.startsWith('/static/') ? keyFromStaticUrl(clean) : null;
    })
    .filter((k): k is string => Boolean(k));
  const keys = [...localKeys, ...extraKeys].filter((key) => key && !key.startsWith('..'));
  if (keys.length === 0) return;
  await deleteCloudFiles(keys);
}
