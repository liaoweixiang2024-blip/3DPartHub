import axios, { type AxiosError } from 'axios';
import { i18n } from '../i18n';

type ErrorToastType = 'error' | 'info';
type ErrorNotifier = (message: string, type?: ErrorToastType) => void;

let notifier: ErrorNotifier | null = null;
const recentMessages = new Map<string, number>();
const DEDUPE_MS = 2500;

export function setGlobalErrorNotifier(next: ErrorNotifier | null) {
  notifier = next;
}

function normalizeMessage(message: string) {
  return message.replace(/\s+/g, ' ').trim();
}

// iOS/WebKit 对跨域或被脱敏的错误只报 "Script error."（无任何细节）。
// 直接把这句原文弹给用户毫无意义，换成友好文案。
const MUTED_SCRIPT_ERROR_RE = /^script error\.?$/i;

function isMutedScriptError(message: string) {
  return MUTED_SCRIPT_ERROR_RE.test(normalizeMessage(message));
}

function shouldSkipMessage(message: string) {
  const normalized = normalizeMessage(message);
  if (!normalized) return true;

  const now = Date.now();
  const last = recentMessages.get(normalized) || 0;
  recentMessages.set(normalized, now);

  for (const [key, time] of recentMessages) {
    if (now - time > DEDUPE_MS * 2) recentMessages.delete(key);
  }

  return now - last < DEDUPE_MS;
}

function isMessageObject(value: unknown): value is { message?: string; detail?: string; error?: string } {
  return !!value && typeof value === 'object';
}

function getResponseMessage(data: unknown) {
  if (typeof data === 'string' && data.trim()) return data;
  if (isMessageObject(data)) {
    if (data.message) return data.message;
    if (data.detail) return data.detail;
    if (data.error) return data.error;
  }
  return '';
}

function getHeaderValue(headers: unknown, name: string) {
  if (!headers || typeof headers !== 'object') return '';

  const maybeHeaders = headers as {
    get?: (headerName: string) => unknown;
    [key: string]: unknown;
  };

  const fromGet = maybeHeaders.get?.(name);
  const rawValue = fromGet ?? maybeHeaders[name] ?? maybeHeaders[name.toLowerCase()];
  if (Array.isArray(rawValue)) return String(rawValue[0] || '');
  if (rawValue == null) return '';
  return String(rawValue);
}

function parseRetrySeconds(value: string) {
  if (!value.trim()) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric);

  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) {
    const seconds = Math.ceil((timestamp - Date.now()) / 1000);
    if (seconds > 0) return seconds;
  }

  return null;
}

function tToast(key: string, fallback: string, options?: Record<string, unknown>) {
  if (!i18n.isInitialized) return fallback;
  return String(i18n.t(`toast.${key}`, { defaultValue: fallback, ...options }));
}

function formatRetryWait(seconds: number) {
  const normalizedSeconds = Math.max(1, Math.ceil(seconds));
  if (normalizedSeconds > 60) {
    return tToast('retryMinutes', `${Math.ceil(normalizedSeconds / 60)} minutes`, {
      count: Math.ceil(normalizedSeconds / 60),
    });
  }
  return tToast('retrySeconds', `${normalizedSeconds} seconds`, { count: normalizedSeconds });
}

function stripRetryText(message: string) {
  // 后端文案可能是「请15分钟后重试」或「请稍后再试」——都剥掉，避免与前端拼的
  // 「请 {{time}}后再试」叠成「……请15分钟后重试，请 14 分钟后再试」
  return message
    .replace(/[，,]?\s*请(?:稍后|\d+\s*秒后|\d+\s*分钟后)[再重]试\s*$/, '')
    .replace(/[，,]?\s*请(?:稍后|\d+\s*秒后|\d+\s*分钟后)[再重]试(?=[，,。])/g, '')
    .trim();
}

export function isRateLimitError(error: unknown): error is AxiosError {
  return axios.isAxiosError(error) && error.response?.status === 429;
}

export function getRateLimitRetrySeconds(error: unknown) {
  if (!isRateLimitError(error)) return null;

  const retryAfter = getHeaderValue(error.response?.headers, 'retry-after');
  const retryAfterSeconds = parseRetrySeconds(retryAfter);
  if (retryAfterSeconds) return retryAfterSeconds;

  const resetAfter = getHeaderValue(error.response?.headers, 'ratelimit-reset');
  return parseRetrySeconds(resetAfter);
}

export function getRateLimitErrorMessage(error: unknown) {
  const fallback = tToast('rateLimit', 'Too many requests. Please try again later');
  if (!isRateLimitError(error)) return fallback;

  const serverMessage = getResponseMessage(error.response?.data);
  const retrySeconds = getRateLimitRetrySeconds(error);
  if (!retrySeconds) return serverMessage || fallback;

  const baseMessage = stripRetryText(serverMessage || tToast('rateLimitBase', 'Too many requests')) || fallback;
  return tToast('rateLimitWithWait', `${baseMessage}. Please try again after ${formatRetryWait(retrySeconds)}`, {
    message: baseMessage,
    time: formatRetryWait(retrySeconds),
  });
}

/** 已知冗长/技术性的服务端报错 → 一句话友好提示。
 *  命中规则的原始文案保留在 console（[server-error] 前缀），便于排查。 */
const VERBOSE_SERVER_MESSAGE_RULES: Array<{ re: RegExp; text: string }> = [
  {
    // 转换子进程 OOM / 内存不足：服务端附带信号名、源文件大小、容器配额、调参建议等诊断信息
    re: /heap out of memory|SIGABRT|SIGSEGV|SIGKILL|OOM|内存不足|内存配额|转换子进程异常退出/i,
    text: '服务器内存不足，转换失败：大文件请拆分上传，或联系管理员调大服务器内存配置',
  },
  {
    // 上传体积超限（nginx / express body 限制返回的原文）
    re: /payload too large|entity too large|request entity|multererror/i,
    text: '文件过大，超出服务器上传限制',
  },
  {
    // Prisma 内部错误原文（Invalid `prisma.xxx()` …）对用户无意义
    re: /Invalid `prisma\.|prismaclientvalidationerror|prisma client/i,
    text: '数据服务异常，请稍后重试；持续出现请联系管理员',
  },
];

/** 服务端原始报错简化：规则映射 → 剥 HTML 错误页/换行堆栈 → 超长截断到首句 */
function simplifyServerMessage(raw: string): string {
  const original = raw.trim();
  if (!original) return original;
  // 原始完整文案进 console，弹窗只给简短版
  console.info('[server-error]', original);

  // nginx / 网关错误页是整页 HTML，先剥标签
  const stripped = /<[a-z!]/i.test(original)
    ? original
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : original;

  for (const rule of VERBOSE_SERVER_MESSAGE_RULES) {
    if (rule.re.test(stripped)) return rule.text;
  }

  // 兜底：只取第一行（去掉换行携带的堆栈/元信息），超长时截到首个句读或 60 字
  let brief = stripped.split(/\r?\n/)[0].trim();
  if (brief.length > 80) {
    const sentence = brief.match(/^[^。；;！!]{1,60}[。；;！!]/);
    brief = sentence ? sentence[0] : `${brief.slice(0, 60)}…`;
  }
  return brief || original;
}

export function getErrorMessage(error: unknown, fallback?: string) {
  const defaultFallback = fallback || tToast('operationFailed', 'Operation failed. Please try again later');

  // 被浏览器脱敏的错误（典型：iOS 点系统分享面板后 WebGL 上下文恢复时抛错）
  // 只有 "Script error." 一句原文，换成通用兜底文案而不是弹英文术语
  if (typeof error === 'string' && isMutedScriptError(error)) return defaultFallback;
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as { message?: string; detail?: string; error?: string } | string | undefined;

    if (status === 429) return getRateLimitErrorMessage(error);

    const responseMessage = getResponseMessage(data);
    // 服务端文案统一走简化：已知技术性长文（内存诊断/Prisma/HTML 错误页）换成一句话
    if (responseMessage) return simplifyServerMessage(responseMessage);
    if (status === 0 || error.code === 'ERR_NETWORK') {
      return tToast('networkFailed', 'Network connection failed. Check the server or network');
    }
    if (status === 401) return tToast('sessionExpired', 'Your session has expired. Please log in again');
    if (status === 403) return tToast('permissionDenied', 'You do not have permission to perform this action');
    if (status === 404) return tToast('resourceNotFound', 'The requested resource does not exist');
    if (status === 413) return tToast('uploadTooLarge', 'Uploaded content is too large');
    if (status && status >= 500) return tToast('serverError', 'Server error. Please try again later');
    if (error.message) return error.message;
  }

  if (error instanceof Error && error.message) {
    return isMutedScriptError(error.message) ? defaultFallback : simplifyServerMessage(error.message);
  }
  if (typeof error === 'string' && error.trim()) return simplifyServerMessage(error);

  return defaultFallback;
}

/** 判断「原始错误」（未经 getErrorMessage 转换）是否为浏览器脱敏的 Script error */
function isMutedScriptErrorValue(error: unknown): boolean {
  if (typeof error === 'string') return isMutedScriptError(error);
  if (error instanceof Error) return isMutedScriptError(error.message);
  return false;
}

export function notifyGlobalError(error: unknown, fallback?: string, type: ErrorToastType = 'error') {
  // 脱敏错误对用户是噪音（用户无法据此做任何事），静默吞掉不上 toast。
  // 典型场景：iOS Safari 点系统分享/添加主屏幕 → 页面挂起恢复时 WebGL 抛错。
  // 注意：必须在「原始错误」上判断——getErrorMessage 会把 Script error 替换成
  // fallback 文案（如「页面运行出错」），替换后的文案永远匹配不上脱敏判断。
  if (isMutedScriptErrorValue(error)) return;

  const message = getErrorMessage(error, fallback);
  if (shouldSkipMessage(message)) return;

  if (notifier) {
    notifier(message, type);
    return;
  }

  if (import.meta.env.DEV) console.error(message, error);
}
