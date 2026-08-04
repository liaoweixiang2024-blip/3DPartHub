import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

/**
 * 判断地址是否为本机/内网/保留段（SSRF 防护）。覆盖 IPv4 全部私有/保留段 + IPv6
 * （含 ::ffff: 映射、链路本地、唯一本地、多播等）。命中即视为禁止访问的远程目标。
 */
function isBlockedRemoteAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map((part) => Number(part));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase().split('%')[0] || '';
    if (lower.startsWith('::ffff:')) return isBlockedRemoteAddress(lower.slice('::ffff:'.length));
    const firstHextet = Number.parseInt(lower.split(':')[0] || '0', 16);
    return (
      lower === '::' ||
      lower === '::1' ||
      (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) ||
      (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
      (firstHextet >= 0xff00 && firstHextet <= 0xffff)
    );
  }
  return false;
}

/** 远程图片主机被 SSRF 策略拒绝（内网/保留地址/重定向）。 */
export class RemoteImageHostBlockedError extends Error {
  constructor() {
    super('REMOTE_IMAGE_HOST_BLOCKED');
    this.name = 'RemoteImageHostBlockedError';
  }
}

export function isRemoteImageHostBlockedError(err: unknown): boolean {
  return err instanceof RemoteImageHostBlockedError;
}

export interface GuardedRemoteImage {
  ok: boolean;
  status: number;
  contentType: string;
  contentLength: number;
  body: NodeJS.ReadableStream;
}

/**
 * 拉取远程图片，带 SSRF 防护 + DNS rebinding 防护。
 *
 * 先 dns.lookup 解析并逐个校验地址（拒绝本机/内网/保留段），随后**直连第一个校验过的 IP**
 * （http/https 的 hostname 锁定到该 IP，过程中不再做二次 DNS 解析），从而消除「先 lookup 校验、
 * 后 fetch 时被 DNS rebinding 切到内网」的 TOCTOU 窗口。
 *
 * - 拒绝重定向（3xx 视为 blocked），防止跳转到未校验地址。
 * - 超时通过 AbortError 名向外抛，便于调用方复用既有「下载图片超时」分支。
 * - HTTPS 用 servername 保持正确的 SNI / 证书校验（用原域名，而非 IP）。
 */
export async function fetchRemoteImageGuarded(
  url: URL,
  options: { timeoutMs?: number } = {},
): Promise<GuardedRemoteImage> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || isBlockedRemoteAddress(hostname)) {
    throw new RemoteImageHostBlockedError();
  }
  const addresses = await lookup(hostname, { all: true, verbatim: false });
  if (!addresses.length || addresses.some(({ address }) => isBlockedRemoteAddress(address))) {
    throw new RemoteImageHostBlockedError();
  }

  // 锁定到预先校验过的地址：直连该 IP，杜绝 fetch 阶段二次 DNS 解析（DNS rebinding）
  const target = addresses[0];
  const isHttps = url.protocol === 'https:';
  const reqModule = isHttps ? https : http;
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
  const timeoutMs = options.timeoutMs ?? 15000;

  return new Promise<GuardedRemoteImage>((resolve, reject) => {
    const req = reqModule.request(
      {
        method: 'GET',
        hostname: target.address,
        port,
        path: `${url.pathname}${url.search}`,
        headers: { host: url.host },
        ...(isHttps ? { servername: url.hostname } : {}),
      },
      (res) => {
        if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          reject(new RemoteImageHostBlockedError());
          return;
        }
        const rawLen = Number(res.headers['content-length'] || 0);
        resolve({
          ok: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode ?? 0,
          contentType: res.headers['content-type'] || '',
          contentLength: Number.isFinite(rawLen) ? rawLen : 0,
          body: res,
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      const err = new Error('REMOTE_IMAGE_TIMEOUT');
      err.name = 'AbortError';
      req.destroy(err);
    });
    req.end();
  });
}
