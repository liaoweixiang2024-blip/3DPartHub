import { motion, AnimatePresence } from 'framer-motion';
import {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useRef,
  memo,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { categoriesApi, type CategoryItem } from '../api/categories';
import { downloadModelFile, isDownloadAuthRequiredError } from '../api/downloads';
import { modelApi, type ServerModelListItem } from '../api/models';
import { createShare } from '../api/shares';
import FormatTag from '../components/shared/FormatTag';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import ModelThumbnail from '../components/shared/ModelThumbnail';
import { PageTitle } from '../components/shared/PagePrimitives';
import Pagination, { DEFAULT_PAGE_SIZE, normalizePageSize } from '../components/shared/Pagination';
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
  HOME_SEARCH_MAX_LENGTH,
  dispatchHomeSearchQuery,
  normalizeHomeSearchQuery,
  readHomeSearchQuery,
  saveHomeSearchQuery,
  type HomeSearchEventDetail,
} from '../lib/homeSearchState';
import { overlayMotion, popoverMotion, sideSheetMotion } from '../lib/motion';
import {
  getCachedPublicSettings,
  getContactEmail,
  getContactPhone,
  getContactAddress,
  getFooterCopyright,
  getFooterLinks,
} from '../lib/publicSettings';
import { preloadModelDetailPage } from '../lib/routeLoaders';
import { useAuthStore, useFavoriteStore } from '../stores';
import { getInterfaceThemePackage } from '../themes/interfaceThemes/registry';
import {
  AnnouncementBanner,
  HomeGridCardContent,
  HomeListCardContent,
  HOME_GRID_ACTION_BUTTON_CLASS,
  HOME_GRID_CARD_CLASS,
  HOME_LIST_ACTION_BUTTON_CLASS,
  HOME_LIST_CARD_CLASS,
} from '../themes/interfaceThemes/shared/HomeDesktopShared';
import type { Category, HomeBrowseState, HomeViewMode, Product } from '../themes/interfaceThemes/shared/homeTypes';
import { getMobileThemePackage } from '../themes/mobileThemes/registry';

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

const HOME_MOBILE_CARD_CLASS = 'home-model-card bg-surface-container-high rounded-sm overflow-hidden flex flex-col';
const HOME_MOBILE_MEDIA_CLASS =
  'h-[140px] bg-surface-container-lowest relative overflow-hidden flex items-center justify-center';
const HOME_MOBILE_BODY_CLASS = 'flex flex-1 flex-col p-2.5';
const HOME_MOBILE_ACTION_BUTTON_CLASS =
  'mt-auto flex h-7 w-full items-center justify-center gap-1.5 rounded-sm bg-primary-container text-xs font-medium text-on-primary';

function HomeMobileCardContent({ media, title, action }: { media: ReactNode; title: ReactNode; action: ReactNode }) {
  return (
    <>
      <div className={HOME_MOBILE_MEDIA_CLASS}>{media}</div>
      <div className={HOME_MOBILE_BODY_CLASS}>
        {title}
        {action}
      </div>
    </>
  );
}

function SkeletonCardMobile() {
  return (
    <div className={`${HOME_MOBILE_CARD_CLASS} animate-pulse`} data-home-skeleton-card>
      <HomeMobileCardContent
        media={
          <>
            <div className="absolute left-1.5 top-1.5 h-3.5 w-8 rounded-sm bg-surface-container-high" />
            <div className="absolute right-1.5 top-1.5 h-3.5 w-10 rounded-sm bg-surface-container-high" />
          </>
        }
        title={
          <div className="mb-1.5 space-y-1.5">
            <div className="h-2.5 w-5/6 rounded bg-surface-container-lowest" />
            <div className="h-2.5 w-2/3 rounded bg-surface-container-lowest" />
          </div>
        }
        action={<div className="mt-auto h-7 w-full rounded-sm bg-surface-container-lowest" />}
      />
    </div>
  );
}

const HOME_SCROLL_POSITION_PREFIX = 'home_model_scroll_position:';
const HOME_SCROLL_TARGET_PREFIX = 'home_model_scroll_target:';
const HOME_SCROLL_OFFSET_PREFIX = 'home_model_scroll_offset:';
const HOME_BROWSE_STATE_PREFIX = 'home_model_browse_state:';
const HOME_SCROLL_RESTORE_PENDING_KEY = 'home_model_scroll_restore_pending_v1';
const HOME_LEGACY_DEFAULT_PAGE_SIZE = 60;
const HOME_DESKTOP_GRID_EAGER_IMAGES = 10;
const HOME_DESKTOP_LIST_EAGER_IMAGES = 6;
const HOME_MOBILE_EAGER_IMAGES = 4;
const HOME_REFRESH_SCROLL_TARGET: HomeRefreshScrollTarget = 'results';

type HomeLocationState = {
  homeBrowseState?: Partial<HomeBrowseState> | null;
} | null;

type HomeRefreshScrollTarget = 'top' | 'results';

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

function normalizeStoredHomePageSize(value: unknown, defaultPageSize = DEFAULT_PAGE_SIZE) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && Math.floor(parsed) === HOME_LEGACY_DEFAULT_PAGE_SIZE) {
    return defaultPageSize;
  }
  return normalizePageSize(parsed, undefined, defaultPageSize);
}

function normalizeHomeBrowseState(
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

function readHomeBrowseState(restoreKey: string | null, defaultPageSize = DEFAULT_PAGE_SIZE) {
  if (typeof window === 'undefined' || !restoreKey) return null;
  try {
    const raw = window.sessionStorage.getItem(`${HOME_BROWSE_STATE_PREFIX}${restoreKey}`);
    return normalizeHomeBrowseState(raw ? JSON.parse(raw) : null, defaultPageSize);
  } catch {
    return null;
  }
}

function readPendingHomeBrowseState(defaultPageSize = DEFAULT_PAGE_SIZE) {
  if (typeof window === 'undefined') return null;
  try {
    return readHomeBrowseState(window.sessionStorage.getItem(HOME_SCROLL_RESTORE_PENDING_KEY), defaultPageSize);
  } catch {
    return null;
  }
}

function saveHomeScrollPosition(
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

function readHomeScrollOffset(restoreKey: string) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(`${HOME_SCROLL_OFFSET_PREFIX}${restoreKey}`);
    const parsed = raw ? Number(raw) : null;
    return parsed != null && Number.isFinite(parsed) ? parsed : null;
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

function jumpHomeScrollTo(container: HTMLElement, top: number) {
  container.scrollTop = Math.max(0, top);
}

function restoreHomeScrollToModel(container: HTMLElement, modelId: string, savedOffset: number | null) {
  const target = getHomeModelElement(container, modelId);
  if (!target) return false;

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const offset = savedOffset ?? 0;
  const top = container.scrollTop + targetRect.top - containerRect.top - offset;
  jumpHomeScrollTo(container, top);
  return true;
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

function ProductCardInner({
  product,
  onDownload,
  imageLoading = 'lazy',
  imageFetchPriority = 'auto',
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
  showCategory = false,
  showVariantMeta = false,
  variant = 'grid',
}: {
  product: Product;
  onDownload: (id: string) => void;
  imageLoading?: 'eager' | 'lazy';
  imageFetchPriority?: 'high' | 'low' | 'auto';
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
  showCategory?: boolean;
  showVariantMeta?: boolean;
  variant?: 'grid' | 'list';
}) {
  const detailPath = `/model/${product.id}`;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(product.name);
  const [renameSaving, setRenameSaving] = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const ignoreNextOverlayClickRef = useRef(false);
  const { isAuthenticated } = useAuthStore();
  const isFavorited = useFavoriteStore((state) => state.favoriteIds.has(product.id));
  const toggleFavoriteInStore = useFavoriteStore((state) => state.toggleFavorite);

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
        await toggleFavoriteInStore({ id: product.id });
      } catch {
        // 收藏失败时保持当前状态，避免一次网络波动打断浏览。
      } finally {
        setFavLoading(false);
      }
    },
    [favLoading, isAuthenticated, product.id, toggleFavoriteInStore],
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
      variants={popoverMotion}
      initial="initial"
      animate="animate"
      exit="exit"
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

  const listFavoriteAction = isAuthenticated ? (
    <button
      onClick={toggleFavorite}
      disabled={favLoading}
      className={`${HOME_LIST_ACTION_BUTTON_CLASS} home-model-list-favorite-button border transition-colors ${
        isFavorited
          ? 'border-primary-container/45 bg-primary-container/10 text-primary-container'
          : 'border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
      } ${favLoading ? 'opacity-60' : ''}`}
      aria-label={isFavorited ? '取消收藏' : '收藏'}
      aria-pressed={isFavorited}
      data-tooltip-ignore
    >
      <Icon name={isFavorited ? 'favorite' : 'star'} size={14} />
      收藏
    </button>
  ) : null;

  if (variant === 'list') {
    const content = (
      <>
        <HomeListCardContent
          media={
            <>
              <ModelThumbnail
                src={product.thumbnailUrl}
                alt={product.name}
                loading={imageLoading}
                fetchPriority={imageFetchPriority}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-1.5 left-1.5 flex gap-1">
                {product.formats.map((f, index) => (
                  <FormatTag key={`${f || 'format'}-${index}`} format={f} />
                ))}
              </div>
            </>
          }
          title={
            <h3 className="home-model-title mb-1 text-sm font-headline text-on-surface leading-tight line-clamp-1">
              {product.name}
            </h3>
          }
          meta={
            <>
              {showCategory ? <span>{product.category}</span> : null}
              <span>{product.fileSize}</span>
              {showVariantMeta && product.variantCount && product.variantCount > 1 && (
                <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded-sm text-[10px] font-medium">
                  ×{product.variantCount} 变体
                </span>
              )}
            </>
          }
          actions={
            <>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDownload(product.id);
                }}
                className={`${HOME_LIST_ACTION_BUTTON_CLASS} home-model-download-button bg-primary-container font-medium text-on-primary hover:opacity-90`}
              >
                <Icon name="download" size={14} fill />
                下载
              </button>
              {listFavoriteAction}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenManageDetail?.(product);
                }}
                className={`${HOME_LIST_ACTION_BUTTON_CLASS} home-model-preview-button border border-outline-variant/40 text-on-surface-variant hover:text-on-surface`}
              >
                <Icon name="visibility" size={14} />
                预览
              </button>
            </>
          }
        />
        {manageOverlay && <AnimatePresence>{manageOverlay}</AnimatePresence>}
      </>
    );
    const className = HOME_LIST_CARD_CLASS;
    if (manageOpen) {
      return (
        <div
          onContextMenu={(event) => onContextMenu?.(event, product)}
          data-home-model-id={product.id}
          data-home-model-layout="list"
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
        data-home-model-layout="list"
        draggable={false}
        className={className}
      >
        {content}
      </Link>
    );
  }
  const content = (
    <>
      <HomeGridCardContent
        media={
          <>
            <ModelThumbnail
              src={product.thumbnailUrl}
              alt={product.name}
              loading={imageLoading}
              fetchPriority={imageFetchPriority}
              className="w-full h-full object-cover"
            />
            <div className="absolute top-2 left-2 flex gap-1">
              {product.formats.map((f, index) => (
                <FormatTag key={`${f || 'format'}-${index}`} format={f} />
              ))}
            </div>
            <span className="absolute top-2 right-2 bg-surface-container-highest/90 px-1.5 py-0.5 text-[9px] text-on-surface-variant font-mono rounded-sm border border-outline-variant/30">
              {product.fileSize}
            </span>
            {(isAuthenticated || (showVariantMeta && product.variantCount && product.variantCount > 1)) && (
              <div className="home-card-hover-actions absolute right-2 bottom-2 z-20 flex translate-y-1 scale-95 items-center gap-1.5 opacity-0 transition-all duration-150 ease-out group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100">
                {isAuthenticated && (
                  <button
                    onClick={toggleFavorite}
                    disabled={favLoading}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container-lowest/90 transition-colors ${
                      isFavorited
                        ? 'border-primary-container/35 text-primary-container'
                        : 'text-on-surface-variant/70 hover:text-on-surface-variant'
                    } ${favLoading ? 'opacity-60' : ''}`}
                    aria-label={isFavorited ? '取消收藏' : '收藏'}
                    aria-pressed={isFavorited}
                    data-tooltip-ignore
                  >
                    <Icon name={isFavorited ? 'favorite' : 'star'} size={14} />
                  </button>
                )}
                {showVariantMeta && product.variantCount && product.variantCount > 1 && (
                  <span className="rounded-sm bg-primary/90 px-1.5 py-0.5 text-[9px] font-bold text-on-primary">
                    ×{product.variantCount}
                  </span>
                )}
              </div>
            )}
          </>
        }
        title={
          <h3 className="home-model-title text-xs font-headline text-on-surface leading-tight line-clamp-2">
            {product.name}
          </h3>
        }
        meta={
          showCategory || (showVariantMeta && product.variantCount && product.variantCount > 1) ? (
            <>
              {showCategory ? <span>{product.category}</span> : null}
              {showVariantMeta && product.variantCount && product.variantCount > 1 ? (
                <span>{product.variantCount} 个变体</span>
              ) : null}
            </>
          ) : null
        }
        actions={
          <>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDownload(product.id);
              }}
              className={`${HOME_GRID_ACTION_BUTTON_CLASS} home-model-download-button bg-primary-container font-medium text-on-primary hover:opacity-90`}
            >
              <Icon name="download" size={14} fill />
              下载
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenManageDetail?.(product);
              }}
              className={`${HOME_GRID_ACTION_BUTTON_CLASS} home-model-preview-button border border-outline-variant/40 text-center text-on-surface-variant hover:text-on-surface`}
            >
              <Icon name="visibility" size={14} />
              预览
            </button>
          </>
        }
      />
      {manageOverlay && <AnimatePresence>{manageOverlay}</AnimatePresence>}
    </>
  );
  const className = HOME_GRID_CARD_CLASS;
  if (manageOpen) {
    return (
      <div
        onContextMenu={(event) => onContextMenu?.(event, product)}
        data-home-model-id={product.id}
        data-home-model-layout="grid"
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
      onPointerDown={preloadModelDetailPage}
      onFocus={preloadModelDetailPage}
      onContextMenu={(event) => onContextMenu?.(event, product)}
      data-home-model-id={product.id}
      data-home-model-layout="grid"
      draggable={false}
      className={className}
    >
      {content}
    </Link>
  );
}

const ProductCard = memo(ProductCardInner, (prev, next) => {
  if (prev.product.id !== next.product.id) return false;
  if (prev.product.name !== next.product.name) return false;
  if (prev.product.thumbnailUrl !== next.product.thumbnailUrl) return false;
  if (prev.imageLoading !== next.imageLoading) return false;
  if (prev.imageFetchPriority !== next.imageFetchPriority) return false;
  if (prev.product.fileSize !== next.product.fileSize) return false;
  if (prev.product.variantCount !== next.product.variantCount) return false;
  if (prev.product.formats !== next.product.formats) return false;
  if (prev.manageOpen !== next.manageOpen) return false;
  if (prev.showCategory !== next.showCategory) return false;
  if (prev.showVariantMeta !== next.showVariantMeta) return false;
  if (prev.variant !== next.variant) return false;
  if (prev.onDownload !== next.onDownload) return false;
  if (prev.onBeforeOpen !== next.onBeforeOpen) return false;
  if (prev.onContextMenu !== next.onContextMenu) return false;
  return true;
});

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
            variants={overlayMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-black/50 z-[260]"
            onClick={onClose}
          />
          <motion.aside
            variants={sideSheetMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed left-0 top-0 w-[min(82vw,280px)] h-dvh bg-surface-container-low z-[270] flex flex-col overflow-y-auto scrollbar-hidden shadow-2xl"
            style={{
              paddingTop: 'env(safe-area-inset-top, 0px)',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              willChange: 'transform',
            }}
          >
            <div className="flex items-center justify-between p-4 border-b border-outline-variant/20">
              <h2 className="text-sm font-bold text-on-surface-variant tracking-wider uppercase font-headline">
                产品目录
              </h2>
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
  imageLoading = 'lazy',
  imageFetchPriority = 'auto',
}: {
  product: Product;
  onDownload: (id: string) => void;
  returnPath: string;
  homeBrowseState: HomeBrowseState;
  onBeforeOpen?: (modelId: string) => void;
  imageLoading?: 'eager' | 'lazy';
  imageFetchPriority?: 'high' | 'low' | 'auto';
}) {
  const detailPath = `/model/${product.id}`;
  return (
    <div data-home-model-id={product.id} data-home-model-layout="mobile" className={HOME_MOBILE_CARD_CLASS}>
      <HomeMobileCardContent
        media={
          <Link
            to={detailPath}
            state={{ from: returnPath, homeBrowseState }}
            onPointerDown={preloadModelDetailPage}
            onFocus={preloadModelDetailPage}
            onClick={() => onBeforeOpen?.(product.id)}
            className="block h-full w-full"
          >
            <ModelThumbnail
              src={product.thumbnailUrl}
              alt={product.name}
              className="w-full h-full object-cover"
              loading={imageLoading}
              fetchPriority={imageFetchPriority}
            />
            <div className="absolute top-1.5 left-1.5 flex flex-col gap-0.5 opacity-70">
              {product.formats.map((f, index) => (
                <FormatTag key={`${f || 'format'}-${index}`} format={f} size="xs" />
              ))}
            </div>
            <span className="absolute top-1.5 right-1.5 text-[7px] text-on-surface-variant/50 bg-black/35 px-1 py-px rounded-sm">
              {product.fileSize}
            </span>
          </Link>
        }
        title={
          <h3 className="text-xs font-headline text-on-surface mb-1.5 leading-tight line-clamp-2">{product.name}</h3>
        }
        action={
          <button onClick={() => onDownload(product.id)} className={HOME_MOBILE_ACTION_BUTTON_CLASS}>
            <Icon name="download" size={14} fill />
            下载
          </button>
        }
      />
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
  const ThemePackage = getInterfaceThemePackage(publicSettings?.interface_theme);
  const MobileThemePackage = getMobileThemePackage(publicSettings?.mobile_interface_theme);
  const DesktopHome = ThemePackage.templates.DesktopHome;
  const mobileHomeTheme = MobileThemePackage.home.dataHomeTheme;
  const desktopHomeBehavior = ThemePackage.home;
  const mobileHomeBehavior = MobileThemePackage.home;
  const usesManualHomePagination =
    (isDesktop ? desktopHomeBehavior.listLoadingMode : mobileHomeBehavior.listLoadingMode) === 'pagination';
  const showModelCardCategory = desktopHomeBehavior.showModelCardCategory;
  const showModelCardVariantMeta = desktopHomeBehavior.showModelCardVariantMeta;
  const footerLinks = getFooterLinks();
  const footerCopyright = getFooterCopyright();
  const contactEmail = getContactEmail();
  const contactPhone = getContactPhone();
  const contactAddress = getContactAddress();
  const homePageSizePolicy = getBusinessConfig(publicSettings || undefined).pageSizePolicy;
  const homePageSizeOptions = normalizeHomePageSizeOptions(homePageSizePolicy);
  const homeDefaultPageSize = homePageSizeOptions.includes(homePageSizePolicy.homeDefault)
    ? homePageSizePolicy.homeDefault
    : homePageSizeOptions[0] || DEFAULT_PAGE_SIZE;
  const legacySearchQuery = normalizeHomeSearchQuery(searchParams.get('q') || '');
  const initialHomeState = useMemo(
    () =>
      normalizeHomeBrowseState(readHomeBrowseStateFromLocation(location.state), homeDefaultPageSize) ||
      readPendingHomeBrowseState(homeDefaultPageSize),
    // Only seed the initial local browse state once when the page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const { isAuthenticated, user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  const [browseBlocked, setBrowseBlocked] = useState(false);
  const [restoreVisualLocked, setRestoreVisualLocked] = useState(() =>
    Boolean(initialHomeState?.restoreKey && getPendingHomeRestoreKey() === initialHomeState.restoreKey),
  );
  const [contextMenu, setContextMenu] = useState<{ product: Product } | null>(null);
  const contextMenuOpenRef = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deletingModel, setDeletingModel] = useState(false);
  const [listRefreshPending, setListRefreshPending] = useState(false);

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
  const [pageSize, setPageSize] = useState(() =>
    searchParams.has('page_size')
      ? normalizePageSize(searchParams.get('page_size'), homePageSizeOptions, homeDefaultPageSize)
      : initialHomeState?.pageSize || homeDefaultPageSize,
  );
  const [viewMode, setViewMode] = useState<HomeViewMode>('grid');
  const [sortBy, setSortBy] = useState(() => initialHomeState?.sort || normalizeSortParam(searchParams.get('sort')));
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const scrollTopResetFrameRef = useRef<number | null>(null);
  const pendingHomeListRefreshResetRef = useRef(false);
  const pendingHomeListRefreshTargetRef = useRef<HomeRefreshScrollTarget>('top');
  const consumedHomeStateKeyRef = useRef<string | null>(null);
  const isRestoringScrollRef = useRef(false);

  // Pull-to-refresh (mobile only)
  const pullStateRef = useRef<'idle' | 'pulling' | 'ready' | 'refreshing'>('idle');
  const pullStartY = useRef(0);
  const pullVisualRef = useRef<{ state: 'idle' | 'pulling' | 'ready' | 'refreshing'; offset: number }>({
    state: 'idle',
    offset: 0,
  });
  const pendingPullVisualRef = useRef<{ state: 'idle' | 'pulling' | 'ready' | 'refreshing'; offset: number } | null>(
    null,
  );
  const pullMoveFrameRef = useRef<number | null>(null);
  const [pullOffset, setPullOffset] = useState(0);
  const [pullState, setPullState] = useState<'idle' | 'pulling' | 'ready' | 'refreshing'>('idle');
  const pullThreshold = typeof window !== 'undefined' ? Math.round(window.innerHeight / 3) : 200;
  const pullMaxVisual = 80;

  // Detect when title row scrolls out of view (for sticky filter button swap)
  const titleRowRef = useRef<HTMLDivElement | null>(null);
  const resultsAnchorRef = useRef<HTMLDivElement | null>(null);
  const [chipsStuck, setChipsStuck] = useState(false);

  const resetHomeListViewportForRefresh = useCallback((target: HomeRefreshScrollTarget = 'top', immediate = false) => {
    pendingHomeListRefreshTargetRef.current = target;

    if (restoreFrameRef.current != null) {
      window.cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
    }
    if (scrollTopResetFrameRef.current != null) {
      window.cancelAnimationFrame(scrollTopResetFrameRef.current);
      scrollTopResetFrameRef.current = null;
    }

    const pendingRestoreKey = getPendingHomeRestoreKey();
    if (pendingRestoreKey) clearPendingHomeRestore(pendingRestoreKey);
    isRestoringScrollRef.current = false;
    setRestoreVisualLocked(false);
    setChipsStuck(false);

    if (immediate) {
      pendingHomeListRefreshResetRef.current = false;
      const container = scrollContainerRef.current;
      if (container) {
        const targetTop =
          target === 'results' && resultsAnchorRef.current ? Math.max(0, resultsAnchorRef.current.offsetTop - 12) : 0;
        if (Math.abs(container.scrollTop - targetTop) > 1) {
          jumpHomeScrollTo(container, targetTop);
        }
      }
      return;
    }

    pendingHomeListRefreshResetRef.current = true;
  }, []);

  useLayoutEffect(() => {
    if (!listRefreshPending || !pendingHomeListRefreshResetRef.current) return;
    pendingHomeListRefreshResetRef.current = false;

    const reset = () => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const targetTop =
        pendingHomeListRefreshTargetRef.current === 'results' && resultsAnchorRef.current
          ? Math.max(0, resultsAnchorRef.current.offsetTop - 12)
          : 0;
      jumpHomeScrollTo(container, targetTop);
    };

    reset();
    scrollTopResetFrameRef.current = window.requestAnimationFrame(() => {
      reset();
      scrollTopResetFrameRef.current = window.requestAnimationFrame(() => {
        reset();
        scrollTopResetFrameRef.current = null;
      });
    });
  }, [listRefreshPending]);

  useEffect(
    () => () => {
      if (scrollTopResetFrameRef.current != null) {
        window.cancelAnimationFrame(scrollTopResetFrameRef.current);
        scrollTopResetFrameRef.current = null;
      }
    },
    [],
  );

  // Keep browsing controls in React/navigation state. Legacy query links still work, then get cleaned from the URL.
  useEffect(() => {
    const stateBrowse = normalizeHomeBrowseState(readHomeBrowseStateFromLocation(location.state), homeDefaultPageSize);
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
    isValidating,
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
    usesManualHomePagination ? 1 : page,
    { manual: usesManualHomePagination },
  );

  useEffect(() => {
    void setModelPageSize(usesManualHomePagination ? 1 : page);
  }, [page, setModelPageSize, usesManualHomePagination]);

  useEffect(() => {
    const handleSearchEvent = (event: Event) => {
      const detail = (event as CustomEvent<HomeSearchEventDetail>).detail;
      if (!detail || typeof detail.query !== 'string') return;
      const query = normalizeHomeSearchQuery(detail.query);
      setSearchQuery(query);
      saveHomeSearchQuery(query);
      if (!detail.preservePage) {
        const shouldRefreshList = query !== searchQuery || (query && activeCategory !== 'all') || page !== 1;
        if (shouldRefreshList) {
          setListRefreshPending(true);
          if (!detail.preserveViewport) {
            resetHomeListViewportForRefresh(HOME_REFRESH_SCROLL_TARGET, usesManualHomePagination);
          }
        }
        if (query && activeCategory !== 'all') setActiveCategory('all');
        setPage(1);
        void setModelPageSize(1);
      }
      if (searchParams.has('q')) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('q');
        setSearchParams(nextParams, { replace: true });
      }
    };
    window.addEventListener(HOME_SEARCH_EVENT, handleSearchEvent);
    return () => window.removeEventListener(HOME_SEARCH_EVENT, handleSearchEvent);
  }, [
    activeCategory,
    page,
    resetHomeListViewportForRefresh,
    searchParams,
    searchQuery,
    setModelPageSize,
    setSearchParams,
    usesManualHomePagination,
  ]);

  const products = useMemo(() => {
    if (!serverData?.items) return [];
    return serverData.items.map(serverItemToProduct);
  }, [serverData]);
  const productIdsKey = useMemo(() => products.map((product) => product.id).join('|'), [products]);
  const showHomeListSkeleton = isLoading || (!usesManualHomePagination && listRefreshPending);

  useEffect(() => {
    if (!listRefreshPending) return;
    if (!isLoading && !isValidating) setListRefreshPending(false);
  }, [isLoading, isValidating, listRefreshPending]);

  const totalItems = serverData?.total || 0;
  const activeCategoryCount = useMemo(() => {
    if (activeCategory === 'all') return totalModelCount || totalItems;
    const parent = categories.find((category) => category.id === activeCategory);
    if (parent) return parent.count;
    for (const category of categories) {
      const child = category.children?.find((item) => item.id === activeCategory);
      if (child) return child.count;
    }
    return null;
  }, [activeCategory, categories, totalItems, totalModelCount]);
  const displayTotalItems =
    (showHomeListSkeleton || listRefreshPending) && activeCategoryCount != null
      ? activeCategoryCount
      : activeCategory === 'all' && !searchQuery.trim()
        ? totalModelCount || totalItems
        : totalItems;
  const totalPages = Math.max(1, serverData?.totalPages || 1);

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
    const nextCategoryChanged = id !== activeCategory || Boolean(searchQuery.trim()) || page !== 1;
    if (nextCategoryChanged) {
      setListRefreshPending(true);
      if (!usesManualHomePagination) {
        resetHomeListViewportForRefresh(HOME_REFRESH_SCROLL_TARGET);
      }
    }
    setActiveCategory(id);
    setSearchQuery('');
    saveHomeSearchQuery('');
    dispatchHomeSearchQuery('', { preservePage: true });
    setPage(1);
    void setModelPageSize(1);
    // Clear search when selecting a category; category itself stays in local navigation state.
    if (searchParams.toString()) setSearchParams(new URLSearchParams(), { replace: true });
  };

  const handleLoadMore = useCallback(() => {
    if (usesManualHomePagination || !hasMore || isLoadingMore) return;
    setPage((current) => current + 1);
  }, [hasMore, isLoadingMore, usesManualHomePagination]);

  const handlePageChange = useCallback(
    (nextPage: number) => {
      if (nextPage === page) return;
      setListRefreshPending(true);
      resetHomeListViewportForRefresh(HOME_REFRESH_SCROLL_TARGET, usesManualHomePagination);
      setPage(nextPage);
    },
    [page, resetHomeListViewportForRefresh, usesManualHomePagination],
  );

  const handlePageSizeChange = useCallback(
    (nextPageSize: number) => {
      if (nextPageSize === pageSize) return;
      setListRefreshPending(true);
      resetHomeListViewportForRefresh(HOME_REFRESH_SCROLL_TARGET, usesManualHomePagination);
      setPageSize(nextPageSize);
      setPage(1);
      void setModelPageSize(1);
    },
    [pageSize, resetHomeListViewportForRefresh, setModelPageSize, usesManualHomePagination],
  );

  const handleSortChange = useCallback(
    (nextSort: string) => {
      const normalizedSort = normalizeSortParam(nextSort);
      const shouldRefreshList = normalizedSort !== sortBy || page !== 1;
      if (shouldRefreshList) {
        setListRefreshPending(true);
        resetHomeListViewportForRefresh(HOME_REFRESH_SCROLL_TARGET, usesManualHomePagination);
      }
      setSortBy(normalizedSort);
      setPage(1);
      void setModelPageSize(1);
    },
    [page, resetHomeListViewportForRefresh, setModelPageSize, sortBy, usesManualHomePagination],
  );

  const scrollDesktopResultsIntoView = useCallback(() => {
    window.requestAnimationFrame(() => {
      resultsAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const handleDesktopHeroSearch = useCallback((query: string) => {
    dispatchHomeSearchQuery(query, { preserveViewport: true });
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
      // Compute the model element's offset from the visible top of the scroll container
      let viewportOffset: number | undefined;
      const container = scrollContainerRef.current;
      if (modelId && container) {
        const target = getHomeModelElement(container, modelId);
        if (target) {
          const containerRect = container.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          viewportOffset = targetRect.top - containerRect.top;
        }
      }
      saveHomeScrollPosition(homeRestoreKey, container?.scrollTop || 0, pendingRestore, modelId, viewportOffset);
    },
    [homeBrowseState, homeRestoreKey],
  );

  useEffect(() => {
    saveHomeBrowseState(homeRestoreKey, homeBrowseState);
    writeHomeBrowseStateToCurrentHistory(homeBrowseState);
  }, [homeBrowseState, homeRestoreKey]);

  useEffect(() => {
    if (!restoreVisualLocked) return;
    const pendingRestoreKey = getPendingHomeRestoreKey();
    if (!pendingRestoreKey || (!isLoading && pendingRestoreKey !== homeRestoreKey)) {
      setRestoreVisualLocked(false);
    }
  }, [homeRestoreKey, isLoading, restoreVisualLocked]);

  useEffect(() => {
    if (!contextMenu) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (isRestoringScrollRef.current) return;
      contextMenuOpenRef.current = false;
      setContextMenu(null);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [contextMenu, isDesktop]);

  // ─── Pull-to-refresh touch handling (mobile) ───
  const commitPullVisual = useCallback((state: 'idle' | 'pulling' | 'ready' | 'refreshing', offset: number) => {
    const next = { state, offset: Math.max(0, Math.round(offset)) };
    pullStateRef.current = state;
    pendingPullVisualRef.current = next;
    if (pullMoveFrameRef.current != null) return;
    pullMoveFrameRef.current = window.requestAnimationFrame(() => {
      pullMoveFrameRef.current = null;
      const pending = pendingPullVisualRef.current;
      pendingPullVisualRef.current = null;
      if (!pending) return;
      const current = pullVisualRef.current;
      if (current.state !== pending.state) setPullState(pending.state);
      if (current.offset !== pending.offset) setPullOffset(pending.offset);
      pullVisualRef.current = pending;
    });
  }, []);

  const finishPullGesture = useCallback(async () => {
    if (isDesktop || pullStateRef.current === 'refreshing') return;

    if (pullStateRef.current === 'ready') {
      commitPullVisual('refreshing', pullMaxVisual);
      const started = Date.now();
      try {
        setPage(1);
        await Promise.all([mutateModels(), mutateCategories()]);
      } catch {
        // SWR handles error reporting
      }
      // Keep the spinner visible at least 800ms so the user sees the animation.
      const elapsed = Date.now() - started;
      if (elapsed < 800) {
        await new Promise((r) => setTimeout(r, 800 - elapsed));
      }
    }

    commitPullVisual('idle', 0);
  }, [commitPullVisual, isDesktop, mutateCategories, mutateModels, pullMaxVisual]);

  useEffect(() => {
    if (isDesktop) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    let trackingPull = false;

    const handleTouchStart = (event: TouchEvent) => {
      if (pullStateRef.current === 'refreshing' || container.scrollTop > 0) {
        trackingPull = false;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      trackingPull = true;
      pullStartY.current = touch.clientY;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!trackingPull || pullStateRef.current === 'refreshing') return;
      const touch = event.touches[0];
      if (!touch) return;
      if (container.scrollTop > 0 && pullStateRef.current === 'idle') {
        trackingPull = false;
        return;
      }

      const delta = touch.clientY - pullStartY.current;
      if (delta <= 0) {
        if (pullStateRef.current !== 'idle') commitPullVisual('idle', 0);
        return;
      }

      const resisted = pullMaxVisual * (1 - Math.exp(-delta / pullThreshold));
      commitPullVisual(delta >= pullThreshold ? 'ready' : 'pulling', resisted);
    };

    const handleTouchEnd = () => {
      if (!trackingPull && pullStateRef.current === 'idle') return;
      trackingPull = false;
      void finishPullGesture();
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      if (pullMoveFrameRef.current != null) {
        window.cancelAnimationFrame(pullMoveFrameRef.current);
        pullMoveFrameRef.current = null;
      }
      pendingPullVisualRef.current = null;
    };
  }, [commitPullVisual, finishPullGesture, isDesktop, pullMaxVisual, pullThreshold]);

  const handlePullTransitionEnd = useCallback(() => {
    // Reset after collapse animation
    if (pullStateRef.current === 'idle') {
      setPullOffset(0);
    }
  }, []);

  const handleModelContextMenu = useCallback(
    (event: MouseEvent, product: Product) => {
      if (!isDesktop || !isAdmin) return;
      event.preventDefault();
      event.stopPropagation();
      contextMenuOpenRef.current = true;
      setContextMenu({ product });
    },
    [isAdmin, isDesktop],
  );

  useEffect(() => {
    contextMenuOpenRef.current = Boolean(contextMenu);
    if (!contextMenu) return;
    const close = () => {
      contextMenuOpenRef.current = false;
      setContextMenu(null);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
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
        const shareUrl = `${window.location.origin}/share/${result.token}`;
        toast('模型分享已创建', 'success');
        try {
          await copyText(shareUrl);
          toast('分享链接已复制到剪贴板', 'success');
        } catch (copyError: unknown) {
          if (import.meta.env.DEV) console.warn('[Share] Copy failed:', copyError);
          toast('模型分享已创建，请到我的分享复制链接', 'info');
        }
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

  const closeManagedModelOverlay = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleBeforeOpenModel = useCallback(
    (modelId: string) => {
      saveCurrentHomeScroll(true, modelId);
    },
    [saveCurrentHomeScroll],
  );

  const renderDesktopProductCard = useCallback(
    (product: Product, index = 0) => {
      const eagerImageCount = viewMode === 'grid' ? HOME_DESKTOP_GRID_EAGER_IMAGES : HOME_DESKTOP_LIST_EAGER_IMAGES;
      const shouldPrioritizeImage = index < eagerImageCount;

      return (
        <ProductCard
          key={product.id}
          product={product}
          imageLoading={shouldPrioritizeImage ? 'eager' : 'lazy'}
          imageFetchPriority={shouldPrioritizeImage ? 'high' : 'auto'}
          onDownload={handleDownload}
          onContextMenu={handleModelContextMenu}
          manageOpen={contextMenu?.product.id === product.id}
          onCloseManage={closeManagedModelOverlay}
          onOpenManageDetail={openManagedModelDetail}
          onShareModel={shareManagedModel}
          onRenameModel={renameManagedModel}
          onRequestDelete={requestManagedModelDelete}
          showCategory={showModelCardCategory}
          showVariantMeta={showModelCardVariantMeta}
          returnPath={modelReturnPath}
          homeBrowseState={homeBrowseState}
          onBeforeOpen={handleBeforeOpenModel}
          variant={viewMode}
        />
      );
    },
    [
      closeManagedModelOverlay,
      contextMenu?.product.id,
      handleBeforeOpenModel,
      handleDownload,
      handleModelContextMenu,
      homeBrowseState,
      modelReturnPath,
      openManagedModelDetail,
      renameManagedModel,
      requestManagedModelDelete,
      shareManagedModel,
      showModelCardCategory,
      showModelCardVariantMeta,
      viewMode,
    ],
  );

  // Sync layout: restore scrollTop + set chipsStuck before first paint to avoid flash.
  // Must run after data vars (isLoading, homeRestoreKey, products) are declared.
  useLayoutEffect(() => {
    if (!isLoading && getPendingHomeRestoreKey() === homeRestoreKey) {
      setRestoreVisualLocked((locked) => (locked ? locked : true));
      const container = scrollContainerRef.current;
      const targetModelId = readHomeScrollTarget(homeRestoreKey);
      if (container && targetModelId) {
        isRestoringScrollRef.current = true;
        const savedOffset = readHomeScrollOffset(homeRestoreKey);
        if (!restoreHomeScrollToModel(container, targetModelId, savedOffset)) {
          isRestoringScrollRef.current = false;
        }
      } else if (container) {
        // Some paths may restore a plain scrollTop without a model target.
        const targetTop = readHomeScrollPosition(homeRestoreKey);
        if (targetTop != null) {
          isRestoringScrollRef.current = true;
          jumpHomeScrollTo(container, targetTop);
          clearPendingHomeRestore(homeRestoreKey);
          requestAnimationFrame(() => {
            isRestoringScrollRef.current = false;
            setRestoreVisualLocked(false);
          });
        } else if (!targetModelId) {
          clearPendingHomeRestore(homeRestoreKey);
          setRestoreVisualLocked(false);
        }
      }
    }
    if (isDesktop) return;
    // Set chipsStuck based on actual (possibly restored) position
    const el = titleRowRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= 0) setChipsStuck(true);
    const observer = new IntersectionObserver(([entry]) => setChipsStuck(!entry.isIntersecting), {
      threshold: 0,
      rootMargin: '0px 0px -1px 0px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isDesktop, isLoading, homeRestoreKey, productIdsKey, products.length]);

  // Scroll restoration (async): model-targeted restore needs to wait for DOM elements,
  // then continuously correct for layout shifts until stable.
  useEffect(() => {
    if (isLoading || getPendingHomeRestoreKey() !== homeRestoreKey) return;
    const targetModelId = readHomeScrollTarget(homeRestoreKey);
    if (!targetModelId) return; // simple scrollTop restore handled in useLayoutEffect above
    const savedOffset = readHomeScrollOffset(homeRestoreKey);

    if (restoreFrameRef.current != null) window.cancelAnimationFrame(restoreFrameRef.current);
    let cancelled = false;
    let lastScrollTop = -1;
    let stableCount = 0;
    const DEADLINE_MS = 3000;
    const startTime = Date.now();

    isRestoringScrollRef.current = true;

    const unlockVisualAfterNextFrame = () => {
      window.requestAnimationFrame(() => {
        if (!cancelled) setRestoreVisualLocked(false);
      });
    };

    const doRestore = () => {
      if (cancelled) return;
      const container = scrollContainerRef.current;
      if (!container) return;

      if (restoreHomeScrollToModel(container, targetModelId, savedOffset)) {
        if (Math.abs(container.scrollTop - lastScrollTop) < 1) {
          stableCount++;
        } else {
          stableCount = 0;
        }
        lastScrollTop = container.scrollTop;
        if (stableCount >= 3 || Date.now() - startTime > DEADLINE_MS) {
          clearPendingHomeRestore(homeRestoreKey);
          isRestoringScrollRef.current = false;
          unlockVisualAfterNextFrame();
          return;
        }
      }

      if (Date.now() - startTime > DEADLINE_MS) {
        clearPendingHomeRestore(homeRestoreKey);
        isRestoringScrollRef.current = false;
        unlockVisualAfterNextFrame();
        return;
      }

      restoreFrameRef.current = window.requestAnimationFrame(doRestore);
    };

    restoreFrameRef.current = window.requestAnimationFrame(doRestore);

    return () => {
      cancelled = true;
      isRestoringScrollRef.current = false;
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
        <DesktopHome
          activeCategory={activeCategory}
          breadcrumb={breadcrumb}
          categories={categories}
          contactAddress={contactAddress}
          contactEmail={contactEmail}
          contactPhone={contactPhone}
          displayTotalItems={displayTotalItems}
          expandedCategories={expandedCategories}
          footerCopyright={footerCopyright}
          footerLinks={footerLinks}
          hasMore={hasMore}
          homePageSizeOptions={homePageSizeOptions}
          homeSearchMaxLength={HOME_SEARCH_MAX_LENGTH}
          isLoadingMore={isLoadingMore}
          normalizeSearchQuery={normalizeHomeSearchQuery}
          page={page}
          pageSize={pageSize}
          products={products}
          renderProductCard={renderDesktopProductCard}
          resultsAnchorRef={resultsAnchorRef}
          scrollContainerRef={scrollContainerRef}
          searchQuery={searchQuery}
          showHomeListSkeleton={showHomeListSkeleton}
          sortBy={sortBy}
          totalItems={totalItems}
          totalModelCount={totalModelCount}
          totalPages={totalPages}
          viewMode={viewMode}
          onHeroExplore={scrollDesktopResultsIntoView}
          onHeroSearch={handleDesktopHeroSearch}
          onLoadMore={handleLoadMore}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          onSelectCategory={handleSelectCategory}
          onSortChange={handleSortChange}
          onToggleCategory={toggleCategory}
          onViewModeChange={setViewMode}
        />
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
  const mobileFilterDrawer = (
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
  );

  return (
    <PublicPageShell onMobileMenuToggle={() => setDrawerOpen((prev) => !prev)}>
      {createPortal(mobileFilterDrawer, document.body)}
      <main
        ref={scrollContainerRef}
        data-home-theme={mobileHomeTheme}
        className="home-scroll-container flex-1 overflow-y-auto overflow-x-hidden scrollbar-hidden bg-surface-dim"
      >
        {/* Pull-to-refresh indicator (mobile only) */}
        {!isDesktop && pullOffset > 0 && (
          <div
            className="flex items-center justify-center gap-2 text-xs text-on-surface-variant select-none overflow-hidden"
            style={{
              height: pullOffset,
              transition: pullState === 'idle' ? 'height 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)' : 'none',
            }}
            onTransitionEnd={handlePullTransitionEnd}
          >
            {pullState === 'refreshing' ? (
              <Icon name="autorenew" size={18} className="text-primary-container animate-spin" />
            ) : (
              <Icon
                name="arrow_downward"
                size={18}
                className="text-primary-container transition-transform duration-200"
                style={{ transform: pullState === 'ready' ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            )}
            <span>{pullState === 'refreshing' ? '正在刷新...' : pullState === 'ready' ? '松开刷新' : '下拉刷新'}</span>
          </div>
        )}
        <div className="p-3 space-y-3 pb-20 min-h-full flex flex-col">
          <AnnouncementBanner />
          {/* Header with filter button (visible when not scrolled) */}
          <div ref={titleRowRef} className="flex items-center justify-between">
            <div>
              <PageTitle className="text-base md:text-base md:normal-case">
                {activeCategory === 'all' ? '零件目录' : breadcrumb.label}
              </PageTitle>
              <span className="text-[10px] text-on-surface-variant">{displayTotalItems} 个模型</span>
            </div>
            <button
              onClick={() => setDrawerOpen(true)}
              className={`p-2 text-on-surface-variant hover:text-on-surface bg-surface-container-high rounded-sm flex items-center gap-1.5 transition-opacity duration-200 ${chipsStuck ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
            >
              <Icon name="tune" size={18} />
              <span className="text-xs">筛选</span>
            </button>
          </div>

          {/* Sticky category chips + filter button on right */}
          <div className="sticky top-0 z-10 -mx-3 px-3 py-2 bg-surface-dim">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex gap-2 overflow-x-auto scrollbar-hidden">
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
              <button
                onClick={() => setDrawerOpen(true)}
                className={`shrink-0 text-on-surface-variant hover:text-on-surface bg-surface-container-highest rounded-sm flex items-center justify-center shadow-sm transition-opacity duration-300 ${chipsStuck && products.length >= 6 ? 'opacity-100 py-1 px-2' : 'opacity-0 pointer-events-none w-0 overflow-hidden'}`}
              >
                <Icon name="tune" size={16} />
              </button>
            </div>
          </div>

          {/* Model grid */}
          {showHomeListSkeleton ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCardMobile key={i} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {products.map((product, index) => {
                const shouldPrioritizeImage = index < HOME_MOBILE_EAGER_IMAGES;
                return (
                  <ProductCardMobile
                    key={product.id}
                    product={product}
                    onDownload={handleDownload}
                    returnPath={modelReturnPath}
                    homeBrowseState={homeBrowseState}
                    imageLoading={shouldPrioritizeImage ? 'eager' : 'lazy'}
                    imageFetchPriority={shouldPrioritizeImage ? 'high' : 'auto'}
                    onBeforeOpen={(modelId) => saveCurrentHomeScroll(true, modelId)}
                  />
                );
              })}
            </div>
          )}

          {products.length === 0 && !showHomeListSkeleton && (
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

          {usesManualHomePagination ? (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={totalItems}
              compact
              pageSize={pageSize}
              pageSizeOptions={homePageSizeOptions}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : (
            <InfiniteLoadTrigger
              hasMore={hasMore}
              isLoading={isLoadingMore}
              onLoadMore={handleLoadMore}
              buttonless
              idleLabel={null}
            />
          )}

          {/* Footer */}
          <footer className="mt-auto pt-4 border-t border-outline-variant/10 text-center pb-2">
            <div className="flex flex-col items-center gap-2">
              {footerLinks.length > 0 && (
                <nav
                  aria-label="相关链接"
                  className="flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1"
                >
                  <span className="text-[10px] font-medium text-on-surface-variant/35">相关链接</span>
                  {footerLinks.map((link, index) => (
                    <a
                      key={`${link.label}-${index}`}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] leading-5 text-on-surface-variant/50 underline-offset-4 transition-colors hover:text-primary hover:underline"
                    >
                      {link.label}
                    </a>
                  ))}
                </nav>
              )}
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
              <p className="text-[10px] text-on-surface-variant/40">{getFooterCopyright()}</p>
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
