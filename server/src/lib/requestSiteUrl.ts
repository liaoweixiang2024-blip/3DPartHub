import type { Request } from 'express';
import { config } from './config.js';

function firstHeaderValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] || '' : value || '';
  return raw.split(',')[0]?.trim() || '';
}

export function requestSiteUrl(req: Pick<Request, 'headers' | 'get' | 'protocol'>): string {
  // SITE_URL 配置优先：不再从请求头推断（Host/X-Forwarded-Host 可被注入伪造，
  // 防密码重置等带 token 的邮件链接被改写到钓鱼域——见 config.siteUrl 注释）
  if (config.siteUrl && /^https?:\/\//i.test(config.siteUrl)) return config.siteUrl;
  const host = firstHeaderValue(req.headers['x-forwarded-host']) || req.get('host') || '';
  const proto = firstHeaderValue(req.headers['x-forwarded-proto']) || req.protocol || '';
  if (!host || !/^https?$/i.test(proto)) return '';
  return `${proto.toLowerCase()}://${host}`;
}
