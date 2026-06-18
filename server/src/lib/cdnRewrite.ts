// CDN 响应改写中间件（完整 URL 改写方案）
//
// 把 JSON 响应里的 /static/ 路径改写为配置的 CDN/公开域名。浏览器拿到改写后的 URL
// 后直连 CDN（无 302、无回环），CDN 回源指向本站 /static。
//
// 规则：
// - 仅当配了 storage_cdn_base_url 或 storage_public_base_url 时启用。
// - 域名解析：优先 storage_cdn_base_url（CDN 加速域名），否则 storage_public_base_url（公开基址）。
// - 类型门控（按 /static/ 后的首段）：
//     图片类（thumbnails/product-wall/option-images/selection-assets/logo/favicon/watermark）
//       → 受 image_cdn_enabled 控制
//     资源类（models/originals/drawings/html-previews/batch）
//       → 受 resource_cdn_enabled 控制
//     其余 → 不改写
// - 只改写"字符串值开头"的 /static/（JSON 里形如 "/static/..."），避免误伤正文中提到 /static 的描述。
// - 保留 query（?t=...）；body 不含 /static/ 时走原始 res.json，零额外开销。
import type { NextFunction, Request, Response } from 'express';
import { getCachedSettings } from './settings.js';

const IMAGE_SEGMENTS = new Set([
  'thumbnails',
  'product-wall',
  'option-images',
  'selection-assets',
  'logo',
  'favicon',
  'watermark',
]);
const RESOURCE_SEGMENTS = new Set(['models', 'originals', 'drawings', 'html-previews', 'batch']);

/** 根据 /static/<seg>/... 路径判定是否应改写，返回要拼接的 base 域名（无需改写则 null）。 */
function resolveBaseUrl(path: string, settings: Record<string, unknown>): string | null {
  // path 形如 /static/thumbnails/xxx；取 /static/ 后的第一段
  const segment = path.slice('/static/'.length).split('/')[0] || '';
  const isImage = IMAGE_SEGMENTS.has(segment);
  if (!isImage && !RESOURCE_SEGMENTS.has(segment)) return null;
  const enabled = isImage ? settings.image_cdn_enabled === true : settings.resource_cdn_enabled === true;
  if (!enabled) return null;
  const base = String(settings.storage_cdn_base_url || settings.storage_public_base_url || '')
    .trim()
    .replace(/["']/g, '')
    .replace(/\/+$/, '');
  return base || null;
}

export function cdnUrlRewrite(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    const settings = getCachedSettings();
    if (!settings.storage_cdn_base_url && !settings.storage_public_base_url) {
      return originalJson(body);
    }
    let str: string;
    try {
      str = JSON.stringify(body);
    } catch {
      return originalJson(body);
    }
    if (typeof str !== 'string' || !str.includes('/static/')) {
      return originalJson(body);
    }
    str = str.replace(/"(\/static\/[^"]*)"/g, (full, path: string) => {
      const base = resolveBaseUrl(path, settings);
      return base ? `"${base}${path}"` : full;
    });
    res.set('Content-Type', 'application/json');
    return res.send(str);
  }) as typeof res.json;
  next();
}
