const MODEL_DETAIL_TITLE_CACHE_KEY = 'model_detail_title_cache_v1';
const MODEL_DETAIL_TITLE_CACHE_LIMIT = 120;

export function getCachedModelDetailTitle(modelId?: string) {
  if (typeof window === 'undefined' || !modelId) return null;
  try {
    const cache = JSON.parse(window.localStorage.getItem(MODEL_DETAIL_TITLE_CACHE_KEY) || '{}') as Record<
      string,
      { name?: string }
    >;
    return cache[modelId]?.name?.trim() || null;
  } catch {
    return null;
  }
}

export function cacheModelDetailTitle(modelId: string | undefined, name: string | undefined) {
  if (typeof window === 'undefined' || !modelId || !name?.trim()) return;
  try {
    const cache = JSON.parse(window.localStorage.getItem(MODEL_DETAIL_TITLE_CACHE_KEY) || '{}') as Record<
      string,
      { name?: string; updatedAt?: number }
    >;
    cache[modelId] = { name: name.trim(), updatedAt: Date.now() };
    const entries = Object.entries(cache)
      .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MODEL_DETAIL_TITLE_CACHE_LIMIT);
    window.localStorage.setItem(MODEL_DETAIL_TITLE_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}
