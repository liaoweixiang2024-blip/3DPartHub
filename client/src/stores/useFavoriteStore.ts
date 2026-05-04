import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { favoriteApi } from '../api/favorites';

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
        const snapshot = new Set(get().favoriteIds);
        const wasFavorite = snapshot.has(model.id);

        const next = new Set(snapshot);
        if (wasFavorite) {
          next.delete(model.id);
        } else {
          next.add(model.id);
        }
        set({ favoriteIds: next });

        try {
          if (wasFavorite) {
            await favoriteApi.remove(model.id);
          } else {
            await favoriteApi.add(model.id);
          }
        } catch {
          set({ favoriteIds: snapshot });
        }
      },
      isFavorite: (id) => get().favoriteIds.has(id),
      hydrate: async () => {
        try {
          const items = await favoriteApi.list();
          set({ favoriteIds: new Set(items.map((f) => f.modelId || f.model?.model_id).filter(Boolean)) });
        } catch {
          // Silently fail — local state preserved
        }
      },
    }),
    {
      name: 'favorites-storage',
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
    },
  ),
);
