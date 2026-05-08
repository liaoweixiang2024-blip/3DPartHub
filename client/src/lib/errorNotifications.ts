import axios, { type AxiosError } from 'axios';

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

function formatRetryWait(seconds: number) {
  const normalizedSeconds = Math.max(1, Math.ceil(seconds));
  if (normalizedSeconds > 60) return `${Math.ceil(normalizedSeconds / 60)} 分钟`;
  return `${normalizedSeconds} 秒`;
}

function stripRetryText(message: string) {
  return message.replace(/[，,]?\s*请(?:稍后|\d+\s*秒后|\d+\s*分钟后)再试\s*$/, '').trim();
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
  const fallback = '请求过于频繁，请稍后再试';
  if (!isRateLimitError(error)) return fallback;

  const serverMessage = getResponseMessage(error.response?.data);
  const retrySeconds = getRateLimitRetrySeconds(error);
  if (!retrySeconds) return serverMessage || fallback;

  const baseMessage = stripRetryText(serverMessage || '请求过于频繁') || '请求过于频繁';
  return `${baseMessage}，请 ${formatRetryWait(retrySeconds)}后再试`;
}

export function getErrorMessage(error: unknown, fallback = '操作失败，请稍后重试') {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as { message?: string; detail?: string; error?: string } | string | undefined;

    if (status === 429) return getRateLimitErrorMessage(error);

    const responseMessage = getResponseMessage(data);
    if (responseMessage) return responseMessage;
    if (status === 0 || error.code === 'ERR_NETWORK') return '网络连接失败，请检查服务器或网络';
    if (status === 401) return '登录状态已失效，请重新登录';
    if (status === 403) return '没有权限执行该操作';
    if (status === 404) return '请求的资源不存在';
    if (status === 413) return '上传内容过大';
    if (status && status >= 500) return '服务器异常，请稍后重试';
    if (error.message) return error.message;
  }

  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;

  return fallback;
}

export function notifyGlobalError(error: unknown, fallback?: string, type: ErrorToastType = 'error') {
  const message = getErrorMessage(error, fallback);
  if (shouldSkipMessage(message)) return;

  if (notifier) {
    notifier(message, type);
    return;
  }

  if (import.meta.env.DEV) console.error(message, error);
}
