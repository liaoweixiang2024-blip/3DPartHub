import { existsSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { config } from "../lib/config.js";

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
  return String(format || "").trim().replace(/^\./, "").toLowerCase();
}

export function isDeprecatedHtmlPreviewFormat(format?: string | null): boolean {
  return ["html", "htm"].includes(normalizeModelFormat(format));
}

function pathInside(filePath: string, root: string): boolean {
  const rel = relative(root, filePath);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.includes("\0") && !rel.startsWith(`${sep}`));
}

export function isManagedModelFilePath(filePath: string): boolean {
  const absolutePath = resolve(filePath);
  const roots = [
    resolve(process.cwd(), config.uploadDir),
    resolve(process.cwd(), "uploads"),
    resolve(process.cwd(), config.staticDir, "originals"),
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

  const fallback = join(config.staticDir, "originals", `${model.id}.${format}`);
  return existsSync(fallback) ? fallback : null;
}

export function modelManagedFilePaths(model: ModelFileRef): string[] {
  const paths = new Set<string>();
  const uploadPath = resolveStoredPath(model.uploadPath);
  if (uploadPath) paths.add(uploadPath);

  for (const ext of ["glb", "gltf", "bin"]) {
    paths.add(join(config.staticDir, "models", `${model.id}.${ext}`));
  }
  paths.add(join(config.staticDir, "models", `${model.id}.meta.json`));
  paths.add(join(config.staticDir, "thumbnails", `${model.id}.png`));
  paths.add(join(config.staticDir, "html-previews", `${model.id}.html`));
  paths.add(join(config.staticDir, "html-previews", `${model.id}.htm`));

  for (const format of new Set([
    normalizeModelFormat(model.originalFormat),
    normalizeModelFormat(model.format),
  ])) {
    if (format) paths.add(join(config.staticDir, "originals", `${model.id}.${format}`));
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
        result.failed.push({ path, message: "不是文件，已跳过" });
        continue;
      }
      rmSync(path, { force: true });
      result.removed.push(path);
    } catch (err) {
      const message = err instanceof Error ? err.message : "删除失败";
      result.failed.push({ path, message });
    }
  }

  return result;
}

export function removeModelFiles(model: ModelFileRef): FileCleanupResult {
  return removeExistingFiles(modelManagedFilePaths(model));
}
