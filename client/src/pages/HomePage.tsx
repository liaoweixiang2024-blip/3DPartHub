import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import useSWR, { preload } from 'swr';
import { categoriesApi } from '../api/categories';
import { downloadModelFile, isDownloadAuthRequiredError } from '../api/downloads';
import { modelApi } from '../api/models';
import { createShare } from '../api/shares';
import { SkeletonCardMobile } from '../components/home/HomeMobileCardContent';
import {
  buildCategories,
  serverItemToProduct,
  parsePageParam,
  normalizeSortParam,
  normalizeHomePageSizeOptions,
  buildHomeReturnPath,
  buildHomeRestoreKey,
  readHomeBrowseStateFromLocation,
  normalizeHomeBrowseState,
  saveHomeBrowseState,
  writeHomeBrowseStateToCurrentHistory,
  readPendingHomeBrowseState,
  saveHomeScrollPosition,
  readHomeScrollPosition,
  readHomeScrollTarget,
  readHomeScrollOffset,
  getHomeModelElement,
  jumpHomeScrollTo,
  restoreHomeScrollToModel,
  getPendingHomeRestoreKey,
  clearPendingHomeRestore,
  HOME_DESKTOP_GRID_EAGER_IMAGES,
  HOME_DESKTOP_LIST_EAGER_IMAGES,
  HOME_MOBILE_EAGER_IMAGES,
  HOME_REFRESH_SCROLL_TARGET,
  type HomeRefreshScrollTarget,
} from '../components/home/homeUtils';
import { MobileDrawer } from '../components/home/MobileDrawer';
import { ProductCard } from '../components/home/ProductCard';
import { ProductCardMobile } from '../components/home/ProductCardMobile';
import AuthModal from '../components/shared/AuthModal';
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
import { cacheModelDetailTitle } from '../lib/modelDetailTitleCache';
import {
  getCachedPublicSettings,
  getContactEmail,
  getContactPhone,
  getContactAddress,
  getFooterCopyright,
  getFooterLinks,
} from '../lib/publicSettings';
import { useAuthStore } from '../stores';
import { getInterfaceThemePackage } from '../themes/interfaceThemes/registry';
import { AnnouncementBanner } from '../themes/interfaceThemes/shared/HomeDesktopShared';
import type { HomeBrowseState, HomeViewMode, Product } from '../themes/interfaceThemes/shared/homeTypes';
import { getMobileThemePackage } from '../themes/mobileThemes/registry';

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
  const [authDialogOpen, setAuthDialogOpen] = useState(false);

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
    if (products.length === 0 || isLoading) return;
    const prefetch = () => {
      for (const p of products.slice(0, 6)) {
        preload(`/api/models/${p.id}`, () => modelApi.getById(p.id));
      }
    };
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(prefetch, { timeout: 2000 });
    } else {
      setTimeout(prefetch, 0);
    }
  }, [productIdsKey, isLoading, products]);

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
        if (!usesManualHomePagination) {
          resetHomeListViewportForRefresh(HOME_REFRESH_SCROLL_TARGET);
        }
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
      cacheModelDetailTitle(product.id, product.name);
      saveCurrentHomeScroll(true, product.id);
      setContextMenu(null);
      navigate(`/model/${product.id}`, { state: { from: modelReturnPath, homeBrowseState, modelName: product.name } });
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
      <div
        className="flex flex-col items-center justify-center h-dvh bg-surface gap-6"
        data-interface-theme={ThemePackage.manifest.key}
      >
        <Icon name="lock" size={64} className="text-on-surface-variant/30" />
        <h2 className="text-xl font-bold text-on-surface">需要登录</h2>
        <p className="text-sm text-on-surface-variant">浏览模型库需要先登录账号</p>
        <button
          type="button"
          onClick={() => setAuthDialogOpen(true)}
          className="px-6 py-2.5 bg-primary-container text-on-primary rounded-lg text-sm font-medium hover:opacity-90"
        >
          前往登录
        </button>
        <AuthModal open={authDialogOpen} onClose={() => setAuthDialogOpen(false)} returnUrl={location.pathname} />
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
                    setAuthDialogOpen(true);
                  }}
                  className="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity"
                >
                  前往登录
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        <AuthModal open={authDialogOpen} onClose={() => setAuthDialogOpen(false)} returnUrl={location.pathname} />
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
                  setAuthDialogOpen(true);
                }}
                className="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity"
              >
                前往登录
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      <AuthModal open={authDialogOpen} onClose={() => setAuthDialogOpen(false)} returnUrl={location.pathname} />
    </PublicPageShell>
  );
}
