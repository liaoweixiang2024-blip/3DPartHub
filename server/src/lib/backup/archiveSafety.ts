// 备份归档条目的路径安全校验（纯逻辑，零 I/O，便于单元测试）。
//
// 抽自 ../backup.ts：恢复前对 tar 归档条目做路径遍历（../、绝对路径、盘符、
// null 字节、符号链接/特殊文件）与噪声条目（__MACOSX、.DS_Store、._*）过滤。
// I/O 部分（exec tar、解压、进度）仍留在 backup.ts，通过这里的纯函数判定安全性。

import { isAbsolute } from 'path';

// 跨平台噪声文件名：macOS 资源 fork 残留等，恢复/统计时直接丢弃。
export function isIgnoredFileName(name: string): boolean {
  return name === '__MACOSX' || name === '.DS_Store' || name.startsWith('._');
}

function isIgnoredArchiveEntry(entry: string): boolean {
  return entry
    .split('/')
    .filter(Boolean)
    .some((part) => isIgnoredFileName(part));
}

export function normalizeBackupArchiveEntryList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map(normalizeArchiveEntryLine)
    .filter((line): line is string => Boolean(line));
}

export function normalizeArchiveEntryLine(line: string): string | null {
  const normalized = line.trim().replace(/^\.\//, '');
  if (!normalized || isIgnoredArchiveEntry(normalized)) return null;
  return normalized;
}

export function isUnsafeBackupArchiveEntry(entry: string): boolean {
  const normalized = entry.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.includes('\0')) return true;
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || isAbsolute(normalized)) return true;
  return normalized.split('/').some((part) => part === '..');
}

export function isUnsafeBackupArchiveVerboseEntry(line: string): boolean {
  const trimmed = line.trimStart();
  if (!trimmed) return false;
  const type = trimmed[0];
  return type !== '-' && type !== 'd';
}

export function summarizeTarVerboseLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ').slice(0, 240);
}
