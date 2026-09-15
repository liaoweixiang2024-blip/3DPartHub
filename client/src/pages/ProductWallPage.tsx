import {
  startTransition,
  useCallback,
  useEffect,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import '../styles/product-wall.css';
import {
  listAdminProductWallCategories,
  listProductWallCategories,
  listProductWallCounts,
  listProductWallFavoriteItems,
  listProductWallItemsPage,
  listProductWallFavorites,
  addProductWallFavorite,
  removeProductWallFavorite,
  type ProductWallItem,
  type ProductWallKind,
  type ProductWallListResponse,
} from '../api/productWall';
import {
  collectFilesFromDataTransfer,
  errorMessage,
  getProductWallColumnCount,
  productWallDownloadName,
  wallImageUrl,
  PRODUCT_WALL_RENDER_BATCH_SIZE,
  PRODUCT_WALL_MOBILE_EAGER_IMAGE_COUNT,
  PRODUCT_WALL_MOBILE_RENDER_BATCH_SIZE,
  PRODUCT_WALL_EAGER_IMAGE_COUNT,
  PRODUCT_WALL_FAVORITES_FILTER,
  PRODUCT_WALL_CANVAS_MODE_KEY,
  PRODUCT_WALL_DEFAULT_KIND_KEY,
  productWallRatioValue,
  type ProductWallCanvasMode,
} from '../components/product-wall-admin/productWallAdminUtils';
import { ProductWallPreview } from '../components/product-wall-admin/ProductWallPreview';
import { ProductWallThumbnail } from '../components/product-wall-admin/ProductWallThumbnail';
import { ProductWallUploadModal } from '../components/product-wall-admin/ProductWallUploadModal';
import { AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import LoginConfirmDialog from '../components/shared/LoginConfirmDialog';
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SearchField from '../components/shared/SearchField';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { downloadBrowserFile } from '../lib/browserDownload';
import { copyText } from '../lib/clipboard';
import { useFeatureFlags } from '../lib/publicSettings';
import { useAuthStore } from '../stores/useAuthStore';

type WallItem = ProductWallItem;

type WallFilter = string;

type ProductWallMasonryEntry = {
  imageIndex: number;
  item: WallItem;
};

const PRODUCT_WALL_ALL_FILTER = '__all__';
const PRODUCT_WALL_WALL_PAGE_SIZE = 50;
const PRODUCT_WALL_SEARCH_DEBOUNCE_MS = 300;

function ProductWallLoadingState() {
  const { t } = useTranslation();

  return (
    <section className="flex min-h-[320px] w-full">
      <PageRefreshIndicator label={t('productWall.loadingLabel')} />
    </section>
  );
}

export default function ProductWallPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('productWall.title'));
  const featureFlags = useFeatureFlags();
  const loadMoreRef = useRef<HTMLButtonElement | null>(null);
  const previewMenuBlockUntilRef = useRef(0);
  const activePreviewRef = useRef<WallItem | null>(null);
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const { toast } = useToast();
  const isLoggedIn = hasHydrated && isAuthenticated;
  const isAdmin = isLoggedIn && user?.role === 'ADMIN';
  // ADMIN 不依赖 profile 的 canUploadProductWall 字段（服务端对 ADMIN 恒放行），
  // 避免旧登录态缺少该字段时管理员的上传/后台入口消失；非管理员以字段为准
  const canUpload = isLoggedIn && (isAdmin || Boolean(user?.canUploadProductWall));
  const {
    data: categories,
    error: categoriesError,
    isLoading: categoriesLoading,
  } = useSWR(
    isAdmin ? 'admin-product-wall-categories' : 'product-wall-categories',
    isAdmin ? listAdminProductWallCategories : listProductWallCategories,
  );
  const [active, setActive] = useState<WallItem | null>(null);
  const [filter, setFilter] = useState<WallFilter>(PRODUCT_WALL_ALL_FILTER);
  const {
    value: query,
    draftValue: queryInputValue,
    setValue: setQuery,
    inputProps: queryInputProps,
  } = useImeSafeSearchInput();
  const [dragActive, setDragActive] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadModalFiles, setUploadModalFiles] = useState<File[] | null>(null);
  const [canvasMode] = useState<ProductWallCanvasMode>(() => {
    if (typeof window === 'undefined') return 'white';
    const saved = window.localStorage.getItem(PRODUCT_WALL_CANVAS_MODE_KEY);
    return saved === 'checker' ? 'checker' : 'white';
  });
  const [defaultUploadKind] = useState<ProductWallKind>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(PRODUCT_WALL_DEFAULT_KIND_KEY) || '';
  });
  const [columnCount, setColumnCount] = useState(getProductWallColumnCount);
  const initialRenderBatchSize =
    columnCount <= 2 ? PRODUCT_WALL_MOBILE_RENDER_BATCH_SIZE : PRODUCT_WALL_RENDER_BATCH_SIZE;
  const [renderCount, setRenderCount] = useState(initialRenderBatchSize);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');
  const [wallReady, setWallReady] = useState(false);
  const categoryList = useMemo(() => categories ?? [], [categories]);
  const databaseCategoryNames = useMemo(() => categoryList.map((item) => item.name).filter(Boolean), [categoryList]);
  const categoryNames = useMemo(() => Array.from(new Set(databaseCategoryNames)), [databaseCategoryNames]);
  const filters = useMemo<WallFilter[]>(
    () => [PRODUCT_WALL_ALL_FILTER, PRODUCT_WALL_FAVORITES_FILTER, ...categoryNames],
    [categoryNames],
  );
  const resolvedDefaultUploadKind = categoryNames.includes(defaultUploadKind)
    ? defaultUploadKind
    : categoryNames[0] || '';
  const isUtilityFilter = filter === PRODUCT_WALL_ALL_FILTER || filter === PRODUCT_WALL_FAVORITES_FILTER;
  const isFavoritesFilter = filter === PRODUCT_WALL_FAVORITES_FILTER;
  const uploadKind = isUtilityFilter ? resolvedDefaultUploadKind : filter;
  const isCompactWallLayout = columnCount <= 2;
  const renderBatchSize = isCompactWallLayout ? PRODUCT_WALL_MOBILE_RENDER_BATCH_SIZE : PRODUCT_WALL_RENDER_BATCH_SIZE;
  const eagerImageCount = isCompactWallLayout ? PRODUCT_WALL_MOBILE_EAGER_IMAGE_COUNT : PRODUCT_WALL_EAGER_IMAGE_COUNT;
  const thumbnailLazyRootMargin = isCompactWallLayout ? '180px 0px' : '300px 0px';
  const loadMoreRootMargin = isCompactWallLayout ? '180px 0px' : '300px 0px';
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();

  // ── 墙体数据：服务端分页 + 真无限滚动（分类/搜索条件上移服务端，不再一次拉全库）──
  const wallKind = isUtilityFilter ? '' : filter;
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), PRODUCT_WALL_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const wallSearchQuery = isFavoritesFilter ? '' : debouncedQuery;
  const wallFetcher = useCallback((key: string) => {
    const params = new URLSearchParams(key.split('?')[1] || '');
    const page = Number(params.get('p')) || 1;
    if (key.startsWith('product-wall-favorites')) {
      return listProductWallFavoriteItems(page, PRODUCT_WALL_WALL_PAGE_SIZE);
    }
    return listProductWallItemsPage(page, PRODUCT_WALL_WALL_PAGE_SIZE, {
      kind: params.get('k') || undefined,
      q: params.get('q') || undefined,
    });
  }, []);
  const {
    data: wallData,
    error: itemsError,
    isLoading: wallIsLoading,
    mutate: mutateWall,
    size: wallSize,
    setSize: setWallSize,
  } = useSWRInfinite(
    (pageIndex: number, previousPage: ProductWallListResponse | null) => {
      if (isFavoritesFilter && !isLoggedIn) return null;
      if (previousPage && previousPage.items.length < PRODUCT_WALL_WALL_PAGE_SIZE) return null;
      if (isFavoritesFilter) return `product-wall-favorites?p=${pageIndex + 1}`;
      return `product-wall-items?p=${pageIndex + 1}&k=${encodeURIComponent(wallKind)}&q=${encodeURIComponent(wallSearchQuery)}`;
    },
    wallFetcher,
    // 翻页/窗口聚焦不重校验已加载页（变更都通过 mutateWall() 显式刷新，避免列表跳动）
    { revalidateFirstPage: false, revalidateOnFocus: false },
  );
  // 切换分类/搜索条件后回到第一页（useSWRInfinite 换 key 不会自动重置 size；仅在条件真实变化时触发，避免挂载期多余重校验）
  const lastWallQueryKeyRef = useRef(`${filter}|${wallSearchQuery}|${isLoggedIn}`);
  useEffect(() => {
    const nextKey = `${filter}|${wallSearchQuery}|${isLoggedIn}`;
    if (lastWallQueryKeyRef.current === nextKey) return;
    lastWallQueryKeyRef.current = nextKey;
    setWallSize(1);
  }, [filter, wallSearchQuery, isLoggedIn, setWallSize]);
  const items = useMemo(() => wallData?.flatMap((page) => page.items) ?? [], [wallData]);
  const wallTotal = wallData?.[0]?.total ?? 0;
  const hasMoreWallPages = items.length < wallTotal;
  const apiError = itemsError || categoriesError;
  const initialLoading = (wallIsLoading && !wallData) || (categoriesLoading && !categories);

  // tab 计数：公开计数接口（approved 总数 + 按分类）+ 收藏总数
  const { data: countsData, mutate: mutateCounts } = useSWR('product-wall-counts', listProductWallCounts);
  const { data: favoritesMeta, mutate: mutateFavoritesMeta } = useSWR(
    isLoggedIn ? 'product-wall-favorites-meta' : null,
    () => listProductWallFavoriteItems(1, 1),
  );

  const visibleItems = useMemo(() => {
    // 收藏流不支持服务端搜索：搜索词对已加载的收藏项做客户端过滤
    if (!isFavoritesFilter || !normalizedQuery) return items;
    return items.filter((item) =>
      [item.title, item.description || '', item.kind, ...item.tags].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      ),
    );
  }, [items, isFavoritesFilter, normalizedQuery]);
  const renderedItems = visibleItems.slice(0, renderCount);
  const hasMoreVisibleItems = renderedItems.length < visibleItems.length || hasMoreWallPages;
  const filterCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    acc[PRODUCT_WALL_ALL_FILTER] = countsData?.total ?? 0;
    acc[PRODUCT_WALL_FAVORITES_FILTER] = isLoggedIn ? (favoritesMeta?.total ?? 0) : 0;
    for (const name of categoryNames) acc[name] = countsData?.byKind?.[name] ?? 0;
    return acc;
  }, [countsData, favoritesMeta, isLoggedIn, categoryNames]);
  const masonryColumns = useMemo(() => {
    const columns = Array.from({ length: columnCount }, () => [] as ProductWallMasonryEntry[]);
    const heights = Array.from({ length: columnCount }, () => 0);
    renderedItems.forEach((item, imageIndex) => {
      let shortestColumnIndex = 0;
      for (let index = 1; index < columns.length; index += 1) {
        if (heights[index] < heights[shortestColumnIndex]) shortestColumnIndex = index;
      }
      columns[shortestColumnIndex].push({ imageIndex, item });
      heights[shortestColumnIndex] += 1 / productWallRatioValue(item.ratio);
    });
    return columns;
  }, [renderedItems, columnCount]);
  const activeFavorited = active ? favoriteIds.has(active.id) : false;

  // 所有上传路径（按钮/拖拽/粘贴/文件夹）统一进上传弹窗确认，不再直接静默上传
  const openUploadModal = useCallback((files?: File[] | null) => {
    if (files && files.length) setUploadModalFiles(files);
    setUploadModalOpen(true);
  }, []);
  const handleUploadSource = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length) openUploadModal(files);
    },
    [openUploadModal],
  );
  const handleUploadCompleted = useCallback(() => {
    void mutateWall();
    void mutateCounts();
  }, [mutateWall, mutateCounts]);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginDialogReason, setLoginDialogReason] = useState('');
  const toggleFavoriteItem = async (item: WallItem) => {
    if (!isLoggedIn) {
      setLoginDialogReason(t('productWall.aria.favoriteImage'));
      setLoginDialogOpen(true);
      return;
    }
    const wasFavorite = favoriteIds.has(item.id);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    toast(wasFavorite ? t('productWall.toasts.favoriteRemoved') : t('productWall.toasts.favoriteAdded'), 'success');
    try {
      if (wasFavorite) await removeProductWallFavorite(item.id);
      else await addProductWallFavorite(item.id);
      void mutateFavoritesMeta();
    } catch {
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (wasFavorite) next.add(item.id);
        else next.delete(item.id);
        return next;
      });
      toast(t('productWall.toasts.favoriteFailed'), 'error');
    }
  };
  const toggleFavorite = async () => {
    if (!active) return;
    await toggleFavoriteItem(active);
  };
  const shareTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareActiveImage = async () => {
    if (!active) return;
    const url = wallImageUrl(active);
    try {
      if (navigator.share) {
        await navigator.share({ title: active.title, text: active.kind, url });
      } else {
        await copyText(url);
        setShareState('copied');
        if (shareTimeoutRef.current) clearTimeout(shareTimeoutRef.current);
        shareTimeoutRef.current = setTimeout(() => setShareState('idle'), 1600);
      }
    } catch {
      try {
        await copyText(url);
        setShareState('copied');
        if (shareTimeoutRef.current) clearTimeout(shareTimeoutRef.current);
        shareTimeoutRef.current = setTimeout(() => setShareState('idle'), 1600);
      } catch {
        setShareState('idle');
      }
    }
  };
  const downloadProductWallItem = useCallback(
    async (item: ProductWallItem) => {
      try {
        await downloadBrowserFile(item.image, { fileName: productWallDownloadName(item) });
      } catch (err) {
        toast(errorMessage(err, t('productWall.toasts.downloadFailed')), 'error');
      }
    },
    [t, toast],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (!canUpload) return;
      const pastedImages = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
      if (pastedImages.length) {
        event.preventDefault();
        openUploadModal(pastedImages);
      }
    },
    [canUpload, openUploadModal],
  );

  useEffect(() => {
    const updateColumnCount = () => setColumnCount(getProductWallColumnCount());
    updateColumnCount();
    window.addEventListener('resize', updateColumnCount);
    return () => window.removeEventListener('resize', updateColumnCount);
  }, []);
  useEffect(() => {
    return () => {
      if (shareTimeoutRef.current) clearTimeout(shareTimeoutRef.current);
    };
  }, []);
  useEffect(() => {
    if (!canUpload) return;
    if (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches) return;
    const hasFiles = (event: globalThis.DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files');
    const handleDocumentDragOver = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragActive(true);
    };
    const handleDocumentDragLeave = (event: globalThis.DragEvent) => {
      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      ) {
        setDragActive(false);
      }
    };
    const handleDocumentDrop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      setDragActive(false);
      void collectFilesFromDataTransfer(event.dataTransfer).then(handleUploadSource);
    };
    document.addEventListener('dragover', handleDocumentDragOver);
    document.addEventListener('dragleave', handleDocumentDragLeave);
    document.addEventListener('drop', handleDocumentDrop);
    return () => {
      document.removeEventListener('dragover', handleDocumentDragOver);
      document.removeEventListener('dragleave', handleDocumentDragLeave);
      document.removeEventListener('drop', handleDocumentDrop);
    };
  }, [canUpload, handleUploadSource]);
  useEffect(() => {
    setRenderCount(renderBatchSize);
    setWallReady(false);
  }, [filter, normalizedQuery, renderBatchSize]);
  useEffect(() => {
    if (initialLoading) {
      setWallReady(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setWallReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [initialLoading, filter, normalizedQuery, columnCount]);
  const { data: favoriteData } = useSWR(isLoggedIn ? 'product-wall-favorites' : null, listProductWallFavorites);
  useEffect(() => {
    setFavoriteIds(new Set(favoriteData || []));
  }, [favoriteData]);
  // 分类被重命名/删除后，墙体筛选指向失效分类时回到「全部」
  useEffect(() => {
    if (isUtilityFilter) return;
    if (categoryNames.length && !categoryNames.includes(filter)) setFilter(PRODUCT_WALL_ALL_FILTER);
  }, [categoryNames, filter, isUtilityFilter]);
  const visibleItemsLengthRef = useRef(0);
  const renderCountRef = useRef(renderCount);
  const loadMoreFrameRef = useRef<number | null>(null);
  const hasMoreWallPagesRef = useRef(false);
  const wallSizeRef = useRef(wallSize);
  renderCountRef.current = renderCount;
  visibleItemsLengthRef.current = visibleItems.length;
  hasMoreWallPagesRef.current = hasMoreWallPages;
  wallSizeRef.current = wallSize;
  const loadMoreVisibleItems = useCallback(() => {
    if (loadMoreFrameRef.current != null) return;
    loadMoreFrameRef.current = window.requestAnimationFrame(() => {
      loadMoreFrameRef.current = null;
      startTransition(() => {
        setRenderCount((count) => Math.min(count + renderBatchSize, visibleItemsLengthRef.current));
      });
      // 已渲染条数即将覆盖已加载条数且服务端还有更多页 → 拉取下一页
      if (renderCountRef.current + renderBatchSize >= visibleItemsLengthRef.current && hasMoreWallPagesRef.current) {
        void setWallSize(wallSizeRef.current + 1);
      }
    });
  }, [renderBatchSize, setWallSize]);
  useEffect(
    () => () => {
      if (loadMoreFrameRef.current != null) window.cancelAnimationFrame(loadMoreFrameRef.current);
    },
    [],
  );
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMoreVisibleItems || !wallReady) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        loadMoreVisibleItems();
      },
      { rootMargin: loadMoreRootMargin },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreVisibleItems, loadMoreRootMargin, wallReady, loadMoreVisibleItems]);
  const closeActivePreview = useCallback(() => {
    cancelAnimationFrame(0);
    previewMenuBlockUntilRef.current = performance.now() + 520;
    setActive(null);
  }, []);
  useEffect(() => {
    const blockPreviewClickThrough = (event: Event) => {
      if (performance.now() >= previewMenuBlockUntilRef.current || activePreviewRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      if ('stopImmediatePropagation' in event) event.stopImmediatePropagation();
    };
    window.addEventListener('click', blockPreviewClickThrough, true);
    window.addEventListener('pointerup', blockPreviewClickThrough, true);
    window.addEventListener('touchend', blockPreviewClickThrough, true);
    return () => {
      window.removeEventListener('click', blockPreviewClickThrough, true);
      window.removeEventListener('pointerup', blockPreviewClickThrough, true);
      window.removeEventListener('touchend', blockPreviewClickThrough, true);
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const closePreview = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeActivePreview();
    };
    window.addEventListener('keydown', closePreview);
    return () => window.removeEventListener('keydown', closePreview);
  }, [active, closeActivePreview]);
  const headerActions = canUpload ? (
    <div className="product-wall-action-row flex w-auto items-center justify-end gap-1.5 md:gap-2">
      <button
        type="button"
        onClick={() => openUploadModal()}
        className="product-wall-action inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary-container/12 px-3 text-sm font-semibold text-primary-container transition-colors hover:bg-primary-container/18 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container/35"
        aria-label={t('productWall.actions.upload')}
        data-tooltip-ignore
      >
        <Icon name="cloud_upload" size={16} />
        {t('productWall.actions.upload')}
      </button>
    </div>
  ) : null;

  return (
    <AdminPageShell
      desktopContentClassName="app-public-tool-shell app-product-wall-shell p-6"
      mobileContentClassName="px-4 py-4 pb-20"
    >
      <div className="relative" onPaste={handlePaste}>
        <AdminManagementPage
          title={t('productWall.title')}
          meta={initialLoading ? t('productWall.loading') : undefined}
          description={t('productWall.description')}
          actions={headerActions}
          className="app-public-tool-page app-public-tool-page-product-wall !h-auto"
          toolbar={
            <div className="product-wall-toolbar grid min-h-11 items-center gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
              <ResponsiveSectionTabs
                tabs={filters.map((item) => ({
                  value: item,
                  label:
                    item === PRODUCT_WALL_ALL_FILTER
                      ? t('productWall.filters.all')
                      : item === PRODUCT_WALL_FAVORITES_FILTER
                        ? t('productWall.filters.favorites')
                        : item,
                  count: filterCounts[item] || 0,
                  icon:
                    item === PRODUCT_WALL_ALL_FILTER
                      ? 'grid_view'
                      : item === PRODUCT_WALL_FAVORITES_FILTER
                        ? 'favorite'
                        : 'image',
                }))}
                value={filter}
                onChange={setFilter}
                mobileTitle={t('productWall.currentCategory')}
                countUnit={t('productWall.countUnit')}
              />
              <SearchField
                inputProps={queryInputProps}
                value={queryInputValue}
                onClear={() => setQuery('')}
                placeholder={t('productWall.searchPlaceholder')}
                className="product-wall-search md:ml-auto md:w-72"
              />
            </div>
          }
          contentClassName="overflow-visible"
          toolbarSticky
        >
          {dragActive && (
            <div className="mb-4 flex h-10 items-center justify-center border-y border-primary-container/35 bg-primary-container/6 text-sm font-medium text-primary-container">
              {t('productWall.dragReleaseUpload')}
            </div>
          )}

          {initialLoading || (visibleItems.length > 0 && !wallReady) ? (
            <ProductWallLoadingState />
          ) : visibleItems.length ? (
            <>
              <section className="product-wall-masonry w-full">
                {masonryColumns.map((column, columnIndex) => (
                  <div key={columnIndex} className="product-wall-masonry-column">
                    {column.map(({ imageIndex, item }) => {
                      const itemFavorited = favoriteIds.has(item.id);
                      return (
                        <article
                          key={item.id || `${item.title}-${imageIndex}`}
                          className="product-wall-card group relative break-inside-avoid overflow-hidden rounded-xl bg-transparent"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setActive(item);
                            }}
                            className="block w-full overflow-hidden rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container/35"
                          >
                            <ProductWallThumbnail
                              item={item}
                              canvasMode={canvasMode}
                              imageIndex={imageIndex}
                              eagerImageCount={eagerImageCount}
                              lazyRootMargin={thumbnailLazyRootMargin}
                            />
                          </button>
                          {
                            <div className="product-wall-card-actions absolute right-2 top-2 z-20 flex items-center gap-1.5">
                              {featureFlags.favorites && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void toggleFavoriteItem(item);
                                  }}
                                  className={`product-wall-card-action ${itemFavorited ? 'is-active' : ''}`}
                                  aria-label={
                                    itemFavorited
                                      ? t('productWall.aria.unfavorite')
                                      : t('productWall.aria.favoriteImage')
                                  }
                                  title={
                                    itemFavorited
                                      ? t('productWall.preview.unfavorite')
                                      : t('productWall.preview.favorite')
                                  }
                                  data-tooltip-ignore
                                >
                                  <Icon name={itemFavorited ? 'favorite' : 'star'} size={14} />
                                </button>
                              )}
                              {featureFlags.downloads && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void downloadProductWallItem(item);
                                  }}
                                  className="product-wall-card-action"
                                  aria-label={t('productWall.aria.downloadImage')}
                                  title={t('productWall.preview.download')}
                                  data-tooltip-ignore
                                >
                                  <Icon name="download" size={14} />
                                </button>
                              )}
                            </div>
                          }
                        </article>
                      );
                    })}
                  </div>
                ))}
              </section>
              {hasMoreVisibleItems ? (
                <button
                  ref={loadMoreRef}
                  type="button"
                  onClick={loadMoreVisibleItems}
                  className="product-wall-load-more flex h-16 w-full items-center justify-center gap-2 text-xs text-on-surface-variant transition-colors hover:text-primary-container"
                >
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-on-surface-variant/50" />
                  {t('productWall.loadMore')}
                  <span
                    className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-on-surface-variant/50"
                    style={{ animationDelay: '0.3s' }}
                  />
                </button>
              ) : visibleItems.length > renderBatchSize ? (
                <div className="flex h-12 w-full items-center justify-center text-xs text-on-surface-variant/40">
                  {t('productWall.reachedEnd')}
                </div>
              ) : null}
            </>
          ) : (
            <section className="flex min-h-[360px] items-center justify-center border-y border-dashed border-outline-variant/28 bg-surface-container-low/35 px-4 py-12 text-center">
              <div className="max-w-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-container/10 text-primary-container">
                  <Icon name="cloud_upload" size={22} />
                </div>
                <h2 className="mt-4 text-base font-semibold text-on-surface">
                  {apiError
                    ? t('productWall.empty.loadFailed')
                    : isFavoritesFilter
                      ? t('productWall.empty.favoritesTitle')
                      : canUpload
                        ? t('productWall.empty.categoryEmpty')
                        : t('productWall.empty.noGallery')}
                </h2>
                <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                  {apiError
                    ? errorMessage(apiError, t('productWall.empty.apiErrorDescription'))
                    : isFavoritesFilter
                      ? isLoggedIn
                        ? t('productWall.empty.favoritesLoggedIn')
                        : t('productWall.empty.favoritesLogin')
                      : canUpload
                        ? uploadKind
                          ? t('productWall.empty.uploadHint', { kind: uploadKind })
                          : t('productWall.empty.noCategoryUpload')
                        : t('productWall.empty.publicEmpty')}
                </p>
              </div>
            </section>
          )}
        </AdminManagementPage>
      </div>

      {uploadModalOpen && canUpload && (
        <ProductWallUploadModal
          open={uploadModalOpen}
          isAdmin={isAdmin}
          categories={categoryNames}
          defaultKind={uploadKind}
          initialFiles={uploadModalFiles}
          onClose={() => {
            setUploadModalOpen(false);
            setUploadModalFiles(null);
          }}
          onCompleted={handleUploadCompleted}
        />
      )}

      {active && (
        <ProductWallPreview
          active={active}
          canvasMode={canvasMode}
          activeFavorited={activeFavorited}
          shareState={shareState}
          onClose={closeActivePreview}
          onToggleFavorite={() => void toggleFavorite()}
          onShare={() => void shareActiveImage()}
          onDownload={(item) => void downloadProductWallItem(item)}
        />
      )}
      <LoginConfirmDialog open={loginDialogOpen} onClose={() => setLoginDialogOpen(false)} reason={loginDialogReason} />
    </AdminPageShell>
  );
}
