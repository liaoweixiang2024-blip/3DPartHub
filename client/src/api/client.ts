import axios from "axios";
import { getAccessToken, useAuthStore } from "../stores/useAuthStore";
import { notifyGlobalError } from "../lib/errorNotifications";
import { unwrapApiData } from "./response";

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 120000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// Simple circuit breaker — if too many consecutive server errors, pause requests briefly
let consecutiveServerErrors = 0;
let circuitOpenUntil = 0;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 15000;

function isCircuitOpen(): boolean {
  if (Date.now() < circuitOpenUntil) return true;
  circuitOpenUntil = 0;
  return false;
}

function recordServerError() {
  consecutiveServerErrors++;
  if (consecutiveServerErrors >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    notifyGlobalError("服务器暂时不可用，正在自动重试...");
  }
}

function resetCircuit() {
  consecutiveServerErrors = 0;
  circuitOpenUntil = 0;
}

// Reject requests when circuit is open
client.interceptors.request.use((config) => {
  if (isCircuitOpen()) {
    return Promise.reject(new Error("服务暂时不可用，请稍后再试"));
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
    delete config.headers["Content-Type"];
  }
  return config;
});

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

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
  const method = String(config?.method || "get").toLowerCase();
  const url = String(config?.url || "");
  return method === "get" && (
    url.startsWith("/notifications/unread-count") ||
    url.startsWith("/notifications?")
  );
}

client.interceptors.response.use(
  (response) => {
    resetCircuit();
    return response;
  },
  async (error) => {
    const originalRequest = error.config;
    const silentBackgroundRequest = isSilentBackgroundRequest(originalRequest);

    // Don't retry login/register/refresh endpoints
    const isAuthEndpoint =
      originalRequest.url?.includes("/auth/login") ||
      originalRequest.url?.includes("/auth/register") ||
      originalRequest.url?.includes("/auth/refresh");

    // Track server errors for circuit breaker
    if (error.response && error.response.status >= 500) {
      recordServerError();
    }

    // Show rate limit notification
    if (error.response?.status === 429) {
      const retryAfter = error.response.headers["retry-after"] || error.response.headers["ratelimit-reset"];
      const seconds = retryAfter ? Math.ceil(Number(retryAfter)) : 60;
      const msg = seconds > 60 ? `请求过于频繁，请 ${Math.ceil(seconds / 60)} 分钟后再试` : `请求过于频繁，请 ${seconds} 秒后再试`;
      if (!silentBackgroundRequest) notifyGlobalError(msg);
      return Promise.reject(error);
    }

    if (
      error.response?.status !== 401 ||
      originalRequest._retry ||
      isAuthEndpoint
    ) {
      // For 401 on non-auth endpoints, session expired — redirect to login
      if (error.response?.status === 401 && !isAuthEndpoint) {
        if (!useAuthStore.getState().hasHydrated) {
          return Promise.reject(error);
        }
        notifyGlobalError("登录状态已失效，请重新登录");
        useAuthStore.getState().logout();
        window.location.replace("/login");
      } else if (!isAuthEndpoint && !silentBackgroundRequest) {
        notifyGlobalError(error);
      }
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return client(originalRequest);
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const tokens = useAuthStore.getState().tokens;
      const refreshToken = tokens?.refreshToken;

      const { data: resp } = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL || "/api"}/auth/refresh`,
        refreshToken ? { refreshToken } : {},
        { withCredentials: true }
      );

      const newAccessToken = unwrapApiData<{ accessToken?: string }>(resp).accessToken;
      if (!newAccessToken) throw new Error("No access token in refresh response");

      // Update in-memory accessToken; refreshToken lives in an HttpOnly cookie.
      useAuthStore.getState().setAccessToken(newAccessToken, refreshToken);

      processQueue(null, newAccessToken);
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      return client(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      if (!useAuthStore.getState().hasHydrated) {
        return Promise.reject(refreshError);
      }
      notifyGlobalError("登录状态已失效，请重新登录");
      useAuthStore.getState().logout();
      window.location.replace("/login");
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default client;
