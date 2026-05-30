import { fixMojibakeFilename } from './filenameEncoding.js';

function cleanDownloadBaseName(value: string, fallback: string) {
  const sanitized = Array.from(value.replace(/[<>:"/\\|?*]/g, '_'))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('');
  return sanitized.trim().slice(0, 180) || fallback;
}

function normalizeDownloadSourceName(value: string | null | undefined, fallback: string) {
  const raw = String(value || '');
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  return (
    fixMojibakeFilename(decoded)
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
      .trim()
      .slice(0, 255) || fallback
  );
}

function normalizeExtension(extension: string | null | undefined, fallback = 'step') {
  return String(extension || fallback)
    .replace(/^\.+/, '')
    .toLowerCase();
}

const DOWNLOAD_FILE_EXTENSIONS = new Set(['step', 'stp', 'iges', 'igs', 'glb', 'gltf', 'pdf']);

function stripDownloadExtension(value: string) {
  const match = value.match(/\.([^.]+)$/);
  if (!match) return value;
  return DOWNLOAD_FILE_EXTENSIONS.has(match[1].toLowerCase()) ? value.slice(0, -match[0].length) : value;
}

function modelNameSeparatorIndex(baseName: string) {
  const indices = [baseName.indexOf('_'), baseName.indexOf('＿')].filter((index) => index >= 0).sort((a, b) => a - b);

  for (const index of indices) {
    const prefix = baseName.slice(0, index).trim();
    const suffix = baseName.slice(index + 1).trim();
    if (prefix && suffix && /[\u3400-\u9fff\uf900-\ufaff]/.test(prefix)) return index;
  }

  return -1;
}

export function modelDownloadBaseName(sourceName: string | null | undefined, fallback = 'model') {
  const normalized = normalizeDownloadSourceName(sourceName, fallback);
  const baseName = stripDownloadExtension(normalized).trim();
  const separatorIndex = modelNameSeparatorIndex(baseName);
  const preferredName = separatorIndex >= 0 ? baseName.slice(separatorIndex + 1).trim() : baseName;
  return cleanDownloadBaseName(preferredName || baseName, fallback);
}

export function hasModelDownloadSuffix(sourceName: string | null | undefined) {
  const normalized = normalizeDownloadSourceName(sourceName, 'model');
  const baseName = stripDownloadExtension(normalized).trim();
  return modelNameSeparatorIndex(baseName) >= 0;
}

export function modelDownloadSourceName(
  modelName: string | null | undefined,
  originalName: string | null | undefined,
  fallback = 'model',
) {
  if (hasModelDownloadSuffix(originalName)) return originalName;
  return modelName || originalName || fallback;
}

export function modelDownloadFileName(
  sourceName: string | null | undefined,
  extension: string | null | undefined,
  fallbackBase = 'model',
) {
  return `${modelDownloadBaseName(sourceName, fallbackBase)}.${normalizeExtension(extension)}`;
}
