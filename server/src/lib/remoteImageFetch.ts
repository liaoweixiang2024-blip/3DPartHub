import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

/**
 * 把 IPv6 地址完整展开成 8 个 hextet（处理 :: 压缩、IPv4 内嵌尾段、zone id）。
 * 解析失败返回 null——调用方按危险处理（保守侧）。
 */
function expandIpv6(address: string): number[] | null {
  let addr = address.toLowerCase().split('%')[0];
  const v4tail = addr.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4tail) {
    const octets = v4tail[2].split('.').map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const [a, b, c, d] = octets;
    addr = `${v4tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 && missing < 0) return null;
  if (halves.length === 1 && head.length !== 8) return null;
  const parts = [...head, ...(halves.length === 2 ? Array<string>(missing).fill('0') : []), ...tail];
  if (parts.length !== 8) return null;
  const hextets: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    hextets.push(parseInt(part, 16));
  }
  return hextets;
}

/**
 * 判断地址是否为本机/内网/保留段（SSRF 防护）。覆盖 IPv4 全部私有/保留段 + IPv6
 * （完整展开后按前缀匹配：::、::1、IPv4 兼容/映射段（含十六进制形态 ::ffff:7f00:1）、
 * ULA、链路本地、多播、NAT64 64:ff9b::/96、6to4 2002::/16）。命中即视为禁止访问。
 */
export function isBlockedRemoteAddress(address: string): boolean {
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
    const h = expandIpv6(address);
    if (!h) return true; // 解析不了的一律拒绝（保守侧）
    const first = h[0];
    // ::（未指定）与 ::1（环回）以及整个 ::/96 IPv4 兼容段（::127.0.0.1 / ::7f00:1）：
    // 公网单播（2000::/3）不可能有 6 个前导零段，整段拒绝是安全的
    if (h.slice(0, 6).every((x) => x === 0)) return true;
    // ::ffff:0:0/96 IPv4 映射段（含十六进制写法）
    if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return true;
    // fc00::/7 唯一本地、fe80::/10 链路本地、ff00::/8 多播
    if ((first & 0xfe00) === 0xfc00) return true;
    if ((first & 0xffc0) === 0xfe80) return true;
    if ((first & 0xff00) === 0xff00) return true;
    // 6to4（内嵌 IPv4 可能指向内网）与 NAT64 64:ff9b::/96（映射 IPv4 回环/内网）
    if (first === 0x2002) return true;
    if (first === 0x0064 && h[1] === 0xff9b) return true;
    return false;
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
