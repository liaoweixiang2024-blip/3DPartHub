import type { ProductWallItem } from '../../api/productWall';

type WallItem = ProductWallItem;

export type ProductWallCanvasMode = 'white' | 'checker';

export const PRODUCT_WALL_UPLOAD_BATCH_SIZE = 20;
export const PRODUCT_WALL_RENDER_BATCH_SIZE = 24;
export const PRODUCT_WALL_MOBILE_RENDER_BATCH_SIZE = 12;
export const PRODUCT_WALL_EAGER_IMAGE_COUNT = 3;
export const PRODUCT_WALL_MOBILE_EAGER_IMAGE_COUNT = 2;
export const PRODUCT_WALL_CANVAS_MODE_KEY = 'product-wall-canvas-mode';
export const PRODUCT_WALL_DEFAULT_KIND_KEY = 'product-wall-default-kind';
export const PRODUCT_WALL_FAVORITES_FILTER = '__favorites__';

export type WebkitFileSystemEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
};
export type WebkitFileSystemFileEntry = WebkitFileSystemEntry & {
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
};
export type WebkitFileSystemDirectoryEntry = WebkitFileSystemEntry & {
  createReader: () => {
    readEntries: (success: (entries: WebkitFileSystemEntry[]) => void, error?: (error: DOMException) => void) => void;
  };
};
export type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => WebkitFileSystemEntry | null;
};

export function isZipFile(file: File) {
  return (
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed' ||
    file.name.toLowerCase().endsWith('.zip')
  );
}

export function isRarFile(file: File) {
  return (
    file.type === 'application/vnd.rar' ||
    file.type === 'application/x-rar-compressed' ||
    file.name.toLowerCase().endsWith('.rar')
  );
}

export function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
}

export function isSupportedUploadFile(file: File) {
  return isImageFile(file) || isZipFile(file) || isRarFile(file);
}

export function readDirectoryEntries(entry: WebkitFileSystemDirectoryEntry): Promise<WebkitFileSystemEntry[]> {
  const reader = entry.createReader();
  const entries: WebkitFileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

export function readFileEntry(entry: WebkitFileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

export async function collectFilesFromEntry(entry: WebkitFileSystemEntry, maxDepth = 5): Promise<File[]> {
  if (entry.isFile) return [await readFileEntry(entry as WebkitFileSystemFileEntry)];
  if (!entry.isDirectory || maxDepth <= 0) return [];
  const children = await readDirectoryEntries(entry as WebkitFileSystemDirectoryEntry);
  const nested = await Promise.all(children.map((child) => collectFilesFromEntry(child, maxDepth - 1)));
  return nested.flat();
}

export async function collectFilesFromDataTransfer(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items || []) as DataTransferItemWithEntry[];
  if (!items.length) return Array.from(dataTransfer.files);
  const nested = await Promise.all(
    items.map(async (item) => {
      const entry = item.webkitGetAsEntry?.();
      if (entry) return collectFilesFromEntry(entry);
      const file = item.getAsFile();
      return file ? [file] : [];
    }),
  );
  return nested.flat();
}

export type FileWithPath = { file: File; relativePath: string };

async function collectFilesWithPathFromEntry(
  entry: WebkitFileSystemEntry,
  prefix: string,
  maxDepth: number,
): Promise<FileWithPath[]> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as WebkitFileSystemFileEntry);
    return [{ file, relativePath: prefix ? `${prefix}/${file.name}` : file.name }];
  }
  if (!entry.isDirectory || maxDepth <= 0) return [];
  const children = await readDirectoryEntries(entry as WebkitFileSystemDirectoryEntry);
  const dirPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
  const nested = await Promise.all(
    children.map((child) => collectFilesWithPathFromEntry(child, dirPrefix, maxDepth - 1)),
  );
  return nested.flat();
}

/**
 * 展开拖入的 DataTransfer，保留每个文件相对拖入根的路径（文件夹名做模型名依赖该路径）。
 * 必须在 drop 事件的同步阶段调用（内部立刻取 webkitGetAsEntry，items 异步会被浏览器清空），
 * 返回的 Promise 可以往后 await。
 */
export function collectFilesWithPathFromDataTransfer(
  entries: WebkitFileSystemEntry[],
  fallbackFiles: File[],
): Promise<FileWithPath[]> {
  if (!entries.length) return Promise.resolve(fallbackFiles.map((file) => ({ file, relativePath: file.name })));
  return Promise.all(entries.map((entry) => collectFilesWithPathFromEntry(entry, '', 8))).then((lists) => lists.flat());
}

export function wallImageUrl(item: WallItem) {
  if (typeof window === 'undefined') return item.image;
  return new URL(item.image, window.location.origin).toString();
}

export function productWallDownloadName(item: WallItem) {
  const ext = item.image.split('.').pop()?.split('?')[0] || 'webp';
  return `${item.title}.${ext}`;
}

export function productWallPreviewImage(item: WallItem) {
  return item.previewImage || item.image;
}

export function productWallRatioValue(ratio: string) {
  const [width, height] = ratio.split('/').map((part) => Number(part.trim()));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 4 / 5;
  return width / height;
}

export function getProductWallColumnCount() {
  if (typeof window === 'undefined') return 2;
  const width = window.innerWidth;
  if (width >= 1680) return 5;
  if (width >= 1280) return 4;
  if (width >= 860) return 3;
  return 2;
}

export function errorMessage(error: unknown, fallback = '操作失败，请稍后重试') {
  const detail = (error as { response?: { data?: { detail?: string; message?: string } } })?.response?.data;
  return detail?.detail || detail?.message || (error instanceof Error ? error.message : fallback);
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
