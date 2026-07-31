import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { favoriteApi } from '../api/favorites';

interface FavoriteState {
  favoriteIds: Set<string>;
  _pendingIds: Set<string>;
  toggleFavorite: (model: { id: string; [key: string]: unknown }) => Promise<void>;
  isFavorite: (id: string) => boolean;
  hydrate: () => Promise<void>;
}

export const useFavoriteStore = create<FavoriteState>()(
  persist(
    (set, get) => ({
      favoriteIds: new Set<string>(),
      _pendingIds: new Set<string>(),
      toggleFavorite: async (model) => {
        // Prevent concurrent toggle for the same model
        if (get()._pendingIds.has(model.id)) return;

        const snapshot = new Set(get().favoriteIds);
        const wasFavorite = snapshot.has(model.id);

        set({ _pendingIds: new Set([...get()._pendingIds, model.id]) });

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
        } finally {
          const pending = new Set(get()._pendingIds);
          pending.delete(model.id);
          set({ _pendingIds: pending });
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
      // _pendingIds 是「进行中」的瞬态状态，绝不能持久化——
      // JSON.stringify(Set) 会得到 "{}"，刷新加载后 _pendingIds 变成空对象，
      // _pendingIds.has() 就会抛 "not a function"，导致收藏/取消收藏全部失败。
      partialize: (state) => ({ favoriteIds: state.favoriteIds }),
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const parsed = JSON.parse(str);
          const savedFavoriteIds = parsed?.state?.favoriteIds;
          return {
            ...parsed,
            state: {
              ...parsed.state,
              favoriteIds: new Set(Array.isArray(savedFavoriteIds) ? savedFavoriteIds : []),
              // 始终用全新 Set，丢弃旧版本可能持久化进来的脏 _pendingIds（{} 或数组）
              _pendingIds: new Set(),
            },
          };
        },
        setItem: (name, value) => {
          const serialized = {
            ...value,
            state: {
              favoriteIds: Array.from(value.state.favoriteIds ?? []),
            },
          };
          localStorage.setItem(name, JSON.stringify(serialized));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    },
  ),
);
