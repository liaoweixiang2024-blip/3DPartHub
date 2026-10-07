// 下载设备粗分类：只存 mobile/desktop/unknown 三值枚举，不落完整 UA（避免浏览器指纹隐私问题）。
// 已知局限：iPadOS 13+ 默认伪装成 Mac 桌面 UA（无 Touch 标记），会被计入 desktop——
// 纯 UA 无法区分，属可接受的粗分误差。

export type DownloadDevice = 'mobile' | 'desktop' | 'unknown';

const MOBILE_UA_PATTERN = /ipad|iphone|ipod|android|mobile|windows phone|iemobile|opera mini/;

export function deviceFromUserAgent(userAgent: string | undefined | null): DownloadDevice {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (!ua.trim()) return 'unknown';
  return MOBILE_UA_PATTERN.test(ua) ? 'mobile' : 'desktop';
}

/** 从 Express 请求头提取下载设备分类（记录下载事件用） */
export function deviceFromRequest(req: { headers: Record<string, unknown> }): DownloadDevice {
  const raw = req.headers['user-agent'];
  const userAgent = Array.isArray(raw) ? raw[0] : raw;
  return deviceFromUserAgent(typeof userAgent === 'string' ? userAgent : null);
}
