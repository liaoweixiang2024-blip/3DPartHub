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
  // 未配置 SITE_URL 的兜底改 fail-closed：请求 Host 必须命中 ALLOWED_ORIGINS 白名单
  // 才采用（含端口精确比对），否则返回空（通知回落为无链接文案）——伪造的
  // X-Forwarded-Host/Host 不能再把邮件/通知里的链接改写到钓鱼域
  const host = firstHeaderValue(req.headers['x-forwarded-host']) || req.get('host') || '';
  if (!host || !isAllowedHost(host)) return '';
  const proto = firstHeaderValue(req.headers['x-forwarded-proto']) || req.protocol || '';
  if (!/^https?$/i.test(proto)) return '';
  return `${proto.toLowerCase()}://${host}`;
}

function isAllowedHost(host: string): boolean {
  const normalizedHost = host.trim().toLowerCase();
  if (!normalizedHost) return false;
  return config.allowedOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .some((origin) => {
      try {
        return new URL(origin).host.toLowerCase() === normalizedHost;
      } catch {
        return false;
      }
    });
}
