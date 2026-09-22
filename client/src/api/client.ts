import axios from 'axios';
import { i18n } from '../i18n';
import { getErrorMessage, getRateLimitRetrySeconds, notifyGlobalError } from '../lib/errorNotifications';
import { getAccessToken, useAuthStore } from '../stores/useAuthStore';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 120000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Simple circuit breaker — if too many consecutive server errors, pause requests briefly
let consecutiveServerErrors = 0;
let circuitOpenUntil = 0;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 15000;
const DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 60;
const rateLimitNoticeUntil = new Map<string, number>();

function tToast(key: string, fallback: string) {
  if (!i18n.isInitialized) return fallback;
  return String(i18n.t(`toast.${key}`, { defaultValue: fallback }));
}

function isCircuitOpen(): boolean {
  if (Date.now() < circuitOpenUntil) return true;
  circuitOpenUntil = 0;
  return false;
}

function recordServerError() {
  consecutiveServerErrors++;
  if (consecutiveServerErrors >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    notifyGlobalError(
      tToast('serviceUnavailableRetrying', 'Server is temporarily unavailable. Retrying automatically...'),
    );
  }
}

function resetCircuit() {
  consecutiveServerErrors = 0;
  circuitOpenUntil = 0;
}

// Reject requests when circuit is open
client.interceptors.request.use((config) => {
  if (isCircuitOpen()) {
    return Promise.reject(
      new Error(tToast('serviceUnavailable', 'Service is temporarily unavailable. Please try again later')),
    );
  }
  return config;
});

client.interceptors.request.use((config) => {
  const accessToken = getAccessToken();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  // Let browser set Content-Type with boundary for FormData
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

// Queue for requests that failed with 401 while a refresh is in-flight.
// The refresh lock is managed by useAuthStore._refreshPromise.
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];
let refreshInProgress = false;

// 会话失效的「提示 + 登出 + 跳登录页」全局只执行一次：
// 并发请求同时吃 401 时（如开启浏览门槛后打开首页），不去重会叠一排「登录状态已失效」toast。
let sessionExpiredHandled = false;

function handleSessionExpiredOnce() {
  if (sessionExpiredHandled) return;
  sessionExpiredHandled = true;
  notifyGlobalError(tToast('sessionExpired', 'Your session has expired. Please log in again'));
  useAuthStore.getState().logout();
  // 带上当前位置，登录后可回跳；已是 /login 则不再跳
  if (!window.location.pathname.startsWith('/login')) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login?redirect=${returnTo}`);
  }
}

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
}

function isSilentBackgroundRequest(config: { method?: unknown; url?: unknown } | undefined) {
  const method = String(config?.method || 'get').toLowerCase();
  const url = String(config?.url || '');
  return method === 'get' && (url.startsWith('/notifications/unread-count') || url.startsWith('/notifications?'));
}

function getRateLimitNoticeKey(config: { method?: unknown; url?: unknown } | undefined) {
  const method = String(config?.method || 'get').toLowerCase();
  const url = String(config?.url || 'unknown');
  return `${method}:${url}`;
}

function shouldNotifyRateLimit(config: { method?: unknown; url?: unknown } | undefined, retrySeconds: number) {
  const now = Date.now();
  for (const [key, until] of rateLimitNoticeUntil) {
    if (until <= now) rateLimitNoticeUntil.delete(key);
  }

  const key = getRateLimitNoticeKey(config);
  const existingUntil = rateLimitNoticeUntil.get(key) || 0;
  const nextUntil = now + Math.max(1, retrySeconds) * 1000;
  rateLimitNoticeUntil.set(key, Math.max(existingUntil, nextUntil));

  return now >= existingUntil;
}

client.interceptors.response.use(
  (response) => {
    resetCircuit();
    return response;
  },
  async (error) => {
    const originalRequest = error.config;
    const silentBackgroundRequest = isSilentBackgroundRequest(originalRequest);
    // 进入处理器时的登录态：区分「会话真失效」（要提示+跳登录）与「本来就没登录」
    // （开启浏览门槛时匿名访问公开接口吃 401，应静默、由页面级锁屏/登录引导承接）
    const wasAuthenticated = useAuthStore.getState().isAuthenticated;

    // 统一改写 err.message 为简化后的友好文案（getErrorMessage 内含服务端长文规则）：
    // 页面里大量 `err instanceof Error ? err.message` 的写法不走 getErrorMessage，
    // 不改写的话它们弹的是 "Request failed with status code 500" 或服务端原始长文。
    // 只动 message，response/status/code 保持原样——按状态码分支判断的页面不受影响。
    if (error instanceof Error && !axios.isCancel(error)) {
      error.message = getErrorMessage(error);
    }

    // Don't retry login/register/refresh endpoints
    const isAuthEndpoint =
      originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/register') ||
      originalRequest.url?.includes('/auth/refresh');

    // Track server errors for circuit breaker
    if (error.response && error.response.status >= 500) {
      recordServerError();
    }

    // Show rate limit notification
    if (error.response?.status === 429) {
      const seconds = getRateLimitRetrySeconds(error) || DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS;
      if (!silentBackgroundRequest && shouldNotifyRateLimit(originalRequest, seconds)) {
        notifyGlobalError(getErrorMessage(error));
      }
      return Promise.reject(error);
    }

    if (error.response?.status !== 401 || originalRequest._retry || isAuthEndpoint) {
      // For 401 on non-auth endpoints, check if it's a transient issue
      if (error.response?.status === 401 && !isAuthEndpoint) {
        if (!useAuthStore.getState().hasHydrated) {
          return Promise.reject(error);
        }
        // Only force logout if we're certain the session is gone (not during hydration)
        if (wasAuthenticated) {
          handleSessionExpiredOnce();
        }
      } else if (!isAuthEndpoint && !silentBackgroundRequest) {
        notifyGlobalError(error);
      }
      return Promise.reject(error);
    }

    // 浏览门槛拦截（匿名访问开启了「需登录浏览」的公开接口）：无会话可刷新，
    // 直接静默拒绝——不弹错误、不跳登录页，由页面级锁屏/登录引导（如首页 browseBlocked）承接
    const respData = (error.response?.data ?? {}) as { code?: unknown; detail?: unknown };
    const browseLoginRequired =
      respData.code === 'LOGIN_REQUIRED_BROWSE' ||
      respData.detail === '需要登录后才能浏览模型' ||
      respData.detail === '需要登录后才能查看模型预览';
    if (browseLoginRequired && !wasAuthenticated && useAuthStore.getState().hasHydrated) {
      return Promise.reject(error);
    }

    if (refreshInProgress) {
      return new Promise((resolve, reject) => {
        // Auto-reject if refresh takes longer than 30 seconds
        const timeout = setTimeout(() => {
          const idx = failedQueue.findIndex((p) => p.resolve === resolve);
          if (idx !== -1) failedQueue.splice(idx, 1);
          reject(new Error('Token refresh timed out'));
        }, 30_000);
        failedQueue.push({
          resolve: (token) => {
            clearTimeout(timeout);
            resolve(token);
          },
          reject: (err) => {
            clearTimeout(timeout);
            reject(err);
          },
        });
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return client(originalRequest);
      });
    }

    originalRequest._retry = true;
    refreshInProgress = true;

    try {
      const ok = await useAuthStore.getState().restoreSessionFromCookie();
      if (!ok) {
        // restoreSessionFromCookie returns false for network errors too —
        // only logout if the access token was actually cleared (auth rejection)
        const newAccessToken = getAccessToken();
        if (!newAccessToken) {
          // Refresh truly failed (auth rejection), logout
          processQueue(new Error('Session expired'), null);
          // 从未登录过的访客（如开启浏览门槛后的匿名首页访问）不弹「登录失效」、不强制跳登录页
          if (useAuthStore.getState().hasHydrated && wasAuthenticated) {
            handleSessionExpiredOnce();
          }
          return Promise.reject(new Error('Session expired'));
        }
        // Token still present — was a transient network issue, don't retry with
        // old (possibly expired) token to avoid infinite 401 → retry → 401 loop.
        // Just reject and let the user retry manually.
        processQueue(null, newAccessToken);
        return Promise.reject(error);
      }

      const newAccessToken = getAccessToken();
      if (!newAccessToken) throw new Error('No access token after refresh');

      processQueue(null, newAccessToken);
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      return client(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      if (!useAuthStore.getState().hasHydrated) {
        return Promise.reject(refreshError);
      }
      if (wasAuthenticated) {
        handleSessionExpiredOnce();
      }
      return Promise.reject(refreshError);
    } finally {
      refreshInProgress = false;
    }
  },
);

export default client;
