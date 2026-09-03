/**
 * 批量打包下载 ZIP 的统一命名（与服务端 server/src/lib/zipDownloadName.ts 保持同一格式）。
 * `${prefix}_${count}个文件_${YYYYMMDD-HHmm}.zip` —— 一眼可辨日期和数量。
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

// 与服务端 ZIP_PREFIX_LABELS 保持同一映射（前端仅兜底展示，正常路径用响应头的 filename*）
const ZIP_PREFIX_LABELS: Record<string, string> = {
  favorites: '收藏打包',
  downloads: '下载打包',
  batch: '批量下载',
};

export function batchZipName(prefix: string, fileCount: number, date = new Date()): string {
  const safePrefix = (ZIP_PREFIX_LABELS[prefix] || prefix).replace(/[\s/\\:*?"<>|]+/g, '').trim() || '打包下载';
  const count = Math.max(1, Math.floor(fileCount) || 1);
  return `${safePrefix}_${count}个文件_${formatZipStamp(date)}.zip`;
}
