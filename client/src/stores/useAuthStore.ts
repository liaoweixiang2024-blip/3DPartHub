import { create } from "zustand";
import { persist } from "zustand/middleware";
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
}

// In-memory accessToken — also persisted to localStorage for page refresh
let _accessToken: string | null = null;

export function getAccessToken(): string | null {
  return _accessToken;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      tokens: null,
      isAuthenticated: false,
      login: (user, tokens) => {
        _accessToken = tokens.accessToken;
        set({ user, tokens, isAuthenticated: true });
        useFavoriteStore.getState().hydrate();
      },
      logout: () => {
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
    }),
    {
      name: "auth-v2",
      version: 1,
      partialize: (state) => ({
        user: state.user,
        tokens: state.tokens,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.tokens?.accessToken) {
          _accessToken = state.tokens.accessToken;
        }
      },
      // Migrate from old "auth-storage" format
      migrate: (persisted, version) => {
        if (version === 0) {
          // Old format had accessToken as "" — force re-login
          return { user: null, tokens: null, isAuthenticated: false } as any;
        }
        return persisted as any;
      },
    }
  )
);
