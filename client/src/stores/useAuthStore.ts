import { create } from "zustand";
import { persist } from "zustand/middleware";
import axios from "axios";
import type { User, AuthTokens } from "../types";
import { useFavoriteStore } from "./useFavoriteStore";

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

// In-memory accessToken. Refresh is restored through an HttpOnly cookie.
let _accessToken: string | null = null;

export function getAccessToken(): string | null {
  return _accessToken;
}

/** Decode JWT payload without a library */
function decodeJwtPayload(token: string): { exp?: number; [k: string]: unknown } | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
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

function apiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || "/api";
}

function unwrapApiPayload<T>(value: unknown): T {
  if (value && typeof value === "object" && "data" in value) {
    const data = (value as { data?: unknown }).data;
    if (data && typeof data === "object" && "data" in data) {
      return (data as { data?: T }).data as T;
    }
    return data as T;
  }
  return value as T;
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
        void axios.post(
          `${import.meta.env.VITE_API_BASE_URL || "/api"}/auth/logout`,
          {},
          { withCredentials: true }
        ).catch(() => {});
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
        const refreshToken = get().tokens?.refreshToken;
        set({ user: rememberedUser, tokens: null, isAuthenticated: false });
        if (refreshToken && isTokenExpired(refreshToken)) {
          _accessToken = null;
          set({ user: null, tokens: null, isAuthenticated: false, rememberMe: false });
          return false;
        }

        try {
          const { data: refreshResp } = await axios.post(
            `${apiBaseUrl()}/auth/refresh`,
            refreshToken ? { refreshToken } : {},
            { withCredentials: true }
          );
          const { accessToken } = unwrapApiPayload<{ accessToken?: string }>(refreshResp);
          if (!accessToken) throw new Error("No token in response");

          const { data: profileResp } = await axios.get(
            `${apiBaseUrl()}/auth/profile`,
            {
              withCredentials: true,
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );
          const user = unwrapApiPayload<User>(profileResp);

          _accessToken = accessToken;
          set({
            user,
            tokens: refreshToken ? { accessToken, refreshToken } : null,
            isAuthenticated: true,
          });
          useFavoriteStore.getState().hydrate();
          return true;
        } catch (error) {
          _accessToken = null;
          const status = axios.isAxiosError(error) ? error.response?.status : undefined;
          if (status && [400, 401, 403].includes(status)) {
            set({ user: null, tokens: null, isAuthenticated: false, rememberMe: false });
          } else {
            set((state) => ({
              user: state.rememberMe ? state.user : null,
              tokens: null,
              isAuthenticated: false,
            }));
          }
          return false;
        }
      },
      checkAndRefreshToken: async () => {
        const { tokens, isAuthenticated, logout } = get();
        if (!isAuthenticated) return false;

        // If access token is still valid, nothing to do
        if (!isTokenExpired(_accessToken)) return true;

        // Access token expired — try to refresh
        const refreshToken = tokens?.refreshToken;
        if (refreshToken && isTokenExpired(refreshToken)) {
          logout();
          return false;
        }

        try {
          const { data: resp } = await axios.post(
            `${apiBaseUrl()}/auth/refresh`,
            refreshToken ? { refreshToken } : {},
            { withCredentials: true }
          );
          const newAccessToken = unwrapApiPayload<{ accessToken?: string }>(resp).accessToken;
          if (!newAccessToken) throw new Error("No token in response");

          _accessToken = newAccessToken;
          set({ tokens: refreshToken ? { accessToken: newAccessToken, refreshToken } : null });
          return true;
        } catch {
          logout();
          return false;
        }
      },
    }),
    {
      name: "auth-v2",
      version: 3,
      partialize: (state) => ({
        user: state.rememberMe ? state.user : null,
        tokens: null,
        isAuthenticated: false,
        rememberMe: state.rememberMe,
      }),
      onRehydrateStorage: () => (state) => {
        _accessToken = null;
        void state?.restoreSessionFromCookie().finally(() => {
          state?.setHasHydrated(true);
        });
      },
      // Migrate from old "auth-storage" format
      migrate: (persisted, version) => {
        if (version === 0) {
          // Old format had accessToken as "" — force re-login
          return { user: null, tokens: null, isAuthenticated: false, rememberMe: false } as any;
        }
        const state = (persisted || {}) as Partial<AuthState>;
        return {
          ...state,
          tokens: null,
          rememberMe: version < 3 ? Boolean(state.isAuthenticated && state.user) : Boolean(state.rememberMe),
          hasHydrated: false,
        } as any;
      },
    }
  )
);
