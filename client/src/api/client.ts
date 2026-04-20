import axios, { AxiosError } from "axios";
import { getAccessToken, useAuthStore } from "../stores/useAuthStore";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 120000,
  headers: {
    "Content-Type": "application/json",
  },
});

function shouldRetry(error: AxiosError): boolean {
  // Only retry on network errors or 5xx server errors
  if (!error.response) return true; // network error
  const status = error.response.status;
  return status >= 500 && status < 600;
}

function getRetryDelay(attempt: number): number {
  return RETRY_BASE_DELAY * Math.pow(2, attempt);
}

client.interceptors.request.use((config) => {
  // Set retry count
  config.__retryCount = config.__retryCount || 0;
  return config;
});

client.interceptors.request.use((config) => {
  const accessToken = getAccessToken();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
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

    // Retry logic for network/server errors
    if (shouldRetry(error) && originalRequest.__retryCount < MAX_RETRIES) {
      originalRequest.__retryCount += 1;
      const delay = getRetryDelay(originalRequest.__retryCount - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return client(originalRequest);
    }

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
      alert(msg);
      return Promise.reject(error);
    }

    if (
      error.response?.status !== 401 ||
      originalRequest._retry ||
      isAuthEndpoint
    ) {
      // Only redirect to login for non-auth 401 errors (session expired)
      if (error.response?.status === 401 && !isAuthEndpoint) {
        useAuthStore.getState().logout();
        window.location.replace("/login");
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
      useAuthStore.getState().logout();
      window.location.replace("/login");
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default client;
