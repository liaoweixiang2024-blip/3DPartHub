/**
 * 批量打包下载 ZIP 的统一命名。
 *
 * 之前用 `${prefix}_${Date.now()}.zip`（毫秒时间戳），用户看不出下载日期和文件数量；
 * 统一改为 `${prefix}_${count}个文件_${YYYYMMDD-HHmm}.zip`，一眼可辨。
 */

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

export function formatZipStamp(date = new Date()): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

// 英文前缀 → 中文展示名（调用方仍传英文 key，集中在展示层映射）
const ZIP_PREFIX_LABELS: Record<string, string> = {
  favorites: '收藏打包',
  downloads: '下载打包',
  batch: '批量下载',
};

export function batchZipFileName(prefix: string, fileCount: number, date = new Date()): string {
  const safePrefix = (ZIP_PREFIX_LABELS[prefix] || prefix).replace(/[\s/\\:*?"<>|]+/g, '').trim() || '打包下载';
  const count = Math.max(1, Math.floor(fileCount) || 1);
  return `${safePrefix}_${count}个文件_${formatZipStamp(date)}.zip`;
}

/**
 * 备份归档的下载文件名：`备份_全量_3331模型_20260903-1542.tar.gz`。
 * 只影响下载时的 Content-Disposition，不改变磁盘上的存储文件名（存储 ID 兼容旧记录）。
 */
export function backupDownloadFileName(input: {
  scopeLabel?: string;
  itemCount?: number;
  modelCount?: number;
  fileCount?: number;
  createdAt?: string;
}): string {
  const scope = (input.scopeLabel || '全量').replace(/[\s/\\:*?"<>|]+/g, '').trim() || '全量';
  const count =
    Math.max(0, Math.floor(input.itemCount ?? input.modelCount ?? 0)) || Math.max(0, Math.floor(input.fileCount ?? 0));
  const date = input.createdAt ? new Date(input.createdAt) : new Date();
  const stamp = Number.isNaN(date.getTime()) ? formatZipStamp(new Date()) : formatZipStamp(date);
  const countPart = count > 0 ? `${count}条` : '';
  return ['备份', scope, countPart, stamp].filter(Boolean).join('_') + '.tar.gz';
}
