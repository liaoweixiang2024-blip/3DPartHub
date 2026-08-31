import { fixMojibakeText, normalizeUploadFilename } from '../lib/filenameEncoding.js';

export type StructuredArchivePath = {
  categoryName: string;
  subcategoryName: string | null;
  modelName: string;
  modelDirKey: string;
  /** 模型文件位于零件目录的子文件夹内（改版/加配件组合等变体），批量上传时若零件目录有直接模型文件则跳过 */
  isBelowModelDir: boolean;
};

export type StructuredArchivePathOptions = {
  isKnownSubcategory?: (categoryName: string, segmentName: string) => boolean | undefined;
};

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}

function normalizeArchiveSegment(value: string, maxLength = 180): string {
  return normalizeUploadFilename(value).trim().slice(0, maxLength);
}

function archivePathQualityScore(value: string) {
  if (!value) return -1000;
  const cjkCount = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const asciiCount = (value.match(/[a-zA-Z0-9_\-\s()[\]（）【】.\\/]/g) || []).length;
  const replacementCount = (value.match(/\uFFFD/g) || []).length;
  const controlCount = (value.match(/[\u0000-\u001f\u007f-\u009f]/g) || []).length;
  return cjkCount * 12 + asciiCount - replacementCount * 80 - controlCount * 20;
}

function decodeArchiveNameBytes(rawName: Buffer): string {
  const candidates = [
    rawName.toString('utf8'),
    new TextDecoder('gbk').decode(rawName),
    new TextDecoder('gb18030').decode(rawName),
  ];
  return candidates.reduce((best, candidate) =>
    archivePathQualityScore(candidate) > archivePathQualityScore(best) ? candidate : best,
  );
}

export function decodeZipEntryNameForUpload(entry: {
  entryName: string;
  rawEntryName?: Buffer | Uint8Array;
  header?: { flags?: number } | null;
}): string {
  const rawName = entry.rawEntryName ? Buffer.from(entry.rawEntryName) : null;
  if (!rawName?.length) return entry.entryName;
  // ZIP 规范 EFS 标志位（flags bit 11 = 0x800）= 文件名是 UTF-8，直接信任——不能走启发式打分：
  // UTF-8 中文每 3 字节会被 GBK 解成 1.5 个乱码汉字（仍在 CJK 计分区），乱码串 CJK 字符数
  // 反而更多、得分更高，导致正确的 UTF-8 名被 GBK 乱码覆盖（Python/macOS 打的中文 ZIP 都中招）。
  if ((entry.header?.flags ?? 0) & 0x800) return rawName.toString('utf8');
  return decodeArchiveNameBytes(rawName);
}

export function normalizeBatchArchiveEntryName(entryName: string): string | null {
  const normalized = entryName
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => fixMojibakeText(segment))
    .join('/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.includes('\0')) {
    return null;
  }
  const clean = normalized
    .split('/')
    .reduce<string[]>((parts, part) => {
      if (!part || part === '.') return parts;
      if (part === '..') {
        parts.pop();
        return parts;
      }
      parts.push(part);
      return parts;
    }, [])
    .join('/');
  if (
    !clean ||
    clean === '..' ||
    entryName
      .replace(/\\/g, '/')
      .split('/')
      .some((part) => part === '..')
  )
    return null;
  if (/^[a-zA-Z]:/.test(clean)) return null;
  return clean;
}

function segmentContainsModelStem(segment: string, fileStem: string) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/[\s_\-()（）【】[\].]/g, '');
  const normalizedSegment = normalize(segment);
  const normalizedStem = normalize(fileStem);
  return Boolean(normalizedStem && normalizedSegment.includes(normalizedStem));
}

function isLikelyModelFolder(segment: string, fileStem: string) {
  return segment.includes('_') || segment.includes('＿') || segmentContainsModelStem(segment, fileStem);
}

export function structuredArchivePath(
  cleanName: string,
  options: StructuredArchivePathOptions = {},
): StructuredArchivePath | null {
  const parts = cleanName
    .split('/')
    .filter(Boolean)
    .map((part) => normalizeArchiveSegment(part));
  if (parts.length < 2) return null;

  const fileName = parts.at(-1) || '';
  const fileStem = stripExtension(fileName);
  const dirs = parts.slice(0, -1);
  const [categoryName] = dirs;
  const secondDir = dirs[1];
  const thirdDir = dirs[2];
  const knownSubcategory =
    categoryName && secondDir ? options.isKnownSubcategory?.(categoryName, secondDir) : undefined;
  const thirdDirLooksLikeModelFolder = thirdDir ? isLikelyModelFolder(thirdDir, fileStem) : false;
  const secondDirIsModelFolder =
    Boolean(secondDir) &&
    (knownSubcategory === false ||
      (knownSubcategory !== true &&
        (isLikelyModelFolder(secondDir, fileStem) || (thirdDir ? !thirdDirLooksLikeModelFolder : false))));
  const hasSubcategory = Boolean(secondDir && !secondDirIsModelFolder);
  const subcategoryName = hasSubcategory ? secondDir : null;
  const modelName = secondDirIsModelFolder ? secondDir : hasSubcategory && thirdDir ? thirdDir : fileStem;
  if (!categoryName || (hasSubcategory && !subcategoryName) || !modelName) return null;
  const modelKeyParts = hasSubcategory ? [categoryName, subcategoryName, modelName] : [categoryName, modelName];
  // 嵌套判定：零件目录是第二层（无子分类，段数>3 为嵌套）或第三层（有子分类，段数>4 为嵌套）；
  // 文件直接在分类/子分类下（无零件目录）时恒不嵌套
  const isBelowModelDir = secondDirIsModelFolder ? parts.length > 3 : hasSubcategory ? parts.length > 4 : false;
  return {
    categoryName: categoryName.slice(0, 50),
    subcategoryName: subcategoryName ? subcategoryName.slice(0, 50) : null,
    modelName,
    modelDirKey: modelKeyParts.filter(Boolean).join('/').toLowerCase(),
    isBelowModelDir,
  };
}
