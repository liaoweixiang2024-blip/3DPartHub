import type { CategoryItem } from '../../api/categories';
import type { ServerModelListItem } from '../../api/models';
import { DEFAULT_PAGE_SIZE, normalizePageSize } from '../../components/shared/Pagination';
import { i18n } from '../../i18n';
import { normalizeHomeSearchQuery } from '../../lib/homeSearchState';
import type { Category, HomeBrowseState, Product } from './homeTypes';

export function buildCategories(tree: CategoryItem[]): Category[] {
  return tree.map((node) => ({
    id: node.id,
    name: node.name,
    icon: node.icon,
    count: node.totalCount ?? node.count ?? 0,
    children: (node.children || []).map((child) => ({
      id: child.id,
      name: child.name,
      count: child.totalCount ?? child.count ?? 0,
    })),
  }));
}

export const HOME_MOBILE_CARD_CLASS =
  'home-model-card bg-surface-container-high rounded-sm overflow-hidden flex flex-col';
export const HOME_MOBILE_MEDIA_CLASS =
  'h-[140px] bg-surface-container-lowest relative overflow-hidden flex items-center justify-center';
export const HOME_MOBILE_BODY_CLASS = 'flex flex-1 flex-col p-2.5';
export const HOME_MOBILE_ACTION_BUTTON_CLASS =
  'mt-auto flex h-7 w-full items-center justify-center gap-1.5 rounded-sm bg-primary-container text-xs font-medium text-on-primary';

export const HOME_SCROLL_POSITION_PREFIX = 'home_model_scroll_position:';
export const HOME_SCROLL_TARGET_PREFIX = 'home_model_scroll_target:';
export const HOME_SCROLL_OFFSET_PREFIX = 'home_model_scroll_offset:';
export const HOME_BROWSE_STATE_PREFIX = 'home_model_browse_state:';
export const HOME_SCROLL_RESTORE_PENDING_KEY = 'home_model_scroll_restore_pending_v1';
export const HOME_LEGACY_DEFAULT_PAGE_SIZE = 60;
export const HOME_DESKTOP_GRID_EAGER_IMAGES = 10;
export const HOME_DESKTOP_LIST_EAGER_IMAGES = 6;
export const HOME_MOBILE_EAGER_IMAGES = 4;
export type HomeRefreshScrollTarget = 'top' | 'results';
export const HOME_REFRESH_SCROLL_TARGET: HomeRefreshScrollTarget = 'results';

type HomeLocationState = {
  homeBrowseState?: Partial<HomeBrowseState> | null;
} | null;

export function parsePageParam(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

export function normalizeSortParam(value: string | null) {
  return value === 'name' ? 'name' : 'created_at';
}

export function normalizeHomePageSizeOptions(policy: Record<string, number>) {
  const options = [policy.homeOption1, policy.homeOption2, policy.homeOption3, policy.homeOption4]
    .map((value) => Math.floor(Number(value) || 0))
    .filter((value) => value > 0);
  return Array.from(new Set(options)).sort((a, b) => a - b);
}

export function buildHomeReturnPath() {
  return '/';
}

export function buildHomeRestoreKey(
  categoryId: string,
  query: string,
  page = 1,
  sort = 'created_at',
  pageSize = DEFAULT_PAGE_SIZE,
) {
  const params = new URLSearchParams();
  params.set('category', categoryId || 'all');
  if (query) params.set('q', query);
  if (page > 1) params.set('page', String(page));
  if (pageSize !== DEFAULT_PAGE_SIZE) params.set('page_size', String(pageSize));
  if (sort !== 'created_at') params.set('sort', sort);
  return params.toString();
}

export function readHomeBrowseStateFromLocation(state: unknown) {
  const homeState = (state as HomeLocationState)?.homeBrowseState;
  return homeState && typeof homeState === 'object' ? homeState : null;
}

export function normalizeStoredHomePageSize(value: unknown, defaultPageSize = DEFAULT_PAGE_SIZE) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && Math.floor(parsed) === HOME_LEGACY_DEFAULT_PAGE_SIZE) {
    return defaultPageSize;
  }
  return normalizePageSize(parsed, undefined, defaultPageSize);
}

export function normalizeHomeBrowseState(
  value: Partial<HomeBrowseState> | null | undefined,
  defaultPageSize = DEFAULT_PAGE_SIZE,
) {
  if (!value) return null;
  const categoryId = typeof value.categoryId === 'string' && value.categoryId ? value.categoryId : 'all';
  const query = typeof value.query === 'string' ? normalizeHomeSearchQuery(value.query) : '';
  const page = typeof value.page === 'number' ? parsePageParam(String(value.page)) : 1;
  const pageSize =
    typeof value.pageSize === 'number' ? normalizeStoredHomePageSize(value.pageSize, defaultPageSize) : defaultPageSize;
  const sort = normalizeSortParam(typeof value.sort === 'string' ? value.sort : null);
  return {
    categoryId,
    query,
    page,
    pageSize,
    sort,
    restoreKey: value.restoreKey || buildHomeRestoreKey(categoryId, query, page, sort, pageSize),
  };
}

export function saveHomeBrowseState(restoreKey: string, state: HomeBrowseState) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${HOME_BROWSE_STATE_PREFIX}${restoreKey}`, JSON.stringify(state));
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}

export function writeHomeBrowseStateToCurrentHistory(state: HomeBrowseState) {
  if (typeof window === 'undefined') return;
  try {
    const current = window.history.state;
    if (!current || typeof current !== 'object') return;
    const usr = current.usr && typeof current.usr === 'object' ? current.usr : {};
    window.history.replaceState(
      { ...current, usr: { ...usr, homeBrowseState: state } },
      '',
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    );
  } catch {
    // Ignore history state failures.
  }
}

export function readHomeBrowseState(restoreKey: string | null, defaultPageSize = DEFAULT_PAGE_SIZE) {
  if (typeof window === 'undefined' || !restoreKey) return null;
  try {
    const raw = window.sessionStorage.getItem(`${HOME_BROWSE_STATE_PREFIX}${restoreKey}`);
    return normalizeHomeBrowseState(raw ? JSON.parse(raw) : null, defaultPageSize);
  } catch {
    return null;
  }
}

export function readPendingHomeBrowseState(defaultPageSize = DEFAULT_PAGE_SIZE) {
  if (typeof window === 'undefined') return null;
  try {
    return readHomeBrowseState(window.sessionStorage.getItem(HOME_SCROLL_RESTORE_PENDING_KEY), defaultPageSize);
  } catch {
    return null;
  }
}

export function saveHomeScrollPosition(
  restoreKey: string,
  scrollTop: number,
  pendingRestore = false,
  modelId?: string,
  viewportOffset?: number,
) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      `${HOME_SCROLL_POSITION_PREFIX}${restoreKey}`,
      String(Math.max(0, Math.round(scrollTop))),
    );
    if (modelId) {
      window.sessionStorage.setItem(`${HOME_SCROLL_TARGET_PREFIX}${restoreKey}`, modelId);
      if (viewportOffset != null) {
        window.sessionStorage.setItem(`${HOME_SCROLL_OFFSET_PREFIX}${restoreKey}`, String(Math.round(viewportOffset)));
      }
    }
    if (pendingRestore) window.sessionStorage.setItem(HOME_SCROLL_RESTORE_PENDING_KEY, restoreKey);
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}

export function readHomeScrollPosition(restoreKey: string) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(`${HOME_SCROLL_POSITION_PREFIX}${restoreKey}`);
    const parsed = raw ? Number(raw) : null;
    return parsed != null && Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readHomeScrollTarget(restoreKey: string) {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(`${HOME_SCROLL_TARGET_PREFIX}${restoreKey}`);
  } catch {
    return null;
  }
}

export function readHomeScrollOffset(restoreKey: string) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(`${HOME_SCROLL_OFFSET_PREFIX}${restoreKey}`);
    const parsed = raw ? Number(raw) : null;
    return parsed != null && Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getHomeModelElement(container: HTMLElement, modelId: string) {
  return (
    Array.from(container.querySelectorAll<HTMLElement>('[data-home-model-id]')).find(
      (element) => element.dataset.homeModelId === modelId,
    ) || null
  );
}

export function jumpHomeScrollTo(container: HTMLElement, top: number) {
  container.scrollTop = Math.max(0, top);
}

export function restoreHomeScrollToModel(container: HTMLElement, modelId: string, savedOffset: number | null) {
  const target = getHomeModelElement(container, modelId);
  if (!target) return false;

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const offset = savedOffset ?? 0;
  const top = container.scrollTop + targetRect.top - containerRect.top - offset;
  jumpHomeScrollTo(container, top);
  return true;
}

export function getPendingHomeRestoreKey() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(HOME_SCROLL_RESTORE_PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearPendingHomeRestore(restoreKey: string) {
  if (typeof window === 'undefined') return;
  try {
    if (window.sessionStorage.getItem(HOME_SCROLL_RESTORE_PENDING_KEY) === restoreKey) {
      window.sessionStorage.removeItem(HOME_SCROLL_RESTORE_PENDING_KEY);
    }
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}

export function serverItemToProduct(item: ServerModelListItem): Product {
  const format = item.format?.toUpperCase() || 'UNKNOWN';
  return {
    id: item.model_id,
    name: item.name || i18n.t('modelDetail.unnamed'),
    description: i18n.t('modelDetail.formatModel', { format }),
    formats: [format],
    fileSize: formatFileSize(item.original_size || item.file_size || 0),
    category: item.category || i18n.t('home.otherCategory'),
    thumbnailUrl: item.thumbnail_url || undefined,
    createdAt: item.created_at || undefined,
    fileSizeBytes: item.original_size || item.file_size || 0,
    variantCount: item.group?.variant_count,
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
