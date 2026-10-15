import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useImeSafeSearchInput } from '../../hooks/useImeSafeSearchInput';
import { searchSelectionProducts, type SelectionSearchResult } from '../../api/selections';
import { useDebouncedValue, selectionPress } from './selectionUtils';
import SearchField from '../shared/SearchField';
import Icon from '../shared/Icon';

/* 选型页全局型号搜索（大类/子分类阶段）：跨全部选型产品搜 modelNo/name。
   数据走现成的 GET /api/selections/search（searchSelectionProducts），
   桌面 = 工具栏 SearchField + 下方下拉面板；移动端 = 标题下展开行 + 内联结果。
   useGlobalSelectionSearch 同时供 SelectionPage 的「查看全部」列表页复用
   （onSelect 省略 = 纯列表模式，不点行跳转）。 */

export type GlobalSearchItem = SelectionSearchResult['items'][number];

export interface GlobalSearchLabels {
  empty: string;
  error: string;
  listLabel: string;
  loadMore: string;
  loading: string;
  retry: string;
  viewAll: string;
  formatTotal: (total: number) => string;
}

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

export function useGlobalSelectionSearch(onSelect?: (item: GlobalSearchItem) => void) {
  const { draftValue, setValue, inputProps } = useImeSafeSearchInput({ initialValue: '' });
  const query = useDebouncedValue(draftValue.trim(), SEARCH_DEBOUNCE_MS);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GlobalSearchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  /* 重试计数：query 不变时重发请求；每次新词自增作废在途响应（竞态守卫） */
  const [retryTick, setRetryTick] = useState(0);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const reqId = ++reqIdRef.current;
    if (!query) {
      setItems([]);
      setTotal(0);
      setPage(1);
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    setItems([]);
    setTotal(0);
    setPage(1);
    searchSelectionProducts(query, 1, PAGE_SIZE)
      .then((result) => {
        if (reqIdRef.current !== reqId) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch(() => {
        /* 401 走浏览门槛由页面级锁接管，这里统一落到可重试的错误态 */
        if (reqIdRef.current !== reqId) return;
        setError(true);
      })
      .finally(() => {
        if (reqIdRef.current !== reqId) return;
        setLoading(false);
      });
  }, [query, retryTick]);

  const loadMore = useCallback(async () => {
    if (!query || loading || loadingMore || items.length >= total) return;
    const reqId = reqIdRef.current;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const result = await searchSelectionProducts(query, nextPage, PAGE_SIZE);
      /* 加载期间换了词：query effect 已重置列表，丢弃这页 */
      if (reqIdRef.current !== reqId) return;
      setItems((prev) => [...prev, ...result.items]);
      setPage(nextPage);
      setTotal(result.total);
    } catch {
      if (reqIdRef.current === reqId) setError(true);
    } finally {
      if (reqIdRef.current === reqId) setLoadingMore(false);
    }
  }, [query, loading, loadingMore, items.length, total, page]);

  const retry = useCallback(() => setRetryTick((t) => t + 1), []);

  const handleSelect = useCallback(
    (item: GlobalSearchItem) => {
      setValue('');
      setOpen(false);
      setItems([]);
      setTotal(0);
      setPage(1);
      onSelect?.(item);
    },
    [onSelect, setValue],
  );

  return {
    draftValue,
    inputProps,
    setValue,
    setOpen,
    query,
    open,
    items,
    total,
    hasMore: items.length < total,
    loading,
    loadingMore,
    error,
    loadMore,
    retry,
    handleSelect,
  };
}

export type SearchState = ReturnType<typeof useGlobalSelectionSearch>;

/* 行内小转圈（按钮内操作图标惯例：Icon refresh + animate-spin） */
function InlineSpinner() {
  return <Icon name="refresh" size={13} className="animate-spin text-current motion-reduce:animate-none" />;
}

function ResultRow({
  item,
  onSelect,
  withHover,
}: {
  item: GlobalSearchItem;
  onSelect: (item: GlobalSearchItem) => void;
  /* hover/按压反馈只给桌面下拉；移动端内联列表触摸会粘滞（iOS 粘滞
     hover/:active），滑动起手压在某行上会让该行缩放「跳动」 */
  withHover: boolean;
}) {
  const thumb = item.image || item.matchedModelThumbnail || null;
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left ${
        withHover ? `hover:bg-surface-container-high/60 ${selectionPress}` : ''
      }`}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className="h-10 w-10 shrink-0 rounded-lg bg-surface-container object-contain"
        />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container text-on-surface-variant/60">
          <Icon name={item.category.icon || 'category'} size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-on-surface">{item.modelNo || item.name}</span>
        {item.modelNo ? <span className="block truncate text-xs text-on-surface-variant">{item.name}</span> : null}
      </span>
      <span className="max-w-[30%] shrink-0 truncate rounded-md border border-outline-variant/15 bg-surface-container px-2 py-0.5 text-[11px] text-on-surface-variant">
        {item.category.name}
      </span>
    </button>
  );
}

/** 结果行列表（不含计数 footer——footer 由容器放在滚动区外，见各调用处注释） */
function SearchRows({ s, labels, withHover }: { s: SearchState; labels: GlobalSearchLabels; withHover: boolean }) {
  if (s.loading) {
    return (
      <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-on-surface-variant">
        <InlineSpinner />
        {labels.loading}
      </div>
    );
  }
  if (s.error) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-5 text-xs text-on-surface-variant">
        <span>{labels.error}</span>
        <button
          type="button"
          onClick={s.retry}
          className={`rounded-lg border border-outline-variant/30 px-3 py-1 text-xs font-medium text-on-surface ${selectionPress}`}
        >
          {labels.retry}
        </button>
      </div>
    );
  }
  if (s.items.length === 0) {
    return <div className="px-3 py-6 text-center text-xs text-on-surface-variant">{labels.empty}</div>;
  }
  return (
    <div role="listbox" aria-label={labels.listLabel}>
      {s.items.map((item) => (
        <ResultRow key={item.id} item={item} onSelect={s.handleSelect} withHover={withHover} />
      ))}
    </div>
  );
}

/** 底部计数/「查看全部」。必须放在滚动容器**外**（面板 flex 列的固定底行）：
    早期版本做成滚动区内的 sticky bottom-0，iOS 触摸滚动时 sticky 逐帧抖动、
    拉到底回弹还会把整条 footer 往上拽一下；移出滚动区后由外层 overflow-hidden
    裁剪，行也不可能从 footer 下方漏出 */
function SearchFooter({
  s,
  labels,
  onViewAll,
}: {
  s: SearchState;
  labels: GlobalSearchLabels;
  /** 提供时渲染「查看全部」——进入全站结果列表页 */
  onViewAll?: (query: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-outline-variant/10 bg-surface px-2.5 pb-1.5 pt-2 text-[11px] text-on-surface-variant">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="tabular-nums">{labels.formatTotal(s.total)}</span>
        {s.loadingMore ? <InlineSpinner /> : null}
      </span>
      {onViewAll && s.query ? (
        <button
          type="button"
          onClick={() => onViewAll(s.query)}
          className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-semibold text-primary-container ${selectionPress}`}
        >
          <Icon name="open_in_full" size={11} />
          {labels.viewAll}
        </button>
      ) : null}
    </div>
  );
}

/** 链接 IME 安全 inputProps：追加 focus 展开 / Esc 行为（保留原 Enter 组合态拦截） */
function useChainedInputProps(s: SearchState, onEscape: () => void): InputHTMLAttributes<HTMLInputElement> {
  return {
    ...s.inputProps,
    onFocus: () => s.setOpen(true),
    onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
      s.inputProps.onKeyDown?.(e);
      if (e.key === 'Escape') onEscape();
    },
  };
}

/** 桌面：工具栏 SearchField + 下方浮动下拉面板（TopNav 面板模式） */
export function GlobalSearchDropdown({
  placeholder,
  labels,
  onSelect,
  focusSignal = 0,
  onViewAll,
}: {
  placeholder: string;
  labels: GlobalSearchLabels;
  onSelect: (item: GlobalSearchItem) => void;
  /** 变化时聚焦输入框（「清空即返回搜索」回到本页后接续连续搜索） */
  focusSignal?: number;
  onViewAll?: (query: string) => void;
}) {
  const s = useGlobalSelectionSearch(onSelect);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputProps = useChainedInputProps(s, () => {
    if (s.draftValue) s.setValue('');
    else s.setOpen(false);
  });

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  /* 点外收起 */
  useEffect(() => {
    if (!s.open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) s.setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [s.open, s.setOpen]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      {/* wrapper 定宽：SEARCH_FIELD_CLASS 自带 w-full，直接拼 w-56/w-64 会被
          w-full 干扰（同优先级看样式表顺序），宽度失控。宽度取 w-52：再宽会把
          工具栏左侧的统计条（产品大类/分类/型号）挤没 */}
      <div className="w-52 xl:w-64">
        <SearchField
          inputProps={inputProps}
          inputRef={inputRef}
          value={s.draftValue}
          onClear={() => {
            s.setValue('');
            inputRef.current?.focus();
          }}
          placeholder={placeholder}
          className="w-full"
        />
      </div>
      {s.open && s.query ? (
        /* 面板限高、列表内部滚动（overscroll-contain 断滚动链，滚轮/触摸不会
           穿透带动页面）；计数/「查看全部」footer 是滚动区外的固定底行——
           不随列表滚动，也不会被触摸回弹拽动 */
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-[80] flex max-h-[min(24rem,55vh)] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface shadow-dropdown">
          {/* 滚到底自动加载下一页（loadMore 自带并发/翻完守卫）；overflow-x-hidden
              防结果行/分类徽章把内容横向撑出面板 */}
          <div
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-1.5 pb-1.5 pt-1.5 scrollbar-hidden"
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) void s.loadMore();
            }}
          >
            <SearchRows s={s} labels={labels} withHover />
          </div>
          {s.items.length > 0 ? <SearchFooter s={s} labels={labels} onViewAll={onViewAll} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** 移动端「全页搜索」面板：搜索行 + 结果区 + 底部操作条（共 N / 查看全部 /
    关闭搜索）同属一张卡片，整卡钉在标题下方到页面底之间（页面侧由 flex 链给足
    高度）。结果区在面板内部滚动，搜索框常驻可见；滚到底自动加载下一页。
    hook 实例（s）由页面持有。 */
export function GlobalSearchMobilePanel({
  s,
  labels,
  placeholder,
  closeLabel,
  onClose,
  onViewAll,
}: {
  s: SearchState;
  labels: GlobalSearchLabels;
  placeholder: string;
  closeLabel: string;
  onClose: () => void;
  onViewAll?: (query: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  /* Esc = 清词（关闭入口是底栏「关闭搜索」按钮，不绑键盘行为） */
  const inputProps = useChainedInputProps(s, () => {
    if (s.draftValue) s.setValue('');
  });

  /* 面板挂载即聚焦输入 */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    /* 卡片外壳由页面侧的 AdminContentPanel 提供（与标题卡/统计卡同款）；这里只
       排内部三段：搜索行 / 结果区 / 底部操作条 */
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 搜索行：面板顶（面板钉满剩余视口高，滚动只发生在下方结果区） */}
      <div className="shrink-0 px-2.5 pt-2.5">
        <SearchField
          inputProps={inputProps}
          inputRef={inputRef}
          value={s.draftValue}
          onClear={() => {
            s.setValue('');
            inputRef.current?.focus();
          }}
          placeholder={placeholder}
          className="w-full"
        />
      </div>
      {/* 结果区：内部滚动 + 滚到底自动翻页；未输入词/无匹配时空态居中 */}
      <div
        className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain px-1.5 pb-1.5 scrollbar-hidden"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) void s.loadMore();
        }}
      >
        {!s.loading && !s.error && s.items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
            <Icon name="search_off" size={36} className="text-on-surface-variant/20" />
            <p className="text-sm text-on-surface-variant">{labels.empty}</p>
          </div>
        ) : (
          <SearchRows s={s} labels={labels} withHover={false} />
        )}
      </div>
      {/* 底部操作条：卡片内压一层深一档的底色 + 上边线，与结果区拉开层次
          （询价条同款 bg-surface-container-high） */}
      <div className="flex shrink-0 items-center gap-1.5 rounded-b-xl border-t border-outline-variant/15 bg-surface-container-high px-3 pb-2 pt-2 text-xs text-on-surface-variant">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate tabular-nums">
            {s.loading ? labels.loading : s.total > 0 ? labels.formatTotal(s.total) : labels.empty}
          </span>
          {s.loadingMore ? <InlineSpinner /> : null}
        </span>
        {onViewAll && s.query && s.total > 0 && !s.loading ? (
          <button
            type="button"
            onClick={() => onViewAll(s.query)}
            className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-semibold text-primary-container ${selectionPress}`}
          >
            <Icon name="open_in_full" size={11} />
            {labels.viewAll}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-medium text-on-surface-variant hover:text-on-surface ${selectionPress}`}
        >
          <Icon name="close" size={12} />
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
