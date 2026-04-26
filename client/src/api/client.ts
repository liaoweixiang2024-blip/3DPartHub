import axios from "axios";
import { getAccessToken, useAuthStore } from "../stores/useAuthStore";
import { notifyGlobalError } from "../lib/errorNotifications";

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 120000,
  headers: {
    "Content-Type": "application/json",
  },
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

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Don't retry login/register/refresh endpoints
    const isAuthEndpoint =
      originalRequest.url?.includes("/auth/login") ||
      originalRequest.url?.includes("/auth/register") ||
      originalRequest.url?.includes("/auth/refresh");

    // Show rate limit notification
    if (error.response?.status === 429) {
      const retryAfter = error.response.headers["retry-after"] || error.response.headers["ratelimit-reset"];
      const seconds = retryAfter ? Math.ceil(Number(retryAfter)) : 60;
      const msg = seconds > 60 ? `请求过于频繁，请 ${Math.ceil(seconds / 60)} 分钟后再试` : `请求过于频繁，请 ${seconds} 秒后再试`;
      notifyGlobalError(msg);
      return Promise.reject(error);
    }

    if (
      error.response?.status !== 401 ||
      originalRequest._retry ||
      isAuthEndpoint
    ) {
      // For 401 on non-auth endpoints, session expired — redirect to login
      if (error.response?.status === 401 && !isAuthEndpoint) {
        notifyGlobalError("登录状态已失效，请重新登录");
        useAuthStore.getState().logout();
        window.location.replace("/login");
      } else if (!isAuthEndpoint) {
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
      if (!refreshToken) throw new Error("No refresh token");

      const { data: resp } = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL || "/api"}/auth/refresh`,
        { refreshToken }
      );

      const newAccessToken = resp.data?.data?.accessToken || resp.data?.accessToken || resp.accessToken;
      if (!newAccessToken) throw new Error("No access token in refresh response");

      // Update tokens via store (keeps accessToken in memory only)
      useAuthStore.getState().setTokens({ accessToken: newAccessToken, refreshToken });

      processQueue(null, newAccessToken);
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      return client(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
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
