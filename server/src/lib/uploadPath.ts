import { resolve, sep } from 'node:path';

export function normalizeUploadFileName(fileName: unknown): string | null {
  if (typeof fileName !== 'string') return null;
  const trimmed = fileName.trim();
  if (!trimmed || trimmed.length > 255) return null;
  if (/^[a-zA-Z]:/.test(trimmed)) return null;
  if (/[/\\\0]/.test(trimmed) || trimmed === '.' || trimmed === '..') return null;
  return trimmed;
}

export function resolveUploadPathInsideRoot(uploadRoot: string, fileName: string): string | null {
  if (!normalizeUploadFileName(fileName)) return null;
  const resolvedRoot = resolve(uploadRoot);
  const resolved = resolve(resolvedRoot, fileName);
  if (resolved !== resolvedRoot && resolved.startsWith(`${resolvedRoot}${sep}`)) return resolved;
  return null;
}
