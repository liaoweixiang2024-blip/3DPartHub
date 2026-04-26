import axios from "axios";

type ErrorToastType = "error" | "info";
type ErrorNotifier = (message: string, type?: ErrorToastType) => void;

let notifier: ErrorNotifier | null = null;
const recentMessages = new Map<string, number>();
const DEDUPE_MS = 2500;

export function setGlobalErrorNotifier(next: ErrorNotifier | null) {
  notifier = next;
}

function normalizeMessage(message: string) {
  return message.replace(/\s+/g, " ").trim();
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

export function getErrorMessage(error: unknown, fallback = "操作失败，请稍后重试") {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as
      | { message?: string; detail?: string; error?: string }
      | string
      | undefined;

    if (typeof data === "string" && data.trim()) return data;
    if (data?.message) return data.message;
    if (data?.detail) return data.detail;
    if (data?.error) return data.error;
    if (status === 0 || error.code === "ERR_NETWORK") return "网络连接失败，请检查服务器或网络";
    if (status === 401) return "登录状态已失效，请重新登录";
    if (status === 403) return "没有权限执行该操作";
    if (status === 404) return "请求的资源不存在";
    if (status === 413) return "上传内容过大";
    if (status === 429) return "请求过于频繁，请稍后再试";
    if (status && status >= 500) return "服务器异常，请稍后重试";
    if (error.message) return error.message;
  }

  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;

  return fallback;
}

export function notifyGlobalError(error: unknown, fallback?: string, type: ErrorToastType = "error") {
  const message = getErrorMessage(error, fallback);
  if (shouldSkipMessage(message)) return;

  if (notifier) {
    notifier(message, type);
    return;
  }

  console.error(message, error);
}
