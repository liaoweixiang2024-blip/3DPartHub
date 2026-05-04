const MODEL_DETAIL_RETURN_PATH_KEY = 'model_detail_return_path_v1';

export function isModelDetailPath(pathname: string) {
  return /^\/model\/[^/]+\/?$/.test(pathname);
}

export function normalizeModelReturnPath(value?: string | null, currentPath = '') {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.startsWith('/') || decoded.startsWith('//')) return null;
    if (decoded === currentPath) return null;
    return decoded;
  } catch {
    if (!value.startsWith('/') || value.startsWith('//') || value === currentPath) return null;
    return value;
  }
}

export function saveModelReturnPath(path: string) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeModelReturnPath(path);
  if (!normalized) return;
  try {
    window.sessionStorage.setItem(MODEL_DETAIL_RETURN_PATH_KEY, normalized);
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}

export function getModelReturnPath(currentPath = '') {
  if (typeof window === 'undefined') return null;
  try {
    return normalizeModelReturnPath(window.sessionStorage.getItem(MODEL_DETAIL_RETURN_PATH_KEY), currentPath);
  } catch {
    return null;
  }
}
