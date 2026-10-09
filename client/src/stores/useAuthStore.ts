import axios from 'axios';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import client from '../api/client';
import type { User, AuthTokens } from '../types';
import { useFavoriteStore } from './useFavoriteStore';

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  rememberMe: boolean;
  hasHydrated: boolean;
  login: (user: User, tokens: AuthTokens, rememberMe?: boolean) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
  setTokens: (tokens: AuthTokens) => void;
  setAccessToken: (accessToken: string, refreshToken?: string | null) => void;
  checkAndRefreshToken: () => Promise<boolean>;
  restoreSessionFromCookie: () => Promise<boolean>;
  setHasHydrated: (hasHydrated: boolean) => void;
}

type PersistedAuthState = {
  user: User | null;
  tokens: null;
  isAuthenticated: false;
  rememberMe: boolean;
};

function createPersistedAuthState(user: User | null = null, rememberMe = false): PersistedAuthState {
  return { user, tokens: null, isAuthenticated: false, rememberMe };
}

// In-memory accessToken. Refresh is restored through an HttpOnly cookie.
let _accessToken: string | null = null;

// Singleton refresh lock to prevent concurrent /auth/refresh calls which
// would invalidate each other's familyId and trigger token revocation.
let _refreshPromise: Promise<boolean> | null = null;

export function getAccessToken(): string | null {
  return _accessToken;
}

/** Decode JWT payload without a library */
function decodeJwtPayload(token: string): { exp?: number; [k: string]: unknown } | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Check if the current access token is expired (with 30s grace) */
function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return Date.now() >= payload.exp * 1000 - 30_000; // 30s grace
}

function unwrapApiPayload<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'data' in value) {
    const data = (value as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'data' in data) {
      return (data as { data?: T }).data as T;
    }
    return data as T;
  }
  return value as T;
}

async function doRefresh(get: () => AuthState, set: (partial: Partial<AuthState>) => void): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const { data: refreshResp } = await client.post('/auth/refresh');
      const { accessToken } = unwrapApiPayload<{ accessToken?: string }>(refreshResp);
      // 无 cookie 的探测（无痕/未登录访客）服务端回 204 无体：没有 accessToken 就
      // 是「无会话」，短路返回，不再去拉 profile（那会再制造一个 401 控制台噪声）
      if (!accessToken) {
        _accessToken = null;
        set({ user: null, tokens: null, isAuthenticated: false, rememberMe: false });
        return false;
      }
      _accessToken = accessToken;

      let user: User | null = null;
      try {
        const { data: profileResp } = await client.get('/auth/profile');
        user = unwrapApiPayload<User>(profileResp);
      } catch {
        // Profile fetch failed but refresh succeeded — keep session alive
        user = get().user;
      }

      if (user) {
        set({ user, tokens: null, isAuthenticated: true });
        useFavoriteStore.getState().hydrate();
        return true;
      }

      // Refresh succeeded but no user — genuine auth failure
      _accessToken = null;
      set({ user: null, tokens: null, isAuthenticated: false, rememberMe: false });
      return false;
    } catch (err) {
      // Distinguish network errors from auth rejection (401/403)
      const status = (err as { response?: { status?: number } })?.response?.status;
      const isNetworkError = !status; // no response = network failure / timeout / CORS
      const isServerError = status && status >= 500;

      if (isNetworkError || isServerError) {
        // Transient failure — restore session if we had a user before
        const prevUser = get().user;
        if (prevUser) {
          set({ user: prevUser, tokens: null, isAuthenticated: true });
        }
        return false;
      }

      // Auth rejection (401/403/etc) — genuinely expired or revoked
      _accessToken = null;
      set({ user: null, tokens: null, isAuthenticated: false, rememberMe: false });
      return false;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      tokens: null,
      isAuthenticated: false,
      rememberMe: false,
      hasHydrated: false,
      login: (user, tokens, rememberMe = false) => {
        _accessToken = tokens.accessToken;
        set({ user, tokens: null, isAuthenticated: true, rememberMe });
        useFavoriteStore.getState().hydrate();
      },
      logout: () => {
        void axios
          .post(`${import.meta.env.VITE_API_BASE_URL || '/api'}/auth/logout`, {}, { withCredentials: true })
          .catch(() => {});
        _accessToken = null;
        set({ user: null, tokens: null, isAuthenticated: false, rememberMe: false });
      },
      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),
      setTokens: (tokens) => {
        _accessToken = tokens.accessToken;
        set({ tokens });
      },
      setAccessToken: (accessToken, refreshToken) => {
        _accessToken = accessToken;
        set({ tokens: refreshToken ? { accessToken, refreshToken } : null });
      },
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      restoreSessionFromCookie: async () => {
        if (!isTokenExpired(_accessToken) && get().user) return true;

        const rememberedUser = get().rememberMe ? get().user : null;
        set({ user: rememberedUser, tokens: null, isAuthenticated: false });

        return doRefresh(get, set);
      },
      checkAndRefreshToken: async () => {
        const { isAuthenticated } = get();
        if (!isAuthenticated) return false;

        if (!isTokenExpired(_accessToken)) return true;

        return doRefresh(get, set);
      },
    }),
    {
      name: 'auth-v2',
      version: 3,
      partialize: (state) => ({
        user: state.rememberMe ? state.user : null,
        tokens: null,
        isAuthenticated: false,
        rememberMe: state.rememberMe,
      }),
      onRehydrateStorage: () => (state) => {
        _accessToken = null;
        // 推迟到微任务再恢复会话：store 创建发生在模块求值期，而 client.ts ↔ 本文件
        // 循环依赖——入口若先 import client.ts，本模块体执行时 client 尚未初始化，
        // doRefresh 同步引用它会直接 TDZ 抛错（"Cannot access 'client' before initialization"），
        // 被 catch 当成网络错误走「乐观保活」，已死的会话被当成仍登录。
        // 微任务在整个模块图求值完成后才执行，此时 client 必然已就绪。
        queueMicrotask(() => {
          void state?.restoreSessionFromCookie().finally(() => {
            state?.setHasHydrated(true);
          });
        });
      },
      // Migrate from old "auth-storage" format
      migrate: (persisted, version) => {
        if (version === 0) {
          // Old format had accessToken as "" — force re-login
          return createPersistedAuthState();
        }
        const state = (persisted || {}) as Partial<AuthState>;
        return createPersistedAuthState(
          state.user ?? null,
          version < 3 ? Boolean(state.isAuthenticated && state.user) : Boolean(state.rememberMe),
        );
      },
    },
  ),
);
