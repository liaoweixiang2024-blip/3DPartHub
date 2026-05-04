import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useMemo, useCallback, useRef, type MouseEvent, type UIEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { categoriesApi, type CategoryItem } from '../api/categories';
import { downloadModelFile, isDownloadAuthRequiredError } from '../api/downloads';
import { favoriteApi } from '../api/favorites';
import { modelApi, type ServerModelListItem } from '../api/models';
import { createShare } from '../api/shares';
import FormatTag from '../components/shared/FormatTag';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import ModelThumbnail from '../components/shared/ModelThumbnail';
import { PageTitle } from '../components/shared/PagePrimitives';
import { DEFAULT_PAGE_SIZE, normalizePageSize } from '../components/shared/Pagination';
import { PublicPageShell } from '../components/shared/PublicPageShell';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useInfiniteModels } from '../hooks/useModels';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getBusinessConfig } from '../lib/businessConfig';
import { copyText } from '../lib/clipboard';
import { getErrorMessage } from '../lib/errorNotifications';
import {
  HOME_SEARCH_EVENT,
  dispatchHomeSearchQuery,
  normalizeHomeSearchQuery,
  readHomeSearchQuery,
  saveHomeSearchQuery,
  type HomeSearchEventDetail,
} from '../lib/homeSearchState';
import {
  getCachedPublicSettings,
  getAnnouncement,
  getContactEmail,
  getContactPhone,
  getContactAddress,
  getSiteTitle,
  getFooterLinks,
  getFooterCopyright,
} from '../lib/publicSettings';
import { sanitizeHtml } from '../lib/sanitizeHtml';
import { useAuthStore } from '../stores';

interface Category {
  id: string;
  name: string;
  icon: string;
  count: number;
  children: { id: string; name: string; count: number }[];
}

function buildCategories(tree: CategoryItem[]): Category[] {
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

interface Product {
  id: string;
  name: string;
  description: string;
  formats: string[];
  fileSize: string;
  category: string;
  thumbnailUrl?: string;
  createdAt?: string;
  fileSizeBytes?: number;
  variantCount?: number;
}

function AnnouncementBanner() {
  const [ann, setAnn] = useState({ enabled: false, text: '', type: 'info', color: '' });
  const [dismissed, setDismissed] = useState(false);
  const safeAnnouncementHtml = useMemo(() => sanitizeHtml(ann.text), [ann.text]);

  useEffect(() => {
    getCachedPublicSettings().then(() => {
      setAnn(getAnnouncement());
    });
  }, []);

  if (!ann.enabled || !ann.text || dismissed) return null;

  const presetColors: Record<string, string> = {
    info: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    warning: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
    error: 'bg-red-500/10 border-red-500/20 text-red-400',
  };

  // Custom color overrides preset
  const style = ann.color
    ? { backgroundColor: `${ann.color}18`, borderColor: `${ann.color}40`, color: ann.color }
    : undefined;
  const className = ann.color
    ? 'flex items-center gap-2 px-4 py-2 rounded-md border text-sm mb-4'
    : `flex items-center gap-2 px-4 py-2 rounded-md border text-sm mb-4 ${presetColors[ann.type] || presetColors.info}`;

  return (
    <div className={className} style={style}>
      <Icon name="campaign" size={18} className="shrink-0" />
      <span
        className="flex-1 [&_a]:underline [&_a]:font-medium hover:[&_a]:opacity-80"
        dangerouslySetInnerHTML={{ __html: safeAnnouncementHtml }}
      />
      <button onClick={() => setDismissed(true)} className="shrink-0 opacity-60 hover:opacity-100">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

function CategorySidebar({
  expandedCategories,
  activeCategory,
  categories: categoriesData,
  totalCount,
  onToggle,
  onSelect,
}: {
  expandedCategories: Set<string>;
  activeCategory: string;
  categories: Category[];
  totalCount: number;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="hidden md:flex w-56 bg-surface-container-low flex-col border-r border-primary-container/10 shrink-0 py-4 gap-2">
      <div className="px-5 py-3 border-b border-surface">
        <h2 className="text-sm font-bold text-on-surface tracking-wider uppercase font-headline">产品目录</h2>
      </div>
      <div className="flex-1 px-3 py-2 flex flex-col gap-0.5 overflow-y-auto scrollbar-hidden">
        <button
          onClick={() => onSelect('all')}
          className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors rounded-sm ${
            activeCategory === 'all'
              ? 'border-l-2 border-primary-container text-primary-container bg-gradient-to-r from-primary-container/15 to-transparent'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'
          }`}
        >
          <span className="flex items-center gap-2">
            <Icon name="category_all" size={18} />
            全部模型
          </span>
          <span className="text-[10px] bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">
            {totalCount || categoriesData.reduce((s, c) => s + c.count, 0)}
          </span>
        </button>
        {categoriesData.map((cat) => {
          const isExpanded = expandedCategories.has(cat.id);
          const hasChildren = cat.children && cat.children.length > 0;
          const isActive = cat.id === activeCategory || (cat.children?.some((c) => c.id === activeCategory) ?? false);
          return (
            <div key={cat.id}>
              <button
                onClick={() => {
                  if (hasChildren) {
                    onSelect(cat.id);
                    onToggle(cat.id);
                  } else {
                    onSelect(cat.id);
                  }
                }}
                className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors rounded-sm ${
                  isActive
                    ? 'border-l-2 border-primary-container text-primary-container bg-gradient-to-r from-primary-container/15 to-transparent'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon name={cat.icon} size={18} />
                  {cat.name}
                </span>
                <span className="flex items-center gap-1.5">
                  {hasChildren && (
                    <motion.span
                      animate={{ rotate: isExpanded ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-on-surface-variant/60"
                    >
                      <Icon name="expand_more" size={14} />
                    </motion.span>
                  )}
                  <span className="text-[10px] bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">
                    {cat.count}
                  </span>
                </span>
              </button>
              <AnimatePresence>
                {hasChildren && isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    {cat.children.map((child) => (
                      <button
                        key={child.id}
                        onClick={() => onSelect(child.id)}
                        className={`w-full text-left ml-8 pr-4 py-1.5 text-[12px] transition-colors flex items-center gap-2 ${
                          activeCategory === child.id
                            ? 'text-primary-container'
                            : 'text-slate-500 hover:text-on-surface'
                        }`}
                      >
                        <span
                          className={`w-1 h-1 rounded-full shrink-0 ${activeCategory === child.id ? 'bg-primary-container' : 'bg-slate-600'}`}
                        />
                        {child.name}
                        <span className="text-[10px] text-on-surface-variant/60 ml-auto">{child.count}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-surface-container-high rounded-sm overflow-hidden animate-pulse">
      <div className="aspect-square bg-surface-container-lowest" />
      <div className="p-2.5 space-y-2">
        <div className="h-3 bg-surface-container-lowest rounded w-3/4" />
        <div className="h-3 bg-surface-container-lowest rounded w-1/2" />
      </div>
    </div>
  );
}

function SkeletonCardMobile() {
  return (
    <div className="bg-surface-container-high rounded-sm overflow-hidden animate-pulse">
      <div className="aspect-square bg-surface-container-lowest" />
      <div className="p-2 space-y-1.5">
        <div className="h-2.5 bg-surface-container-lowest rounded w-3/4" />
      </div>
    </div>
  );
}

const HOME_SCROLL_POSITION_PREFIX = 'home_model_scroll_position:';
const HOME_SCROLL_TARGET_PREFIX = 'home_model_scroll_target:';
const HOME_BROWSE_STATE_PREFIX = 'home_model_browse_state:';
const HOME_SCROLL_RESTORE_PENDING_KEY = 'home_model_scroll_restore_pending_v1';

type HomeBrowseState = {
  categoryId: string;
  query: string;
  page: number;
  pageSize: number;
  sort: string;
  restoreKey: string;
};

type HomeLocationState = {
  homeBrowseState?: Partial<HomeBrowseState> | null;
} | null;

function parsePageParam(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function normalizeSortParam(value: string | null) {
  return value === 'name' ? 'name' : 'created_at';
}

function normalizeHomePageSizeOptions(policy: Record<string, number>) {
  const options = [policy.homeOption1, policy.homeOption2, policy.homeOption3, policy.homeOption4]
    .map((value) => Math.floor(Number(value) || 0))
    .filter((value) => value > 0);
  return Array.from(new Set(options)).sort((a, b) => a - b);
}

function buildHomeReturnPath() {
  return '/';
}

function buildHomeRestoreKey(
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

function readHomeBrowseStateFromLocation(state: unknown) {
  const homeState = (state as HomeLocationState)?.homeBrowseState;
  return homeState && typeof homeState === 'object' ? homeState : null;
}

function normalizeHomeBrowseState(value: Partial<HomeBrowseState> | null | undefined) {
  if (!value) return null;
  const categoryId = typeof value.categoryId === 'string' && value.categoryId ? value.categoryId : 'all';
  const query = typeof value.query === 'string' ? normalizeHomeSearchQuery(value.query) : '';
  const page = typeof value.page === 'number' ? parsePageParam(String(value.page)) : 1;
  const pageSize = typeof value.pageSize === 'number' ? normalizePageSize(value.pageSize) : DEFAULT_PAGE_SIZE;
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

function saveHomeBrowseState(restoreKey: string, state: HomeBrowseState) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${HOME_BROWSE_STATE_PREFIX}${restoreKey}`, JSON.stringify(state));
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}

function writeHomeBrowseStateToCurrentHistory(state: HomeBrowseState) {
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

function readHomeBrowseState(restoreKey: string | null) {
  if (typeof window === 'undefined' || !restoreKey) return null;
  try {
    const raw = window.sessionStorage.getItem(`${HOME_BROWSE_STATE_PREFIX}${restoreKey}`);
    return normalizeHomeBrowseState(raw ? JSON.parse(raw) : null);
  } catch {
    return null;
  }
}

function readPendingHomeBrowseState() {
  if (typeof window === 'undefined') return null;
  try {
    return readHomeBrowseState(window.sessionStorage.getItem(HOME_SCROLL_RESTORE_PENDING_KEY));
  } catch {
    return null;
  }
}

function saveHomeScrollPosition(restoreKey: string, scrollTop: number, pendingRestore = false, modelId?: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      `${HOME_SCROLL_POSITION_PREFIX}${restoreKey}`,
      String(Math.max(0, Math.round(scrollTop))),
    );
    if (modelId) window.sessionStorage.setItem(`${HOME_SCROLL_TARGET_PREFIX}${restoreKey}`, modelId);
    if (pendingRestore) window.sessionStorage.setItem(HOME_SCROLL_RESTORE_PENDING_KEY, restoreKey);
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}

function readHomeScrollPosition(restoreKey: string) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(`${HOME_SCROLL_POSITION_PREFIX}${restoreKey}`);
    const parsed = raw ? Number(raw) : null;
    return parsed != null && Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readHomeScrollTarget(restoreKey: string) {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(`${HOME_SCROLL_TARGET_PREFIX}${restoreKey}`);
  } catch {
    return null;
  }
}

function getHomeModelElement(container: HTMLElement, modelId: string) {
  return (
    Array.from(container.querySelectorAll<HTMLElement>('[data-home-model-id]')).find(
      (element) => element.dataset.homeModelId === modelId,
    ) || null
  );
}

function scrollHomeToModel(container: HTMLElement, modelId: string | null, fallbackTop: number | null) {
  if (modelId) {
    const target = getHomeModelElement(container, modelId);
    if (target) {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const topPadding = Math.max(16, Math.round(container.clientHeight * 0.14));
      const top = container.scrollTop + targetRect.top - containerRect.top - topPadding;
      container.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
      return true;
    }
    return false;
  }
  if (fallbackTop != null) {
    container.scrollTo({ top: fallbackTop, behavior: 'auto' });
    return true;
  }
  return false;
}

function getPendingHomeRestoreKey() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(HOME_SCROLL_RESTORE_PENDING_KEY);
  } catch {
    return null;
  }
}

function clearPendingHomeRestore(restoreKey: string) {
  if (typeof window === 'undefined') return;
  try {
    if (window.sessionStorage.getItem(HOME_SCROLL_RESTORE_PENDING_KEY) === restoreKey) {
      window.sessionStorage.removeItem(HOME_SCROLL_RESTORE_PENDING_KEY);
    }
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}

function ProductCard({
  product,
  onDownload,
  returnPath,
  homeBrowseState,
  onBeforeOpen,
  onContextMenu,
  manageOpen,
  onCloseManage,
  onOpenManageDetail,
  onShareModel,
  onRenameModel,
  onRequestDelete,
  variant = 'grid',
}: {
  product: Product;
  onDownload: (id: string) => void;
  returnPath: string;
  homeBrowseState: HomeBrowseState;
  onBeforeOpen?: (modelId: string) => void;
  onContextMenu?: (event: MouseEvent, product: Product) => void;
  manageOpen?: boolean;
  onCloseManage?: () => void;
  onOpenManageDetail?: (product: Product) => void;
  onShareModel?: (product: Product) => void;
  onRenameModel?: (product: Product, name: string) => Promise<void>;
  onRequestDelete?: (product: Product) => void;
  variant?: 'grid' | 'list';
}) {
  const detailPath = `/model/${product.id}`;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(product.name);
  const [renameSaving, setRenameSaving] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const ignoreNextOverlayClickRef = useRef(false);
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (manageOpen) {
      setRenameValue(product.name);
      setRenaming(false);
      setRenameSaving(false);
    }
  }, [manageOpen, product.name]);

  const toggleFavorite = useCallback(
    async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (favLoading || !isAuthenticated) return;
      setFavLoading(true);
      try {
        if (isFavorited) {
          await favoriteApi.remove(product.id);
          setIsFavorited(false);
        } else {
          await favoriteApi.add(product.id);
          setIsFavorited(true);
        }
      } catch {
        // 收藏失败时保持当前状态，避免一次网络波动打断浏览。
      } finally {
        setFavLoading(false);
      }
    },
    [favLoading, isFavorited, product.id, isAuthenticated],
  );

  const cancelRename = useCallback(() => {
    setRenameValue(product.name);
    setRenaming(false);
  }, [product.name]);

  const commitRename = useCallback(async () => {
    const nextName = renameValue.trim();
    if (renameSaving) return false;
    if (!nextName || nextName === product.name) {
      setRenameValue(product.name);
      setRenaming(false);
      return true;
    }
    setRenameSaving(true);
    try {
      await onRenameModel?.(product, nextName);
      setRenaming(false);
      return true;
    } catch {
      return false;
    } finally {
      setRenameSaving(false);
    }
  }, [onRenameModel, product, renameSaving, renameValue]);

  const finishRenameThen = useCallback(
    async (action: () => void) => {
      if (renaming) {
        const committed = await commitRename();
        if (!committed) return;
      }
      action();
    },
    [commitRename, renaming],
  );

  const handleCardClick = useCallback(
    (event: MouseEvent) => {
      if (manageOpen) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onBeforeOpen?.(product.id);
    },
    [manageOpen, onBeforeOpen, product.id],
  );

  const manageOverlay = manageOpen ? (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="absolute inset-0 z-20 bg-surface-container-high text-on-surface"
      draggable={false}
      onDragStartCapture={(event) => event.preventDefault()}
      onDragOverCapture={(event) => event.preventDefault()}
      onDropCapture={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (ignoreNextOverlayClickRef.current) {
          ignoreNextOverlayClickRef.current = false;
          return;
        }
        if (renaming && event.target instanceof Element && !event.target.closest('[data-rename-control]')) {
          void commitRename();
        }
      }}
      onContextMenu={(event) => {
        if (event.target instanceof Element && event.target.closest('[data-rename-control]')) {
          event.stopPropagation();
          return;
        }
        event.preventDefault();
      }}
    >
      <div className="flex h-full flex-col p-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-primary">模型管理</p>
            {renaming ? (
              <textarea
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => {
                  ignoreNextOverlayClickRef.current = true;
                  event.stopPropagation();
                }}
                onMouseUp={(event) => event.stopPropagation()}
                onPointerDown={(event) => {
                  ignoreNextOverlayClickRef.current = true;
                  event.stopPropagation();
                }}
                onPointerUp={(event) => event.stopPropagation()}
                onDragStart={(event) => event.preventDefault()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => event.preventDefault()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    void commitRename();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelRename();
                  }
                }}
                data-rename-control
                draggable={false}
                rows={2}
                className="mt-1 h-20 max-h-36 min-h-16 w-full min-w-0 resize-y rounded-sm border border-primary/40 bg-surface-container-lowest px-2.5 py-1.5 text-sm font-semibold leading-5 text-on-surface outline-none selection:bg-primary/30 focus:border-primary"
                autoFocus
              />
            ) : (
              <button
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setRenaming(true);
                }}
                className="mt-1 flex w-full min-w-0 items-start gap-1.5 rounded-sm text-left text-sm font-semibold leading-tight text-on-surface transition-colors hover:text-primary"
                title="编辑名称"
              >
                <span className="line-clamp-2 min-w-0">{product.name}</span>
              </button>
            )}
            <p className="mt-1 text-[11px] text-on-surface-variant">{product.fileSize}</p>
            {renaming && <p className="mt-1 text-[10px] text-on-surface-variant/80">点击空白处保存，Esc 取消</p>}
          </div>
          <button
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void finishRenameThen(() => onCloseManage?.());
            }}
            data-rename-control
            className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
            title="关闭"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="mt-auto grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void finishRenameThen(() => onOpenManageDetail?.(product));
              }}
              data-rename-control
              disabled={renameSaving}
              className="flex min-w-0 items-center justify-center gap-1.5 rounded-sm bg-primary-container px-2 py-2 text-xs font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Icon
                name={renameSaving ? 'progress_activity' : 'open_in_new'}
                size={13}
                className={renameSaving ? 'animate-spin' : ''}
              />
              <span className="truncate">打开详情</span>
            </button>
            <button
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void finishRenameThen(() => onShareModel?.(product));
              }}
              data-rename-control
              disabled={renameSaving}
              className="flex min-w-0 items-center justify-center gap-1.5 rounded-sm border border-outline-variant/30 px-2 py-2 text-xs text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-50"
            >
              <Icon name="share" size={13} />
              <span className="truncate">分享链接</span>
            </button>
            <button
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void finishRenameThen(() => onRequestDelete?.(product));
              }}
              data-rename-control
              disabled={renameSaving}
              className="col-span-2 flex min-w-0 items-center justify-center gap-1.5 rounded-sm border border-error/30 px-2 py-2 text-xs font-semibold text-error transition-colors hover:bg-error-container/15 disabled:opacity-50"
            >
              <Icon name="delete" size={13} />
              <span className="truncate">删除模型</span>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  ) : null;

  if (variant === 'list') {
    const content = (
      <>
        <div className="w-32 shrink-0 bg-surface-container-lowest relative overflow-hidden flex items-center justify-center">
          <ModelThumbnail
            src={product.thumbnailUrl}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
          <div className="absolute top-1.5 left-1.5 flex gap-1">
            {product.formats.map((f, index) => (
              <FormatTag key={`${f || 'format'}-${index}`} format={f} />
            ))}
          </div>
        </div>
        <div className="flex-1 flex flex-col justify-center p-3 min-w-0">
          <h3 className="text-sm font-headline text-on-surface leading-tight line-clamp-1 mb-1">{product.name}</h3>
          <div className="flex items-center gap-3 text-xs text-on-surface-variant mb-2">
            <span>{product.fileSize}</span>
            {product.variantCount && product.variantCount > 1 && (
              <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded-sm text-[10px] font-medium">
                ×{product.variantCount} 变体
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDownload(product.id);
              }}
              className="bg-primary-container text-on-primary rounded-sm py-1 px-3 text-xs font-medium hover:opacity-90 flex items-center gap-1"
            >
              <Icon name="download" size={14} fill />
              下载
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="border border-outline-variant/40 text-on-surface-variant hover:text-on-surface rounded-sm py-1 px-3 text-xs flex items-center gap-1"
            >
              <Icon name="visibility" size={14} />
              预览
            </button>
          </div>
        </div>
        <AnimatePresence>{manageOverlay}</AnimatePresence>
      </>
    );
    const className =
      'relative flex group bg-surface-container-high rounded-sm overflow-hidden hover:shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition-all duration-300';
    if (manageOpen) {
      return (
        <div
          onContextMenu={(event) => onContextMenu?.(event, product)}
          data-home-model-id={product.id}
          draggable={false}
          className={className}
        >
          {content}
        </div>
      );
    }
    return (
      <Link
        to={detailPath}
        state={{ from: returnPath, homeBrowseState }}
        onClick={handleCardClick}
        onContextMenu={(event) => onContextMenu?.(event, product)}
        data-home-model-id={product.id}
        draggable={false}
        className={className}
      >
        {content}
      </Link>
    );
  }
  const content = (
    <>
      <div className="aspect-square bg-surface-container-lowest relative overflow-hidden flex items-center justify-center">
        <ModelThumbnail
          src={product.thumbnailUrl}
          alt={product.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute top-2 left-2 flex gap-1">
          {product.formats.map((f, index) => (
            <FormatTag key={`${f || 'format'}-${index}`} format={f} />
          ))}
        </div>
        <span className="absolute top-2 right-2 bg-surface-container-highest/80 backdrop-blur-md px-1.5 py-0.5 text-[9px] text-on-surface-variant font-mono rounded-sm border border-outline-variant/30">
          {product.fileSize}
        </span>
        <div className="absolute right-2 bottom-2 z-20 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity delay-[240ms]">
          {isAuthenticated && (
            <button
              onClick={toggleFavorite}
              disabled={favLoading}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container-lowest/40 backdrop-blur-sm transition-colors ${isFavorited ? 'text-primary-container border-primary-container/30' : 'text-on-surface-variant/60 hover:text-on-surface-variant'}`}
              aria-label={isFavorited ? '取消收藏' : '收藏'}
              data-tooltip-ignore
            >
              <Icon name={isFavorited ? 'favorite' : 'star'} size={14} />
            </button>
          )}
          {product.variantCount && product.variantCount > 1 && (
            <span className="bg-primary/90 text-on-primary text-[9px] font-bold px-1.5 py-0.5 rounded-sm">
              ×{product.variantCount}
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 flex flex-col p-2.5">
        <h3 className="text-xs font-headline text-on-surface leading-tight line-clamp-2">{product.name}</h3>
        <div className="flex items-center gap-2 mt-auto pt-2">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDownload(product.id);
            }}
            className="flex-1 bg-primary-container text-on-primary rounded-sm py-1.5 px-3 text-xs font-medium hover:opacity-90 flex items-center justify-center gap-1"
          >
            <Icon name="download" size={14} fill />
            下载
          </button>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="flex-1 border border-outline-variant/40 text-on-surface-variant hover:text-on-surface rounded-sm py-1.5 px-3 text-xs text-center flex items-center justify-center gap-1"
          >
            <Icon name="visibility" size={14} />
            预览
          </button>
        </div>
      </div>
      <AnimatePresence>{manageOverlay}</AnimatePresence>
    </>
  );
  const className =
    'block group bg-surface-container-high rounded-sm overflow-hidden hover:shadow-[0_12px_24px_rgba(0,0,0,0.4)] transition-all duration-300 flex flex-col relative';
  if (manageOpen) {
    return (
      <div
        onContextMenu={(event) => onContextMenu?.(event, product)}
        data-home-model-id={product.id}
        draggable={false}
        className={className}
      >
        {content}
      </div>
    );
  }
  return (
    <Link
      to={detailPath}
      state={{ from: returnPath, homeBrowseState }}
      onClick={handleCardClick}
      onContextMenu={(event) => onContextMenu?.(event, product)}
      data-home-model-id={product.id}
      draggable={false}
      className={className}
    >
      {content}
    </Link>
  );
}

function MobileDrawer({
  open,
  onClose,
  expandedCategories,
  activeCategory,
  categories: categoriesData,
  totalCount,
  onToggle,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  expandedCategories: Set<string>;
  activeCategory: string;
  categories: Category[];
  totalCount: number;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  useEffect(() => {
    document.documentElement.classList.toggle('mobile-nav-drawer-open', open);
    return () => document.documentElement.classList.remove('mobile-nav-drawer-open');
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[260]"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed left-0 top-0 bottom-0 w-72 bg-surface-container-low flex flex-col overflow-y-auto scrollbar-hidden z-[270]"
          >
            <div className="flex items-center justify-between p-4 border-b border-outline-variant/20">
              <h2 className="text-sm font-bold text-on-surface tracking-wider uppercase font-headline">产品目录</h2>
              <button onClick={onClose} className="p-1 text-on-surface-variant">
                <Icon name="close" size={24} />
              </button>
            </div>
            <div className="flex-1 py-2">
              <button
                onClick={() => {
                  onSelect('all');
                  onClose();
                }}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                  activeCategory === 'all'
                    ? 'border-l-2 border-primary-container text-primary-container bg-gradient-to-r from-primary-container/15 to-transparent'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon name="category_all" size={18} />
                  全部模型
                </span>
                <span className="text-[10px] bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">
                  {totalCount || categoriesData.reduce((s, c) => s + c.count, 0)}
                </span>
              </button>
              {categoriesData.map((cat) => {
                const isExpanded = expandedCategories.has(cat.id);
                const hasChildren = cat.children && cat.children.length > 0;
                const isActive =
                  cat.id === activeCategory || (cat.children?.some((c) => c.id === activeCategory) ?? false);
                return (
                  <div key={cat.id}>
                    <button
                      onClick={() => {
                        if (hasChildren) {
                          onSelect(cat.id);
                          onToggle(cat.id);
                        } else {
                          onSelect(cat.id);
                          onClose();
                        }
                      }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                        isActive
                          ? 'border-l-2 border-primary-container text-primary-container bg-gradient-to-r from-primary-container/15 to-transparent'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon name={cat.icon} size={18} />
                        {cat.name}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {hasChildren && (
                          <motion.span
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            transition={{ duration: 0.2 }}
                            className="text-on-surface-variant/60"
                          >
                            <Icon name="expand_more" size={16} />
                          </motion.span>
                        )}
                        <span className="text-[10px] bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">
                          {cat.count}
                        </span>
                      </span>
                    </button>
                    <AnimatePresence>
                      {hasChildren && isExpanded && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: 'auto' }}
                          exit={{ height: 0 }}
                          className="overflow-hidden"
                        >
                          {cat.children.map((child) => (
                            <button
                              key={child.id}
                              onClick={() => {
                                onSelect(child.id);
                                onClose();
                              }}
                              className={`w-full text-left ml-8 pr-4 py-2 text-[12px] flex items-center gap-2 ${
                                activeCategory === child.id ? 'text-primary-container' : 'text-slate-500'
                              }`}
                            >
                              <span
                                className={`w-1 h-1 rounded-full shrink-0 ${activeCategory === child.id ? 'bg-primary-container' : 'bg-slate-600'}`}
                              />
                              {child.name}
                              <span className="text-[10px] text-on-surface-variant/60 ml-auto">{child.count}</span>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function ProductCardMobile({
  product,
  onDownload,
  returnPath,
  homeBrowseState,
  onBeforeOpen,
}: {
  product: Product;
  onDownload: (id: string) => void;
  returnPath: string;
  homeBrowseState: HomeBrowseState;
  onBeforeOpen?: (modelId: string) => void;
}) {
  const detailPath = `/model/${product.id}`;
  return (
    <div className="bg-surface-container-high rounded-sm overflow-hidden flex flex-col">
      <Link
        to={detailPath}
        state={{ from: returnPath, homeBrowseState }}
        onClick={() => onBeforeOpen?.(product.id)}
        data-home-model-id={product.id}
        className="block"
      >
        <div className="h-[140px] bg-surface-container-lowest relative overflow-hidden flex items-center justify-center">
          <ModelThumbnail src={product.thumbnailUrl} alt={product.name} className="w-full h-full object-cover" />
          <div className="absolute top-2 left-2 flex flex-col gap-0.5">
            {product.formats.map((f, index) => (
              <FormatTag key={`${f || 'format'}-${index}`} format={f} />
            ))}
          </div>
          <span className="absolute top-2 right-2 text-[9px] text-on-surface-variant/60 bg-black/30 backdrop-blur-sm px-1.5 py-0.5 rounded-sm">
            {product.fileSize}
          </span>
        </div>
      </Link>
      <div className="p-2.5 flex flex-col flex-1">
        <h3 className="text-xs font-headline text-on-surface mb-1.5 leading-tight line-clamp-2">{product.name}</h3>
        <button
          onClick={() => onDownload(product.id)}
          className="mt-auto w-full text-xs py-1.5 bg-primary-container text-on-primary rounded-sm font-medium flex items-center justify-center gap-1.5"
        >
          <Icon name="download" size={14} fill />
          下载
        </button>
      </div>
    </div>
  );
}

function serverItemToProduct(item: ServerModelListItem): Product {
  const format = item.format?.toUpperCase() || 'UNKNOWN';
  return {
    id: item.model_id,
    name: item.name || '未命名模型',
    description: `${format} 格式 3D 模型`,
    formats: [format],
    fileSize: formatFileSize(item.original_size || item.file_size || 0),
    category: item.category || '其他辅料',
    thumbnailUrl: item.thumbnail_url || undefined,
    createdAt: item.created_at || undefined,
    fileSizeBytes: item.original_size || item.file_size || 0,
    variantCount: item.group?.variant_count,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function HomePage() {
  useDocumentTitle();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: publicSettings } = useSWR('publicSettings', () => getCachedPublicSettings());
  const homePageSizePolicy = getBusinessConfig(publicSettings || undefined).pageSizePolicy;
  const homePageSizeOptions = normalizeHomePageSizeOptions(homePageSizePolicy);
  const homeDefaultPageSize = homePageSizeOptions.includes(homePageSizePolicy.homeDefault)
    ? homePageSizePolicy.homeDefault
    : homePageSizeOptions[0] || DEFAULT_PAGE_SIZE;
  const legacySearchQuery = normalizeHomeSearchQuery(searchParams.get('q') || '');
  const initialHomeState = useMemo(
    () => normalizeHomeBrowseState(readHomeBrowseStateFromLocation(location.state)) || readPendingHomeBrowseState(),
    // Only seed the initial local browse state once when the page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const { isAuthenticated, user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  const [browseBlocked, setBrowseBlocked] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ product: Product } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deletingModel, setDeletingModel] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      getCachedPublicSettings()
        .then((s) => {
          if (s.require_login_browse) setBrowseBlocked(true);
        })
        .catch(() => {});
    }
  }, [isAuthenticated]);

  // Fetch category tree (with counts from server)
  const { data: categoryData, mutate: mutateCategories } = useSWR('/categories', () => categoriesApi.tree());
  const categories = useMemo(() => buildCategories(categoryData?.items || []), [categoryData]);
  const totalModelCount = useMemo(
    () => categoryData?.total ?? categories.reduce((sum, category) => sum + category.count, 0),
    [categories, categoryData?.total],
  );

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState(
    () => initialHomeState?.query ?? readHomeSearchQuery() ?? legacySearchQuery,
  );
  const [activeCategory, setActiveCategory] = useState(
    () => initialHomeState?.categoryId || searchParams.get('category') || 'all',
  );
  const [page, setPage] = useState(() => initialHomeState?.page || parsePageParam(searchParams.get('page')));
  const [pageSize, setPageSize] = useState(
    () =>
      initialHomeState?.pageSize ||
      normalizePageSize(searchParams.get('page_size'), homePageSizeOptions, homeDefaultPageSize),
  );
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState(() => initialHomeState?.sort || normalizeSortParam(searchParams.get('sort')));
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const consumedHomeStateKeyRef = useRef<string | null>(null);

  // Keep browsing controls in React/navigation state. Legacy query links still work, then get cleaned from the URL.
  useEffect(() => {
    const stateBrowse = normalizeHomeBrowseState(readHomeBrowseStateFromLocation(location.state));
    if (stateBrowse && consumedHomeStateKeyRef.current !== location.key) {
      consumedHomeStateKeyRef.current = location.key;
      if (stateBrowse.query !== searchQuery) {
        setSearchQuery(stateBrowse.query);
        saveHomeSearchQuery(stateBrowse.query);
        dispatchHomeSearchQuery(stateBrowse.query, { preservePage: true });
      }
      if (stateBrowse.categoryId !== activeCategory) setActiveCategory(stateBrowse.categoryId);
      if (stateBrowse.page !== page) setPage(stateBrowse.page);
      if (stateBrowse.pageSize !== pageSize) setPageSize(stateBrowse.pageSize);
      if (stateBrowse.sort !== sortBy) setSortBy(stateBrowse.sort);
      return;
    }

    const hasLegacySearchQuery = searchParams.has('q');
    if (hasLegacySearchQuery && legacySearchQuery !== searchQuery) {
      setSearchQuery(legacySearchQuery);
      saveHomeSearchQuery(legacySearchQuery);
      dispatchHomeSearchQuery(legacySearchQuery, { preservePage: true });
    }

    const legacyCategory = searchParams.get('category');
    if (legacyCategory && legacyCategory !== activeCategory) setActiveCategory(legacyCategory);

    if (searchParams.has('page')) {
      const nextPage = parsePageParam(searchParams.get('page'));
      if (nextPage !== page) setPage(nextPage);
    }
    if (searchParams.has('page_size')) {
      const nextPageSize = normalizePageSize(searchParams.get('page_size'), homePageSizeOptions, homeDefaultPageSize);
      if (nextPageSize !== pageSize) setPageSize(nextPageSize);
    }
    if (searchParams.has('sort')) {
      const nextSort = normalizeSortParam(searchParams.get('sort'));
      if (nextSort !== sortBy) setSortBy(nextSort);
    }

    if (
      hasLegacySearchQuery ||
      legacyCategory ||
      searchParams.has('page') ||
      searchParams.has('page_size') ||
      searchParams.has('sort')
    ) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('q');
      nextParams.delete('category');
      nextParams.delete('page');
      nextParams.delete('page_size');
      nextParams.delete('sort');
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    activeCategory,
    homeDefaultPageSize,
    homePageSizeOptions,
    legacySearchQuery,
    location.key,
    location.state,
    page,
    pageSize,
    searchParams,
    searchQuery,
    setSearchParams,
    sortBy,
  ]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);

  useEffect(() => {
    saveHomeSearchQuery(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const handleSearchEvent = (event: Event) => {
      const detail = (event as CustomEvent<HomeSearchEventDetail>).detail;
      if (!detail || typeof detail.query !== 'string') return;
      const query = normalizeHomeSearchQuery(detail.query);
      setSearchQuery(query);
      saveHomeSearchQuery(query);
      if (!detail.preservePage) {
        if (query && activeCategory !== 'all') setActiveCategory('all');
        setPage(1);
        scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (searchParams.has('q')) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('q');
        setSearchParams(nextParams, { replace: true });
      }
    };
    window.addEventListener(HOME_SEARCH_EVENT, handleSearchEvent);
    return () => window.removeEventListener(HOME_SEARCH_EVENT, handleSearchEvent);
  }, [activeCategory, searchParams, setSearchParams]);

  const handleDownload = useCallback(
    async (modelId: string) => {
      try {
        await downloadModelFile(modelId, 'original');
      } catch (error) {
        if (isDownloadAuthRequiredError(error)) {
          setLoginPromptOpen(true);
          return;
        }
        toast('下载失败，请稍后重试', 'error');
      }
    },
    [toast],
  );

  // Server-side filtering with category ID
  const {
    data: serverData,
    isLoading,
    mutate: mutateModels,
    hasMore,
    isLoadingMore,
    setSize: setModelPageSize,
  } = useInfiniteModels(
    {
      page,
      pageSize,
      search: searchQuery,
      categoryId: activeCategory !== 'all' ? activeCategory : undefined,
      sort: sortBy,
    },
    page,
  );

  useEffect(() => {
    setModelPageSize(page);
  }, [page, setModelPageSize]);

  const products = useMemo(() => {
    if (!serverData?.items) return [];
    return serverData.items.map(serverItemToProduct);
  }, [serverData]);
  const productIdsKey = useMemo(() => products.map((product) => product.id).join('|'), [products]);

  const totalItems = serverData?.total || 0;
  const displayTotalItems =
    activeCategory === 'all' && !searchQuery.trim() ? totalModelCount || totalItems : totalItems;

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => {
      if (prev.has(id)) {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }
      return new Set([id]);
    });
  };

  const handleSelectCategory = (id: string) => {
    setActiveCategory(id);
    setSearchQuery('');
    saveHomeSearchQuery('');
    dispatchHomeSearchQuery('');
    setPage(1);
    // Clear search when selecting a category; category itself stays in local navigation state.
    if (searchParams.toString()) setSearchParams(new URLSearchParams(), { replace: true });
  };

  const handleLoadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setPage((current) => current + 1);
  }, [hasMore, isLoadingMore]);

  const handleSortChange = useCallback((nextSort: string) => {
    const normalizedSort = normalizeSortParam(nextSort);
    setSortBy(normalizedSort);
    setPage(1);
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const modelReturnPath = useMemo(() => buildHomeReturnPath(), []);

  const homeRestoreKey = useMemo(
    () => buildHomeRestoreKey(activeCategory, searchQuery, page, sortBy, pageSize),
    [activeCategory, page, pageSize, searchQuery, sortBy],
  );

  const homeBrowseState = useMemo<HomeBrowseState>(
    () => ({
      categoryId: activeCategory,
      query: searchQuery,
      page,
      pageSize,
      sort: sortBy,
      restoreKey: homeRestoreKey,
    }),
    [activeCategory, homeRestoreKey, page, pageSize, searchQuery, sortBy],
  );

  const saveCurrentHomeScroll = useCallback(
    (pendingRestore = false, modelId?: string) => {
      saveHomeBrowseState(homeRestoreKey, homeBrowseState);
      writeHomeBrowseStateToCurrentHistory(homeBrowseState);
      saveHomeScrollPosition(homeRestoreKey, scrollContainerRef.current?.scrollTop || 0, pendingRestore, modelId);
    },
    [homeBrowseState, homeRestoreKey],
  );

  useEffect(() => {
    saveHomeBrowseState(homeRestoreKey, homeBrowseState);
    writeHomeBrowseStateToCurrentHistory(homeBrowseState);
  }, [homeBrowseState, homeRestoreKey]);

  const handleHomeScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      saveHomeScrollPosition(homeRestoreKey, event.currentTarget.scrollTop);
      setContextMenu((current) => (current ? null : current));
    },
    [homeRestoreKey],
  );

  const handleModelContextMenu = useCallback(
    (event: MouseEvent, product: Product) => {
      if (!isDesktop || !isAdmin) return;
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({ product });
    },
    [isAdmin, isDesktop],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', closeWithEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', closeWithEscape);
    };
  }, [contextMenu]);

  const handleDeleteModel = useCallback(async () => {
    if (!deleteTarget) return;
    setDeletingModel(true);
    try {
      await modelApi.delete(deleteTarget.id);
      toast('模型已删除', 'success');
      setDeleteTarget(null);
      setContextMenu(null);
      await Promise.all([mutateModels(), mutateCategories()]);
    } catch {
      toast('删除失败，请稍后重试', 'error');
    } finally {
      setDeletingModel(false);
    }
  }, [deleteTarget, mutateCategories, mutateModels, toast]);

  const openManagedModelDetail = useCallback(
    (product: Product) => {
      saveCurrentHomeScroll(true, product.id);
      setContextMenu(null);
      navigate(`/model/${product.id}`, { state: { from: modelReturnPath, homeBrowseState } });
    },
    [homeBrowseState, modelReturnPath, navigate, saveCurrentHomeScroll],
  );

  const shareManagedModel = useCallback(
    async (product: Product) => {
      try {
        const result = await createShare({
          modelId: product.id,
          allowPreview: true,
          allowDownload: true,
          downloadLimit: 0,
        });
        await copyText(`${window.location.origin}/share/${result.token}`);
        toast('分享链接已复制', 'success');
      } catch (error: unknown) {
        toast(getErrorMessage(error, '创建分享失败'), 'error');
      }
      setContextMenu(null);
    },
    [toast],
  );

  const renameManagedModel = useCallback(
    async (_product: Product, name: string) => {
      try {
        await modelApi.update(_product.id, { name });
        toast('模型名称已更新', 'success');
        setContextMenu(null);
        await mutateModels();
      } catch (error: unknown) {
        toast(getErrorMessage(error, '改名失败'), 'error');
        throw error;
      }
    },
    [mutateModels, toast],
  );

  const requestManagedModelDelete = useCallback((product: Product) => {
    setDeleteTarget(product);
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (isLoading || getPendingHomeRestoreKey() !== homeRestoreKey) return;
    const targetTop = readHomeScrollPosition(homeRestoreKey);
    const targetModelId = readHomeScrollTarget(homeRestoreKey);
    if (targetTop == null && !targetModelId) return;

    if (restoreFrameRef.current != null) window.cancelAnimationFrame(restoreFrameRef.current);
    let restored = false;
    const tryRestore = () => {
      const container = scrollContainerRef.current;
      if (!container || restored) return false;
      restored = scrollHomeToModel(container, targetModelId, targetTop);
      if (restored) clearPendingHomeRestore(homeRestoreKey);
      return restored;
    };

    restoreFrameRef.current = window.requestAnimationFrame(() => {
      tryRestore();
      restoreFrameRef.current = window.requestAnimationFrame(() => {
        tryRestore();
        restoreFrameRef.current = window.requestAnimationFrame(() => {
          tryRestore();
          restoreFrameRef.current = null;
        });
      });
    });

    return () => {
      if (restoreFrameRef.current != null) {
        window.cancelAnimationFrame(restoreFrameRef.current);
        restoreFrameRef.current = null;
      }
    };
  }, [homeRestoreKey, isLoading, productIdsKey, products.length]);

  // Resolve breadcrumb
  const breadcrumb = useMemo(() => {
    if (activeCategory === 'all') return { parent: null, child: null, label: '全部模型' };
    const parent = categories.find((c) => c.id === activeCategory);
    if (parent) return { parent: parent.name, child: null, label: parent.name };
    for (const cat of categories) {
      const child = cat.children?.find((c) => c.id === activeCategory);
      if (child) return { parent: cat.name, child: child.name, label: `${cat.name} / ${child.name}` };
    }
    return { parent: null, child: null, label: activeCategory };
  }, [activeCategory, categories]);

  if (browseBlocked) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-surface gap-6">
        <Icon name="lock" size={64} className="text-on-surface-variant/30" />
        <h2 className="text-xl font-bold text-on-surface">需要登录</h2>
        <p className="text-sm text-on-surface-variant">浏览模型库需要先登录账号</p>
        <Link
          to="/login"
          className="px-6 py-2.5 bg-primary-container text-on-primary rounded-lg text-sm font-medium hover:opacity-90"
        >
          前往登录
        </Link>
      </div>
    );
  }

  if (isDesktop) {
    return (
      <PublicPageShell>
        <div className="flex flex-1 overflow-hidden">
          <CategorySidebar
            expandedCategories={expandedCategories}
            activeCategory={activeCategory}
            categories={categories}
            totalCount={totalModelCount}
            onToggle={toggleCategory}
            onSelect={handleSelectCategory}
          />
          <main
            ref={scrollContainerRef}
            onScroll={handleHomeScroll}
            className="flex-1 overflow-y-auto model-list-scrollbar bg-surface-dim p-6 relative"
          >
            <AnnouncementBanner />
            <div className="flex justify-between items-end mb-6 border-b border-surface-container-low pb-3 flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm mb-1.5">
                  <button
                    type="button"
                    onClick={() => handleSelectCategory('all')}
                    className="text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors"
                  >
                    首页
                  </button>
                  <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
                  {breadcrumb.parent && !breadcrumb.child ? (
                    <span className="text-primary font-medium">{breadcrumb.label}</span>
                  ) : breadcrumb.parent && breadcrumb.child ? (
                    <>
                      <span
                        className="text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors"
                        onClick={() => {
                          const parent = categories.find((c) => c.name === breadcrumb.parent);
                          if (parent) handleSelectCategory(parent.id);
                        }}
                      >
                        {breadcrumb.parent}
                      </span>
                      <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
                      <span className="text-primary font-medium">{breadcrumb.child}</span>
                    </>
                  ) : (
                    <span className="text-primary font-medium">{breadcrumb.label}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <PageTitle>零件模型库</PageTitle>
                  <span className="bg-surface-container-high px-2 py-0.5 text-xs text-on-surface-variant rounded-sm border border-outline-variant/20">
                    {displayTotalItems} 个模型
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => handleSortChange(e.target.value)}
                    className="bg-surface-container-lowest text-sm text-on-surface rounded-sm pl-3 pr-8 py-1 border border-outline-variant/30 outline-none appearance-none cursor-pointer"
                  >
                    <option value="created_at">最新上传</option>
                    <option value="name">名称排序</option>
                  </select>
                  <Icon
                    name="expand_more"
                    size={12}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
                  />
                </div>
                <div className="flex rounded-sm border border-outline-variant/30 overflow-hidden">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`px-2.5 py-1.5 transition-colors ${viewMode === 'grid' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`}
                  >
                    <Icon name="grid_view" size={18} />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`px-2.5 py-1.5 transition-colors ${viewMode === 'list' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`}
                  >
                    <Icon name="view_list" size={18} />
                  </button>
                </div>
              </div>
            </div>

            {isLoading && products.length === 0 ? (
              <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {Array.from({ length: 12 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : (
              <>
                <div
                  className={`grid gap-3 ${viewMode === 'grid' ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'grid-cols-1 gap-2'}`}
                >
                  {products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      onDownload={handleDownload}
                      onContextMenu={handleModelContextMenu}
                      manageOpen={contextMenu?.product.id === product.id}
                      onCloseManage={() => setContextMenu(null)}
                      onOpenManageDetail={openManagedModelDetail}
                      onShareModel={shareManagedModel}
                      onRenameModel={renameManagedModel}
                      onRequestDelete={requestManagedModelDelete}
                      returnPath={modelReturnPath}
                      homeBrowseState={homeBrowseState}
                      onBeforeOpen={(modelId) => saveCurrentHomeScroll(true, modelId)}
                      variant={viewMode}
                    />
                  ))}
                </div>

                {products.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <Icon name="search_off" size={48} className="text-on-surface-variant/30" />
                    <div className="text-center">
                      <p className="text-on-surface-variant">没有找到匹配的模型</p>
                      {searchQuery.trim() && (
                        <p className="mt-1 text-xs text-on-surface-variant/60">
                          可以提交需求，请管理员补充或完善模型库。
                        </p>
                      )}
                    </div>
                    {searchQuery.trim() && (
                      <Link
                        to="/support"
                        state={{
                          source: 'model_search',
                          searchQuery: searchQuery.trim(),
                          classification: 'novel',
                          description: `模型库未搜索到：${searchQuery.trim()}\n请协助补充或完善该模型。`,
                        }}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary-container px-4 py-2 text-sm font-bold text-on-primary transition-opacity hover:opacity-90"
                      >
                        <Icon name="assignment_add" size={16} />
                        申请完善模型
                      </Link>
                    )}
                  </div>
                )}

                <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={handleLoadMore} />
              </>
            )}
          </main>
        </div>
        {/* Full-width Footer */}
        <footer className="shrink-0 border-t border-outline-variant/10 bg-surface-container-low">
          <div className="px-8 py-4">
            <div className="flex items-center justify-between gap-8">
              {/* Left: Brand */}
              <span className="font-headline font-semibold text-sm text-on-surface-variant/60">{getSiteTitle()}</span>
              {/* Right: Links + Contact */}
              <div className="flex items-center gap-5">
                {getFooterLinks().map((link, i) => (
                  <a
                    key={i}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-on-surface-variant/40 hover:text-on-surface-variant/70 transition-colors"
                  >
                    {link.label}
                  </a>
                ))}
                {getContactEmail() && (
                  <a
                    href={`mailto:${getContactEmail()}`}
                    className="flex items-center gap-1.5 text-[11px] text-on-surface-variant/40 hover:text-primary transition-colors"
                  >
                    <Icon name="mail" size={13} />
                    <span>{getContactEmail()}</span>
                  </a>
                )}
                {getContactPhone() && (
                  <a
                    href={`tel:${getContactPhone()}`}
                    className="flex items-center gap-1.5 text-[11px] text-on-surface-variant/40 hover:text-primary transition-colors"
                  >
                    <Icon name="phone" size={13} />
                    <span>{getContactPhone()}</span>
                  </a>
                )}
              </div>
            </div>
            {/* Copyright + Address line */}
            <div className="flex items-center justify-between mt-2.5">
              <p className="text-[10px] text-on-surface-variant/25">
                {getFooterCopyright() || `© ${new Date().getFullYear()} ${getSiteTitle()}. All rights reserved.`}
              </p>
              {getContactAddress() && (
                <span className="flex items-center gap-1 text-[10px] text-on-surface-variant/25">
                  <Icon name="domain" size={11} />
                  {getContactAddress()}
                </span>
              )}
            </div>
          </div>
        </footer>
        <AnimatePresence>
          {deleteTarget && (
            <motion.div
              key="model-delete-dialog"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
              onClick={() => !deletingModel && setDeleteTarget(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.16 }}
                className="w-full max-w-lg overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-high shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex gap-4 border-b border-outline-variant/10 bg-error-container/10 p-5">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-error/20 bg-surface-container-lowest">
                    <ModelThumbnail
                      src={deleteTarget.thumbnailUrl}
                      alt={deleteTarget.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2 text-error">
                      <Icon name="warning" size={18} />
                      <h3 className="font-headline text-base font-bold">确认删除模型</h3>
                    </div>
                    <p className="line-clamp-2 text-sm font-medium text-on-surface">{deleteTarget.name}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">这个操作会立即删除模型资产与数据库关联记录。</p>
                  </div>
                </div>
                <div className="space-y-4 p-5">
                  <div className="rounded-md border border-error/20 bg-error-container/10 px-3 py-2.5 text-sm leading-relaxed text-on-surface">
                    删除后无法恢复，请确认当前模型不再需要展示、下载或作为变体使用。
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-on-surface-variant">
                    {[
                      'STEP/原始文件',
                      '生成预览文件',
                      '缩略图与图纸',
                      '版本文件',
                      '收藏/下载等关联',
                      '数据库模型记录',
                    ].map((item) => (
                      <div
                        key={item}
                        className="flex items-center gap-2 rounded-md bg-surface-container-low px-2.5 py-2"
                      >
                        <Icon name="check" size={13} className="text-error" />
                        <span className="min-w-0 truncate">{item}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end gap-3 pt-1">
                    <button
                      onClick={() => setDeleteTarget(null)}
                      disabled={deletingModel}
                      className="rounded-md border border-outline-variant/30 px-4 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-highest disabled:opacity-50"
                    >
                      先不删除
                    </button>
                    <button
                      onClick={handleDeleteModel}
                      disabled={deletingModel}
                      className="flex items-center gap-2 rounded-md bg-error px-4 py-2 text-sm font-medium text-on-error transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {deletingModel && <Icon name="progress_activity" size={15} className="animate-spin" />}
                      {deletingModel ? '正在删除...' : '确认永久删除'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        {loginPromptOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setLoginPromptOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-surface-container-high rounded-lg shadow-2xl p-6 w-80 border border-outline-variant/20"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center">
                  <Icon name="lock" size={20} className="text-primary-container" />
                </div>
                <h3 className="text-lg font-headline font-bold text-on-surface">需要登录</h3>
              </div>
              <p className="text-sm text-on-surface-variant mb-5">下载模型需要先登录账号，是否前往登录？</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setLoginPromptOpen(false)}
                  className="flex-1 py-2.5 text-sm text-on-surface-variant border border-outline-variant/30 rounded-lg hover:bg-surface-container-highest transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    setLoginPromptOpen(false);
                    navigate('/login');
                  }}
                  className="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity"
                >
                  前往登录
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </PublicPageShell>
    );
  }

  // Mobile layout
  return (
    <PublicPageShell
      onMobileMenuToggle={() => setDrawerOpen((prev) => !prev)}
      mobileDrawer={
        <MobileDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          expandedCategories={expandedCategories}
          activeCategory={activeCategory}
          categories={categories}
          totalCount={totalModelCount}
          onToggle={toggleCategory}
          onSelect={handleSelectCategory}
        />
      }
    >
      <main
        ref={scrollContainerRef}
        onScroll={handleHomeScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hidden bg-surface-dim"
      >
        <div className="p-3 space-y-3 pb-20 min-h-full flex flex-col">
          <AnnouncementBanner />
          {/* Header with category filter button */}
          <div className="flex items-center justify-between">
            <div>
              <PageTitle className="text-base md:text-base md:normal-case">
                {activeCategory === 'all' ? '零件目录' : breadcrumb.label}
              </PageTitle>
              <span className="text-[10px] text-on-surface-variant">{displayTotalItems} 个模型</span>
            </div>
            <button
              onClick={() => setDrawerOpen(true)}
              className="p-2 text-on-surface-variant hover:text-on-surface bg-surface-container-high rounded-sm flex items-center gap-1.5"
            >
              <Icon name="tune" size={18} />
              <span className="text-xs">筛选</span>
            </button>
          </div>

          {/* Horizontal scrollable category chips */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hidden pb-1 -mx-3 px-3">
            <button
              onClick={() => handleSelectCategory('all')}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeCategory === 'all'
                  ? 'bg-primary-container text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant'
              }`}
            >
              全部模型
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleSelectCategory(cat.id)}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeCategory === cat.id
                    ? 'bg-primary-container text-on-primary'
                    : 'bg-surface-container-high text-on-surface-variant'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Model grid */}
          {isLoading && products.length === 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCardMobile key={i} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {products.map((product) => (
                <ProductCardMobile
                  key={product.id}
                  product={product}
                  onDownload={handleDownload}
                  returnPath={modelReturnPath}
                  homeBrowseState={homeBrowseState}
                  onBeforeOpen={(modelId) => saveCurrentHomeScroll(true, modelId)}
                />
              ))}
            </div>
          )}

          {products.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Icon name="search_off" size={40} className="text-on-surface-variant/30" />
              <div className="text-center">
                <p className="text-sm text-on-surface-variant">没有找到匹配的模型</p>
                {searchQuery.trim() && (
                  <p className="mt-1 text-[11px] text-on-surface-variant/60">提交需求让管理员补充模型。</p>
                )}
              </div>
              {searchQuery.trim() && (
                <Link
                  to="/support"
                  state={{
                    source: 'model_search',
                    searchQuery: searchQuery.trim(),
                    classification: 'novel',
                    description: `模型库未搜索到：${searchQuery.trim()}\n请协助补充或完善该模型。`,
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-container px-3 py-2 text-xs font-bold text-on-primary"
                >
                  <Icon name="assignment_add" size={14} />
                  申请完善模型
                </Link>
              )}
            </div>
          )}

          <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={handleLoadMore} />

          {/* Footer */}
          <footer className="mt-auto pt-4 border-t border-outline-variant/10 text-center pb-2">
            <div className="flex flex-col items-center gap-2">
              {getContactEmail() && (
                <a
                  href={`mailto:${getContactEmail()}`}
                  className="flex items-center gap-1 text-[11px] text-on-surface-variant/40 hover:text-primary transition-colors"
                >
                  <Icon name="mail" size={12} />
                  <span>{getContactEmail()}</span>
                </a>
              )}
              {getContactPhone() && (
                <a
                  href={`tel:${getContactPhone()}`}
                  className="flex items-center gap-1 text-[11px] text-on-surface-variant/40 hover:text-primary transition-colors"
                >
                  <Icon name="phone" size={12} />
                  <span>{getContactPhone()}</span>
                </a>
              )}
              {getContactAddress() && (
                <span className="flex items-center gap-1 text-[10px] text-on-surface-variant/30">
                  <Icon name="domain" size={11} />
                  {getContactAddress()}
                </span>
              )}
              <p className="text-[10px] text-on-surface-variant/40">
                © {new Date().getFullYear()} {getSiteTitle()}
              </p>
            </div>
          </footer>
        </div>
      </main>
      {loginPromptOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setLoginPromptOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-surface-container-high rounded-lg shadow-2xl p-6 w-80 border border-outline-variant/20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center">
                <Icon name="lock" size={20} className="text-primary-container" />
              </div>
              <h3 className="text-lg font-headline font-bold text-on-surface">需要登录</h3>
            </div>
            <p className="text-sm text-on-surface-variant mb-5">下载模型需要先登录账号，是否前往登录？</p>
            <div className="flex gap-3">
              <button
                onClick={() => setLoginPromptOpen(false)}
                className="flex-1 py-2.5 text-sm text-on-surface-variant border border-outline-variant/30 rounded-lg hover:bg-surface-container-highest transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setLoginPromptOpen(false);
                  navigate('/login');
                }}
                className="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity"
              >
                前往登录
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </PublicPageShell>
  );
}
