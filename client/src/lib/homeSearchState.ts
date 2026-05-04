export const HOME_SEARCH_QUERY_KEY = 'home_model_search_query_v1';
export const HOME_SEARCH_EVENT = 'home-model-search-change';
export const HOME_SEARCH_MAX_LENGTH = 200;

export type HomeSearchEventDetail = {
  query: string;
  preservePage?: boolean;
};

export function readHomeSearchQuery() {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.sessionStorage.getItem(HOME_SEARCH_QUERY_KEY);
    return stored == null ? null : normalizeHomeSearchQuery(stored);
  } catch {
    return null;
  }
}

export function normalizeHomeSearchQuery(query: string) {
  const sanitized = Array.from(query)
    .map((char) => {
      const code = char.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? ' ' : char;
    })
    .join('');
  return Array.from(sanitized.replace(/\s+/g, ' ').trim()).slice(0, HOME_SEARCH_MAX_LENGTH).join('');
}

export function saveHomeSearchQuery(query: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(HOME_SEARCH_QUERY_KEY, normalizeHomeSearchQuery(query));
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}

export function dispatchHomeSearchQuery(query: string, options: { preservePage?: boolean } = {}) {
  if (typeof window === 'undefined') return;
  const normalizedQuery = normalizeHomeSearchQuery(query);
  window.dispatchEvent(
    new CustomEvent<HomeSearchEventDetail>(HOME_SEARCH_EVENT, {
      detail: { query: normalizedQuery, preservePage: options.preservePage },
    }),
  );
}
