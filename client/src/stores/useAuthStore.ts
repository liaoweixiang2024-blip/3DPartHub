import { create } from "zustand";
import { persist } from "zustand/middleware";
import axios from "axios";
import type { User, AuthTokens } from "../types";
import { useFavoriteStore } from "./useFavoriteStore";

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  login: (user: User, tokens: AuthTokens) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
  setTokens: (tokens: AuthTokens) => void;
  setAccessToken: (accessToken: string, refreshToken?: string | null) => void;
  checkAndRefreshToken: () => Promise<boolean>;
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

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      tokens: null,
      isAuthenticated: false,
      login: (user, tokens) => {
        _accessToken = tokens.accessToken;
        set({ user, tokens: null, isAuthenticated: true });
        useFavoriteStore.getState().hydrate();
      },
      logout: () => {
        void axios.post(
          `${import.meta.env.VITE_API_BASE_URL || "/api"}/auth/logout`,
          {},
          { withCredentials: true }
        ).catch(() => {});
        _accessToken = null;
        set({ user: null, tokens: null, isAuthenticated: false });
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
            `${import.meta.env.VITE_API_BASE_URL || "/api"}/auth/refresh`,
            refreshToken ? { refreshToken } : {},
            { withCredentials: true }
          );
          const newAccessToken = resp.data?.data?.accessToken || resp.data?.accessToken || resp.accessToken;
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
      version: 2,
      partialize: (state) => ({
        user: state.user,
        tokens: null,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => () => {
        _accessToken = null;
      },
      // Migrate from old "auth-storage" format
      migrate: (persisted, version) => {
        if (version === 0) {
          // Old format had accessToken as "" — force re-login
          return { user: null, tokens: null, isAuthenticated: false } as any;
        }
        const state = (persisted || {}) as Partial<AuthState>;
        return { ...state, tokens: null } as any;
      },
    }
  )
);
