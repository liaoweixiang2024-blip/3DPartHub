import type { Request } from 'express';

function firstHeaderValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] || '' : value || '';
  return raw.split(',')[0]?.trim() || '';
}

export function requestSiteUrl(req: Pick<Request, 'headers' | 'get' | 'protocol'>): string {
  const host = firstHeaderValue(req.headers['x-forwarded-host']) || req.get('host') || '';
  const proto = firstHeaderValue(req.headers['x-forwarded-proto']) || req.protocol || '';
  if (!host || !/^https?$/i.test(proto)) return '';
  return `${proto.toLowerCase()}://${host}`;
}
