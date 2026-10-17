import { Response } from 'express';
import { cacheDelByPrefix } from '../../lib/cache.js';
import type { AuthRequest } from '../../middleware/auth.js';

export function adminOnly(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ detail: '需要管理员权限' });
    return false;
  }
  return true;
}

export function asSingleString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return undefined;
}

export function isValidGroupImageFit(value: unknown): value is 'cover' | 'contain' | null {
  return value === 'cover' || value === 'contain' || value === null;
}

export async function invalidateSelectionCache() {
  await cacheDelByPrefix('cache:selections:');
}

/** 选项画册条目：旧数据是纯 URL 字符串；新写入为 { url, updatedAt }（管理端展示上传/更新时间） */
export type OptionCatalogEntry = string | { url: string; updatedAt: string };

/** 兼容读取新旧两种画册条目，统一取 URL（无效/缺失返回 null） */
export function optionCatalogUrl(entry: unknown): string | null {
  if (typeof entry === 'string' && entry) return entry;
  if (entry && typeof entry === 'object' && typeof (entry as { url?: unknown }).url === 'string') {
    return (entry as { url: string }).url;
  }
  return null;
}
