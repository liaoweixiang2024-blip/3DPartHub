import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import useSWR, { mutate as globalMutate, preload } from 'swr';
import { categoriesApi } from '../api/categories';
import { downloadModelFile, isDownloadAuthRequiredError } from '../api/downloads';
import { modelApi } from '../api/models';
import { createShare } from '../api/shares';
import DeleteModelDialog from '../components/home/DeleteModelDialog';
import { AnnouncementBanner } from '../components/home/HomeDesktopShared';
import { SkeletonCardMobile } from '../components/home/HomeMobileCardContent';
import type { HomeBrowseState, HomeViewMode, Product } from '../components/home/homeTypes';
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
import LoginConfirmDialog from '../components/shared/LoginConfirmDialog';
import { PageTitle } from '../components/shared/PagePrimitives';
import Pagination, { DEFAULT_PAGE_SIZE, normalizePageSize } from '../components/shared/Pagination';
import { isAuthModalEnabled } from '../components/shared/ProtectedLink';
import { PublicPageShell } from '../components/shared/PublicPageShell';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useInfiniteModels } from '../hooks/useModels';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
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
import { useResolvedPublicInterfaceTheme } from '../lib/interfaceThemePreference';
import { cacheModelDetailTitle } from '../lib/modelDetailTitleCache';
import {
  usePublicSettings,
  getCachedPublicSettings,
  refreshSiteConfig,
  getContactEmail,
  getContactPhone,
  getContactAddress,
  getFooterCopyright,
  getFooterLinks,
} from '../lib/publicSettings';
import { useAuthStore } from '../stores';
import { getInterfaceThemePackage } from '../themes/interfaceThemes/registry';
import { getMobileThemePackage } from '../themes/mobileThemes/registry';

export default function HomePage() {
  useDocumentTitle();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings: publicSettings } = usePublicSettings();
  const resolvedPublicTheme = useResolvedPublicInterfaceTheme(publicSettings);
  const ThemePackage = getInterfaceThemePackage(isDesktop ? resolvedPublicTheme : publicSettings?.interface_theme);
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
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
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

  const openLoginEntry = useCallback(async () => {
    let latestSettings = publicSettings;
    try {
      latestSettings = await refreshSiteConfig();
    } catch {
      latestSettings = publicSettings;
    }
    if (isAuthModalEnabled(latestSettings)) {
      setAuthDialogOpen(true);
      return;
    }
    navigate('/login', { state: { from: location.pathname } });
  }, [location.pathname, navigate, publicSettings]);

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

  const handlePullRefresh = useCallback(async () => {
    setPage(1);
    await Promise.all([mutateModels(), mutateCategories()]);
  }, [mutateModels, mutateCategories]);

  const { pullOffset, pullState, handlePullTransitionEnd } = usePullToRefresh(scrollContainerRef, {
    isDesktop,
    onRefresh: handlePullRefresh,
  });

  useEffect(() => {
    if (!isDesktop) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    let lastScrollTop = container.scrollTop;
    let snapFrame: number | null = null;
    let measureFrame: number | null = null;
    let scrollIdleTimer: number | null = null;
    let titleSnapDistance = 0;

    const clearSnapFrame = () => {
      if (snapFrame == null) return;
      window.cancelAnimationFrame(snapFrame);
      snapFrame = null;
    };

    const measureTitleSnapDistance = () => {
      const title = container.querySelector<HTMLElement>('.home-title-toolbar');
      if (!title) {
        titleSnapDistance = 0;
        return titleSnapDistance;
      }
      const titleStyles = window.getComputedStyle(title);
      const titleMarginBottom = Number.parseFloat(titleStyles.marginBottom) || 0;
      const titleEnd = title.offsetTop + title.offsetHeight + titleMarginBottom;
      const firstListBlock = container.querySelector<HTMLElement>('.home-model-grid, .home-model-empty-state');
      const listStart = firstListBlock?.offsetTop || titleEnd;
      titleSnapDistance = Math.max(220, titleEnd + 120, listStart + 120);
      return titleSnapDistance;
    };

    const scheduleMeasureTitleSnapDistance = () => {
      if (measureFrame != null) return;
      measureFrame = window.requestAnimationFrame(() => {
        measureFrame = null;
        measureTitleSnapDistance();
      });
    };

    const getTitleSnapDistance = () => titleSnapDistance || measureTitleSnapDistance();

    const clearScrollIdleTimer = () => {
      if (scrollIdleTimer == null) return;
      window.clearTimeout(scrollIdleTimer);
      scrollIdleTimer = null;
    };

    const markScrolling = () => {
      container.classList.add('home-is-scrolling');
      clearScrollIdleTimer();
      scrollIdleTimer = window.setTimeout(() => {
        container.classList.remove('home-is-scrolling');
        scrollIdleTimer = null;
      }, 140);
    };

    const snapTitleToTop = () => {
      clearSnapFrame();
      if (container.scrollTop <= getTitleSnapDistance()) {
        container.scrollTop = 0;
        lastScrollTop = 0;
      }
    };

    const scheduleTitleSnap = () => {
      clearSnapFrame();
      snapFrame = window.requestAnimationFrame(() => {
        snapFrame = null;
        snapTitleToTop();
      });
    };

    const handleScroll = () => {
      const currentTop = container.scrollTop;
      const scrollingUp = currentTop < lastScrollTop;
      lastScrollTop = currentTop;
      markScrolling();

      if (currentTop <= 360) {
        scheduleMeasureTitleSnapDistance();
      }

      if (!scrollingUp || currentTop <= 0) {
        clearSnapFrame();
        return;
      }

      const titleSnapDistance = getTitleSnapDistance();
      if (titleSnapDistance <= 0 || currentTop > titleSnapDistance) {
        clearSnapFrame();
        return;
      }

      scheduleTitleSnap();
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasureTitleSnapDistance) : null;
    resizeObserver?.observe(container);
    scheduleMeasureTitleSnapDistance();
    return () => {
      container.removeEventListener('scroll', handleScroll);
      resizeObserver?.disconnect();
      container.classList.remove('home-is-scrolling');
      clearSnapFrame();
      clearScrollIdleTimer();
      if (measureFrame != null) {
        window.cancelAnimationFrame(measureFrame);
        measureFrame = null;
      }
    };
  }, [isDesktop]);

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
        preload(`/api/models/${p.id}`, () =>
          modelApi.getById(p.id).catch((error: unknown) => {
            const status = (error as { response?: { status?: number } })?.response?.status;
            if (status === 404) return null;
            throw error;
          }),
        );
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
      resetHomeListViewportForRefresh('top', usesManualHomePagination);
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
        resetHomeListViewportForRefresh('top', usesManualHomePagination);
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
    const deletedId = deleteTarget.id;
    setDeletingModel(true);
    try {
      await modelApi.delete(deletedId);
      await mutateModels(
        (pages) => {
          if (!pages) return pages;
          let removed = false;
          const nextPages = pages.map((page) => {
            const nextItems = page.items.filter((item) => item.model_id !== deletedId);
            if (nextItems.length === page.items.length) return page;
            removed = true;
            const nextTotal = Math.max(0, page.total - 1);
            return {
              ...page,
              items: nextItems,
              total: nextTotal,
              totalPages: Math.max(1, Math.ceil(nextTotal / Math.max(1, page.pageSize || pageSize))),
            };
          });
          return removed ? nextPages : pages;
        },
        { revalidate: false },
      );
      toast('模型已删除', 'success');
      setDeleteTarget(null);
      setContextMenu(null);
      await Promise.all([
        mutateModels(),
        mutateCategories(),
        globalMutate(
          (key) =>
            typeof key === 'string' &&
            (key.startsWith('/models/infinite') || key.startsWith('/models?page') || key === '/models/count'),
        ),
      ]);
    } catch {
      toast('删除失败，请稍后重试', 'error');
    } finally {
      setDeletingModel(false);
    }
  }, [deleteTarget, mutateCategories, mutateModels, pageSize, toast]);

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
          onClick={openLoginEntry}
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
        <DeleteModelDialog
          target={deleteTarget}
          deleting={deletingModel}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDeleteModel}
        />
        <LoginConfirmDialog
          open={loginPromptOpen}
          onClose={() => setLoginPromptOpen(false)}
          reason="下载模型"
          returnUrl={location.pathname}
        />
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
      <LoginConfirmDialog
        open={loginPromptOpen}
        onClose={() => setLoginPromptOpen(false)}
        reason="下载模型"
        returnUrl={location.pathname}
      />
      <AuthModal open={authDialogOpen} onClose={() => setAuthDialogOpen(false)} returnUrl={location.pathname} />
    </PublicPageShell>
  );
}
