import { create } from "zustand";
import { persist } from "zustand/middleware";
import { favoriteApi, type FavoriteItem } from "../api/favorites";
import type { ServerModelListItem } from "../api/models";

interface FavoriteState {
  favoriteIds: Set<string>;
  toggleFavorite: (model: { id: string; [key: string]: unknown }) => Promise<void>;
  isFavorite: (id: string) => boolean;
  hydrate: () => Promise<void>;
}

export const useFavoriteStore = create<FavoriteState>()(
  persist(
    (set, get) => ({
      favoriteIds: new Set<string>(),
      toggleFavorite: async (model) => {
        const prev = new Set(get().favoriteIds);
        const wasFavorite = prev.has(model.id);

        // Optimistic update
        if (wasFavorite) {
          prev.delete(model.id);
        } else {
          prev.add(model.id);
        }
        set({ favoriteIds: new Set(prev) });

        try {
          if (wasFavorite) {
            await favoriteApi.remove(model.id);
          } else {
            await favoriteApi.add(model.id);
          }
        } catch {
          // Rollback on failure
          set({ favoriteIds: new Set(get().favoriteIds).add(model.id) === prev ? prev : new Set(get().favoriteIds) });
          // Simple rollback: re-toggle
          const rollback = new Set(get().favoriteIds);
          if (wasFavorite) {
            rollback.add(model.id);
          } else {
            rollback.delete(model.id);
          }
          set({ favoriteIds: rollback });
        }
      },
      isFavorite: (id) => get().favoriteIds.has(id),
      hydrate: async () => {
        try {
          const items = await favoriteApi.list();
          set({ favoriteIds: new Set(items.map((f: any) => f.modelId || f.model?.id)) });
        } catch {
          // Silently fail — local state preserved
        }
      },
    }),
    {
      name: "favorites-storage",
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const parsed = JSON.parse(str);
          return {
            ...parsed,
            state: {
              ...parsed.state,
              favoriteIds: new Set(parsed.state.favoriteIds || []),
            },
          };
        },
        setItem: (name, value) => {
          const serialized = {
            ...value,
            state: {
              ...value.state,
              favoriteIds: Array.from(value.state.favoriteIds),
            },
          };
          localStorage.setItem(name, JSON.stringify(serialized));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);
