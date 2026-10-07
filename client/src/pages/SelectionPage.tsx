import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { startTransition, useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import useSWR from 'swr';
import {
  filterSelectionProducts,
  getSelectionCategories,
  getSelectionModelMatches,
  type SelectionProduct,
  createSelectionShare,
} from '../api/selections';
import InquirySubmitDialog from '../components/inquiry/InquirySubmitDialog';
import {
  ResultCard,
  SelectionInlineLoading,
  SelectionLoadingOverlay,
  SelectionShareLinkDialog,
} from '../components/selection';
import {
  isManualColumn,
  isPresetColumn,
  normalizeManualValue,
  columnLabel,
  getInquiryCartItemTitle,
  getInquiryCartItemSummary,
  applyManualSpecs,
  stableJson,
  useDebouncedValue,
  selectionMotion,
  selectionPress,
  mobileCategoryListClass,
  mobileCategoryPanelClass,
  mobileCategoryCardClass,
  type ShareLinkDialogState,
  type ShareTarget,
} from '../components/selection/selectionUtils';
import { AdminContentPanel, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import BrowseLoginLock, { useBrowseGate } from '../components/shared/BrowseLoginLock';
import Icon from '../components/shared/Icon';
import LoginConfirmDialog from '../components/shared/LoginConfirmDialog';
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import SafeImage from '../components/shared/SafeImage';
import SearchField from '../components/shared/SearchField';
import {
  selectionCategoryCardClass,
  selectionCategoryGridClass,
  selectionCategoryPanelClass,
} from '../components/shared/SelectionPageLayout';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { useInquiryCart } from '../hooks/useInquiryCart';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getBusinessConfig } from '../lib/businessConfig';
import { copyText } from '../lib/clipboard';
import { getKitListTitle } from '../lib/kitList';
import { useFeatureFlags, usePublicSettings } from '../lib/publicSettings';
import { compareOptionValues } from '../lib/selectionSort';
import { useAuthStore } from '../stores/useAuthStore';

/* ══════════════ Main Page ══════════════ */

export default function SelectionPage() {
  const { t } = useTranslation();
  const { settings: settingsData } = usePublicSettings();
  const business = getBusinessConfig(settingsData);
  const pageTitle = String(settingsData?.selection_page_title || '').trim() || t('selectionPage.title');
  const pageDesc = String(settingsData?.selection_page_desc || '').trim() || t('selectionPage.description');
  useDocumentTitle(pageTitle);
  const isCategoryTablet = useMediaQuery('(min-width: 640px)');
  const isCategoryWide = useMediaQuery('(min-width: 1280px)');
  const isCategoryUltraWide = useMediaQuery('(min-width: 1536px)');
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const prefersReducedMotion = useReducedMotion();
  const navigate = useNavigate();
  const location = useLocation();
  const previewCategoryImages = useMemo(
    () => new URLSearchParams(location.search).get('previewImages') === '1',
    [location.search],
  );
  const user = useAuthStore((s) => s.user);
  const { toast } = useToast();
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [cartPreviewOpen, setCartPreviewOpen] = useState(false);
  const cartActionBarRef = useRef<HTMLDivElement>(null);
  const inquiryCart = useInquiryCart();
  const featureFlags = useFeatureFlags();
  const canInquiry = featureFlags.inquiry;
  const hideMobileBottomNav = !isDesktop && (cartPreviewOpen || inquiryOpen);
  const selectedIds = inquiryCart.productIds;
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (inquiryCart.items.length === 0) setCartPreviewOpen(false);
  }, [inquiryCart.items.length]);

  useEffect(() => {
    if (!cartPreviewOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cartActionBarRef.current?.contains(target)) return;
      setCartPreviewOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [cartPreviewOpen]);

  /* wizard state */
  const [groupId, setGroupId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [autoSelectedFields, setAutoSelectedFields] = useState<Set<string>>(new Set());
  const {
    value: searchDraft,
    draftValue: searchDraftInputValue,
    setValue: setSearchDraft,
    inputProps: searchDraftInputProps,
  } = useImeSafeSearchInput();
  const search = useDebouncedValue(searchDraft.trim(), 250);
  const [pressedCategoryKey, setPressedCategoryKey] = useState<string | null>(null);
  /* 触摸拖动吞点击守卫：iOS 把「按住慢慢拖」判成 tap 时仍会派发 click（位移小/滚动接管慢），
     点击高亮（pressedCategoryKey → 卡片变白+顶线显形）就会在滑动时闪现。记录 touchstart 起点，
     位移超过 10px 的触摸一律吞掉 click——真实点击（原地点按）不受影响 */
  const categoryTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swallowCategoryClickRef = useRef(false);
  const [pendingOptionKey, setPendingOptionKey] = useState<string | null>(null);

  /* recently viewed subcategories (localStorage) */
  const RECENT_KEY = 'selection:recent';
  const [, setRecentSlugs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 6);
    } catch {
      return [];
    }
  });
  function pushRecent(slug: string) {
    setRecentSlugs((prev) => {
      const next = [slug, ...prev.filter((s) => s !== slug)].slice(0, 6);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        return next;
      }
      return next;
    });
  }

  /* data */
  // 浏览门槛：require_login_selection（选型独立开关）开启且未登录时不再拉取选型公开接口
  // （发出去只会 401），显示与首页一致的模糊锁屏；门槛未判定前同样暂停请求
  const browseGate = useBrowseGate('require_login_selection');
  const {
    data: cats = [],
    error: categoriesError,
    isLoading: categoriesLoading,
    mutate: retryCategories,
  } = useSWR(browseGate.dataReady ? 'selections/categories' : null, getSelectionCategories);

  /* pre-fill from share link state or URL params */
  const shareStateRef = useRef<{ shareSlug?: string; shareSpecs?: Record<string, string> } | null | undefined>(
    undefined,
  );
  if (shareStateRef.current === undefined) {
    const state = location.state as { shareSlug?: string; shareSpecs?: Record<string, string> } | null;
    shareStateRef.current = state?.shareSlug ? state : null;
  }

  // ?c=<slug> 深链（选型导航页弹窗跳转）：目录加载后直达该分类向导（一次性读取）
  const deepLinkSlugRef = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const g = params.get('g');
    if (g && !groupId) {
      setGroupId(g);
    }
    const c = params.get('c');
    if (c) deepLinkSlugRef.current = c;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply ?c= deep link once categories are loaded (before share state handling)
  useEffect(() => {
    const c = deepLinkSlugRef.current;
    if (!c || !cats.length || slug) return;
    const match = cats.find((cat) => cat.slug === c);
    if (!match) {
      deepLinkSlugRef.current = null;
      return;
    }
    setSlug(match.slug);
    if (match.groupId) setGroupId(match.groupId);
    deepLinkSlugRef.current = null;
    navigate(`${location.pathname}?g=${match.groupId ?? ''}`, { replace: true });
  }, [cats, location.pathname, navigate, slug]);

  // Apply share slug/specs once cats are loaded
  useEffect(() => {
    const share = shareStateRef.current;
    if (!share?.shareSlug || !cats.length || slug) return;
    setSlug(share.shareSlug);
    if (share.shareSpecs) {
      setSpecs(share.shareSpecs);
      setAutoSelectedFields(new Set());
    }
    const match = cats.find((c) => c.slug === share.shareSlug);
    if (match?.groupId) setGroupId(match.groupId);
    shareStateRef.current = null;
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null });
  }, [cats, location.hash, location.pathname, location.search, navigate, slug]);

  /* derive groups and standalone categories from API categories */
  interface DerivedGroup {
    id: string;
    name: string;
    icon: string;
    image: string | null;
    sortOrder: number;
    children: { slug: string; name: string; icon: string }[];
  }
  const groups = useMemo<DerivedGroup[]>(() => {
    const map = new Map<string, DerivedGroup>();
    for (const c of cats) {
      if (!c.groupId || !c.groupName) continue;
      if (!map.has(c.groupId)) {
        map.set(c.groupId, {
          id: c.groupId,
          name: c.groupName,
          icon: c.groupIcon || 'category',
          image: c.groupImage || null,
          sortOrder: c.sortOrder,
          children: [],
        });
      } else if (!map.get(c.groupId)!.image && c.groupImage) {
        map.get(c.groupId)!.image = c.groupImage;
      }
      map.get(c.groupId)!.sortOrder = Math.min(map.get(c.groupId)!.sortOrder, c.sortOrder);
      map.get(c.groupId)!.children.push({ slug: c.slug, name: c.name, icon: c.icon || 'category' });
    }
    return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [cats]);

  // Standalone categories without a group
  const standaloneCats = useMemo(() => cats.filter((c) => !c.groupId || !c.groupName), [cats]);
  const catBySlug = useMemo(() => new Map(cats.map((c) => [c.slug, c])), [cats]);

  const group = useMemo(() => groups.find((g) => g.id === groupId) ?? null, [groups, groupId]);

  const liveCat = slug ? (cats.find((c) => c.slug === slug) ?? null) : null;
  const fields = useMemo(() => {
    if (liveCat?.columns?.length) {
      return liveCat.columns.filter((col) => !col.displayOnly).map((col) => col.key);
    }
    return [];
  }, [liveCat]);

  const columns = useMemo(() => {
    if (liveCat?.columns?.length) return liveCat.columns;
    return [];
  }, [liveCat]);

  const manualFields = useMemo(
    () => new Set(columns.filter((col) => isManualColumn(col) || isPresetColumn(col)).map((col) => col.key)),
    [columns],
  );
  const specKeys = useMemo(() => fields.filter((f) => specs[f]), [fields, specs]);

  const curField = useMemo(() => {
    for (const f of fields) {
      if (specs[f]) continue;
      if (skipped.has(f)) continue;
      return f;
    }
    return null;
  }, [fields, specs, skipped]);

  const phase: 'group' | 'sub' | 'wizard' = !groupId ? 'group' : !slug ? 'sub' : 'wizard';
  const resultBatchSize = isDesktop ? 80 : 40;
  const filterSpecKey = useMemo(
    () =>
      fields
        .filter((field) => specs[field])
        .map((field) => `${field}=${specs[field]}`)
        .join('|'),
    [fields, specs],
  );
  const skippedKey = useMemo(() => Array.from(skipped).sort().join('|'), [skipped]);
  const filterField = search ? null : curField;
  const includeFilterItems = Boolean(search || !curField);
  const filterAutoAdvance = Boolean(!search && curField);
  const filterResetKey = `${slug || ''}:${search}:${filterSpecKey}:${skippedKey}:${filterField || ''}`;
  const [resultPageSize, setResultPageSize] = useState(resultBatchSize);
  const suppressAutoAdvanceScrollRef = useRef(false);
  const pendingAutoAdvanceScrollRef = useRef(false);

  useEffect(() => {
    setResultPageSize(resultBatchSize);
  }, [filterResetKey, resultBatchSize]);

  const {
    data: filterData,
    isLoading,
    isValidating,
    error: filterError,
    mutate: retryFilter,
  } = useSWR(
    liveCat
      ? [
          'sel-filter',
          liveCat.slug,
          filterSpecKey,
          skippedKey,
          filterField || '',
          search,
          includeFilterItems,
          filterAutoAdvance,
          resultPageSize,
        ]
      : null,
    () =>
      filterSelectionProducts(liveCat!.slug, {
        specs,
        field: filterField,
        search,
        skipped: Array.from(skipped),
        autoAdvance: filterAutoAdvance,
        page: 1,
        pageSize: resultPageSize,
        includeItems: includeFilterItems,
      }),
    { revalidateOnFocus: false, keepPreviousData: true },
  );
  const filterBusy = Boolean(liveCat && (isLoading || isValidating));
  const [showFilterLoading, setShowFilterLoading] = useState(false);
  const shouldShowFilterLoading = Boolean(filterBusy && (showFilterLoading || !filterData));
  const shouldOverlayFilterLoading = Boolean(filterBusy && showFilterLoading && filterData);
  useEffect(() => {
    if (!filterBusy) {
      setShowFilterLoading(false);
      return;
    }
    setShowFilterLoading(false);
    const timer = window.setTimeout(() => setShowFilterLoading(true), 180);
    return () => window.clearTimeout(timer);
  }, [filterBusy, filterResetKey]);

  useEffect(() => {
    if (!filterBusy) setPendingOptionKey(null);
  }, [filterBusy, filterResetKey]);

  useEffect(() => {
    if (!filterData?.autoAdvanced?.length) return;
    const nextSpecs = filterData.resolvedSpecs ?? specs;
    const nextSkipped = new Set(filterData.resolvedSkipped ?? []);
    const specsChanged = stableJson(nextSpecs) !== stableJson(specs);
    const skippedChanged = stableJson(Array.from(nextSkipped).sort()) !== stableJson(Array.from(skipped).sort());
    if (!specsChanged && !skippedChanged) return;
    suppressAutoAdvanceScrollRef.current = true;
    pendingAutoAdvanceScrollRef.current = true;
    startTransition(() => {
      if (specsChanged) setSpecs(nextSpecs);
      if (skippedChanged) setSkipped(nextSkipped);
      setAutoSelectedFields((prev) => {
        const next = new Set(prev);
        for (const item of filterData.autoAdvanced ?? []) {
          if (item.reason === 'single' && item.field) next.add(item.field);
        }
        for (const field of Object.keys(nextSpecs)) {
          if (!nextSpecs[field]) next.delete(field);
        }
        return next;
      });
    });
  }, [filterData?.autoAdvanced, filterData?.resolvedSpecs, filterData?.resolvedSkipped, specs, skipped]);

  const filtered = useMemo(() => filterData?.items ?? [], [filterData?.items]);
  const filteredTotal = filterData?.total ?? 0;
  const categoryProductCount = liveCat?.productCount ?? 0;

  const options = useMemo(() => {
    if (!curField) return [];
    if (manualFields.has(curField)) return [];
    const entries = (filterData?.options ?? []).map(({ val, count }) => [val, count] as const);
    // Get sortType from column definition
    const colDef = columns.find((c) => c.key === curField);
    const sortType = colDef?.sortType;
    // Use custom optionOrder if defined
    const savedOrderRaw = (liveCat?.optionOrder as Record<string, string[] | string>)?.[curField];
    const savedOrder = Array.isArray(savedOrderRaw) ? savedOrderRaw : [];
    if (savedOrder && savedOrder.length > 0) {
      const orderMap = new Map(savedOrder.map((v, i) => [v, i]));
      entries.sort((a, b) => {
        const ia = orderMap.get(a[0]) ?? Infinity;
        const ib = orderMap.get(b[0]) ?? Infinity;
        if (ia !== ib) return ia - ib;
        return compareOptionValues(sortType, a[0], b[0], business.threadPriority);
      });
    } else {
      entries.sort((a, b) => compareOptionValues(sortType, a[0], b[0], business.threadPriority));
    }
    return entries.map(([val, count]) => ({ val, count }));
  }, [filterData?.options, curField, liveCat?.optionOrder, columns, manualFields, business.threadPriority]);
  const currentStepOptionCount = useMemo(() => {
    if (!curField) return null;
    const colDef = columns.find((c) => c.key === curField);
    if (isManualColumn(colDef)) return null;
    if (isPresetColumn(colDef)) return colDef?.presetOptions?.length ?? 0;
    return options.length;
  }, [columns, curField, options.length]);
  const currentStepOptionCountText =
    currentStepOptionCount === null
      ? t('selectionPage.manualInput')
      : filterBusy && !isPresetColumn(columns.find((c) => c.key === curField))
        ? t('selectionPage.matching')
        : t('selectionPage.optionCount', { count: currentStepOptionCount.toLocaleString() });

  const visibleFiltered = filtered;
  const remainingResultCount = Math.max(filteredTotal - visibleFiltered.length, 0);
  const hasMoreResults = remainingResultCount > 0;
  const loadMoreResults = useCallback(() => {
    setResultPageSize((count) => Math.min(count + resultBatchSize, filteredTotal || count + resultBatchSize));
  }, [filteredTotal, resultBatchSize]);
  const visibleModelNos = useMemo(
    () => Array.from(new Set(visibleFiltered.map((p) => p.modelNo).filter(Boolean) as string[])),
    [visibleFiltered],
  );
  const shouldLoadModelMatches = Boolean(search || !curField);
  const { data: modelMatchMap = {} } = useSWR(
    shouldLoadModelMatches && visibleModelNos.length ? ['sel-model-matches', visibleModelNos.join('|')] : null,
    () => getSelectionModelMatches(visibleModelNos),
    { revalidateOnFocus: false },
  );
  const withVisibleMatch = useCallback(
    (product: SelectionProduct) => {
      const matched = product.modelNo ? modelMatchMap[product.modelNo] : undefined;
      if (!matched) return product;
      return { ...product, matchedModelId: matched.id, matchedModelThumbnail: matched.thumbnailUrl };
    },
    [modelMatchMap],
  );
  const applyVisibleManualSpecs = useCallback(
    (product: SelectionProduct) =>
      applyManualSpecs(withVisibleMatch(product), columns, specs, {
        formatGeneratedOutletName: (routeIndex) => t('selectionResult.generatedOutlet', { index: routeIndex }),
      }),
    [columns, specs, t, withVisibleMatch],
  );
  /* auto-scroll ref */
  const curStepRef = useRef<HTMLDivElement>(null);
  const wizardWrapRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const mobileMainRef = useRef<HTMLElement>(null);
  const lastUserScrollAtRef = useRef(0);
  const resultRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryNavigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepScrollIntentRef = useRef<'top' | null>(null);

  /* track user-initiated undo to suppress immediate auto-skip */
  const userUndoRef = useRef(false);

  /* auto-skip preset columns whose dependsOn condition is not met */
  useEffect(() => {
    if (!curField) return;
    const colDef = columns.find((c) => c.key === curField);
    if (!colDef?.dependsOn) return;
    const countValue = Number(specs[colDef.dependsOn.field]) || 0;
    if (countValue >= colDef.dependsOn.minIndex) return;
    startTransition(() => {
      setSkipped((p) => new Set(p).add(curField));
    });
  }, [curField, columns, specs]);

  /* auto-skip: single-value params get auto-selected; zero-option params get skipped */
  useEffect(() => {
    if (filterAutoAdvance) return;
    if (isLoading || search || !curField) return;
    if (manualFields.has(curField)) return;
    const colDef = columns.find((c) => c.key === curField);
    if (options.length === 0 && filteredTotal > 0 && colDef?.required !== true) {
      // Some product rows do not have every column. Skip empty columns instead of trapping users on a dead step.
      suppressAutoAdvanceScrollRef.current = true;
      pendingAutoAdvanceScrollRef.current = true;
      startTransition(() => {
        setSkipped((p) => new Set(p).add(curField));
      });
      return;
    }
    if (userUndoRef.current) {
      // After user manually undoes, suppress auto-select for one cycle so they can re-choose
      userUndoRef.current = false;
      return;
    }
    if (options.length === 1 && colDef?.autoSelectSingle !== false) {
      suppressAutoAdvanceScrollRef.current = true;
      pendingAutoAdvanceScrollRef.current = true;
      startTransition(() => {
        setSpecs((p) => ({ ...p, [curField]: options[0].val }));
        setAutoSelectedFields((p) => new Set(p).add(curField));
      });
    }
  }, [curField, options, search, isLoading, filteredTotal, manualFields, columns, filterAutoAdvance]);

  useEffect(() => {
    if (!filterAutoAdvance) return;
    if (isLoading || search || !curField) return;
    if (manualFields.has(curField)) return;
    const colDef = columns.find((c) => c.key === curField);
    if (options.length === 1 && colDef?.autoSelectSingle !== false) {
      suppressAutoAdvanceScrollRef.current = true;
      pendingAutoAdvanceScrollRef.current = true;
      startTransition(() => {
        setSpecs((p) => ({ ...p, [curField]: options[0].val }));
        setAutoSelectedFields((p) => new Set(p).add(curField));
      });
      return;
    }
    if (colDef?.required === true) return;
    if (options.length > 0 || filteredTotal <= 0) return;
    suppressAutoAdvanceScrollRef.current = true;
    pendingAutoAdvanceScrollRef.current = true;
    startTransition(() => {
      setSkipped((p) => new Set(p).add(curField));
    });
  }, [columns, curField, filterAutoAdvance, filteredTotal, isLoading, manualFields, options, search]);

  /* auto-scroll to current step — desktop uses container.scrollTo to avoid sidebar shift */

  /* 移动端吸顶头（标题+搜索框+已选条，约 176px）会整块盖住滚动定位的目标元素
     （一整排图片选项卡的高度），滚动 target 需减去头在滚动容器里的实际高度。
     桌面端标题在滚动容器外，返回 0 不影响。 */
  const stickyHeaderOffset = (container: HTMLElement) => {
    if (isDesktop) return 0;
    const header = container.parentElement?.querySelector<HTMLElement>('[data-sticky-header]');
    if (!header) return 0;
    const offset = header.getBoundingClientRect().bottom - container.getBoundingClientRect().top;
    return offset > 0 ? offset : 0;
  };

  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (search) return;
    if (!curField) return;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    /* 复核兜底：定位计算时选项图片等异步内容可能还没加载，步骤高度随后变化会把
       标题顶出容器上沿（短视口下「选择XX」只剩半行字被裁切）。初次滚动完成后再
       量一次，越界则立即重新顶对齐。 */
    const recheckStepTop = (delayMs: number) => {
      scrollTimerRef.current = setTimeout(() => {
        const container = scrollContainerRef.current || mobileMainRef.current;
        const el = curStepRef.current || wizardWrapRef.current;
        if (!container || !el) return;
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        if (eRect.top < cRect.top + 4) {
          const target = eRect.top - cRect.top + container.scrollTop - stickyHeaderOffset(container) - 8;
          container.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
        }
      }, delayMs);
    };
    const shouldScrollStepToTop = stepScrollIntentRef.current === 'top';
    if (shouldScrollStepToTop) {
      stepScrollIntentRef.current = null;
      suppressAutoAdvanceScrollRef.current = false;
      scrollTimerRef.current = setTimeout(() => {
        const container = scrollContainerRef.current || mobileMainRef.current;
        const el = curStepRef.current || wizardWrapRef.current;
        if (!container || !el) return;
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const target = eRect.top - cRect.top + container.scrollTop - stickyHeaderOffset(container) - 8;
        container.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
        recheckStepTop(isDesktop ? 350 : 150);
      }, 0);
      return () => {
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      };
    }
    if (suppressAutoAdvanceScrollRef.current) {
      suppressAutoAdvanceScrollRef.current = false;
      /* 被抑制的自动滚动（桌面掉选回退正是这条路径：E1 被抑制、E2 因 pending=false
         跳过 → 没有任何 effect 滚动；结果区卸载把 scrollHeight 收窄、浏览器把
         scrollTop 强制收窄的残留位置会把步骤标题留在折叠线上方，短视口下
         「选择XX」字被裁一半）。兜底：步骤在视口外才顶对齐拉回，正常情况零副作用。 */
      scrollTimerRef.current = setTimeout(
        () => {
          const container = scrollContainerRef.current || mobileMainRef.current;
          const el = curStepRef.current || wizardWrapRef.current;
          if (!container || !el) return;
          const cRect = container.getBoundingClientRect();
          const eRect = el.getBoundingClientRect();
          if (eRect.top < cRect.top + 4) {
            const target = eRect.top - cRect.top + container.scrollTop - stickyHeaderOffset(container) - 8;
            container.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
          }
        },
        isDesktop ? 260 : 120,
      );
      return () => {
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      };
    }
    scrollTimerRef.current = setTimeout(
      () => {
        const el = curStepRef.current;
        if (!el) return;
        const container = scrollContainerRef.current || mobileMainRef.current;
        if (container) {
          const cRect = container.getBoundingClientRect();
          const eRect = el.getBoundingClientRect();
          // 桌面默认居中当前步骤；但步骤比视口还高时（如带选项大图的「接头形态」）
          // 居中会落到步骤中间 —— 改为顶端对齐，保证看到步骤标题
          const tallStep = eRect.height >= cRect.height - 16;
          const target =
            isDesktop && !tallStep
              ? eRect.top - cRect.top + container.scrollTop - cRect.height / 2 + eRect.height / 2
              : eRect.top - cRect.top + container.scrollTop - stickyHeaderOffset(container) - 8;
          container.scrollTo({ top: Math.max(0, target), behavior: isDesktop ? 'smooth' : 'auto' });
          recheckStepTop(isDesktop ? 550 : 150);
        } else {
          wizardWrapRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
      },
      isDesktop ? 200 : 60,
    );
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [curField, search, isDesktop]);

  const autoAdvanceScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!pendingAutoAdvanceScrollRef.current || search || phase !== 'wizard' || isLoading) return;
    if (!curField) {
      pendingAutoAdvanceScrollRef.current = false;
      return;
    }

    const colDef = curField ? columns.find((c) => c.key === curField) : undefined;
    const isManual = curField ? manualFields.has(curField) : false;
    const willAutoConfirm = Boolean(
      curField && !isManual && options.length === 1 && colDef?.autoSelectSingle !== false,
    );
    const willAutoSkip = Boolean(
      curField && !isManual && options.length === 0 && filteredTotal > 0 && colDef?.required !== true,
    );
    if (willAutoConfirm || willAutoSkip) return;

    if (autoAdvanceScrollTimerRef.current) clearTimeout(autoAdvanceScrollTimerRef.current);
    autoAdvanceScrollTimerRef.current = setTimeout(
      () => {
        const el = curStepRef.current;
        if (!el) return;

        const container = scrollContainerRef.current || mobileMainRef.current;
        if (container) {
          const cRect = container.getBoundingClientRect();
          const eRect = el.getBoundingClientRect();
          // 同上：超高步骤不做居中，否则滚到步骤中间
          const tallStep = eRect.height >= cRect.height - 16;
          const target =
            isDesktop && !tallStep
              ? eRect.top - cRect.top + container.scrollTop - cRect.height / 2 + eRect.height / 2
              : eRect.top - cRect.top + container.scrollTop - stickyHeaderOffset(container) - 8;
          container.scrollTo({ top: Math.max(0, target), behavior: isDesktop ? 'smooth' : 'auto' });
          /* 复核兜底（桌面掉选回退走的就是这条路径）：居中公式在步骤卡片被异步选项
             图片撑高前测量会过冲，把「选择XX」标题滚出容器上沿（短视口下字被裁一半）。
             smooth 完成后量一次，越界立即重新顶对齐。 */
          autoAdvanceScrollTimerRef.current = setTimeout(
            () => {
              const el2 = curStepRef.current;
              const c2 = scrollContainerRef.current || mobileMainRef.current;
              if (!el2 || !c2) return;
              const cr = c2.getBoundingClientRect();
              const er = el2.getBoundingClientRect();
              if (er.top < cr.top + 4) {
                const t = er.top - cr.top + c2.scrollTop - stickyHeaderOffset(c2) - 8;
                c2.scrollTo({ top: Math.max(0, t), behavior: 'auto' });
              }
            },
            isDesktop ? 550 : 150,
          );
        } else {
          wizardWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        pendingAutoAdvanceScrollRef.current = false;
      },
      isDesktop ? 140 : 60,
    );

    return () => {
      if (autoAdvanceScrollTimerRef.current) clearTimeout(autoAdvanceScrollTimerRef.current);
    };
  }, [columns, curField, filteredTotal, isDesktop, isLoading, manualFields, options.length, phase, search]);

  useEffect(() => {
    const markUserScroll = () => {
      lastUserScrollAtRef.current = Date.now();
    };
    window.addEventListener('wheel', markUserScroll, { passive: true });
    window.addEventListener('touchstart', markUserScroll, { passive: true });
    return () => {
      window.removeEventListener('wheel', markUserScroll);
      window.removeEventListener('touchstart', markUserScroll);
    };
  }, []);

  useEffect(() => {
    if (search || curField || phase !== 'wizard' || isLoading || filteredTotal <= 0) return;
    if (resultRevealTimerRef.current) clearTimeout(resultRevealTimerRef.current);
    resultRevealTimerRef.current = setTimeout(() => {
      if (Date.now() - lastUserScrollAtRef.current < 260) return;
      const el = resultRef.current;
      if (!el) return;

      const container = scrollContainerRef.current || mobileMainRef.current;
      if (container) {
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const target = eRect.top - cRect.top + container.scrollTop - stickyHeaderOffset(container) - 18;
        container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      } else {
        wizardWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 120);

    return () => {
      if (resultRevealTimerRef.current) clearTimeout(resultRevealTimerRef.current);
    };
  }, [curField, filteredTotal, filterSpecKey, isDesktop, isLoading, phase, search, skippedKey]);

  /* handlers */
  const scheduleCategoryNavigation = useCallback((applyChange: () => void, delayMs = 0) => {
    if (categoryNavigationTimerRef.current) window.clearTimeout(categoryNavigationTimerRef.current);
    categoryNavigationTimerRef.current = window.setTimeout(() => {
      categoryNavigationTimerRef.current = null;
      startTransition(applyChange);
    }, delayMs);
  }, []);

  useEffect(() => {
    return () => {
      if (categoryNavigationTimerRef.current) window.clearTimeout(categoryNavigationTimerRef.current);
    };
  }, []);

  const pickGroup = useCallback(
    (id: string) => {
      setPressedCategoryKey(`group:${id}`);
      scheduleCategoryNavigation(
        () => {
          setGroupId(id);
          setSlug(null);
          setSpecs({});
          setManualDrafts({});
          setSkipped(new Set());
          setAutoSelectedFields(new Set());
          setSearchDraft('');
          setExpandedKits(new Set());
        },
        isDesktop ? 0 : 32,
      );
      window.setTimeout(() => setPressedCategoryKey(null), isDesktop ? 220 : 360);
    },
    [isDesktop, scheduleCategoryNavigation, setSearchDraft],
  );
  const pickSub = useCallback(
    (s: string) => {
      setPressedCategoryKey(`sub:${s}`);
      suppressAutoAdvanceScrollRef.current = true;
      pendingAutoAdvanceScrollRef.current = false;
      scheduleCategoryNavigation(
        () => {
          pushRecent(s);
          setSlug(s);
          setSpecs({});
          setManualDrafts({});
          setSkipped(new Set());
          setAutoSelectedFields(new Set());
          setSearchDraft('');
          setExpandedKits(new Set());
        },
        isDesktop ? 0 : 32,
      );
      window.setTimeout(() => setPressedCategoryKey(null), isDesktop ? 220 : 360);
    },
    [isDesktop, scheduleCategoryNavigation, setSearchDraft],
  );
  const goToGroupCategories = useCallback(() => {
    setSlug(null);
    setSpecs({});
    setManualDrafts({});
    setSkipped(new Set());
    setAutoSelectedFields(new Set());
    setSearchDraft('');
    setExpandedKits(new Set());
  }, [setSearchDraft]);
  const resetCurrentCategory = useCallback(() => {
    // 清空后回到第一个步骤：显式「回顶」意图，避免桌面居中公式把带大图的高步骤滚到中间
    stepScrollIntentRef.current = 'top';
    pendingAutoAdvanceScrollRef.current = false;
    setSpecs({});
    setManualDrafts({});
    setSkipped(new Set());
    setAutoSelectedFields(new Set());
    setSearchDraft('');
    setExpandedKits(new Set());
    // 兜底直接回顶（curField 未变化时自动滚动 effect 不会重跑；与意图路径滚动目标一致，重复无害）
    window.setTimeout(() => {
      const el = wizardWrapRef.current || curStepRef.current;
      const container = scrollContainerRef.current || mobileMainRef.current;
      if (!el) return;
      if (container) {
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        container.scrollTo({ top: Math.max(0, eRect.top - cRect.top + container.scrollTop - 8), behavior: 'auto' });
      } else {
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    }, 40);
  }, [setSearchDraft]);
  const pickVal = useCallback((key: string, val: string) => {
    setPendingOptionKey(`${key}:${val}`);
    setAutoSelectedFields((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    startTransition(() => {
      setSpecs((p) => ({ ...p, [key]: val }));
    });
  }, []);
  const dropVal = useCallback(
    (key: string) => {
      userUndoRef.current = true;
      if (!isDesktop) {
        stepScrollIntentRef.current = 'top';
        pendingAutoAdvanceScrollRef.current = false;
      }
      setSpecs((prev) => {
        const keys = Object.keys(prev);
        const i = keys.indexOf(key);
        const next: Record<string, string> = {};
        for (let j = 0; j < i; j++) next[keys[j]] = prev[keys[j]];
        return next;
      });
      setAutoSelectedFields((prev) => {
        const next = new Set<string>();
        const keys = Object.keys(specs);
        const i = keys.indexOf(key);
        for (let j = 0; j < i; j++) {
          if (prev.has(keys[j])) next.add(keys[j]);
        }
        return next;
      });
      setSkipped(new Set());
      setSearchDraft('');
    },
    [isDesktop, specs, setSearchDraft],
  );
  const goHome = useCallback(() => {
    startTransition(() => {
      setGroupId(null);
      setSlug(null);
      setSpecs({});
      setManualDrafts({});
      setSkipped(new Set());
      setAutoSelectedFields(new Set());
      setSearchDraft('');
      setExpandedKits(new Set());
    });
  }, [setSearchDraft]);
  const restart = useCallback(() => {
    // 重新选择：同 resetCurrentCategory，清空后回顶
    stepScrollIntentRef.current = 'top';
    pendingAutoAdvanceScrollRef.current = false;
    startTransition(() => {
      setSpecs({});
      setManualDrafts({});
      setSkipped(new Set());
      setAutoSelectedFields(new Set());
      setSearchDraft('');
      setExpandedKits(new Set());
    });
    window.setTimeout(() => {
      const el = wizardWrapRef.current || curStepRef.current;
      const container = scrollContainerRef.current || mobileMainRef.current;
      if (!el) return;
      if (container) {
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        container.scrollTo({ top: Math.max(0, eRect.top - cRect.top + container.scrollTop - 8), behavior: 'auto' });
      } else {
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    }, 120);
  }, []);
  const toggleInquiryProduct = useCallback(
    (product: SelectionProduct) => {
      const result = inquiryCart.toggleProduct(product);
      if (result.limitReached) {
        toast(t('selectionPage.cart.limitReached', { limit: inquiryCart.limit }), 'error');
      } else if (result.added) {
        // 询价关闭时清单仅用于批量导出，提示文案区分
        toast(t(canInquiry ? 'selectionPage.cart.added' : 'selectionPage.cart.addedExport'), 'success');
      }
    },
    [canInquiry, inquiryCart, t, toast],
  );
  // 询价关闭场景：把选中清单导出为 Excel（型号/名称/数量/单位 + 参数列并集）
  const handleExportSelected = useCallback(async () => {
    const items = inquiryCart.items;
    if (!items.length) return;
    try {
      const { default: writeXlsxFile } = await import('write-excel-file/browser');
      // 只导核心四列（型号/名称/数量/单位），不带参数列；
      // 名称剥掉型号的「所有」出现（历史数据常以「系列号 描述 完整型号」结尾，不剥会和型号列重复）
      const headers = ['型号', '名称', '数量', '单位'];
      const rows = items.map((it) => {
        let name = it.productName || '';
        if (it.modelNo) {
          const escaped = it.modelNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          name =
            name
              .replace(new RegExp(escaped, 'gi'), ' ')
              .replace(/[\s\-—_]+/g, ' ')
              .trim() || it.productName;
        }
        return [it.modelNo || '', name, it.qty, it.unit || ''];
      });
      const stamp = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const fileName = `选型清单_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.xlsx`;
      await writeXlsxFile([headers, ...rows], { sheet: t('selectionPage.inquiryCart.exportTitle') }).toFile(fileName);
      toast(t('selectionPage.inquiryCart.exportedCount', { count: items.length }), 'success');
    } catch {
      toast(t('selectionPage.inquiryCart.exportFailed'), 'error');
    }
  }, [inquiryCart.items, t, toast]);
  const toggleKit = useCallback(
    (id: string) =>
      setExpandedKits((p) => {
        const n = new Set(p);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );

  /* ── share handler ── */
  const [sharingTarget, setSharingTarget] = useState<ShareTarget | null>(null);
  const [shareLinkDialog, setShareLinkDialog] = useState<ShareLinkDialogState | null>(null);
  const nativeSharePendingRef = useRef(false);
  const [nativeSharePending, setNativeSharePending] = useState(false);

  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginDialogReason, setLoginDialogReason] = useState('');

  function requireLogin(reason: string) {
    setLoginDialogReason(reason);
    setLoginDialogOpen(true);
  }

  const copyShareLink = useCallback(
    async (
      url: string,
      {
        title,
        description,
        copiedMessage = t('selectionPage.share.copied'),
        showDialogFirst = false,
      }: {
        title: string;
        description: string;
        copiedMessage?: string;
        showDialogFirst?: boolean;
      },
    ) => {
      if (showDialogFirst) {
        setShareLinkDialog({ title, description, url });
        toast(t('selectionPage.share.created'), 'success');
        return true;
      }
      try {
        await copyText(url);
        toast(copiedMessage, 'success');
        return true;
      } catch (error) {
        if (import.meta.env.DEV) console.warn('[Share] Copy failed:', error);
        setShareLinkDialog({ title, description, url });
        toast(t('selectionPage.share.createdCopyManually'), 'info');
        return false;
      }
    },
    [t, toast],
  );

  const handleCopyShareDialogLink = useCallback(async () => {
    if (!shareLinkDialog) return;
    try {
      await copyText(shareLinkDialog.url);
      toast(t('selectionPage.share.copied'), 'success');
      setShareLinkDialog(null);
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[Share] Manual copy failed:', error);
      toast(t('selectionPage.share.copyFailedManual'), 'error');
    }
  }, [shareLinkDialog, t, toast]);

  const handleNativeShareDialogLink = useCallback(async () => {
    if (!shareLinkDialog || typeof navigator === 'undefined' || typeof navigator.share !== 'function') return;
    if (nativeSharePendingRef.current) return;

    nativeSharePendingRef.current = true;
    setNativeSharePending(true);
    try {
      await navigator.share({
        title: shareLinkDialog.title,
        url: shareLinkDialog.url,
      });
      setShareLinkDialog(null);
    } catch (error) {
      const errorName = (error as { name?: string })?.name;
      if (errorName === 'AbortError' || errorName === 'InvalidStateError') return;
      if (import.meta.env.DEV) console.warn('[Share] Native share failed:', error);
      toast(t('selectionPage.share.nativeShareFailed'), 'error');
    } finally {
      nativeSharePendingRef.current = false;
      setNativeSharePending(false);
    }
  }, [shareLinkDialog, t, toast]);

  async function handleShare(withResults = false) {
    const path = await buildSelectionShareUrl(withResults);
    if (!path) return;
    await copyShareLink(`${window.location.origin}${path}`, {
      title: withResults ? t('selectionPage.share.resultTitle') : t('selectionPage.share.categoryTitle'),
      description: t('selectionPage.share.description'),
      showDialogFirst: !isDesktop,
    });
  }

  /**
   * 创建选型分享并返回链接（复制到剪贴板由调用方处理）。
   * 工单来源也复用这里：用户从选型结果提交工单时，来源直接指向当前选型结果快照
   * （autoCreated=true，不在用户分享列表中展示）。
   */
  async function buildSelectionShareUrl(withResults: boolean, autoCreated = false): Promise<string | null> {
    if (!slug) return null;
    if (sharingTarget) return null;
    if (!user) {
      requireLogin(t('selectionPage.share.loginReason'));
      return null;
    }
    setSharingTarget(withResults ? 'result' : 'category');
    try {
      const productIds =
        withResults && filteredTotal > 0
          ? (
              await filterSelectionProducts(slug, {
                specs,
                field: null,
                search,
                page: 1,
                pageSize: filteredTotal,
                includeItems: true,
              })
            ).items.map((p) => p.id)
          : [];
      const payload = {
        categorySlug: slug,
        specs: withResults ? specs : {},
        productIds,
        autoCreated,
      };
      const result = await createSelectionShare(payload);
      return `/selection/s/${result.token}`;
    } catch (err: unknown) {
      if (import.meta.env.DEV) console.error('[Share] Error:', err instanceof Error ? err.message : String(err));
      const resp = typeof err === 'object' && err !== null ? (err as Record<string, unknown>).response : undefined;
      const data = typeof resp === 'object' && resp !== null ? (resp as Record<string, unknown>).data : undefined;
      const apiMsg = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).message : undefined;
      const errMsg = err instanceof Error ? err.message : t('selectionPage.unknownError');
      toast(t('selectionPage.share.failed', { message: apiMsg || errMsg }), 'error');
      return null;
    } finally {
      setSharingTarget(null);
    }
  }

  // 工单来源：预创建当前选型结果的分享快照（/selection/s/<token>），
  // 结果卡片跳工单页时直接带上；未登录或创建失败由 ResultCard 回退（模型页/选型首页）。
  // 筛选条件变化（specs/搜索词/分类）即作废旧快照并重建，保证来源始终对应当前结果。
  const ticketSourceUrlRef = useRef<string | null>(null);
  const ticketSourceBuildingRef = useRef(false);
  const ticketSourceScopeRef = useRef<string>('');
  const ticketSourceScope = `${slug ?? ''}|${JSON.stringify(specs)}|${search}`;
  if (ticketSourceScopeRef.current !== ticketSourceScope) {
    ticketSourceScopeRef.current = ticketSourceScope;
    ticketSourceUrlRef.current = null;
  }
  const prepareTicketSourceUrl = useCallback(() => {
    if (ticketSourceUrlRef.current || ticketSourceBuildingRef.current) return;
    ticketSourceBuildingRef.current = true;
    // autoCreated=true：工单来源快照，不进用户分享列表
    buildSelectionShareUrl(true, true)
      .then((path) => {
        if (path) ticketSourceUrlRef.current = path;
      })
      .catch(() => {})
      .finally(() => {
        ticketSourceBuildingRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildSelectionShareUrl 每次渲染重建，但内部读最新 state，预创建取调用时快照即可
  }, []);
  const getTicketSourceUrl = useCallback(() => ticketSourceUrlRef.current, []);

  // 选型结果出现后预创建工单来源分享快照（用户未登录/分享开关关闭时静默跳过，回退逻辑兜底）
  const hasVisibleResults = visibleFiltered.length > 0;
  useEffect(() => {
    if (hasVisibleResults) prepareTicketSourceUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scope 变化时快照已重置，此处触发重建
  }, [ticketSourceScope, hasVisibleResults]);

  const totalProductCount = useMemo(() => cats.reduce((sum, c) => sum + (c.productCount ?? 0), 0), [cats]);
  const previewImages = [
    "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 120'%3E%3Crect width='160' height='120' rx='18' fill='%23F4F2EF'/%3E%3Cg transform='translate(34 26)' fill='none' stroke='%23D97706' stroke-width='8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M28 20h52'/%3E%3Cpath d='M80 20v44'/%3E%3Cpath d='M28 20v44'/%3E%3Cpath d='M16 64h24'/%3E%3Cpath d='M68 64h24'/%3E%3Cpath d='M44 12h20'/%3E%3C/g%3E%3C/svg%3E",
    "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 120'%3E%3Crect width='160' height='120' rx='18' fill='%23F4F2EF'/%3E%3Cg transform='translate(28 28)' fill='none' stroke='%23D97706' stroke-width='8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='52' cy='34' r='24'/%3E%3Cpath d='M10 34h18'/%3E%3Cpath d='M76 34h18'/%3E%3Cpath d='M52 10V0'/%3E%3Cpath d='M36 0h32'/%3E%3Cpath d='M40 34h24'/%3E%3C/g%3E%3C/svg%3E",
    "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 120'%3E%3Crect width='160' height='120' rx='18' fill='%23F4F2EF'/%3E%3Cg transform='translate(30 22)' fill='none' stroke='%23D97706' stroke-width='8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M16 70C42 18 70 18 96 70'/%3E%3Cpath d='M16 70h24'/%3E%3Cpath d='M72 70h24'/%3E%3Cpath d='M51 20v28'/%3E%3Cpath d='M39 34h24'/%3E%3C/g%3E%3C/svg%3E",
  ];

  const categoryPreviewImage = (seed: string) => {
    let hash = 0;
    for (const ch of seed) hash = (hash + ch.charCodeAt(0)) % previewImages.length;
    return previewImages[hash];
  };

  const categoryMedia = (image: string | null | undefined, icon: string | null | undefined, previewSeed: string) => {
    const mediaImage = image || (previewCategoryImages ? categoryPreviewImage(previewSeed) : '');
    const fallbackIcon = icon || 'inventory_2';

    if (!mediaImage) {
      return (
        <span
          className={
            isDesktop
              ? 'flex aspect-[2/1] w-44 shrink-0 items-center justify-center bg-surface-container-low text-primary-container/40'
              : 'm-2 flex h-14 w-20 shrink-0 items-center justify-center rounded-lg bg-(--selection-thumb-bg) text-primary-container/45'
          }
        >
          <Icon name={fallbackIcon} size={isDesktop ? 32 : 28} />
        </span>
      );
    }

    return (
      <span
        className={
          isDesktop
            ? 'aspect-[2/1] w-44 shrink-0 overflow-hidden'
            : 'm-2 h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-(--selection-thumb-bg)'
        }
      >
        <SafeImage
          src={mediaImage}
          alt=""
          className="h-full w-full object-cover"
          fallbackClassName="bg-surface-container-high"
          fallbackIcon={fallbackIcon}
        />
      </span>
    );
  };

  /* Page chrome is provided by AdminManagementPage so this page follows the same shell as admin/user list pages. */
  const pageHeader = null;

  /* ── group selection ── */
  const categoryStatsUnavailable = (categoriesLoading || categoriesError) && cats.length === 0;
  const categoryGroupCountText = categoryStatsUnavailable ? '—' : groups.length + standaloneCats.length;
  const categoryCountText = categoryStatsUnavailable ? '—' : cats.length;
  const totalProductCountText = categoryStatsUnavailable ? '—' : totalProductCount;
  const selectionStatItems = [
    { label: t('selectionPage.stats.categories'), value: categoryCountText, icon: 'account_tree' },
    { label: t('selectionPage.stats.models'), value: totalProductCountText, icon: 'inventory_2' },
  ];
  const topCategoryItems = useMemo(() => {
    const groupItems = groups.map((g) => {
      const groupImage = g.image || g.children.map((child) => catBySlug.get(child.slug)?.image).find(Boolean) || null;
      return {
        key: `group:${g.id}`,
        type: 'group' as const,
        sortOrder: g.sortOrder,
        active: pressedCategoryKey === `group:${g.id}`,
        image: groupImage,
        icon: g.icon,
        name: g.name,
        description: t('selectionPage.categoryGroupCount', { count: g.children.length }),
        previewSeed: g.id,
        onClick: () => pickGroup(g.id),
      };
    });
    const categoryItems = standaloneCats.map((c) => ({
      key: `cat:${c.id}`,
      type: 'category' as const,
      sortOrder: c.sortOrder,
      active: pressedCategoryKey === `sub:${c.slug}`,
      image: c.image,
      icon: c.icon,
      name: c.name,
      description: t('selectionPage.modelCount', { count: (c.productCount ?? 0).toLocaleString() }),
      previewSeed: c.slug,
      onClick: () => pickSub(c.slug),
    }));
    return [...groupItems, ...categoryItems].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [catBySlug, groups, pickGroup, pickSub, pressedCategoryKey, standaloneCats, t]);
  const subCategoryItems = useMemo(() => {
    if (!group) return [];
    return group.children
      .map((ch, index) => {
        const childCat = catBySlug.get(ch.slug);
        return {
          key: `sub:${ch.slug}`,
          type: 'category' as const,
          sortOrder: childCat?.sortOrder ?? index,
          active: pressedCategoryKey === `sub:${ch.slug}`,
          image: childCat?.image,
          icon: childCat?.icon || ch.icon,
          name: childCat?.name || ch.name,
          description: childCat
            ? t('selectionPage.modelCount', { count: (childCat.productCount ?? 0).toLocaleString() })
            : t('selectionPage.modelPending'),
          previewSeed: ch.slug,
          onClick: () => pickSub(ch.slug),
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [catBySlug, group, pickSub, pressedCategoryKey, t]);
  const categoryColumns = isDesktop ? (isCategoryUltraWide ? 4 : isCategoryWide ? 3 : isCategoryTablet ? 2 : 1) : 1;
  const categoryTitleClass = 'block truncate text-sm font-semibold leading-5 text-on-surface md:text-base';
  const categoryDescriptionClass = 'mt-0.5 block truncate text-xs leading-4 text-on-surface-variant';
  type CategoryRenderItem = (typeof topCategoryItems)[number];
  const categoryItemMotionProps = (index: number) =>
    prefersReducedMotion
      ? { initial: false as const }
      : {
          initial: { opacity: 0, y: 8 },
          whileInView: { opacity: 1, y: 0, scale: 1 },
          viewport: { once: true, amount: 0.25, margin: '-12px 0px -12px 0px' },
          transition: {
            duration: 0.16,
            delay: Math.min((index % categoryColumns) * 0.015, 0.045),
            ease: 'easeOut' as const,
          },
        };
  const mobileCategoryItemMotionProps = prefersReducedMotion
    ? { initial: false as const }
    : {
        initial: { opacity: 0.96, y: 2 },
        animate: { opacity: 1, y: 0 },
        transition: {
          opacity: { duration: 0.16, ease: 'easeOut' as const },
          y: { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.65 },
        },
      };
  const renderCategoryItem = (
    {
      key,
      active,
      image,
      icon,
      name,
      description,
      previewSeed,
      onClick,
    }: {
      key: string;
      active: boolean;
      image?: string | null;
      icon?: string | null;
      name: string;
      description?: string | null;
      previewSeed: string;
      onClick: () => void;
    },
    index: number,
  ) => (
    <motion.button
      key={key}
      onClick={(e) => {
        // 拖动结束派发的 click 一律吞掉（见 categoryTouchStartRef 注释）
        if (swallowCategoryClickRef.current) {
          swallowCategoryClickRef.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClick();
      }}
      onTouchStart={(e) => {
        const touch = e.touches[0];
        if (touch) categoryTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
        swallowCategoryClickRef.current = false;
      }}
      onTouchEnd={(e) => {
        const start = categoryTouchStartRef.current;
        categoryTouchStartRef.current = null;
        if (!start) return;
        const touch = e.changedTouches[0];
        if (!touch) return;
        if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) {
          swallowCategoryClickRef.current = true;
        }
      }}
      data-selection-category-card
      className={isDesktop ? selectionCategoryCardClass(active) : mobileCategoryCardClass(active)}
      // 悬停/按压反馈只给真鼠标：pointerType==='mouse' 才设置 data-mouse-* 属性（样式
      // 见 selectionCategoryCardClass 的 data-[mouse-*] 变体）。iPad/横屏手机虽 ≥768px
      // 走桌面类，但触摸设置不了这些属性——按住滑动零反馈。:hover/:active 伪类和
      // framer-motion whileTap/whileHover 在触摸设备上都会粘在落点卡上，全部不用。
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') e.currentTarget.setAttribute('data-mouse-hover', 'true');
      }}
      onPointerLeave={(e) => e.currentTarget.removeAttribute('data-mouse-hover')}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') e.currentTarget.setAttribute('data-mouse-press', 'true');
      }}
      onPointerUp={(e) => e.currentTarget.removeAttribute('data-mouse-press')}
      onPointerCancel={(e) => e.currentTarget.removeAttribute('data-mouse-press')}
      {...(isDesktop ? categoryItemMotionProps(index) : mobileCategoryItemMotionProps)}
    >
      {categoryMedia(image, icon, previewSeed)}
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 md:px-3.5">
        <div className="min-w-0 flex-1">
          <strong className={categoryTitleClass}>{name}</strong>
          {description ? <small className={categoryDescriptionClass}>{description}</small> : null}
        </div>
        <Icon
          name={active ? 'check' : 'chevron_right'}
          size={17}
          // 变橙同样只给真鼠标：data-mouse-hover 只有 pointerType==='mouse' 能设置，
          // 触摸设备（含 ≥768px 的 iPad/横屏手机）滑动时 :hover 粘在落点也不会变橙
          className="shrink-0 text-on-surface-variant/45 transition-colors group-data-[mouse-hover=true]:text-primary-container"
        />
      </div>
    </motion.button>
  );
  const renderCategoryGrid = (items: CategoryRenderItem[]) => (
    <div className={isDesktop ? selectionCategoryGridClass : mobileCategoryListClass}>
      {items.map((item, index) => renderCategoryItem(item, index))}
    </div>
  );
  const categoryStatusContent =
    categoriesLoading && cats.length === 0 ? (
      <div className="flex min-h-[260px]">
        <PageRefreshIndicator label={t('selectionPage.categories.refreshing')} />
      </div>
    ) : categoriesError && cats.length === 0 ? (
      <div className="text-center py-12">
        <Icon name="error" size={36} className="mx-auto mb-2 text-error/45" />
        <p className="text-sm font-medium text-on-surface">{t('selectionPage.categories.loadFailed')}</p>
        <p className="mt-1 text-xs text-on-surface-variant">{t('selectionPage.categories.loadFailedDescription')}</p>
        <button onClick={() => void retryCategories()} className="mt-3 text-sm text-primary-container hover:underline">
          {t('selectionPage.retry')}
        </button>
      </div>
    ) : null;

  const groupContent = (
    <div className={isDesktop ? selectionCategoryPanelClass : mobileCategoryPanelClass}>
      {categoryStatusContent}
      {!categoryStatusContent && topCategoryItems.length > 0 && renderCategoryGrid(topCategoryItems)}
      {!categoryStatusContent && groups.length === 0 && standaloneCats.length === 0 && (
        <div className="text-center py-10">
          <Icon name="inventory_2" size={40} className="mx-auto mb-3 text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">{t('selectionPage.categories.empty')}</p>
        </div>
      )}
    </div>
  );

  /* ── subcategory selection ── */
  async function handleShareSub(chSlug: string) {
    if (sharingTarget) return;
    if (!user) {
      requireLogin(t('selectionPage.share.loginReason'));
      return;
    }
    setSharingTarget('sub');
    try {
      const url = `${window.location.origin}/selection?g=${encodeURIComponent(chSlug)}`;
      await copyShareLink(url, {
        title: t('selectionPage.share.categoryGeneratedTitle'),
        description: t('selectionPage.share.description'),
      });
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[Share] Subcategory link failed:', error);
      toast(t('selectionPage.share.createFailed'), 'error');
    } finally {
      setSharingTarget(null);
    }
  }

  const isEntrySharePending = sharingTarget === 'entry';
  const isCategorySharePending = sharingTarget === 'category';
  const isResultSharePending = sharingTarget === 'result';
  const isSubSharePending = sharingTarget === 'sub';

  const subContent = group && (
    <div className={isDesktop ? selectionCategoryPanelClass : mobileCategoryPanelClass}>
      {renderCategoryGrid(subCategoryItems)}
    </div>
  );

  /* ── wizard steps rendering (shared between desktop split and mobile combined) ── */
  const stepsJSX = fields.map((field, i) => {
    const isCompleted = !!specs[field];
    const isSkipped = skipped.has(field);
    const isCurrent = curField === field;
    const hasMore = i < fields.length - 1;
    const colDef = columns.find((c) => c.key === field);
    const fieldLabel = colDef?.label || field;
    const isManual = isManualColumn(colDef);
    const isPreset = isPresetColumn(colDef);
    const isAutoSelected = autoSelectedFields.has(field);
    // 数值填写列：有内容但不是合法数字（如 "1." / "."）时拦截提交并提示
    const manualDraftValue = String(manualDrafts[field] ?? specs[field] ?? '');
    const manualNumberInvalid =
      isManual &&
      colDef?.valueType === 'number' &&
      manualDraftValue.trim() !== '' &&
      !/^\d+(\.\d+)?$/.test(manualDraftValue.trim());

    if (isCompleted) {
      return (
        <div key={field}>
          <button
            type="button"
            onClick={isAutoSelected ? undefined : () => dropVal(field)}
            disabled={isAutoSelected}
            // 移动端已完成步骤卡不带 hover/按压：iOS 滑动步骤列表时 :hover/:active 会全程
            // 粘在落点卡上（淡橙底变深+缩放，像被选中）；点击取消的确认由卡片消失本身承担
            className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left md:px-4 ${
              isAutoSelected
                ? 'cursor-default border-outline-variant/10 bg-surface-container-low/55 text-on-surface-variant/55'
                : isDesktop
                  ? `border-primary-container/12 bg-primary-container/8 hover:bg-primary-container/15 ${selectionPress}`
                  : 'border-primary-container/12 bg-primary-container/8'
            }`}
          >
            <div
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full md:h-6 md:w-6 ${
                isAutoSelected ? 'bg-on-surface-variant/10' : 'bg-primary-container/25'
              }`}
            >
              <Icon
                name="check"
                size={12}
                className={isAutoSelected ? 'text-on-surface-variant/35' : 'text-primary-container'}
              />
            </div>
            <span
              className={`shrink-0 text-xs sm:text-sm ${
                isAutoSelected ? 'text-on-surface-variant/45' : 'text-on-surface-variant'
              }`}
            >
              {fieldLabel}:
            </span>
            <span
              className={`truncate text-xs font-bold sm:text-sm ${
                isAutoSelected ? 'text-on-surface-variant/55' : 'text-on-surface'
              }`}
            >
              {specs[field]}
            </span>
            {isAutoSelected ? (
              <span className="ml-auto shrink-0 rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-medium text-on-surface-variant/45">
                {t('selectionPage.autoSelected')}
              </span>
            ) : (
              <Icon name="close" size={12} className="ml-auto shrink-0 text-on-surface-variant/30" />
            )}
          </button>
          {hasMore && (
            <div
              className={`ml-5 h-3 w-px md:ml-6 ${isAutoSelected ? 'bg-outline-variant/8' : 'bg-primary-container/20'}`}
            />
          )}
        </div>
      );
    }

    if (isSkipped) {
      return (
        <div key={field}>
          <div className="flex items-center gap-2.5 px-3 md:px-4 py-2.5 bg-surface-container-low/50 rounded-lg">
            <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-on-surface-variant/10 flex items-center justify-center shrink-0">
              <Icon name="remove" size={10} className="text-on-surface-variant/30" />
            </div>
            <span className="text-xs sm:text-sm text-on-surface-variant/30 line-through">{fieldLabel}</span>
            <span className="text-[10px] text-on-surface-variant/20 ml-1">{t('selectionPage.notApplicable')}</span>
          </div>
          {hasMore && <div className="w-px h-2 bg-on-surface-variant/5 ml-5 md:ml-6" />}
        </div>
      );
    }

    if (isCurrent) {
      return (
        <div key={field} ref={curStepRef}>
          <div className="rounded-2xl border-2 border-primary-container/30 bg-surface-container-low overflow-hidden shadow-sm">
            <div className="px-4 sm:px-5 py-4 sm:py-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-primary-container text-on-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-on-surface">
                    {t('selectionPage.chooseField', { field: fieldLabel })}
                  </h3>
                </div>
                <span className="text-xs text-on-surface-variant bg-surface-container-high px-2.5 py-1 rounded-full shrink-0">
                  {currentStepOptionCountText}
                </span>
              </div>
              {isManual ? (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (manualNumberInvalid) return;
                    const value = normalizeManualValue(colDef, manualDrafts[field] ?? specs[field] ?? '');
                    if (value) pickVal(field, value);
                  }}
                >
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <input
                        name="manual-drafts"
                        value={manualDrafts[field] ?? specs[field] ?? ''}
                        onChange={(e) => {
                          // 数值列只保留数字和一个小数点，其余输入即时丢弃
                          const next =
                            colDef?.valueType === 'number'
                              ? e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
                              : e.target.value;
                          setManualDrafts((prev) => ({ ...prev, [field]: next }));
                        }}
                        inputMode={colDef?.valueType === 'number' ? 'decimal' : undefined}
                        placeholder={colDef?.placeholder || t('selectionPage.manualPlaceholder', { field: fieldLabel })}
                        className={`w-full rounded-xl border bg-surface-container px-3 sm:px-4 py-2.5 pr-12 text-sm text-on-surface outline-none focus:border-primary-container transition-colors ${
                          manualNumberInvalid ? 'border-error/60' : 'border-outline-variant/20'
                        }`}
                      />
                      {colDef?.suffix && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant">
                          {colDef.suffix}
                        </span>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={!String(manualDrafts[field] ?? specs[field] ?? '').trim() || manualNumberInvalid}
                      className="rounded-xl bg-primary-container px-4 py-2.5 text-sm font-bold text-on-primary disabled:opacity-40"
                    >
                      {t('common.confirm')}
                    </button>
                  </div>
                  {manualNumberInvalid ? (
                    <p className="text-xs text-error">{t('selectionPage.manualNumberInvalid')}</p>
                  ) : (
                    <p className="text-xs text-on-surface-variant">{t('selectionPage.manualNote')}</p>
                  )}
                </form>
              ) : isPreset ? (
                <div className="flex flex-wrap gap-2">
                  {(colDef?.presetOptions || []).map((opt) => {
                    const optionKey = `${field}:${opt}`;
                    const pending = pendingOptionKey === optionKey;
                    return (
                      <button
                        key={opt}
                        onClick={() => pickVal(field, opt)}
                        disabled={pendingOptionKey !== null}
                        // 移动端不带 active:scale/hover：滑动选项列表时 :active 会全程粘在落点
                        // 按钮上（缩小状态保持到抬手才弹回）；点击确认由 pending/选中样式承担
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all disabled:cursor-wait disabled:opacity-80 ${isDesktop ? 'active:scale-[0.97]' : ''} ${
                          pending
                            ? 'border-primary-container/45 bg-primary-container/10 text-primary-container shadow-sm'
                            : `border-outline-variant/20 bg-surface-container-low text-on-surface ${isDesktop ? 'hover:border-primary-container/40' : ''}`
                        }`}
                      >
                        {pending ? <Icon name="refresh" size={13} className="animate-spin" /> : null}
                        {opt}
                      </button>
                    );
                  })}
                </div>
              ) : shouldShowFilterLoading ? (
                <SelectionInlineLoading label={t('selectionPage.loadingOptions')} />
              ) : options.length > 0 ? (
                (() => {
                  const fieldImages = liveCat?.optionImages?.[field];
                  const hasFieldImages = fieldImages && Object.keys(fieldImages).length > 0;
                  const displayMode = colDef?.optionDisplay || 'auto';
                  return displayMode === 'image' || (displayMode === 'auto' && hasFieldImages);
                })() ? (
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${isDesktop ? 130 : 100}px, 1fr))` }}
                  >
                    {options.map(({ val }) => {
                      const uploadedImg = liveCat?.optionImages?.[field]?.[val];
                      const selected = specs[field] === val;
                      const optionKey = `${field}:${val}`;
                      const pending = pendingOptionKey === optionKey;
                      return (
                        <button
                          key={val}
                          onClick={() => pickVal(field, val)}
                          disabled={pendingOptionKey !== null}
                          // 移动端不带 active:scale/选中放大/hover：滑动列表时 :active 会粘在落点
                          // 卡上全程缩小、抬手弹回（弹跳感）；选中确认由边框+阴影+对勾承担
                          className={`group relative flex flex-col items-stretch rounded-xl border transition-all duration-150 ${isDesktop ? 'active:scale-[0.97]' : ''} ${
                            pending || selected
                              ? `border-primary-container shadow-sm ${isDesktop ? 'scale-[1.02]' : ''}`
                              : `border-outline-variant/20 bg-surface-container-low ${isDesktop ? 'hover:border-primary-container/40' : ''}`
                          } disabled:cursor-wait disabled:opacity-80`}
                        >
                          {/* Image area */}
                          <div
                            className={`relative w-full aspect-square flex items-center justify-center rounded-t-lg overflow-hidden bg-white`}
                          >
                            {uploadedImg ? (
                              <SafeImage
                                src={uploadedImg}
                                alt={val}
                                className="w-[85%] h-[85%] object-contain"
                                fallbackIcon="inventory_2"
                              />
                            ) : (
                              <Icon name="inventory_2" size={28} className="text-on-surface-variant/20" />
                            )}
                            {/* Selected check */}
                            {(selected || pending) && (
                              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary-container flex items-center justify-center">
                                <Icon
                                  name={pending ? 'refresh' : 'check'}
                                  size={14}
                                  className={`text-on-primary ${pending ? 'animate-spin' : ''}`}
                                />
                              </div>
                            )}
                          </div>
                          {/* Label */}
                          <div className="px-2 py-2 text-center">
                            <span className="text-xs sm:text-sm font-medium text-on-surface leading-tight line-clamp-2">
                              {val}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {options.map(({ val }) => {
                      const optionKey = `${field}:${val}`;
                      const pending = pendingOptionKey === optionKey;
                      return (
                        <button
                          key={val}
                          onClick={() => pickVal(field, val)}
                          disabled={pendingOptionKey !== null}
                          // 移动端不带 active:scale/hover（同上：滑动时 :active/:hover 粘滞）
                          className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-all disabled:cursor-wait disabled:opacity-80 sm:px-4 sm:py-2.5 ${isDesktop ? 'active:scale-95' : ''} ${
                            pending
                              ? 'border-primary-container/45 bg-primary-container/10 text-primary-container shadow-sm'
                              : `border-outline-variant/20 bg-surface-container text-on-surface ${isDesktop ? 'hover:border-primary-container/50 hover:bg-primary-container/5' : ''}`
                          }`}
                        >
                          {pending ? <Icon name="refresh" size={13} className="animate-spin" /> : null}
                          <span className="font-medium">{val}</span>
                        </button>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="text-center py-6">
                  <p className="text-sm text-on-surface-variant">
                    {colDef?.required === true
                      ? t('selectionPage.requiredMissingOptions', { field: fieldLabel })
                      : t('selectionPage.noOptions')}
                  </p>
                  {colDef?.required === true ? (
                    <p className="mt-1 text-xs text-on-surface-variant/70">{t('selectionPage.requiredMissingHelp')}</p>
                  ) : null}
                  {specKeys.length > 0 ? (
                    <button
                      onClick={() => dropVal(specKeys[specKeys.length - 1])}
                      className="mt-2 text-sm text-primary-container hover:underline"
                    >
                      {t('selectionPage.backStep')}
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setSlug(null);
                        setSpecs({});
                        setManualDrafts({});
                        setSkipped(new Set());
                        setAutoSelectedFields(new Set());
                      }}
                      className="mt-2 text-sm text-primary-container hover:underline"
                    >
                      {t('selectionPage.backToCategories')}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex h-1">
              {fields.map((_, fi) => (
                <div
                  key={fi}
                  className={`flex-1 transition-colors duration-300 ${specs[fields[fi]] ? 'bg-primary-container' : skipped.has(fields[fi]) ? 'bg-on-surface-variant/10' : 'bg-outline-variant/10'}`}
                />
              ))}
            </div>
          </div>
          {hasMore && <div className="w-px h-3 bg-outline-variant/10 ml-5 md:ml-6" />}
        </div>
      );
    }

    return (
      <div key={field}>
        <div className="flex items-center gap-2.5 px-3 md:px-4 py-2.5 text-on-surface-variant/25">
          <div className="w-5 h-5 md:w-6 md:h-6 rounded-full border border-current flex items-center justify-center text-[10px] shrink-0">
            {i + 1}
          </div>
          <span className="text-xs sm:text-sm">{fieldLabel}</span>
        </div>
        {hasMore && <div className="w-px h-2 bg-outline-variant/8 ml-5 md:ml-6" />}
      </div>
    );
  });

  const isMobileResultView = !isDesktop && phase === 'wizard' && !search && !curField;
  const wizardTransitionKey = search ? `search-${search}` : curField ? `field-${curField}` : 'selection-results';
  const wizardTransition = prefersReducedMotion
    ? ({ initial: false as const } as const)
    : ({
        initial: { opacity: 0, y: isDesktop ? 4 : 3 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: isDesktop ? -3 : -2 },
        transition: { duration: isDesktop ? 0.14 : 0.13, ease: [0.16, 1, 0.3, 1] as const },
      } as const);

  /* ── results block (only rendered when !curField) ── */
  const resultsJSX = !curField && (
    <div ref={resultRef}>
      <div
        className={`flex items-center justify-between ${isMobileResultView ? 'pt-0' : 'mt-4 border-t border-outline-variant/15 pt-3'}`}
      >
        <div>
          <h3 className="text-base font-bold text-on-surface">{t('selectionPage.result.title')}</h3>
          <p className="text-sm text-on-surface-variant mt-0.5">
            {filteredTotal > 0
              ? t('selectionPage.result.matchedCount', { count: filteredTotal.toLocaleString() })
              : t('selectionPage.result.noMatches')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {filteredTotal > 0 && (
            <button
              onClick={() => handleShare(true)}
              disabled={isResultSharePending}
              className={`text-sm text-primary-container hover:underline shrink-0 inline-flex items-center gap-1 disabled:opacity-50 ${selectionPress}`}
            >
              <Icon name="share" size={14} />
              {isResultSharePending ? t('selectionPage.generatingEllipsis') : t('selectionPage.result.generateLink')}
            </button>
          )}
          {specKeys.length > 0 && (
            <button
              onClick={restart}
              className={`text-sm text-on-surface-variant hover:text-primary-container shrink-0 ${selectionPress}`}
            >
              {t('selectionPage.result.restart')}
            </button>
          )}
        </div>
      </div>
      {filteredTotal > 0 ? (
        <div className="relative mt-3 min-h-[220px]">
          <div
            className={`space-y-3 pb-6 transition-opacity duration-150 ${
              shouldOverlayFilterLoading ? 'pointer-events-none select-none opacity-45' : ''
            }`}
          >
            {visibleFiltered.map((p) => {
              const visibleProduct = applyVisibleManualSpecs(p);
              return (
                <ResultCard
                  key={p.id}
                  product={visibleProduct}
                  columns={columns}
                  kitListTitle={getKitListTitle((liveCat?.optionOrder || null) as Record<string, unknown> | null, p)}
                  selected={selectedIds.has(p.id)}
                  onToggleSelect={() => toggleInquiryProduct(visibleProduct)}
                  onToggleInquiry={canInquiry ? () => toggleInquiryProduct(visibleProduct) : undefined}
                  onPrepareSourceUrl={prepareTicketSourceUrl}
                  onBuildSourceUrl={getTicketSourceUrl}
                  expandedKits={expandedKits}
                  onToggleKit={toggleKit}
                  navigate={navigate}
                  isMobile={!isDesktop}
                />
              );
            })}
            {hasMoreResults && (
              <button
                onClick={loadMoreResults}
                className={`w-full rounded-xl border border-outline-variant/20 bg-surface-container px-4 py-2.5 text-sm font-medium text-on-surface-variant hover:border-primary-container/40 hover:text-primary-container ${selectionPress}`}
              >
                {t('selectionPage.result.loadMore', { count: remainingResultCount.toLocaleString() })}
              </button>
            )}
          </div>
          {shouldOverlayFilterLoading ? <SelectionLoadingOverlay label={t('selectionPage.result.arranging')} /> : null}
        </div>
      ) : shouldShowFilterLoading ? (
        <SelectionInlineLoading label={t('selectionPage.result.arranging')} />
      ) : (
        <div className="text-center py-10">
          <Icon name="search_off" size={36} className="mx-auto mb-2 text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">{t('selectionPage.result.noMatches')}</p>
          <button onClick={restart} className="mt-3 text-sm text-primary-container hover:underline">
            {t('selectionPage.result.restart')}
          </button>
        </div>
      )}
    </div>
  );

  /* ── wizard content: non-wizard-step states (loading / empty / search) ── */
  const wizardContent = filterError ? (
    <div className="text-center py-16 px-4">
      <Icon name="error" size={40} className="mx-auto mb-3 text-error/50" />
      <p className="text-sm font-medium text-on-surface">{t('selectionPage.state.loadFailed')}</p>
      <p className="mt-1 text-xs text-on-surface-variant">{t('selectionPage.state.apiUnavailable')}</p>
      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          onClick={() => retryFilter()}
          className="rounded-lg bg-primary-container px-4 py-2 text-sm font-bold text-on-primary hover:opacity-90"
        >
          {t('selectionPage.retry')}
        </button>
        <button
          onClick={() => {
            setSlug(null);
            setSpecs({});
            setManualDrafts({});
            setSkipped(new Set());
            setAutoSelectedFields(new Set());
          }}
          className="rounded-lg border border-outline-variant/30 px-4 py-2 text-sm text-on-surface-variant hover:bg-surface-container-high/50"
        >
          {t('selectionPage.backToCategories')}
        </button>
      </div>
    </div>
  ) : !liveCat || (!search && specKeys.length === 0 && categoryProductCount === 0) ? (
    <div className="text-center py-16">
      <Icon name="inventory_2" size={40} className="mx-auto mb-3 text-on-surface-variant/20" />
      <p className="text-sm text-on-surface">{t('selectionPage.state.categoryEmpty')}</p>
      <button
        onClick={() => {
          setSlug(null);
          setSpecs({});
          setManualDrafts({});
          setSkipped(new Set());
          setAutoSelectedFields(new Set());
        }}
        className="mt-3 text-sm text-primary-container hover:underline"
      >
        {t('selectionPage.state.chooseOtherCategory')}
      </button>
      {user?.role === 'ADMIN' && (
        <Link
          to="/admin/selections"
          className="mt-3 ml-4 inline-flex items-center gap-1 text-xs text-primary-container hover:underline"
        >
          <Icon name="tune" size={14} />
          {t('selectionPage.state.goManage')}
        </Link>
      )}
    </div>
  ) : search ? (
    /* 移动端 px-0 与步骤区同口径：搜索结果卡和标题卡左右对齐（面板透明，内边距只会在移动端造成缩进） */
    <div className="px-0 md:px-6 py-4 md:py-6">
      {pageHeader}
      {filteredTotal > 0 ? (
        <div className="relative min-h-[220px]">
          <div
            className={`space-y-3 pb-4 transition-opacity duration-150 ${
              shouldOverlayFilterLoading ? 'pointer-events-none select-none opacity-45' : ''
            }`}
          >
            {visibleFiltered.map((p) => {
              const visibleProduct = applyVisibleManualSpecs(p);
              return (
                <ResultCard
                  key={p.id}
                  product={visibleProduct}
                  columns={columns}
                  kitListTitle={getKitListTitle((liveCat?.optionOrder || null) as Record<string, unknown> | null, p)}
                  selected={selectedIds.has(p.id)}
                  onToggleSelect={() => toggleInquiryProduct(visibleProduct)}
                  onToggleInquiry={canInquiry ? () => toggleInquiryProduct(visibleProduct) : undefined}
                  onPrepareSourceUrl={prepareTicketSourceUrl}
                  onBuildSourceUrl={getTicketSourceUrl}
                  expandedKits={expandedKits}
                  onToggleKit={toggleKit}
                  navigate={navigate}
                  isMobile={!isDesktop}
                />
              );
            })}
            {hasMoreResults && (
              <button
                onClick={loadMoreResults}
                className={`w-full rounded-xl border border-outline-variant/20 bg-surface-container px-4 py-2.5 text-sm font-medium text-on-surface-variant hover:border-primary-container/40 hover:text-primary-container ${selectionPress}`}
              >
                {t('selectionPage.result.loadMore', { count: remainingResultCount.toLocaleString() })}
              </button>
            )}
          </div>
          {shouldOverlayFilterLoading ? (
            <SelectionLoadingOverlay label={t('selectionPage.result.matchingSearch')} />
          ) : null}
        </div>
      ) : shouldShowFilterLoading ? (
        <SelectionInlineLoading label={t('selectionPage.result.matchingSearch')} />
      ) : (
        <div className="text-center py-12">
          <Icon name="search_off" size={36} className="mx-auto mb-2 text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">{t('selectionPage.result.noSearchMatches')}</p>
        </div>
      )}
    </div>
  ) : null; /* wizard steps + results rendered separately via stepsJSX / resultsJSX */

  /* ── batch action bar ── */
  const actionBar = inquiryCart.items.length > 0 && (
    <div
      ref={cartActionBarRef}
      className={
        isDesktop
          ? 'relative z-10 flex shrink-0 items-center justify-between border-t border-outline-variant/15 bg-surface/95 px-3 py-2 backdrop-blur-sm md:px-4'
          : `fixed inset-x-0 z-[70] grid items-center gap-1.5 border-t bg-surface-container-high px-3 py-1 ${
              canInquiry ? 'grid-cols-[minmax(0,1fr)_3.75rem_4.25rem]' : 'grid-cols-[minmax(0,1fr)_6.75rem]'
            } ${
              cartPreviewOpen
                ? 'border-outline-variant/14 shadow-[0_-10px_24px_rgba(15,23,42,0.14)]'
                : 'border-outline-variant/12 shadow-[0_-6px_18px_rgba(15,23,42,0.12)]'
            }`
      }
      style={
        !isDesktop
          ? {
              bottom: `calc(${hideMobileBottomNav ? '0px' : '3.5rem'} + env(safe-area-inset-bottom, 0px) + var(--visual-viewport-bottom, 0px))`,
            }
          : undefined
      }
    >
      <AnimatePresence initial={false}>
        {cartPreviewOpen ? (
          <motion.div
            key="inquiry-cart-preview"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, y: 8 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className={`absolute bottom-full left-0 right-0 overflow-hidden bg-surface-container-low ${
              isDesktop
                ? 'rounded-xl border border-outline-variant/15 shadow-2xl md:max-h-[360px]'
                : 'rounded-t-xl border-t border-outline-variant/12 bg-surface-container-high shadow-none'
            }`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-outline-variant/10 px-3 py-2.5 md:py-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-on-surface">
                  {t(canInquiry ? 'selectionPage.inquiryCart.title' : 'selectionPage.inquiryCart.exportTitle')}
                </p>
                <p className="text-xs text-on-surface-variant">
                  {t('selectionPage.inquiryCart.addedCount', { count: inquiryCart.items.length })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!isDesktop ? (
                  <button
                    onClick={inquiryCart.clear}
                    className={`px-2 py-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface ${selectionPress}`}
                  >
                    {t('selectionPage.inquiryCart.clear')}
                  </button>
                ) : null}
                {canInquiry && (
                  <Link
                    to="/my-inquiries"
                    className={`shrink-0 px-2 py-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface ${selectionPress}`}
                  >
                    {isDesktop ? t('selectionPage.inquiryCart.editList') : t('selectionPage.inquiryCart.edit')}
                  </Link>
                )}
              </div>
            </div>
            <div className="max-h-[calc(58dvh-56px)] divide-y divide-outline-variant/10 overflow-y-auto px-2 py-1 md:max-h-[300px]">
              {inquiryCart.items.map((item) => {
                const summary = getInquiryCartItemSummary(item, t('selectionPage.inquiryCart.remarkLabel'));
                return (
                  <div
                    key={item.id}
                    // 清单可滚动：移动端行不带 hover 底色（iOS 滑动粘滞）
                    className="flex min-w-0 items-start gap-2 px-2 py-2.5 md:rounded-lg md:py-2 md:hover:bg-surface-container"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-on-surface">{getInquiryCartItemTitle(item)}</p>
                      <p className="mt-0.5 truncate text-xs text-on-surface-variant">
                        {t('selectionPage.inquiryCart.quantity', {
                          qty: item.qty,
                          unit: item.unit || t('selectionPage.inquiryCart.unitEach'),
                        })}
                        {summary ? ` · ${summary}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => inquiryCart.removeItem(item.id)}
                      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-on-surface-variant md:hover:bg-surface-container-high md:hover:text-on-surface ${isDesktop ? selectionPress : selectionMotion}`}
                      aria-label={t('selectionPage.inquiryCart.removeAria')}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button
        onClick={() => setCartPreviewOpen((value) => !value)}
        className={
          isDesktop
            ? `inline-flex min-h-8 min-w-0 flex-none items-center justify-start gap-1.5 rounded-lg px-2 py-1 text-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface ${selectionPress}`
            : 'inline-flex h-9 min-w-0 items-center justify-between gap-2 rounded-lg text-sm font-semibold text-on-surface'
        }
        aria-expanded={cartPreviewOpen}
      >
        {!isDesktop ? (
          <span className="inline-flex min-w-0 items-center gap-2">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${
                cartPreviewOpen
                  ? 'bg-primary-container text-on-primary'
                  : 'bg-primary-container/10 text-primary-container'
              }`}
            >
              <Icon name="request_quote" size={16} />
            </span>
            <span className="min-w-0 truncate leading-none">
              {t(canInquiry ? 'selectionPage.inquiryCart.pending' : 'selectionPage.inquiryCart.selected')}
            </span>
            <span className="shrink-0 text-xs font-semibold leading-none text-primary-container tabular-nums">
              {inquiryCart.items.length > 99
                ? '99+'
                : t('selectionPage.inquiryCart.pendingCount', { count: inquiryCart.items.length })}
            </span>
            <Icon
              name={cartPreviewOpen ? 'chevrons_down' : 'chevrons_up'}
              size={15}
              className="shrink-0 text-on-surface-variant/70"
            />
          </span>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {t(canInquiry ? 'selectionPage.inquiryCart.pending' : 'selectionPage.inquiryCart.selected')}{' '}
            <strong className="text-on-surface">{inquiryCart.items.length}</strong>{' '}
            {t('selectionPage.inquiryCart.itemUnit')}
          </span>
        )}
        {isDesktop ? (
          <Icon
            name={cartPreviewOpen ? 'chevrons_down' : 'chevrons_up'}
            size={17}
            className="shrink-0 text-on-surface-variant/70"
          />
        ) : null}
      </button>
      <div className={isDesktop ? 'flex shrink-0 items-center gap-2' : 'contents'}>
        {isDesktop ? (
          <button
            onClick={inquiryCart.clear}
            className={`rounded-lg px-2.5 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high ${selectionPress}`}
            aria-label={t('selectionPage.inquiryCart.clearAria')}
          >
            {t('selectionPage.inquiryCart.clear')}
          </button>
        ) : null}
        {canInquiry ? (
          <>
            <Link
              to="/my-inquiries"
              className={
                isDesktop
                  ? `rounded-lg px-2.5 py-1.5 text-center text-xs font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface ${selectionPress}`
                  : 'inline-flex h-9 items-center justify-center rounded-lg px-2 text-center text-sm font-medium text-on-surface-variant'
              }
            >
              {isDesktop ? t('selectionPage.inquiryCart.myInquiries') : t('selectionPage.inquiryCart.list')}
            </Link>
            <button
              onClick={() => {
                if (!user) {
                  requireLogin(t('selectionPage.inquiryCart.loginReason'));
                  return;
                }
                setInquiryOpen(true);
              }}
              className={
                isDesktop
                  ? `rounded-lg bg-primary-container px-4 py-1.5 text-sm font-bold text-on-primary hover:opacity-90 ${selectionPress}`
                  : 'inline-flex h-9 items-center justify-center rounded-lg bg-primary-container px-2 text-sm font-bold text-on-primary'
              }
            >
              {isDesktop ? t('selectionPage.inquiryCart.submitInquiry') : t('selectionPage.inquiryCart.submit')}
            </button>
          </>
        ) : (
          /* 询价功能关闭：清单仅用于批量导出选中型号 */
          <button
            onClick={() => void handleExportSelected()}
            className={
              isDesktop
                ? `rounded-lg bg-primary-container px-4 py-1.5 text-sm font-bold text-on-primary hover:opacity-90 ${selectionPress}`
                : 'inline-flex h-9 items-center justify-center rounded-lg bg-primary-container px-2 text-sm font-bold text-on-primary'
            }
          >
            {t('selectionPage.inquiryCart.exportSelected')}
          </button>
        )}
      </div>
    </div>
  );
  const mobileActionBarSpacer =
    !isDesktop && inquiryCart.items.length > 0 ? <div aria-hidden className="h-14 shrink-0" /> : null;

  const shellTitle = (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 md:gap-1.5">
      {isDesktop ? (
        <>
          <button onClick={goHome} className={`truncate hover:text-primary-container ${selectionPress}`}>
            {pageTitle}
          </button>
          {group && (
            <>
              <Icon name="chevron_right" size={16} className="shrink-0 text-on-surface-variant/35" />
              {!slug ? (
                <span className="truncate">{group.name}</span>
              ) : (
                <button
                  onClick={goToGroupCategories}
                  className={`truncate hover:text-primary-container ${selectionPress}`}
                >
                  {group.name}
                </button>
              )}
            </>
          )}
          {liveCat && (
            <>
              <Icon name="chevron_right" size={16} className="shrink-0 text-on-surface-variant/35" />
              <button
                type="button"
                onClick={resetCurrentCategory}
                className={`truncate text-primary-container hover:text-primary-container ${selectionPress}`}
              >
                {liveCat.name}
              </button>
            </>
          )}
        </>
      ) : (
        <>
          {liveCat && group ? (
            <>
              <span className="shrink-0 text-on-surface">{t('selectionPage.select')}</span>
              <button
                onClick={goToGroupCategories}
                // 冻结头随列表滚动：移动端不带 hover/按压（iOS 粘滞）
                className="max-w-[6.25rem] truncate text-on-surface-variant"
              >
                {group.name}
              </button>
              <Icon name="chevron_right" size={14} className="shrink-0 text-on-surface-variant/35" />
              <button
                type="button"
                onClick={resetCurrentCategory}
                className="min-w-0 flex-1 truncate text-left text-primary-container"
              >
                {liveCat.name}
              </button>
            </>
          ) : liveCat ? (
            <>
              <button onClick={goHome} className="max-w-[5.25rem] truncate text-on-surface-variant">
                {pageTitle}
              </button>
              <Icon name="chevron_right" size={14} className="shrink-0 text-on-surface-variant/35" />
              <button
                type="button"
                onClick={resetCurrentCategory}
                className="min-w-0 flex-1 truncate text-left text-primary-container"
              >
                {liveCat.name}
              </button>
            </>
          ) : group ? (
            <>
              <button onClick={goHome} className="max-w-[5.25rem] truncate text-on-surface-variant">
                {pageTitle}
              </button>
              <Icon name="chevron_right" size={14} className="shrink-0 text-on-surface-variant/35" />
              <span className="min-w-0 flex-1 truncate text-on-surface">{group.name}</span>
            </>
          ) : (
            <span className="truncate text-on-surface">{pageTitle}</span>
          )}
        </>
      )}
    </span>
  );

  const shellDescription =
    phase === 'group'
      ? pageDesc
      : phase === 'sub'
        ? t('selectionPage.intro.sub')
        : curField
          ? t('selectionPage.intro.wizard', { count: currentStepOptionCountText })
          : t('selectionPage.intro.completed', { count: filteredTotal.toLocaleString() });

  const mobileSelectedSummary =
    !isDesktop && phase === 'wizard' && specKeys.length > 0 && !search ? (
      <div className="flex min-w-0 items-stretch overflow-x-auto border-t border-outline-variant/10 pt-1.5 scrollbar-none">
        {specKeys.map((k, index) => {
          const autoSelected = autoSelectedFields.has(k);
          return (
            <button
              key={k}
              onClick={() => dropVal(k)}
              disabled={autoSelected}
              // 横向滚动条内：移动端不带 hover（滑动换看参数时落点文字会变橙粘住）
              className={`min-w-[4.9rem] shrink-0 px-2 text-left transition-colors ${index > 0 ? 'border-l border-outline-variant/12' : ''} ${
                autoSelected ? 'cursor-default text-on-surface-variant/45' : ''
              }`}
            >
              <span className="block truncate text-[9px] leading-3 text-on-surface-variant">
                {columnLabel(columns, k)}
              </span>
              <span
                className={`block truncate text-[11px] font-semibold leading-4 ${autoSelected ? 'text-on-surface-variant/55' : 'text-on-surface'}`}
              >
                {specs[k]}
              </span>
            </button>
          );
        })}
        <button
          onClick={() => {
            setSpecs({});
            setManualDrafts({});
            setSkipped(new Set());
            setAutoSelectedFields(new Set());
          }}
          className="shrink-0 border-l border-outline-variant/12 px-2 text-[10px] font-medium text-on-surface-variant"
        >
          {t('selectionPage.inquiryCart.clear')}
        </button>
      </div>
    ) : null;

  const groupProductTotal =
    group?.children.reduce((sum, child) => sum + (catBySlug.get(child.slug)?.productCount ?? 0), 0) ?? 0;

  const toolbarSummary =
    phase === 'group' ? (
      <div className="flex min-w-0 items-center gap-4 overflow-x-auto scrollbar-none text-xs text-on-surface-variant">
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-sm font-semibold text-on-surface">{t('selectionPage.stats.productGroups')}</span>
          <span className="rounded-full bg-primary-container/8 px-2 py-0.5 text-[10px] font-medium tabular-nums text-primary-container">
            {categoryGroupCountText}
          </span>
        </span>
        <span className="h-3 w-px shrink-0 bg-outline-variant/15" />
        {selectionStatItems.map((item) => (
          <span key={item.label} className="shrink-0">
            {item.label}{' '}
            <strong className="ml-0.5 tabular-nums text-sm font-semibold text-on-surface">
              {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
            </strong>
          </span>
        ))}
      </div>
    ) : phase === 'sub' && group ? (
      <div className="flex min-w-0 items-center gap-4 overflow-x-auto scrollbar-none text-xs text-on-surface-variant">
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-sm font-semibold text-on-surface">{t('selectionPage.stats.categories')}</span>
          <span className="rounded-full bg-primary-container/8 px-2 py-0.5 text-[10px] font-medium tabular-nums text-primary-container">
            {group.children.length}
          </span>
        </span>
        <span className="h-3 w-px shrink-0 bg-outline-variant/15" />
        <span className="shrink-0">
          {t('selectionPage.stats.models')}{' '}
          <strong className="ml-0.5 tabular-nums text-sm font-semibold text-on-surface">
            {groupProductTotal.toLocaleString()}
          </strong>
        </span>
      </div>
    ) : phase === 'wizard' ? (
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto scrollbar-none md:gap-2">
        <span className="shrink-0 whitespace-nowrap text-xs text-on-surface-variant tabular-nums">
          {t('selectionPage.selectedProgress', { selected: specKeys.length, total: fields.length })}
        </span>
        {specKeys.map((k) => {
          const autoSelected = autoSelectedFields.has(k);
          return (
            <button
              key={k}
              onClick={() => dropVal(k)}
              disabled={autoSelected}
              className={`hidden h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs md:inline-flex ${
                autoSelected
                  ? 'cursor-default bg-surface-container-high text-on-surface-variant/55'
                  : `bg-primary-container/10 text-primary-container hover:bg-primary-container/18 ${selectionPress}`
              }`}
            >
              <span className="text-on-surface-variant/70">{columnLabel(columns, k)}</span>
              <span className="max-w-[9rem] truncate font-medium">{specs[k]}</span>
              {!autoSelected ? <Icon name="close" size={10} /> : null}
            </button>
          );
        })}
        {specKeys.length > 0 ? (
          <button
            onClick={() => {
              setSpecs({});
              setManualDrafts({});
              setSkipped(new Set());
              setAutoSelectedFields(new Set());
              setSearchDraft('');
            }}
            className={`hidden h-8 shrink-0 items-center rounded-full px-2.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface md:inline-flex ${selectionPress}`}
          >
            {t('selectionPage.inquiryCart.clear')}
          </button>
        ) : null}
      </div>
    ) : null;

  const handleToolbarShare = async () => {
    if (sharingTarget) return;
    if (!user) {
      requireLogin(t('selectionPage.share.loginReason'));
      return;
    }
    if (phase === 'wizard' && liveCat) {
      await handleShare(false);
      return;
    }
    if (phase === 'sub' && group) {
      await handleShareSub(group.id);
      return;
    }
    setSharingTarget('entry');
    try {
      await copyShareLink(`${window.location.origin}/selection`, {
        title: t('selectionPage.share.entryTitle'),
        description: t('selectionPage.share.description'),
      });
    } finally {
      setSharingTarget(null);
    }
  };
  const toolbarShareLabel =
    phase === 'group' ? t('selectionPage.share.groupLink') : t('selectionPage.share.categoryLink');
  const isToolbarSharePending =
    phase === 'wizard' ? isCategorySharePending : phase === 'sub' ? isSubSharePending : isEntrySharePending;

  const selectionToolbarCore = (
    <div className="flex min-h-0 items-center gap-2 md:min-h-11 md:flex-wrap md:justify-between md:gap-3">
      {/* wizard 阶段左侧已选 chips 允许收缩（内层 overflow-x-auto 接管溢出）——
          之前 shrink-0 让 chips 只增不让，把右侧搜索框/生成链接/全部分类挤变形 */}
      <div className={`min-w-0 items-center gap-2 md:gap-3 ${phase === 'wizard' ? 'hidden md:flex' : 'flex'}`}>
        {toolbarSummary}
      </div>
      <div
        className={`flex min-h-8 flex-nowrap items-center justify-end gap-1.5 md:ml-auto md:min-h-9 md:flex-wrap md:gap-2 ${phase === 'wizard' ? 'min-w-0 flex-1' : 'ml-auto'}`}
      >
        {phase === 'wizard' && liveCat ? (
          <SearchField
            inputProps={searchDraftInputProps}
            value={searchDraftInputValue}
            onClear={() => setSearchDraft('')}
            placeholder={t('selectionPage.searchPlaceholder')}
            className={`min-w-[9.5rem] flex-1 sm:w-64 sm:flex-none ${selectionMotion}`}
          />
        ) : null}
        {isDesktop ? (
          <button
            onClick={() => void handleToolbarShare()}
            disabled={isToolbarSharePending}
            data-tooltip-ignore
            className={`inline-flex h-9 w-[7.25rem] shrink-0 items-center justify-center gap-1.5 px-3 text-xs font-bold text-on-surface-variant hover:text-on-surface disabled:opacity-50 ${selectionPress}`}
            aria-label={isToolbarSharePending ? t('selectionPage.generating') : toolbarShareLabel}
          >
            <Icon name="share" size={14} />
            <span className="whitespace-nowrap">
              {isToolbarSharePending ? t('selectionPage.generating') : toolbarShareLabel}
            </span>
          </button>
        ) : null}
        {isDesktop && phase !== 'group' ? (
          <button
            onClick={goHome}
            data-tooltip-ignore
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface md:h-9 md:w-auto md:gap-1.5 md:px-3 ${selectionPress}`}
            aria-label={t('selectionPage.allCategories')}
          >
            <Icon name="inventory_2" size={14} />
            <span className="hidden text-xs font-bold md:inline">{t('selectionPage.allCategories')}</span>
          </button>
        ) : null}
        {!isDesktop && phase === 'wizard' ? (
          <span
            className="inline-flex h-8 shrink-0 items-center text-[11px] font-semibold text-primary-container tabular-nums"
            aria-label={t('selectionPage.selectedProgressAria', { selected: specKeys.length, total: fields.length })}
          >
            {t('selectionPage.selectedProgress', { selected: specKeys.length, total: fields.length })}
          </span>
        ) : null}
      </div>
    </div>
  );

  const selectionToolbar =
    !isDesktop && phase === 'wizard' ? (
      <div className="flex w-full flex-col items-stretch gap-2">
        {selectionToolbarCore}
        {mobileSelectedSummary}
      </div>
    ) : (
      selectionToolbarCore
    );

  const shellActions =
    !isDesktop && phase === 'wizard' && liveCat ? (
      <div className="flex items-center gap-1">
        <button
          onClick={() => handleShare(false)}
          disabled={isCategorySharePending}
          data-tooltip-ignore
          // 冻结头右侧：移动端不带 hover/按压（iOS 粘滞）
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant disabled:opacity-50"
          aria-label={isCategorySharePending ? t('selectionPage.generating') : t('selectionPage.share.categoryLink')}
        >
          <Icon name="share" size={15} />
        </button>
        <button
          onClick={goHome}
          data-tooltip-ignore
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant"
          aria-label={t('selectionPage.allCategories')}
        >
          <Icon name="inventory_2" size={15} />
        </button>
      </div>
    ) : null;

  const selectionPhaseKey =
    phase === 'group'
      ? 'selection-groups'
      : phase === 'sub'
        ? `selection-sub-${groupId || 'none'}`
        : `selection-wizard-${slug || 'none'}`;
  const desktopScrollContainerClass = 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar';

  useLayoutEffect(() => {
    if (isDesktop) return;
    scrollContainerRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    mobileMainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [isDesktop, selectionPhaseKey]);

  const phaseMotionProps = prefersReducedMotion
    ? { initial: false as const }
    : isDesktop
      ? {
          initial: { opacity: 0.9 },
          animate: { opacity: 1 },
          exit: { opacity: 0.96 },
          transition: { duration: 0.12, ease: 'easeOut' as const },
        }
      : {
          initial: { opacity: 0.86, y: 8, scale: 0.996 },
          animate: { opacity: 1, y: 0, scale: 1 },
          transition: {
            opacity: { duration: 0.16, ease: 'easeOut' as const },
            y: { type: 'spring' as const, stiffness: 380, damping: 34, mass: 0.75 },
            scale: { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const },
          },
        };

  const phaseContent = (
    // 不挂 transform-gpu：它给整个列表造常驻 GPU 合成层，iOS 触摸时再把按住的
    // 分类卡提成子层，半透明卡背景就叠在自己图层的纯白 tile 上——按住/滑动的
    // 那张卡整张变纯白。入场动画期间 framer-motion 会临时建层（0.16s 后自动
    // 释放），不需要常驻层提示。
    <motion.div key={selectionPhaseKey} {...phaseMotionProps} className="min-w-0">
      {phase === 'group' && groupContent}
      {phase === 'sub' && subContent}
      {phase === 'wizard' &&
        (wizardContent || (
          // 移动端 px-0：面板在选型页是透明的，这层内边距会让选项卡比标题卡窄一截（左右对不齐）；
          // 桌面保留 md:px-5 作为滚动面板的内容内边距
          <div ref={wizardWrapRef} className="px-0 py-4 md:px-5 md:py-5">
            {pageHeader}
            <div className="space-y-0">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={wizardTransitionKey} {...wizardTransition} className="min-w-0">
                  {isMobileResultView ? (
                    resultsJSX
                  ) : (
                    <>
                      {stepsJSX}
                      {resultsJSX}
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        ))}
    </motion.div>
  );

  const contentBody = isDesktop ? (
    <AnimatePresence mode={isDesktop ? 'wait' : 'sync'} initial={false}>
      {phaseContent}
    </AnimatePresence>
  ) : (
    phaseContent
  );

  const shareLinkDialogNode = (
    <SelectionShareLinkDialog
      state={shareLinkDialog}
      onClose={() => setShareLinkDialog(null)}
      onCopy={handleCopyShareDialogLink}
      onNativeShare={handleNativeShareDialogLink}
      nativeSharePending={nativeSharePending}
    />
  );

  /* 浏览门槛拦截（require_login_selection）：显示与首页一致的模糊锁屏（选型文案） */
  if (browseGate.blocked) {
    return <BrowseLoginLock scope="selection" />;
  }

  /* ══════════ Desktop Layout ══════════ */
  if (isDesktop) {
    return (
      <>
        <AdminPageShell>
          <AdminManagementPage
            title={shellTitle}
            description={shellDescription}
            toolbar={selectionToolbar}
            className="app-public-tool-page app-public-tool-page-selection"
            contentClassName="min-h-0"
          >
            <AdminContentPanel scroll className="flex flex-col">
              <div ref={scrollContainerRef} className={desktopScrollContainerClass}>
                {contentBody}
              </div>
              {actionBar}
            </AdminContentPanel>
          </AdminManagementPage>
          <InquirySubmitDialog
            open={inquiryOpen}
            onClose={() => setInquiryOpen(false)}
            items={inquiryCart.items}
            onSubmitted={inquiryCart.clear}
          />
        </AdminPageShell>
        <LoginConfirmDialog
          open={loginDialogOpen}
          onClose={() => setLoginDialogOpen(false)}
          reason={loginDialogReason}
          returnUrl={location.pathname + location.search}
        />
        {shareLinkDialogNode}
      </>
    );
  }

  /* ══════════ Mobile Layout ══════════ */
  return (
    <>
      <AdminPageShell
        mobileMainRef={mobileMainRef}
        /* 禁 iOS 橡皮筋回弹：滚动器到顶继续下拉时整段内容（含冻结头）会被拖下再弹回，
           看起来不稳定。scrollbar-hidden 全局类只给了 overscroll-behavior-y: contain
           （仅阻断滚动链、不消自身回弹），且无 layer 全局 CSS 压过 Tailwind 工具类，
           故用 ! 前缀强制 overscroll-behavior: none（iOS 16+ 生效） */
        mobileMainClassName="min-h-0 !overscroll-none"
        mobileContentClassName={`flex min-h-full flex-col gap-3 px-3 py-3 pt-0 ${hideMobileBottomNav ? 'pb-3' : 'pb-safe-nav'}`}
        hideMobileBottomNav={hideMobileBottomNav}
      >
        <AdminManagementPage
          title={shellTitle}
          description={shellDescription}
          actions={shellActions}
          toolbar={selectionToolbar}
          /* 移动端标题+工具栏整块吸顶（标题固定不下滚；向导阶段搜索框也常驻），
             配合上方 mobileContentClassName 的 pt-0 实现「静止位=吸顶位」：
             滚动第一像素起标题/搜索框零位移，只有大类卡片与选项内容滚动；
             桌面端标题本就在滚动容器外，无需吸顶 */
          headerSticky={!isDesktop}
          className="app-public-tool-page app-public-tool-page-selection !h-auto min-h-full flex flex-col gap-3"
          contentClassName="flex flex-col"
        >
          <AdminContentPanel
            className={`flex flex-col overflow-visible ${
              phase === 'group' || phase === 'sub' ? 'rounded-none border-0 bg-transparent' : ''
            }`}
          >
            {contentBody}
            {mobileActionBarSpacer}
            {actionBar}
          </AdminContentPanel>
        </AdminManagementPage>

        <InquirySubmitDialog
          open={inquiryOpen}
          onClose={() => setInquiryOpen(false)}
          items={inquiryCart.items}
          onSubmitted={inquiryCart.clear}
        />
      </AdminPageShell>
      <LoginConfirmDialog
        open={loginDialogOpen}
        onClose={() => setLoginDialogOpen(false)}
        reason={loginDialogReason}
        returnUrl={location.pathname + location.search}
      />
      {shareLinkDialogNode}
    </>
  );
}
