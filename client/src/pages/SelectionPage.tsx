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
  GlobalSearchDropdown,
  GlobalSearchMobilePanel,
  useGlobalSelectionSearch,
  type GlobalSearchItem,
  type GlobalSearchLabels,
} from '../components/selection/GlobalSelectionSearch';
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
  isRecentSelectionJumpLeave,
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

/* 移动端冻结头（data-sticky-header）盖在滚动容器顶部的实际高度。
   滚动定位必须减掉它，否则内容会被钉在冻结头底下（桌面端标题在滚动容器外，返回 0）。 */
const stickyHeaderOffsetOf = (container: HTMLElement, isDesktop: boolean) => {
  if (isDesktop) return 0;
  const header = container.parentElement?.querySelector<HTMLElement>('[data-sticky-header]');
  if (!header) return 0;
  const offset = header.getBoundingClientRect().bottom - container.getBoundingClientRect().top;
  return offset > 0 ? offset : 0;
};

/* ══════════════ 选型向导快照（localStorage） ══════════════
   选型结果页点「模型」跳模型详情（移动端是同视图导航，选型页组件整个卸载），
   返回/重进选型页时所有 useState 向导状态已丢——此前直接退回选型首页从头选。
   快照把进行中的选型（分组/分类/已选参数/跳过项/搜索词/展开的套件）落一份到
   localStorage，作为**永久草稿**保存——直到用户点横幅「继续」、开始新的选型
   （选分组/分类、「重新选择」「清空」「首页」）或快照里的分类被删，才清除；
   不过期。进入时的行为按「是否同会话延续」区分：
   - 同会话（2h 内返回/刷新）：自动静默恢复（点模型看看/切出去沟通再回来）；
   - 主动进入（点选型菜单/侧栏/底部 tab）或快照已超过 2h：首页横幅问
     「继续 / 重新开始」，恢复与否交还用户——没有确认就一直保存，等下次
     重新选型才清除；但从结果卡点「模型」「技术支持」跳出去看、15 分钟内
     回来（含点选型 tab 进入）则静默恢复，不多这一次点击；
   - 显式入口（?c= 深链 / 选型分享链接）优先，不恢复不问。 */
const WIZARD_SNAPSHOT_KEY = 'selection:wizard-snapshot';
/* 同会话窗口：快照最后更新距今在该窗口内视为「会话延续」（静默恢复），
   超出则视为历史草稿（横幅问询，不静默恢复） */
const WIZARD_SESSION_WINDOW_MS = 2 * 60 * 60 * 1000;

interface WizardSnapshot {
  v: 1;
  savedAt: number;
  groupId: string | null;
  slug: string | null;
  specs: Record<string, string>;
  manualDrafts: Record<string, string>;
  skipped: string[];
  autoSelectedFields: string[];
  expandedKits: string[];
  searchDraft: string;
}

/* 「进入选型页的方式」判定：点菜单/链接进入要弹「已恢复」提示，返回/刷新静默。
   不能用 useNavigationType（懒加载路由挂载时读到旧值，实测点 Link 进来也是 POP），
   也不能用 popstate 监听（history 库的监听器先收到事件并同步触发渲染，本页挂载时
   自己的监听器还没跑）。改用纯值对比：
   - location.key：PUSH 生成新 key，POP 返回复用旧 key——挂载时和本模块记录的
     上一个 key 相同 = 返回到同一历史条目（静默）；不同 = 主动进入（提示）
   - 文档导航条目：刷新/整页打开/直接输 URL 时，挂载紧随文档加载（静默） */
let wizardLastKeyInfo: { key: string; at: number } | null = null;
function shouldAskBeforeWizardRestore(returnedToSameEntry: boolean): boolean {
  try {
    const now = performance.now();
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    // 初始进入（刷新/直接打开/PWA 重开）：挂载紧随文档加载 → 静默恢复
    if (!entry || now - entry.startTime < 2000) return false;
    // 浏览器/系统返回到离开前的同一历史条目 → 静默恢复
    if (returnedToSameEntry) return false;
  } catch {
    return false;
  }
  return true;
}

function readWizardSnapshot(): WizardSnapshot | null {
  try {
    const raw = localStorage.getItem(WIZARD_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardSnapshot> | null;
    if (!parsed || parsed.v !== 1 || typeof parsed.savedAt !== 'number') return null;
    const stringArray = (value: unknown) =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    return {
      v: 1,
      savedAt: parsed.savedAt,
      groupId: typeof parsed.groupId === 'string' ? parsed.groupId : null,
      slug: typeof parsed.slug === 'string' ? parsed.slug : null,
      specs: parsed.specs && typeof parsed.specs === 'object' ? parsed.specs : {},
      manualDrafts: parsed.manualDrafts && typeof parsed.manualDrafts === 'object' ? parsed.manualDrafts : {},
      skipped: stringArray(parsed.skipped),
      autoSelectedFields: stringArray(parsed.autoSelectedFields),
      expandedKits: stringArray(parsed.expandedKits),
      searchDraft: typeof parsed.searchDraft === 'string' ? parsed.searchDraft : '',
    };
  } catch {
    return null;
  }
}

function persistWizardSnapshot(data: Omit<WizardSnapshot, 'v' | 'savedAt'>) {
  try {
    const snapshot: WizardSnapshot = { ...data, v: 1, savedAt: Date.now() };
    localStorage.setItem(WIZARD_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    /* 隐私模式等写入失败：静默降级为不恢复 */
  }
}

function clearWizardSnapshot() {
  try {
    localStorage.removeItem(WIZARD_SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}

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
  /* 快照恢复判定（一次性）：显式入口（?c= 深链 / 选型分享链接 state）优先于快照。
     - 有实质进度（选过参数/跳过/填过）+ 主动进入 或 快照超过同会话窗口：
       首页横幅问「继续 / 重新开始」，恢复与否交还用户，没确认就一直保存
     - 同会话内的返回/刷新：自动静默恢复（体感是同一会话延续，问反而是打断）
     - 无实质进度（只选了分组/分类就走）：仅同会话内静默恢复位置，陈旧则忽略（不问） */
  const wizardRestoreRef = useRef<WizardSnapshot | null | undefined>(undefined);
  const wizardAskRef = useRef<WizardSnapshot | null>(null);
  if (wizardRestoreRef.current === undefined) {
    const explicitEntry =
      new URLSearchParams(location.search).get('c') !== null ||
      Boolean((location.state as { shareSlug?: string } | null)?.shareSlug);
    const restored = explicitEntry ? null : readWizardSnapshot();
    // 渲染期只读对比（并发渲染会多次尝试，绝不能在这里写模块变量）；
    // 返回判定还要求上次记录距今 >1.5s：同一次进入内的快速重挂不算返回
    const lastInfo = wizardLastKeyInfo;
    const returnedToSameEntry = lastInfo?.key === location.key && performance.now() - lastInfo.at > 1500;
    let ask = false;
    let autoRestore = false;
    if (restored) {
      const meaningful =
        Object.keys(restored.specs ?? {}).length > 0 ||
        (restored.skipped ?? []).length > 0 ||
        Object.keys(restored.manualDrafts ?? {}).length > 0 ||
        (restored.searchDraft ?? '') !== '';
      const sameSession = Date.now() - restored.savedAt < WIZARD_SESSION_WINDOW_MS;
      if (meaningful) {
        // 浏览器/系统返回到同一历史条目（POP），或从结果卡点「模型」「技术支持」
        // 跳出去看、15 分钟内回来（含点选型 tab 进入）——都是出去看一眼，静默恢复
        const silentReturn = !shouldAskBeforeWizardRestore(returnedToSameEntry) || isRecentSelectionJumpLeave();
        ask = sameSession ? !silentReturn : true;
        autoRestore = !ask;
      } else {
        autoRestore = sameSession;
      }
    }
    wizardAskRef.current = ask ? restored : null; // 挂横幅问，不直接恢复
    wizardRestoreRef.current = autoRestore ? restored : null;
  }
  const wizardRestore = wizardRestoreRef.current;
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
  const [expandedKits, setExpandedKits] = useState<Set<string>>(() => new Set(wizardRestore?.expandedKits ?? []));

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

  /* wizard state —— 初值优先取快照（从模型详情页返回/重进选型页时找回进行中的选型） */
  const [groupId, setGroupId] = useState<string | null>(wizardRestore?.groupId ?? null);
  const [slug, setSlug] = useState<string | null>(wizardRestore?.slug ?? null);
  const [specs, setSpecs] = useState<Record<string, string>>(wizardRestore?.specs ?? {});
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>(wizardRestore?.manualDrafts ?? {});
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set(wizardRestore?.skipped ?? []));
  const [autoSelectedFields, setAutoSelectedFields] = useState<Set<string>>(
    () => new Set(wizardRestore?.autoSelectedFields ?? []),
  );
  const {
    value: searchDraft,
    draftValue: searchDraftInputValue,
    setValue: setSearchDraft,
    inputProps: searchDraftInputProps,
  } = useImeSafeSearchInput({ initialValue: wizardRestore?.searchDraft ?? '' });
  const search = useDebouncedValue(searchDraft.trim(), 250);
  /* 向导搜索框聚焦中（移动端=软键盘弹出）：聚焦即隐藏「已选 X 项」条——
     键盘把输入框顶到键盘上方时，吸顶头里的已选条会跟着跳到输入法上面 */
  const [wizardSearchFocused, setWizardSearchFocused] = useState(false);
  /* 全局型号搜索（大类/子分类阶段）：移动端标题下展开行开关 + 选中后待预填进
     向导搜索框的关键词（pickSub 延迟 transition 里会清 searchDraft，须 commit 后再填） */
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const pendingSearchRef = useRef<string | null>(null);
  /* 全站搜索列表卡的来源按钮：待按产品自身参数一次性选满全部选项的预设（slug
     commit 后的 effect 消费——pickSub 延迟 transition 里会清 specs，须 commit 后再填） */
  const pendingSpecsPresetRef = useRef<Record<string, string> | null>(null);
  /* 全局搜索直达/列表分类按钮携带的产品所属大类（跨大类时同步 groupId）。
     undefined = 本次未携带（区别于 null = 独立分类）。
     cameFromGlobalSearchRef 标记「本向导来自全局搜索直达」，供 ✗ 清空返回搜索
     回路判定；桌面返回后聚焦搜索框的信号 */
  const pendingGlobalGroupRef = useRef<string | null | undefined>(undefined);
  const cameFromGlobalSearchRef = useRef(false);
  /* 发起全局搜索直达时所在的大类（null=选型首页）：跨大类直达会跟随产品改
     groupId（面包屑挂对大类），✗ 清空返回时要用这份原始值还原——返回的应是
     发起搜索的页面，而不是产品所属大类 */
  const globalSearchOriginRef = useRef<string | null>(null);
  /* 「清空即返回搜索」回到大类页时要自动展开搜索行，但 [phase] 收起 effect
     会跟着 phase 变化把它关掉——该 ref 豁免紧接着的一次收起 */
  const skipNextMobileSearchCollapseRef = useRef(false);
  const [globalSearchFocusSignal, setGlobalSearchFocusSignal] = useState(0);
  /* 「查看全部」全站搜索列表态：非 null = 处于 search 阶段（值 = 进入时的词，
     仅作 phase 判定；改词走 globalList hook 自身状态）。列表复用全局搜索 hook，
     不绑 onSelect（列表卡片不点行跳转，操作走询价/模型详情）。
     列表态同步进 URL（?search=词）：点卡片上的分类按钮进向导是 push 新历史条目，
     浏览器返回 pop 回 ?search= 时恢复列表（词和结果不丢） */
  const [globalListSearch, setGlobalListSearch] = useState<string | null>(null);
  const globalList = useGlobalSelectionSearch();
  /* 全站列表「滚到底自动加载」哨兵：进入视口（含 480px 预载提前量）即拉下一页，
     静默进行（无进度指示）；loadMore 自带并发/翻完守卫 */
  const globalListSentinelRef = useRef<HTMLDivElement>(null);
  /* 列表条目 key（push 时记录）+ 退出时最后搜索词：pop 回列表条目 = 恢复列表 */
  const listEntryKeyRef = useRef<string>('');
  const lastListQueryRef = useRef<string | null>(null);
  const prevLocationKeyRef = useRef(location.key);
  /* 下拉/内联「查看全部」→ 全站搜索列表态（词带入列表 hook，debounce 后自然触发请求）；
     退出 = 回到进入前的大类/落地页（groupId/slug 未动） */
  const enterGlobalList = useCallback(
    (query: string) => {
      globalList.setValue(query);
      setGlobalListSearch(query);
      setMobileSearchOpen(false);
      // 列表占据当前历史条目（replace 同 URL）：进向导时 push 新条目，浏览器返回
      // 即 pop 回列表条目；返回链不插入无效的同 URL 跳转
      navigate(`${location.pathname}${location.search}`, { replace: true });
    },
    [globalList.setValue, location.pathname, location.search, navigate],
  );
  /* 退出列表态的唯一出口：先记住词（浏览器返回 pop 回列表条目时恢复用）再清
     state。列表/向导各自 push 同 URL 历史条目（地址栏不变），pop 回列表条目
     即恢复列表——「点分类按钮=新页面、返回=回列表」而 URL 始终干净。
     词从 latest-ref 读（调用点多在长生命周期 useCallback 里，闭包捕获会过期） */
  const locationRef = useRef(location);
  const globalListStateRef = useRef<{ search: string | null; query: string }>({ search: null, query: '' });
  useEffect(() => {
    locationRef.current = location;
    globalListStateRef.current = { search: globalListSearch, query: globalList.query };
  });
  const rememberListQuery = useCallback(() => {
    const { search, query } = globalListStateRef.current;
    if (search !== null) lastListQueryRef.current = query || search;
  }, []);
  const clearGlobalList = useCallback(() => {
    /* 主动退出 replace 同 URL 生成新条目 key：恢复条件（key=列表条目）失配，
       退出不会被误判成「返回恢复」；地址栏不变、不增历史条目。
       注意与 push 型退出（goToListCategory）互斥使用——同一事件里连续
       push+replace 会被 React Router 合并成 replace（push 条目丢失） */
    rememberListQuery();
    if (globalListStateRef.current.search !== null) {
      navigate(`${locationRef.current.pathname}${locationRef.current.search}`, { replace: true });
    }
    setGlobalListSearch(null);
  }, [navigate, rememberListQuery]);
  const exitGlobalList = useCallback(() => clearGlobalList(), [clearGlobalList]);
  useEffect(() => {
    /* 在列表态时记录当前历史条目 key；浏览器 pop 回该条目且已不在列表态 → 恢复
       列表（词用退出前最后搜索词，列表 hook 内部状态未被清）。
       必须 keyChanged（本次渲染的 key 与上次不同）才恢复：React Router 的
       location 更新走 transition，退列表的同步渲染帧里 key 仍是旧值——那一帧
       key===storedEntryKey 恰好成立，没有 keyChanged 守卫会把退出误判成返回 */
    const keyChanged = prevLocationKeyRef.current !== location.key;
    prevLocationKeyRef.current = location.key;
    if (globalListSearch !== null) {
      listEntryKeyRef.current = location.key;
      return;
    }
    if (keyChanged && listEntryKeyRef.current === location.key && lastListQueryRef.current) {
      const query = lastListQueryRef.current;
      lastListQueryRef.current = null;
      setSlug(null);
      setSpecs({});
      setManualDrafts({});
      setSkipped(new Set());
      setAutoSelectedFields(new Set());
      setSearchDraft('');
      setExpandedKits(new Set());
      setGlobalListSearch(query);
    }
  }, [globalListSearch, location.key, setSearchDraft]);
  /* 主动进入时的「继续上次选型」问询横幅（选中 = 待恢复的快照，null = 不显示） */
  const [pendingResume, setPendingResume] = useState<WizardSnapshot | null>(null);

  /* 快照写入：向导状态实际变化才安排一次写（useMemo 的 key 覆盖全部字段，无关重渲染
     不重算、内容不变不重写）；300ms 内的连续变化——如搜索框逐字输入——合并成一次写。
     组件跳走（点「模型」去详情页）时若还有未落盘的变化，卸载前立即补写。
     分组/分类都空 = 用户明确回了选型首页 → 删快照，下次进入全新开始 */
  const wizardSnapshotKey = useMemo(
    () =>
      stableJson([
        groupId,
        slug,
        specs,
        manualDrafts,
        Array.from(skipped).sort(),
        Array.from(autoSelectedFields).sort(),
        Array.from(expandedKits).sort(),
        searchDraft,
      ]),
    [groupId, slug, specs, manualDrafts, skipped, autoSelectedFields, expandedKits, searchDraft, globalListSearch],
  );
  const wizardSnapshotDataRef = useRef<Omit<WizardSnapshot, 'v' | 'savedAt'> | null>(null);
  const wizardSnapshotDirtyRef = useRef(false);
  /* hold：刚点了「重新选择/清空」且还没有新选择——保持已清空状态，不把空进度写回快照 */
  const wizardSnapshotHoldRef = useRef(false);
  useEffect(() => {
    /* 全站搜索列表态不写不删向导快照：纯浏览视图，向导进度原样保留 */
    if (globalListSearch !== null) return;
    if (!groupId && !slug) {
      wizardSnapshotHoldRef.current = false;
      wizardSnapshotDirtyRef.current = false;
      clearWizardSnapshot();
      return;
    }
    const hasWizardProgress =
      Object.keys(specs).length > 0 ||
      skipped.size > 0 ||
      Object.keys(manualDrafts).length > 0 ||
      searchDraft.trim() !== '';
    if (wizardSnapshotHoldRef.current && !hasWizardProgress) return;
    wizardSnapshotHoldRef.current = false;
    wizardSnapshotDataRef.current = {
      groupId,
      slug,
      specs,
      manualDrafts,
      skipped: Array.from(skipped),
      autoSelectedFields: Array.from(autoSelectedFields),
      expandedKits: Array.from(expandedKits),
      searchDraft,
    };
    wizardSnapshotDirtyRef.current = true;
    const timer = window.setTimeout(() => {
      if (wizardSnapshotDataRef.current) persistWizardSnapshot(wizardSnapshotDataRef.current);
      wizardSnapshotDirtyRef.current = false;
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 内容 key 驱动；键已含全部字段
  }, [wizardSnapshotKey]);
  useEffect(
    () => () => {
      /* 卸载（跳去模型页/技术支持/别的页面）：未 hold 时把 savedAt 刷新为离开时刻，
        「在结果页上停留很久才离开」的会话窗口（2h）也从离开重新起算 */
      if (wizardSnapshotDirtyRef.current && wizardSnapshotDataRef.current) {
        persistWizardSnapshot(wizardSnapshotDataRef.current);
        wizardSnapshotDirtyRef.current = false;
      } else if (!wizardSnapshotHoldRef.current && wizardSnapshotDataRef.current) {
        const active = wizardSnapshotDataRef.current.groupId || wizardSnapshotDataRef.current.slug;
        if (active) persistWizardSnapshot(wizardSnapshotDataRef.current);
      }
    },
    [],
  );
  /* 主动进入 + 有快照：首页横幅问用户「继续 / 重新开始」（不自动恢复）。
     挂载提交后记录本次 location.key——供下次挂载对比「是否返回到同一历史条目」 */
  useEffect(() => {
    wizardLastKeyInfo = { key: location.key, at: performance.now() };
    if (wizardAskRef.current) setPendingResume(wizardAskRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时判定一次
  }, []);
  /* 明确的重来意图（重新选择/清空当前分类/横幅「重新开始」）：立即删快照并取消
     未落盘的写入；之后重新选的参数会重新累计，但「点完就走」的下次进入是全新开始 */
  const discardWizardSnapshot = useCallback(() => {
    wizardSnapshotHoldRef.current = true;
    wizardSnapshotDirtyRef.current = false;
    clearWizardSnapshot();
  }, []);
  /* 横幅「继续」：把快照应用到向导状态（save effect 会随之重新累计快照） */
  const applyPendingResume = useCallback(
    (snapshot: WizardSnapshot) => {
      startTransition(() => {
        clearGlobalList();
        setGroupId(snapshot.groupId);
        setSlug(snapshot.slug);
        setSpecs(snapshot.specs ?? {});
        setManualDrafts(snapshot.manualDrafts ?? {});
        setSkipped(new Set(snapshot.skipped ?? []));
        setAutoSelectedFields(new Set(snapshot.autoSelectedFields ?? []));
        setExpandedKits(new Set(snapshot.expandedKits ?? []));
        setSearchDraft(snapshot.searchDraft || '');
      });
      setPendingResume(null);
    },
    [setSearchDraft],
  );
  /* 横幅「重新开始」：用户不要这份进度，删快照保持全新开始 */
  const dismissPendingResume = useCallback(() => {
    discardWizardSnapshot();
    setPendingResume(null);
  }, [discardWizardSnapshot]);
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
    clearGlobalList();
    if (match.groupId) setGroupId(match.groupId);
    deepLinkSlugRef.current = null;
    navigate(`${location.pathname}?g=${match.groupId ?? ''}`, { replace: true });
  }, [cats, location.pathname, navigate, slug]);

  // Apply share slug/specs once cats are loaded
  useEffect(() => {
    const share = shareStateRef.current;
    if (!share?.shareSlug || !cats.length || slug) return;
    setSlug(share.shareSlug);
    clearGlobalList();
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

  const phase: 'group' | 'sub' | 'wizard' | 'search' =
    globalListSearch !== null ? 'search' : !groupId ? 'group' : !slug ? 'sub' : 'wizard';
  /* 移动端「全页搜索」模式：大类/子分类页点搜索图标进入——统计条与分类网格让位，
     搜索结果铺满内容区，底栏提供 共 N 个结果 / 查看全部 / 关闭搜索 */
  const mobileSearchTakeover = !isDesktop && mobileSearchOpen && (phase === 'group' || phase === 'sub');
  useEffect(() => {
    if (phase !== 'search') return;
    const el = globalListSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void globalList.loadMore();
      },
      { rootMargin: '480px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [phase, globalList.loadMore, globalList.hasMore]);

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
  const stickyHeaderOffset = (container: HTMLElement) => stickyHeaderOffsetOf(container, isDesktop);

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
        // 对「冻结头底边」而不是容器顶比较：移动端头部盖住容器顶部一段，
        // 只对容器顶比较会漏掉「步骤夹在容器顶和头底边之间」的半遮状态
        if (eRect.top < cRect.top + stickyHeaderOffset(container) + 4) {
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
          if (eRect.top < cRect.top + stickyHeaderOffset(container) + 4) {
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
              if (er.top < cr.top + stickyHeaderOffset(c2) + 4) {
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
    const reveal = (attempt: number) => {
      /* 用户刚滚动过先不抢滚动，但不能就此放弃：滚轮/触控板惯性会持续几百毫秒地
         续期时间戳，「滚到最后一项顺手点击」的揭示滚动曾被惯性事件直接吞掉
         （选完最后一项结果偶发不往上滚）。此前只重试 4 次（约 1.3 秒）就放弃，
         步骤多的分类（如全铜快插接头）点最后一项前往往刚滚过，结果就再也不往上
         滚了——重试窗口放宽到约 4 秒，惯性结束必能滚到位。 */
      if (Date.now() - lastUserScrollAtRef.current < 260) {
        if (attempt < 12) resultRevealTimerRef.current = setTimeout(() => reveal(attempt + 1), 320);
        return;
      }
      const el = resultRef.current;
      if (!el) return;

      const container = scrollContainerRef.current || mobileMainRef.current;
      if (container) {
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const offset = stickyHeaderOffset(container);
        // 结果已完整可见（顶部没被吸顶头盖住、底部没出容器下沿）才视为「用户自己
        // 滚到/看到了」。此前只看「顶部在上半区」就跳过——结果比剩余视口高一点时
        // 底部被裁掉一截也不滚，短分辨率下看不全选型结果。
        if (eRect.top >= cRect.top + offset - 4 && eRect.bottom <= cRect.bottom + 4) return;
        const fitsViewport = eRect.height < cRect.height - offset - 8;
        let target: number;
        if (fitsViewport && eRect.top >= cRect.top + offset - 4) {
          // 顶部已在视口内、只是底部被裁掉一点：最小滚动，只把底部补进视野
          target = container.scrollTop + (eRect.bottom - cRect.bottom) + 8;
        } else {
          // 结果还在下半区 / 比视口还高：顶对齐（比视口高时只能露出开头）
          target = eRect.top - cRect.top + container.scrollTop - offset - 18;
        }
        container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      } else {
        wizardWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    resultRevealTimerRef.current = setTimeout(() => reveal(0), 120);

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
          // 新的导航选择：恢复快照累计（覆盖此前「重新选择」的 hold）；
          // 用户直接开始新选型 = 不要恢复那份进度，横幅撤下
          wizardSnapshotHoldRef.current = false;
          setPendingResume(null);
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
          // 新的导航选择：恢复快照累计（覆盖此前「重新选择」的 hold）；
          // 用户直接开始新选型 = 不要恢复那份进度，横幅撤下
          wizardSnapshotHoldRef.current = false;
          // 正常进入向导（点分类卡）：撤销上一场「全局搜索直达」标记，
          // 避免 ✗ 清空被误判为「返回搜索」；同时退出全站搜索列表态
          cameFromGlobalSearchRef.current = false;
          clearGlobalList();
          setPendingResume(null);
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
  /* 全局搜索选中产品：跳进所属分类向导，并把型号（无型号用名称）预填进向导搜索。
     pickSub 在延迟 transition 里 setSearchDraft('')，直接 set 会被清——先挂 ref，
     slug commit 后的 effect 再填（搜索 UI 只在大类/子分类阶段渲染，届时 slug 必为
     null，选中目标必是新分类，effect 必触发）。
     groupId 也一并跟随产品所属大类：pickSub 不动 groupId，跨大类直达时面包屑
     会错挂在原来的大类名下。cameFromGlobalSearchRef 标记「本向导会话来自全局
     搜索直达」，供向导搜索框 ✗ 的「清空即返回搜索」回路使用（连续搜索闭环）。 */
  const handleGlobalSelect = useCallback(
    (item: GlobalSearchItem) => {
      globalSearchOriginRef.current = groupId ?? null;
      pendingSearchRef.current = item.modelNo?.trim() || item.name.trim() || null;
      pendingGlobalGroupRef.current = item.category.groupId ?? null;
      setMobileSearchOpen(false);
      pickSub(item.category.slug);
    },
    [groupId, pickSub],
  );
  /* 移动端「全页搜索」模式的搜索实例：搜索行（吸顶头内）、铺满内容区的结果列表、
     底栏（共 N 个结果 / 查看全部 / 关闭搜索）共用这一份状态。选中行走
     handleGlobalSelect 直达向导（hook 的 handleSelect 会顺带清词收起）。 */
  const mobileSearch = useGlobalSelectionSearch(handleGlobalSelect);
  const closeMobileSearch = useCallback(() => {
    mobileSearch.setValue('');
    setMobileSearchOpen(false);
  }, [mobileSearch.setValue]);
  /* 列表卡上的分类按钮：按产品自身参数把全部选项一次选满，直接落在该分类向导的
     结果页（产品型号已知，不必再一步步选选项；产品没有值的参数项自动「跳过」——
     跳过项不参与筛选，结果仍含该产品）。产品 specs 全空时退化为从第一步开始。
     push 一个历史条目——浏览器返回可 pop 回 ?search= 列表（词和结果不丢） */
  const goToListCategory = useCallback(
    (item: GlobalSearchItem) => {
      pendingSearchRef.current = null;
      pendingSpecsPresetRef.current = item.specs && Object.keys(item.specs).length ? { ...item.specs } : null;
      pendingGlobalGroupRef.current = item.category.groupId ?? null;
      /* push 向导条目（本事件内唯一的 navigate——同批再 replace 会把 push 覆盖掉），
         随后退列表（存词 + 清 state，不导航）：渲染时 key 已是新条目 ≠ 列表条目，
         恢复条件不成立。浏览器返回 pop 回列表条目 → 恢复列表 */
      navigate(`${location.pathname}${location.search}`, { replace: false });
      rememberListQuery();
      setGlobalListSearch(null);
      pickSub(item.category.slug);
    },
    [navigate, pickSub, rememberListQuery],
  );
  useEffect(() => {
    if (!slug) return;
    const preset = pendingSearchRef.current;
    const groupId = pendingGlobalGroupRef.current;
    const presetSpecs = pendingSpecsPresetRef.current;
    if (preset === null && groupId === undefined && presetSpecs === null) return;
    pendingSearchRef.current = null;
    pendingGlobalGroupRef.current = undefined;
    pendingSpecsPresetRef.current = null;
    if (groupId !== undefined) setGroupId((prev) => (prev === groupId ? prev : groupId));
    if (preset !== null) {
      cameFromGlobalSearchRef.current = true;
      setSearchDraft(preset);
    }
    if (presetSpecs) {
      const cat = cats.find((c) => c.slug === slug);
      /* 分类还没加载完：留在 ref 里等 cats 就绪后本 effect 重跑（依赖里有 cats） */
      if (!cat && cats.length === 0) {
        pendingSpecsPresetRef.current = presetSpecs;
        return;
      }
      const catFields = (cat?.columns ?? []).filter((col) => !col.displayOnly).map((col) => col.key) as string[];
      const nextSpecs: Record<string, string> = {};
      const nextSkipped = new Set<string>();
      for (const field of catFields) {
        const value = presetSpecs[field];
        /* 只收字符串值（与服务端 specValue/选项计数同口径）；缺失/非字符串 → 跳过该项 */
        if (typeof value === 'string' && value) nextSpecs[field] = value;
        else nextSkipped.add(field);
      }
      /* 至少有一个实选值才落结果页：全空落结果是整分类大列表，不如回第一步 */
      if (Object.keys(nextSpecs).length > 0) {
        setSpecs(nextSpecs);
        setSkipped(nextSkipped);
      }
    }
  }, [slug, cats, setGroupId, setSearchDraft]);
  const goToGroupCategories = useCallback(() => {
    clearGlobalList();
    setSlug(null);
    setSpecs({});
    setManualDrafts({});
    setSkipped(new Set());
    setAutoSelectedFields(new Set());
    setSearchDraft('');
    setExpandedKits(new Set());
  }, [setSearchDraft]);
  /* 向导搜索框 ✗：本向导来自全局搜索直达且还没动过任何选项（搜索激活期间自动
     选择/跳过全部暂停，specs/skipped/manualDrafts 保持空）→ 清空即返回搜索页，
     连续搜下一个型号不绕路；已动过选项只清词，不打断真正在选型的人 */
  const handleWizardSearchClear = useCallback(() => {
    if (
      cameFromGlobalSearchRef.current &&
      slug &&
      specKeys.length === 0 &&
      skipped.size === 0 &&
      Object.keys(manualDrafts).length === 0
    ) {
      cameFromGlobalSearchRef.current = false;
      skipNextMobileSearchCollapseRef.current = true;
      /* 还原到发起搜索时的大类/首页（跨大类直达时 groupId 已被改为产品大类，
         不还原的话标题面包屑会停在产品的大类上） */
      setGroupId(globalSearchOriginRef.current);
      globalSearchOriginRef.current = null;
      goToGroupCategories();
      setMobileSearchOpen(true);
      setGlobalSearchFocusSignal((n) => n + 1);
      return;
    }
    setSearchDraft('');
  }, [
    goToGroupCategories,
    manualDrafts,
    setGlobalSearchFocusSignal,
    setGroupId,
    setSearchDraft,
    skipped.size,
    slug,
    specKeys.length,
  ]);
  const resetCurrentCategory = useCallback(() => {
    // 清空后回到第一个步骤：显式「回顶」意图，避免桌面居中公式把带大图的高步骤滚到中间
    discardWizardSnapshot();
    clearGlobalList();
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
        // 必须减冻结头高度：不减会把第一步（含首项选项卡）钉在冻结头底下，
        // 「清空后第一项选项文字被遮一半」正是这里漏减造成的
        const offset = stickyHeaderOffsetOf(container, isDesktop);
        container.scrollTo({
          top: Math.max(0, eRect.top - cRect.top + container.scrollTop - offset - 8),
          behavior: 'auto',
        });
      } else {
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    }, 40);
  }, [discardWizardSnapshot, isDesktop, setSearchDraft]);
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
      clearGlobalList();
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

  /* 恢复的快照对不上现状（分类/分组被删除或隐藏）：分类没了清空回首页；分组变了
     按分类当前所属分组自愈——避免每次进入都停在空向导 */
  useEffect(() => {
    if (!cats.length) return;
    if (slug) {
      const live = cats.find((c) => c.slug === slug);
      if (!live) {
        goHome();
        return;
      }
      if (live.groupId && live.groupId !== groupId) setGroupId(live.groupId);
      return;
    }
    if (groupId && !groups.some((g) => g.id === groupId)) goHome();
  }, [cats, slug, groupId, groups, goHome]);
  const restart = useCallback(() => {
    // 重新选择：同 resetCurrentCategory，清空后回顶
    discardWizardSnapshot();
    clearGlobalList();
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
        // 同 resetCurrentCategory：减冻结头高度，避免第一步被钉在冻结头底下
        const offset = stickyHeaderOffsetOf(container, isDesktop);
        container.scrollTo({
          top: Math.max(0, eRect.top - cRect.top + container.scrollTop - offset - 8),
          behavior: 'auto',
        });
      } else {
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    }, 120);
  }, [discardWizardSnapshot, isDesktop]);
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
      // 服务端快照的 productIds 上限 500（selection-shares.ts）：匹配结果超限时不再
      // 冻结产品列表，改存纯参数快照（productIds 空）——分享链接打开后自动回跳
      // 选型页按 specs 实时过滤（SelectionSharePage 的 selection-mode 分支），结果一致
      const shareSelectionMode = withResults && filteredTotal > 500;
      const productIds =
        withResults && !shareSelectionMode && filteredTotal > 0
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
      // 预创建（autoCreated）是后台任务：失败静默即可（结果卡跳工单有模型页/选型首页
      // 回退），绝不能把「产品数量不能超过 500」这类快照限制弹给没在分享的用户
      if (!autoCreated) {
        const resp = typeof err === 'object' && err !== null ? (err as Record<string, unknown>).response : undefined;
        const data = typeof resp === 'object' && resp !== null ? (resp as Record<string, unknown>).data : undefined;
        const apiMsg =
          typeof data === 'object' && data !== null ? (data as Record<string, unknown>).message : undefined;
        const errMsg = err instanceof Error ? err.message : t('selectionPage.unknownError');
        toast(t('selectionPage.share.failed', { message: apiMsg || errMsg }), 'error');
      }
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
  // 门槛判定未完成（SWR key 为 null）时 isLoading=false 且 cats 为空，需按加载中处理，
  // 否则统计区先闪「0 个分类」、目录区闪空白，数据到达后才被顶掉
  const categoriesPending = !browseGate.dataReady || categoriesLoading;
  const categoryStatsUnavailable = (categoriesPending || categoriesError) && cats.length === 0;
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
    categoriesPending && cats.length === 0 ? (
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

  /* 「继续上次选型」问询横幅：主动进入 + 有快照时显示在选型首页顶部，
     恢复与否交还用户（继续 = 应用快照；重新开始 = 删快照保持全新） */
  const resumeBanner = pendingResume && (
    <div
      className={`mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary-container/25 bg-primary-container/8 px-3 py-2.5 md:px-4 ${selectionMotion}`}
    >
      <Icon name="history" size={18} className="shrink-0 text-primary-container" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-on-surface">{t('selectionPage.resume.title')}</p>
        <p className="mt-0.5 truncate text-xs text-on-surface-variant">
          {t('selectionPage.resume.detail', {
            category: catBySlug.get(pendingResume.slug ?? '')?.name ?? pendingResume.slug ?? '',
            count: Object.keys(pendingResume.specs ?? {}).length,
          })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={() => applyPendingResume(pendingResume)}
          className={`rounded-lg bg-primary-container px-3 py-1.5 text-xs font-bold text-on-primary hover:opacity-90 md:text-sm ${selectionPress}`}
        >
          {t('selectionPage.resume.continue')}
        </button>
        <button
          onClick={dismissPendingResume}
          className={`rounded-lg border border-outline-variant/30 px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high/50 md:text-sm ${selectionPress}`}
        >
          {t('selectionPage.resume.restart')}
        </button>
      </div>
    </div>
  );

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
                          // overflow-hidden：把白色图片底裁进外层圆角，否则其方角会盖住边框圆角（左上/右上看着缺角）
                          className={`group relative flex flex-col items-stretch rounded-xl border overflow-hidden transition-all duration-150 ${isDesktop ? 'active:scale-[0.97]' : ''} ${
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
  ) : !liveCat && categoriesPending ? (
    /* 快照恢复/重进时分类列表还在加载：先给加载态，不闪「分类为空」 */
    <div className="flex min-h-[260px]">
      <PageRefreshIndicator label={t('selectionPage.categories.refreshing')} />
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

  /* ── 全站搜索列表（「查看全部」）：向导搜索列表同款卡片栈，结果跨全部分类，
     每张卡渲染自己分类的参数列；询价条/询价车与向导共用 ── */
  const globalSearchListContent = (
    /* 标题/计数/返回已上提工具栏左侧（toolbarSummary），列表区直接从状态/卡片开始 */
    <div className="px-0 md:px-6 py-4 md:py-6">
      {/* 防抖等待期 + query 提交帧间隙（词已变、响应未落地）都算加载：
          否则会先闪一帧「没有匹配的产品」再转圈出列表 */}
      {globalList.loading || (globalList.draftValue && !globalList.settled) ? (
        <SelectionInlineLoading label={t('selectionPage.globalSearch.loading')} />
      ) : globalList.error ? (
        <div className="flex flex-col items-center gap-2 py-12 text-sm text-on-surface-variant">
          <span>{t('selectionPage.globalSearch.error')}</span>
          <button
            type="button"
            onClick={globalList.retry}
            className={`rounded-lg border border-outline-variant/30 px-3 py-1.5 text-xs font-medium text-on-surface ${selectionPress}`}
          >
            {t('selectionPage.globalSearch.retry')}
          </button>
        </div>
      ) : globalList.items.length > 0 ? (
        /* 与向导搜索列表同款容器（px/py 外层 + relative min-h + space-y-3 卡片栈），
            不叠 mt——间距和向导搜索结果完全一致 */
        <div className="relative min-h-[220px]">
          <div
            className={`space-y-3 pb-4 ${globalList.loadingMore ? 'pointer-events-none select-none opacity-60' : ''}`}
          >
            {globalList.items.map((item) => {
              const itemCat = catBySlug.get(item.category.slug);
              return (
                <ResultCard
                  key={item.id}
                  product={item}
                  columns={item.category.columns ?? itemCat?.columns ?? []}
                  kitListTitle={getKitListTitle((itemCat?.optionOrder || null) as Record<string, unknown> | null, item)}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={() => toggleInquiryProduct(item)}
                  onToggleInquiry={canInquiry ? () => toggleInquiryProduct(item) : undefined}
                  expandedKits={expandedKits}
                  onToggleKit={toggleKit}
                  navigate={navigate}
                  isMobile={!isDesktop}
                  categoryName={item.category.name}
                  onCategoryClick={() => goToListCategory(item)}
                />
              );
            })}
            {/* 滚到列表尾部自动加载下一页（哨兵进入视口即触发，无手动按钮/进度指示） */}
            {globalList.hasMore ? <div ref={globalListSentinelRef} aria-hidden className="h-2" /> : null}
          </div>
        </div>
      ) : (
        /* 空态在可视区域内上下居中（min-h 撑起，不再贴顶偏上） */
        <div className="flex min-h-[28vh] flex-col items-center justify-center py-8 text-center md:min-h-[30vh]">
          <Icon name="search_off" size={36} className="mb-2 text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">{t('selectionPage.globalSearch.emptyList')}</p>
        </div>
      )}
    </div>
  );

  /* ── batch action bar ── */
  const actionBar = inquiryCart.items.length > 0 && !mobileSearchTakeover && (
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
    !isDesktop && inquiryCart.items.length > 0 && !mobileSearchTakeover ? (
      <div aria-hidden className="h-14 shrink-0" />
    ) : null;

  /* 全页搜索底部操作条：询价条同款页面级固定条（同 bottom 计算：底部导航/
     安全区/软键盘让位）。计数占左侧（翻页小转圈出现只在计数区截断，右侧按钮
     纹丝不动）；「查看全部 / 关闭搜索」幽灵样式按钮居右 */
  const mobileSearchBottomBar = mobileSearchTakeover ? (
    <div
      className="fixed inset-x-0 z-[70] flex items-center gap-1.5 border-t border-outline-variant/12 bg-surface-container-high px-3 py-1 shadow-[0_-6px_18px_rgba(15,23,42,0.12)]"
      style={{
        bottom: `calc(${hideMobileBottomNav ? '0px' : '3.5rem'} + env(safe-area-inset-bottom, 0px) + var(--visual-viewport-bottom, 0px))`,
      }}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-on-surface-variant">
        <span className="truncate tabular-nums">
          {mobileSearch.loading
            ? t('selectionPage.globalSearch.loading')
            : mobileSearch.total > 0
              ? t('selectionPage.globalSearch.total', { total: mobileSearch.total.toLocaleString() })
              : t('selectionPage.globalSearch.emptyList')}
        </span>
        {mobileSearch.loadingMore ? (
          <Icon name="refresh" size={13} className="animate-spin text-current motion-reduce:animate-none" />
        ) : null}
      </span>
      {mobileSearch.query && mobileSearch.total > 0 && !mobileSearch.loading ? (
        /* 「查看全部」：无按钮底色，保留主题色文字作为主操作提示 */
        <button
          type="button"
          onClick={() => enterGlobalList(mobileSearch.query)}
          className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-primary-container ${selectionPress}`}
        >
          <Icon name="open_in_full" size={11} />
          {t('selectionPage.globalSearch.viewAll')}
        </button>
      ) : null}
      {/* 「关闭搜索」：幽灵样式（无底色/描边） */}
      <button
        type="button"
        onClick={closeMobileSearch}
        className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-on-surface-variant hover:text-on-surface ${selectionPress}`}
      >
        <Icon name="close" size={13} />
        {t('selectionPage.globalSearch.close')}
      </button>
    </div>
  ) : null;
  const mobileSearchBarSpacer = mobileSearchTakeover ? <div aria-hidden className="h-10 shrink-0" /> : null;

  const shellTitle = (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 md:gap-1.5">
      {isDesktop ? (
        <>
          <button onClick={goHome} className={`truncate hover:text-primary-container ${selectionPress}`}>
            {pageTitle}
          </button>
          {phase === 'search' ? (
            /* 全站搜索列表面包屑不带分类：结果是跨分类的，挂任何大类都有误导；
               每张卡右上角的两级分类徽章（可点进分类）才是分类导航入口 */
            <>
              <Icon name="chevron_right" size={16} className="shrink-0 text-on-surface-variant/35" />
              <span className="truncate text-primary-container">{t('selectionPage.globalSearch.listTitle')}</span>
            </>
          ) : null}
          {phase !== 'search' && group && (
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
          {phase !== 'search' && liveCat && (
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
          ) : phase === 'search' ? (
            /* 全站搜索列表：面包屑无分类，末端固定「搜索结果」 */
            <>
              <button onClick={goHome} className="max-w-[5.25rem] truncate text-on-surface-variant">
                {pageTitle}
              </button>
              <Icon name="chevron_right" size={14} className="shrink-0 text-on-surface-variant/35" />
              <span className="min-w-0 flex-1 truncate text-left text-primary-container">
                {t('selectionPage.globalSearch.listTitle')}
              </span>
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
    phase === 'search'
      ? t('selectionPage.globalSearch.listDescription')
      : phase === 'group'
        ? pageDesc
        : phase === 'sub'
          ? t('selectionPage.intro.sub')
          : curField
            ? t('selectionPage.intro.wizard', { count: currentStepOptionCountText })
            : t('selectionPage.intro.completed', { count: filteredTotal.toLocaleString() });

  const mobileSelectedSummary =
    !isDesktop && phase === 'wizard' && specKeys.length > 0 && !search && !wizardSearchFocused ? (
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

  /* 向导已选 chips 条：纵向滚轮转横向滚动 + 鼠标按住拖动平移。条本身可滚
     （overflow-x-auto），但鼠标滚轮只有纵向分量、对横向条无效，原生也不支持按住拖动，
     滚动条又被 scrollbar-none 隐藏——都不补的话用户完全无从滚动（「选项固定住了
     不能横向滚动」的反馈正是这里）。触控板原生横滑（deltaX）不劫持；条没溢出时也
     不劫持，页面滚动行为不变。拖动超过阈值后松手不触发 chip 点击（防止拖动变成掉选）。 */
  const wizardChipsStripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wizardChipsStripRef.current;
    if (!el || !isDesktop) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth + 2) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };
    let dragging = false;
    let dragStartX = 0;
    let dragStartScroll = 0;
    let dragMoved = false;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      dragging = true;
      dragMoved = false;
      dragStartX = event.clientX;
      dragStartScroll = el.scrollLeft;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || event.buttons !== 1) return;
      const dx = event.clientX - dragStartX;
      if (!dragMoved && Math.abs(dx) < 5) return;
      if (!dragMoved) {
        dragMoved = true;
        el.style.userSelect = 'none';
      }
      el.scrollLeft = dragStartScroll - dx;
    };
    const onPointerUp = () => {
      dragging = false;
      if (dragMoved) el.style.userSelect = '';
    };
    const onClickCapture = (event: MouseEvent) => {
      if (dragMoved) {
        event.preventDefault();
        event.stopPropagation();
        dragMoved = false;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    el.addEventListener('click', onClickCapture, true);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, [isDesktop, phase]);

  /* 移动端搜索激活时替代统计条（产品大类/分类/型号）的摘要行：共 N 个结果 +
     查看全部——计数在标题下一眼可见，不必把内联结果滚到底才看到 footer */
  const toolbarSummary =
    phase === 'search' ? (
      /* 全站搜索列表：工具栏左侧只放「搜索结果 · 共 N 个结果」信息；
         返回是操作，归右侧操作区（桌面）/标题图标位（移动端） */
      <div className="flex min-w-0 items-center gap-3 overflow-x-auto scrollbar-none">
        <span className="shrink-0 text-sm font-semibold text-on-surface">
          {t('selectionPage.globalSearch.listTitle')}
        </span>
        {/* 计数/状态段固定宽度槽位：加载中 → 共 N 个结果 → 空态描述三态文案宽窄
            不同，不定宽会带着整行左右跳（tabular-nums + truncate 兜底） */}
        <span className="w-36 shrink-0 truncate text-xs text-on-surface-variant tabular-nums">
          {globalList.loading
            ? t('selectionPage.globalSearch.loading')
            : globalList.total > 0
              ? t('selectionPage.globalSearch.total', { total: globalList.total.toLocaleString() })
              : t('selectionPage.globalSearch.listDescription')}
        </span>
      </div>
    ) : phase === 'group' ? (
      !mobileSearchTakeover ? (
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
      ) : null
    ) : phase === 'sub' && group ? (
      !mobileSearchTakeover ? (
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
      ) : null
    ) : phase === 'wizard' && !search ? (
      /* 搜索激活时隐藏「已选 X/Y」与 chips（移动端 mobileSelectedSummary 同条件）：
         搜索结果视图里进度条没有参照意义 */
      <div
        ref={wizardChipsStripRef}
        className="flex min-w-0 items-center gap-1.5 overflow-x-auto scrollbar-none md:gap-2"
      >
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
              discardWizardSnapshot();
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

  /* 全局搜索文案（组件保持纯净由这里传翻译值） */
  const globalSearchLabels = useMemo<GlobalSearchLabels>(
    () => ({
      empty: t('selectionPage.globalSearch.empty'),
      error: t('selectionPage.globalSearch.error'),
      listLabel: t('selectionPage.globalSearch.listLabel'),
      loadMore: t('selectionPage.globalSearch.loadMore'),
      loading: t('selectionPage.globalSearch.loading'),
      retry: t('selectionPage.globalSearch.retry'),
      viewAll: t('selectionPage.globalSearch.viewAll'),
      formatTotal: (total: number) => t('selectionPage.globalSearch.total', { total }),
    }),
    [t],
  );

  const selectionToolbarCore = (
    <div className="flex min-h-0 items-center gap-2 md:min-h-11 md:flex-wrap md:justify-between md:gap-3">
      {/* wizard 阶段左侧已选 chips 吸收全部挤压空间（内层 overflow-x-auto 接管溢出）。
          v5.3.8 只给了 min-w-0，但右侧仍是 flex-1（basis 0 先让位）——chips 多到结果阶段
          （8 个字段全选 + 清空按钮）时右侧还是被压到内容宽度以下换行变形。改为：
          桌面右侧 flex-none 锁定自然宽度（搜索框/生成链接/全部分类永不变形），
          左侧 flex-1 吃剩余空间，chips 横向滚动；窄分辨率（1366@125% 缩放≈1093px）也稳。 */}
      <div
        className={`min-w-0 items-center gap-2 md:gap-3 ${phase === 'wizard' ? 'hidden md:flex md:min-w-0 md:flex-1' : 'flex'}`}
      >
        {toolbarSummary}
      </div>
      <div
        className={`flex min-h-8 flex-nowrap items-center justify-end gap-1.5 md:ml-auto md:min-h-9 md:flex-wrap md:gap-2 ${phase === 'wizard' ? 'min-w-0 flex-1 md:flex-none' : 'ml-auto'}`}
      >
        {isDesktop && (phase === 'group' || phase === 'sub') ? (
          /* 全局型号搜索：跨全部选型产品搜型号/名称（向导阶段用向导自己的分类内搜索） */
          <GlobalSearchDropdown
            placeholder={t('selectionPage.globalSearch.placeholder')}
            labels={globalSearchLabels}
            onSelect={handleGlobalSelect}
            focusSignal={globalSearchFocusSignal}
            onViewAll={enterGlobalList}
          />
        ) : isDesktop && phase === 'search' ? (
          /* 搜索框直接绑列表（改词即刷新列表，无下拉）。返回走面包屑大类段。
             外层 wrapper 定宽——SEARCH_FIELD_CLASS 自带 w-full，直接拼 w-64 会被
             w-full 干扰把框撑长、连带把「重新选型」挤到下一行 */
          <div className="w-64 shrink-0">
            <SearchField
              inputProps={globalList.inputProps}
              value={globalList.draftValue}
              onClear={() => globalList.setValue('')}
              placeholder={t('selectionPage.globalSearch.placeholder')}
              className="w-full"
            />
          </div>
        ) : null}
        {phase === 'wizard' && liveCat ? (
          <SearchField
            inputProps={{
              ...searchDraftInputProps,
              onFocus: () => setWizardSearchFocused(true),
              onBlur: () => setWizardSearchFocused(false),
            }}
            value={searchDraftInputValue}
            onClear={handleWizardSearchClear}
            placeholder={t('selectionPage.searchPlaceholder')}
            className={`min-w-[9.5rem] flex-1 sm:w-64 sm:flex-none ${selectionMotion}`}
          />
        ) : null}
        {isDesktop && phase !== 'search' ? (
          /* 分享的是单分类/大类链接，全站搜索列表（跨分类）不渲染，也给工具栏让位 */
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
          /* 完全重新开始选型（回选型首页并清空）：此前叫「全部分类」+收纳箱图标，
             用户看不懂这是重选入口，改为明确的「重新选型」+ 重来图标 */
          <button
            onClick={goHome}
            data-tooltip-ignore
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface md:h-9 md:w-auto md:gap-1.5 md:px-3 ${selectionPress}`}
            aria-label={t('selectionPage.restartAll')}
          >
            <Icon name="restart_alt" size={14} />
            <span className="hidden text-xs font-bold md:inline">{t('selectionPage.restartAll')}</span>
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
    !isDesktop && phase === 'search' ? (
      /* 全站搜索列表态（移动端）：搜索行常显 + 全站统计条；不垫 core——此阶段
         右侧操作按钮为空，core 的空右容器会留出一条空行（min-h 占位） */
      <div className="flex w-full flex-col items-stretch gap-2">
        <SearchField
          inputProps={globalList.inputProps}
          value={globalList.draftValue}
          onClear={() => globalList.setValue('')}
          placeholder={t('selectionPage.globalSearch.placeholder')}
          className="w-full"
        />
        {toolbarSummary}
      </div>
    ) : !isDesktop &&
      mobileSearchTakeover /* 全页搜索模式：搜索行/结果/底栏同在内容区的一张卡里（GlobalSearchMobilePanel），
         工具栏让位——吸顶块只剩标题行，面板顶的搜索框照样常驻可见 */ ? null : !isDesktop &&
      (mobileSearchOpen || phase === 'wizard') ? (
      <div className="flex w-full flex-col items-stretch gap-2">
        {selectionToolbarCore}
        {phase === 'wizard' ? mobileSelectedSummary : null}
      </div>
    ) : (
      selectionToolbarCore
    );

  /* ── 移动端冻结头右侧操作（与 PC 工具栏对齐）──
     PC 端「生成分类/大类链接」「重新选型」在工具栏里，子分类页/向导页都有；
     移动端工具栏宽度有限，统一收到标题右侧图标位。向导页/子分类页=分类链接+
     重新选型、大类落地页=大类链接（与 PC 一致，人在首页重新选型无意义）。
     大类/子分类阶段另有全局型号搜索：点搜索图标在标题正下方展开一行（非弹窗），
     向导阶段不出现（用向导自己的分类内搜索）。 */
  const mobileHeaderSearchButton = (phase === 'group' || phase === 'sub') && (
    <button
      onClick={() => setMobileSearchOpen((v) => !v)}
      data-tooltip-ignore
      // 冻结头右侧：移动端不带 hover/按压（iOS 粘滞）
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant"
      aria-label={t('selectionPage.globalSearch.toggle')}
      aria-expanded={mobileSearchOpen}
    >
      <Icon name="search" size={15} />
    </button>
  );
  const mobileHeaderShareButton = (pending: boolean, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      disabled={pending}
      data-tooltip-ignore
      // 冻结头右侧：移动端不带 hover/按压（iOS 粘滞）
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant disabled:opacity-50"
      aria-label={pending ? t('selectionPage.generating') : label}
    >
      <Icon name="share" size={15} />
    </button>
  );
  const mobileHeaderRestartButton = (
    <button
      onClick={goHome}
      data-tooltip-ignore
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant"
      aria-label={t('selectionPage.restartAll')}
    >
      <Icon name="restart_alt" size={15} />
    </button>
  );
  const shellActions = !isDesktop ? (
    <div className="flex items-center gap-1">
      {mobileHeaderSearchButton}
      {phase === 'wizard' && liveCat
        ? mobileHeaderShareButton(isCategorySharePending, t('selectionPage.share.categoryLink'), () =>
            handleShare(false),
          )
        : phase === 'sub' && group
          ? mobileHeaderShareButton(
              isSubSharePending,
              t('selectionPage.share.categoryLink'),
              () => void handleShareSub(group.id),
            )
          : phase === 'group'
            ? mobileHeaderShareButton(
                isEntrySharePending,
                t('selectionPage.share.groupLink'),
                () => void handleToolbarShare(),
              )
            : null}
      {phase === 'search' ? (
        /* 搜索列表态：标题位给「返回进入前的大类页」（重新选型在此阶段语义弱——
           还没开始选型；回首页走面包屑「产品选型」即可） */
        <button
          onClick={exitGlobalList}
          data-tooltip-ignore
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant"
          aria-label={t('selectionPage.globalSearch.back')}
        >
          <Icon name="arrow_back" size={15} />
        </button>
      ) : phase !== 'group' ? (
        mobileHeaderRestartButton
      ) : null}
    </div>
  ) : null;

  /* 阶段切换（进向导/换大类）自动收起移动端全局搜索行；
     「清空即返回搜索」的返回路径自带展开意图，豁免一次 */
  useEffect(() => {
    if (skipNextMobileSearchCollapseRef.current) {
      skipNextMobileSearchCollapseRef.current = false;
      return;
    }
    setMobileSearchOpen(false);
  }, [phase]);

  const selectionPhaseKey = mobileSearchTakeover
    ? /* 全页搜索进出各播一次入场动画（关闭后分类网格重新滑入） */
      'selection-mobile-search'
    : phase === 'group'
      ? 'selection-groups'
      : phase === 'sub'
        ? `selection-sub-${groupId || 'none'}`
        : phase === 'search'
          ? 'selection-search'
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
    <motion.div
      key={selectionPhaseKey}
      {...phaseMotionProps}
      className={mobileSearchTakeover ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'min-w-0'}
    >
      {mobileSearchTakeover ? (
        /* 全页搜索模式：搜索行 + 结果 + 底部操作条（共 N / 查看全部 / 关闭搜索）
           同属一张卡片，钉在标题下方与页面底之间（flex 链给足高度，结果区内部
           滚动、滚到底自动翻页；分类网格/恢复横幅让位） */
        <GlobalSearchMobilePanel
          s={mobileSearch}
          labels={globalSearchLabels}
          placeholder={t('selectionPage.globalSearch.placeholder')}
        />
      ) : (
        <>
          {phase === 'group' && resumeBanner}
          {phase === 'group' && groupContent}
          {phase === 'sub' && subContent}
          {phase === 'search' && globalSearchListContent}
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
        </>
      )}
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

  /* 浏览门槛拦截（require_login_selection）：显示与首页一致的模糊锁屏（选型文案）。
    pendingLock：门槛已开且本地无记住的会话，判定期间直接渲染锁屏，
    避免先画页面内容、判定完成再整页替换（闪动） */
  if (browseGate.blocked || browseGate.pendingLock) {
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
        mobileContentClassName={`flex min-h-full flex-col gap-3 px-3 py-3 pt-0 ${hideMobileBottomNav ? 'pb-3' : 'pb-safe-nav'} ${
          /* 全页搜索：内容整体封顶在视口内（面板内部滚动，页面本身不再滚动），
             flex 链的 min-h-0 收缩才有确限高度可依 */
          mobileSearchTakeover ? 'max-h-full' : ''
        }`}
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
          className={`app-public-tool-page app-public-tool-page-selection !h-auto min-h-full flex flex-col gap-3 ${
            /* !shrink/!min-h-0：.app-page 基础样式把 flex-shrink 钉死为 0、
               min-h-full 又垫了底——不强制压掉它们，面板会被内容撑破 */
            mobileSearchTakeover ? 'flex-1 !shrink !min-h-0' : ''
          }`}
          contentClassName={`flex flex-col ${mobileSearchTakeover ? 'min-h-0 flex-1 -mt-[1.125rem]' : ''}`}
        >
          <AdminContentPanel
            className={`flex flex-col overflow-visible ${
              /* 全页搜索：回归默认卡片样式（与标题卡同款）+ 撑满剩余高度 */
              mobileSearchTakeover
                ? 'min-h-0 flex-1 overflow-hidden !bg-surface-container-low'
                : phase === 'group' || phase === 'sub'
                  ? 'rounded-none border-0 bg-transparent'
                  : ''
            }`}
          >
            {contentBody}
            {mobileActionBarSpacer}
            {mobileSearchBarSpacer}
            {actionBar}
            {mobileSearchBottomBar}
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
