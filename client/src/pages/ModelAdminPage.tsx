import { AnimatePresence, motion } from 'framer-motion';
import { lazy, startTransition, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { mutate as swrMutate } from 'swr';
import useSWRInfinite from 'swr/infinite';
import { categoriesApi, type CategoryItem } from '../api/categories';
import { modelApi, type DeletedModelListItem, type ModelGroupItem, type ServerModelListItem } from '../api/models';
import EditDialog from '../components/model-admin/EditDialog';
import PreviewOperationsModal from '../components/model-admin/PreviewOperationsModal';
import { formatModelDateTime, formatSize } from '../components/model-admin/shared';
import { AdminButton } from '../components/shared/AdminControls';
import { AdminTableHeadCell, AdminTableHeadRow, ADMIN_TABLE_HEAD_CLASS } from '../components/shared/AdminDataTable';
import { AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import ModelThumbnail from '../components/shared/ModelThumbnail';
import ResponsiveSectionTabs, { type ResponsiveSectionTab } from '../components/shared/ResponsiveSectionTabs';
import SearchField from '../components/shared/SearchField';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { useVisibleItems } from '../hooks/useVisibleItems';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';

// ── Constants ──────────────────────────────────────────────────────────────

const MODEL_ADMIN_PAGE_SIZE = 60;
const MODEL_ADMIN_VISIBLE_BATCH_SIZE = 80;
const MOBILE_MODEL_VISIBLE_BATCH_SIZE = 40;
const DELETED_MODEL_PAGE_SIZE = 50;
const MERGE_SUGGESTION_PAGE_SIZE = 40;
const CATEGORY_FILTER_ALL = '__all__';
const MODEL_ADMIN_COUNT_KEY = '/models/count?grouped=false';
const MODEL_ADMIN_PANEL_CLASS =
  'rounded-lg border border-outline-variant/10 bg-surface-container-low overflow-auto [scrollbar-gutter:stable] min-h-[calc(100vh-220px)] max-h-[calc(100vh-220px)]';
type ModelAdminTab = 'models' | 'suggestions' | 'groups' | 'deleted';
type DeletedPurgeMode = 'selected' | 'all';
type ModelGroupConfirm =
  | { type: 'remove'; group: ModelGroupItem; modelId: string }
  | { type: 'delete'; group: ModelGroupItem };
type SearchInputProps = ReturnType<typeof useImeSafeSearchInput>['inputProps'];

function AdminSearchField({
  inputProps,
  value,
  onClear,
  placeholder,
  className = '',
}: {
  inputProps: SearchInputProps;
  value: string;
  onClear: () => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <SearchField
      inputProps={inputProps}
      value={value}
      onClear={onClear}
      placeholder={placeholder}
      className={`md:w-72 md:shrink-0 ${className}`}
    />
  );
}

const preloadUploadModal = () => import('../components/shared/UploadModal');
const UploadModal = lazy(preloadUploadModal);

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}

function UploadModalFallback({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-busy="true"
    >
      <div className="flex w-full max-w-lg items-center gap-3 rounded-t-2xl border border-outline-variant/20 bg-surface-container-low px-5 py-4 shadow-2xl sm:rounded-lg">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-container/12 text-primary-container">
          <Icon name="progress_activity" size={20} className="animate-spin" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-on-surface">上传面板加载中</p>
          <p className="mt-0.5 text-xs text-on-surface-variant">正在准备文件选择和转换队列。</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          aria-label="关闭上传面板"
        >
          <Icon name="close" size={18} />
        </button>
      </div>
    </div>
  );
}

function UploadModalLoader({
  open,
  onClose,
  onConverted,
}: {
  open: boolean;
  onClose: () => void;
  onConverted: () => void;
}) {
  if (!open) return null;
  return (
    <Suspense fallback={<UploadModalFallback onClose={onClose} />}>
      <UploadModal open={open} onClose={onClose} onConverted={onConverted} />
    </Suspense>
  );
}

function flattenCategoryOptions(categories: CategoryItem[]) {
  return categories.flatMap((category) => [
    { id: category.id, label: category.name },
    ...(category.children || []).map((child) => ({
      id: child.id,
      label: `${category.name} / ${child.name}`,
    })),
  ]);
}

function useModelAdminList(search: string, categoryId: string) {
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const normalizedCategoryId = categoryId === CATEGORY_FILTER_ALL ? '' : categoryId;
  const getKey = useCallback(
    (pageIndex: number, previousPageData: Awaited<ReturnType<typeof modelApi.list>> | null) => {
      if (previousPageData && previousPageData.page >= previousPageData.totalPages) return null;
      return ['/admin/models', debouncedSearch, normalizedCategoryId, pageIndex + 1] as const;
    },
    [debouncedSearch, normalizedCategoryId],
  );

  const { data, error, isLoading, isValidating, mutate, setSize, size } = useSWRInfinite(
    getKey,
    ([, query, selectedCategoryId, page]) =>
      modelApi.list({
        search: query || undefined,
        categoryId: selectedCategoryId || undefined,
        page,
        pageSize: MODEL_ADMIN_PAGE_SIZE,
        grouped: false,
      }),
    { revalidateFirstPage: false },
  );

  useEffect(() => {
    setSize(1);
  }, [debouncedSearch, normalizedCategoryId, setSize]);

  const pages = data || [];
  const items = pages.flatMap((page) => page.items);
  const firstPage = pages[0];
  const lastPage = pages[pages.length - 1];
  const hasMore = Boolean(lastPage && lastPage.page < lastPage.totalPages);
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1] && !error);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

  return {
    items,
    total: firstPage?.total || 0,
    isLoadingInitial: isLoading && pages.length === 0,
    isLoadingMore,
    isValidating,
    hasMore,
    loadMore,
    mutate,
  };
}

function useMergeSuggestionPages(enabled: boolean) {
  const getKey = useCallback(
    (pageIndex: number, previousPageData: Awaited<ReturnType<typeof modelApi.getMergeSuggestions>> | null) => {
      if (!enabled) return null;
      if (previousPageData && pageIndex * MERGE_SUGGESTION_PAGE_SIZE >= previousPageData.total) return null;
      return ['/model-groups/suggestions', pageIndex + 1] as const;
    },
    [enabled],
  );

  const { data, error, isLoading, mutate, setSize, size } = useSWRInfinite(
    getKey,
    ([, page]) => modelApi.getMergeSuggestions({ page, pageSize: MERGE_SUGGESTION_PAGE_SIZE }),
    { revalidateFirstPage: false },
  );

  const pages = data || [];
  const groups = pages.flatMap((page) => page.data);
  const total = pages[0]?.total ?? 0;
  const hasMore = groups.length < total;
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1] && !error);
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

  return {
    groups,
    total,
    isLoading: isLoading && pages.length === 0,
    isLoadingMore,
    hasMore,
    loadMore,
    mutate,
  };
}

function useDeletedModelPages(search: string, enabled: boolean, refreshVersion: number) {
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const getKey = useCallback(
    (pageIndex: number, previousPageData: Awaited<ReturnType<typeof modelApi.listDeleted>> | null) => {
      if (!enabled) return null;
      if (previousPageData && previousPageData.page >= previousPageData.totalPages) return null;
      return ['/models/deleted', debouncedSearch, refreshVersion, pageIndex + 1] as const;
    },
    [debouncedSearch, enabled, refreshVersion],
  );

  const { data, error, isLoading, mutate, setSize, size } = useSWRInfinite(
    getKey,
    ([, query, , page]) =>
      modelApi.listDeleted({
        search: query || undefined,
        page,
        pageSize: DELETED_MODEL_PAGE_SIZE,
      }),
    { keepPreviousData: true, revalidateFirstPage: false },
  );

  useEffect(() => {
    if (enabled) setSize(1);
  }, [debouncedSearch, enabled, refreshVersion, setSize]);

  const pages = data || [];
  const items = pages.flatMap((page) => page.items);
  const firstPage = pages[0];
  const lastPage = pages[pages.length - 1];
  const hasMore = Boolean(lastPage && lastPage.page < lastPage.totalPages);
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1] && !error);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

  return {
    items,
    total: firstPage?.total || 0,
    isLoading: isLoading && pages.length === 0,
    isLoadingMore,
    hasMore,
    loadMore,
    mutate,
  };
}

function DeletedModelsPanel({
  items,
  total,
  isLoadingMore,
  hasMore,
  onLoadMore,
  onRestore,
  onRestoreSelected,
  onToggleSelect,
  onToggleSelectLoaded,
  onClearSelection,
  onPurgeSelected,
  onClearAll,
  restoringId,
  restoringSelected,
  selectedIds,
  selectedCount,
  selectedRestorableCount,
  allLoadedSelected,
  purging,
  compact = false,
}: {
  items: DeletedModelListItem[];
  total: number;
  isLoadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onRestore: (model: DeletedModelListItem) => void;
  onRestoreSelected: () => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectLoaded: () => void;
  onClearSelection: () => void;
  onPurgeSelected: () => void;
  onClearAll: () => void;
  restoringId: string | null;
  restoringSelected: boolean;
  selectedIds: Set<string>;
  selectedCount: number;
  selectedRestorableCount: number;
  allLoadedSelected: boolean;
  purging: boolean;
  compact?: boolean;
}) {
  const hasItems = items.length > 0;
  const actionBusy = purging || restoringSelected;

  if (compact) {
    return (
      <div className="admin-tab-panel flex flex-col gap-3">
        {hasItems && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant/10 bg-surface-container-high px-3 py-2">
            <span className="text-xs text-on-surface-variant">
              已加载 <span className="font-bold text-primary-container">{items.length}</span> / {total}
              {selectedCount > 0 && <span>，已选 {selectedCount}</span>}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <AdminButton onClick={onToggleSelectLoaded} disabled={actionBusy} size="sm" variant="secondary">
                {allLoadedSelected ? '取消' : '全选'}
              </AdminButton>
              {selectedCount > 0 && (
                <>
                  <AdminButton onClick={onClearSelection} disabled={actionBusy} size="sm" variant="secondary">
                    取消选择
                  </AdminButton>
                  <AdminButton
                    onClick={onRestoreSelected}
                    disabled={actionBusy || selectedRestorableCount === 0}
                    size="sm"
                    variant="tonal"
                  >
                    {restoringSelected ? '恢复中' : '恢复选中'}
                  </AdminButton>
                  <AdminButton onClick={onPurgeSelected} disabled={actionBusy} size="sm" variant="danger">
                    彻底删除
                  </AdminButton>
                </>
              )}
              <AdminButton onClick={onClearAll} disabled={actionBusy || total === 0} size="sm" variant="danger">
                清空回收站
              </AdminButton>
            </div>
          </div>
        )}
        {items.map((model) => (
          <div
            key={model.model_id}
            className="rounded-lg border border-outline-variant/10 bg-surface-container-high p-3 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selectedIds.has(model.model_id)}
                onChange={() => onToggleSelect(model.model_id)}
                className="mt-3 h-4 w-4 shrink-0 accent-primary-container"
                aria-label={`选择 ${model.name}`}
              />
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-surface-container-highest text-on-surface-variant">
                <Icon name="delete_sweep" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-on-surface">
                  {model.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-on-surface-variant">
                  <span>{model.category || '未分类'}</span>
                  <span className="font-mono">{model.format?.toUpperCase()}</span>
                  <span className="font-mono">{formatSize(model.original_size)}</span>
                </div>
                <p className="mt-1 text-[10px] text-on-surface-variant">
                  删除时间：{formatModelDateTime(model.deleted_at)}
                </p>
              </div>
              <button
                onClick={() => onRestore(model)}
                disabled={actionBusy || !model.can_restore || restoringId === model.model_id}
                className="shrink-0 rounded-sm border border-primary/25 px-2.5 py-1.5 text-xs font-medium text-primary disabled:cursor-not-allowed disabled:border-outline-variant/15 disabled:text-on-surface-variant/45"
              >
                {restoringId === model.model_id ? '恢复中' : '恢复'}
              </button>
            </div>
            {!model.can_restore && (
              <p className="mt-2 rounded-sm bg-error/10 px-2 py-1 text-[11px] text-error">
                原始文件不存在，不能直接恢复。
              </p>
            )}
          </div>
        ))}
        {items.length > 0 && (
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={onLoadMore} />
        )}
        {items.length === 0 && (
          <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
            <Icon name="delete_sweep" size={38} className="mb-3 text-on-surface-variant/25" />
            <p className="text-sm font-medium text-on-surface">回收站是空的</p>
            <p className="mt-1 text-xs text-on-surface-variant">已删除模型会暂存在这里，确认无误后可恢复。</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={MODEL_ADMIN_PANEL_CLASS}>
      {items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/10 bg-surface-container-low px-4 py-3">
          <div className="text-sm text-on-surface-variant">
            已加载 <strong className="text-primary">{items.length}</strong> / 共{' '}
            <strong className="text-primary">{total}</strong> 个已删除模型
            {selectedCount > 0 && (
              <>
                ，已选择 <strong className="text-primary">{selectedCount}</strong> 个
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AdminButton
              onClick={onToggleSelectLoaded}
              disabled={actionBusy}
              icon="select_all"
              size="sm"
              variant="secondary"
            >
              {allLoadedSelected ? '取消全选' : '全选已加载'}
            </AdminButton>
            {selectedCount > 0 && (
              <>
                <AdminButton
                  onClick={onClearSelection}
                  disabled={actionBusy}
                  icon="close"
                  size="sm"
                  variant="secondary"
                >
                  取消选择
                </AdminButton>
                <AdminButton
                  onClick={onRestoreSelected}
                  disabled={actionBusy || selectedRestorableCount === 0}
                  icon="restore"
                  size="sm"
                  variant="tonal"
                >
                  {restoringSelected ? '恢复中...' : '恢复选中'}
                </AdminButton>
                <AdminButton onClick={onPurgeSelected} disabled={actionBusy} icon="delete" size="sm" variant="danger">
                  彻底删除
                </AdminButton>
              </>
            )}
            <AdminButton
              onClick={onClearAll}
              disabled={actionBusy || total === 0}
              icon="delete_sweep"
              size="sm"
              variant="danger"
            >
              清空回收站
            </AdminButton>
          </div>
        </div>
      )}
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className={ADMIN_TABLE_HEAD_CLASS}>
          <AdminTableHeadRow>
            <AdminTableHeadCell className="w-12">
              <input
                type="checkbox"
                checked={allLoadedSelected}
                disabled={items.length === 0 || actionBusy}
                onChange={onToggleSelectLoaded}
                className="h-4 w-4 accent-primary-container"
                aria-label={allLoadedSelected ? '取消选择已显示模型' : '选择已显示模型'}
              />
            </AdminTableHeadCell>
            <AdminTableHeadCell>模型</AdminTableHeadCell>
            <AdminTableHeadCell>分类</AdminTableHeadCell>
            <AdminTableHeadCell>格式</AdminTableHeadCell>
            <AdminTableHeadCell>大小</AdminTableHeadCell>
            <AdminTableHeadCell>删除时间</AdminTableHeadCell>
            <AdminTableHeadCell className="text-right">操作</AdminTableHeadCell>
          </AdminTableHeadRow>
        </thead>
        <tbody>
          {items.map((model) => (
            <tr
              key={model.model_id}
              className="border-b border-outline-variant/10 transition-colors hover:bg-surface-container-high/50"
            >
              <td className="px-4 py-3 align-middle">
                <input
                  type="checkbox"
                  checked={selectedIds.has(model.model_id)}
                  onChange={() => onToggleSelect(model.model_id)}
                  className="h-4 w-4 accent-primary-container"
                  aria-label={`选择 ${model.name}`}
                />
              </td>
              <td className="px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-surface-container-highest text-on-surface-variant">
                    <Icon name="delete_sweep" size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="block max-w-[360px] truncate font-medium text-on-surface">{model.name}</p>
                    <p className="mt-0.5 max-w-[360px] truncate text-xs text-on-surface-variant">
                      原文件：{model.original_name || '—'}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-on-surface-variant">{model.category || '未分类'}</td>
              <td className="px-4 py-3">
                <span className="rounded-sm bg-surface-container-highest px-1.5 py-0.5 font-mono text-xs">
                  {model.format?.toUpperCase() || '—'}
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-on-surface-variant">{formatSize(model.original_size)}</td>
              <td className="px-4 py-3 text-on-surface-variant">{formatModelDateTime(model.deleted_at)}</td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => onRestore(model)}
                  disabled={actionBusy || !model.can_restore || restoringId === model.model_id}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-primary/25 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-outline-variant/15 disabled:text-on-surface-variant/45 disabled:hover:bg-transparent"
                >
                  <Icon name="restore" size={14} />
                  {restoringId === model.model_id ? '恢复中...' : model.can_restore ? '恢复' : '文件缺失'}
                </button>
              </td>
            </tr>
          ))}
          {items.length > 0 && (
            <tr>
              <td colSpan={7}>
                <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={onLoadMore} />
              </td>
            </tr>
          )}
          {items.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-12 text-center text-on-surface-variant">
                回收站是空的
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ModelCategoryFilter({
  value,
  onChange,
  options,
  allValue,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
  allValue: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find((o) => o.id === value);
  const label = selected ? selected.label : '全部分类';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-outline-variant/20 bg-surface-container-lowest/30 px-2.5 text-xs font-medium text-on-surface-variant transition-colors hover:border-outline-variant/35 hover:bg-surface-container-high/65 hover:text-on-surface"
      >
        <Icon name="filter_list" size={14} />
        <span className="max-w-[8rem] truncate">{label}</span>
        <Icon name="expand_more" size={14} className="ml-0.5" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 max-h-64 min-w-[10rem] overflow-y-auto rounded-lg border border-outline-variant/15 bg-surface-container-high shadow-lg">
          <button
            onClick={() => {
              onChange(allValue);
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${value === allValue ? 'font-medium text-primary-container bg-primary-container/10' : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'}`}
          >
            <Icon name="category_all" size={14} />
            全部分类
          </button>
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                onChange(opt.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${value === opt.id ? 'font-medium text-primary-container bg-primary-container/10' : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'}`}
            >
              <Icon name="folder" size={14} />
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DesktopContent() {
  const { toast } = useToast();
  const {
    value: search,
    draftValue: searchInputValue,
    setValue: setSearch,
    inputProps: searchInputProps,
  } = useImeSafeSearchInput();
  const [categoryFilter, setCategoryFilter] = useState(CATEGORY_FILTER_ALL);
  const [editModel, setEditModel] = useState<ServerModelListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerModelListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [selectedAllMatching, setSelectedAllMatching] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewOpsOpen, setPreviewOpsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ModelAdminTab>('models');

  const {
    items: models,
    total: modelTotal,
    isLoadingInitial,
    isLoadingMore,
    hasMore,
    loadMore,
    mutate,
  } = useModelAdminList(search, categoryFilter);
  const { data: modelCountData } = useSWR(MODEL_ADMIN_COUNT_KEY, () => modelApi.getModelCount({ grouped: false }));
  const displayModelTotal =
    categoryFilter === CATEGORY_FILTER_ALL && !search.trim() ? (modelCountData?.total ?? modelTotal) : modelTotal;
  const {
    visibleItems: visibleModels,
    hasMore: hasMoreVisibleModels,
    loadMore: loadMoreVisibleModels,
  } = useVisibleItems(models, MODEL_ADMIN_VISIBLE_BATCH_SIZE, `${search.trim()}:${categoryFilter}`);
  const { data: catData } = useSWR('/categories', () => categoriesApi.tree());
  const categoryOptions = flattenCategoryOptions(catData?.items || []);
  const visibleModelIds = visibleModels.map((model) => model.model_id);
  const selectedModelCount = selectedAllMatching ? displayModelTotal : selectedModelIds.size;
  const allVisibleModelsSelected =
    visibleModelIds.length > 0 &&
    (selectedAllMatching || visibleModelIds.every((modelId) => selectedModelIds.has(modelId)));

  // Force refresh count + list when page mounts (e.g. after deleting a model on detail page)
  useEffect(() => {
    mutate(undefined, { revalidate: true });
    swrMutate(MODEL_ADMIN_COUNT_KEY);
  }, [mutate]);
  const categories = catData?.items || [];

  // Merge suggestions
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const {
    value: groupSearch,
    draftValue: groupSearchInputValue,
    setValue: setGroupSearch,
    inputProps: groupSearchInputProps,
  } = useImeSafeSearchInput();
  const {
    value: suggestionSearch,
    draftValue: suggestionSearchInputValue,
    setValue: setSuggestionSearch,
    inputProps: suggestionSearchInputProps,
  } = useImeSafeSearchInput();
  const {
    value: deletedSearch,
    draftValue: deletedSearchInputValue,
    setValue: setDeletedSearch,
    inputProps: deletedSearchInputProps,
  } = useImeSafeSearchInput();
  const [restoringModelId, setRestoringModelId] = useState<string | null>(null);
  const [restoringDeletedBatch, setRestoringDeletedBatch] = useState(false);
  const [selectedDeletedModelIds, setSelectedDeletedModelIds] = useState<Set<string>>(new Set());
  const [purgingDeleted, setPurgingDeleted] = useState(false);
  const [purgeConfirmMode, setPurgeConfirmMode] = useState<DeletedPurgeMode | null>(null);
  const [deletedRefreshVersion, setDeletedRefreshVersion] = useState(0);
  const [groupAction, setGroupAction] = useState<string | null>(null);
  const [groupConfirm, setGroupConfirm] = useState<ModelGroupConfirm | null>(null);
  const {
    groups: suggestionGroups,
    total: activeSuggestionCount,
    isLoading: sugLoading,
    isLoadingMore: suggestionsLoadingMore,
    hasMore: suggestionsHasMore,
    loadMore: loadMoreSuggestions,
    mutate: sugMutate,
  } = useMergeSuggestionPages(activeTab === 'suggestions');
  const { data: suggestionCountData, mutate: suggestionCountMutate } = useSWR('/model-groups/suggestions/count', () =>
    modelApi.getMergeSuggestions({ page: 1, pageSize: 1 }),
  );
  const {
    data: groupData,
    isLoading: groupsLoading,
    mutate: groupMutate,
  } = useSWR(activeTab === 'groups' ? '/model-groups' : null, () => modelApi.listModelGroups());
  const { data: groupCountData } = useSWR('/model-groups/count', () => modelApi.getModelGroupCount());
  const {
    items: deletedModels,
    total: deletedTotal,
    isLoading: deletedLoading,
    isLoadingMore: deletedLoadingMore,
    hasMore: deletedHasMore,
    loadMore: loadMoreDeleted,
    mutate: deletedMutate,
  } = useDeletedModelPages(deletedSearch, activeTab === 'deleted', deletedRefreshVersion);
  const { data: deletedCountData, mutate: deletedCountMutate } = useSWR('/models/deleted/count', () =>
    modelApi.listDeleted({ page: 1, pageSize: 1 }),
  );
  const deletedModelIds = deletedModels.map((model) => model.model_id);
  const selectedDeletedCount = selectedDeletedModelIds.size;
  const selectedRestorableDeletedCount = deletedModels.filter(
    (model) => selectedDeletedModelIds.has(model.model_id) && model.can_restore,
  ).length;
  const allDeletedLoadedSelected =
    deletedModelIds.length > 0 && deletedModelIds.every((modelId) => selectedDeletedModelIds.has(modelId));
  const filteredSuggestions = suggestionSearch
    ? suggestionGroups.filter((g) => g.name.toLowerCase().includes(suggestionSearch.toLowerCase()))
    : suggestionGroups;
  const suggestionNames = filteredSuggestions.map((group) => group.name);
  const selectedSuggestionCount = suggestionNames.filter((name) => selectedNames.has(name)).length;
  const allSuggestionsSelected = suggestionNames.length > 0 && selectedSuggestionCount === suggestionNames.length;
  const suggestionCount = activeTab === 'suggestions' ? activeSuggestionCount : (suggestionCountData?.total ?? 0);
  const mergedGroupCount = groupCountData?.total ?? groupData?.length;
  const deletedGlobalCount = deletedCountData?.total ?? 0;
  const deletedModelCount =
    activeTab === 'deleted'
      ? deletedSearch.trim()
        ? deletedTotal
        : Math.max(deletedTotal, deletedGlobalCount)
      : deletedGlobalCount;
  const groups = Array.isArray(groupData) ? groupData : [];
  const filteredGroups = groupSearch
    ? groups.filter(
        (g) =>
          g.name.toLowerCase().includes(groupSearch.toLowerCase()) ||
          g.models.some(
            (m) =>
              m.name.toLowerCase().includes(groupSearch.toLowerCase()) ||
              (m.originalName || '').toLowerCase().includes(groupSearch.toLowerCase()),
          ),
      )
    : groups;
  const modelAdminTabs: ResponsiveSectionTab[] = [
    { value: 'models', label: '全部模型', count: displayModelTotal, icon: 'inventory_2' },
    { value: 'suggestions', label: '合并建议', count: suggestionCount, icon: 'merge_type' },
    { value: 'groups', label: '已合并', count: mergedGroupCount, icon: 'category' },
    { value: 'deleted', label: '回收站', count: deletedModelCount, icon: 'delete_sweep' },
  ];

  useEffect(() => {
    setSelectedNames(new Set());
  }, [activeTab]);

  useEffect(() => {
    setSelectedModelIds(new Set());
    setSelectedAllMatching(false);
  }, [activeTab, search, categoryFilter]);

  useEffect(() => {
    setSelectedDeletedModelIds(new Set());
  }, [activeTab, deletedSearch]);

  useEffect(() => {
    if (activeTab !== 'deleted') return;
    deletedMutate();
    deletedCountMutate();
  }, [activeTab, deletedMutate, deletedCountMutate]);

  useEffect(() => {
    if (activeTab !== 'deleted' || deletedSearch.trim() || deletedLoading) return;
    if (deletedModelCount > 0 && deletedModels.length === 0) {
      deletedMutate();
    }
  }, [activeTab, deletedSearch, deletedLoading, deletedModelCount, deletedModels.length, deletedMutate]);

  const refreshModelAdminData = () => {
    mutate();
    swrMutate(MODEL_ADMIN_COUNT_KEY);
    swrMutate('/categories');
    sugMutate();
    suggestionCountMutate();
    groupMutate();
    setDeletedRefreshVersion((version) => version + 1);
    deletedMutate();
    deletedCountMutate();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await modelApi.delete(deleteTarget.model_id);
      toast('已删除', 'success');
      setSelectedModelIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.model_id);
        return next;
      });
      refreshModelAdminData();
      setDeleteTarget(null);
    } catch {
      toast('删除失败', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelectModel = (modelId: string) => {
    if (selectedAllMatching) {
      setSelectedAllMatching(false);
      setSelectedModelIds(new Set(visibleModelIds.filter((id) => id !== modelId)));
      return;
    }
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const toggleSelectVisibleModels = () => {
    setSelectedAllMatching(false);
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (allVisibleModelsSelected) {
        visibleModelIds.forEach((modelId) => next.delete(modelId));
      } else {
        visibleModelIds.forEach((modelId) => next.add(modelId));
      }
      return next;
    });
  };

  const selectAllMatchingModels = () => {
    if (displayModelTotal <= 0) return;
    setSelectedAllMatching(true);
    setSelectedModelIds(new Set());
  };

  const clearSelectedModels = () => {
    setSelectedAllMatching(false);
    setSelectedModelIds(new Set());
  };

  const handleBatchDelete = async () => {
    const modelIds = Array.from(selectedModelIds);
    if (!selectedAllMatching && modelIds.length === 0) return;
    setBatchDeleting(true);
    try {
      const result = await modelApi.batchDelete(
        selectedAllMatching
          ? {
              allMatching: true,
              filters: {
                search: search.trim() || undefined,
                categoryId: categoryFilter === CATEGORY_FILTER_ALL ? undefined : categoryFilter,
              },
            }
          : { modelIds },
      );
      const warningText = result.warnings > 0 ? `，${result.warnings} 个文件清理警告` : '';
      toast(`已删除 ${result.deleted} 个模型${warningText}`, result.warnings > 0 ? 'error' : 'success');
      clearSelectedModels();
      setBatchDeleteOpen(false);
      refreshModelAdminData();
    } catch {
      toast('批量删除失败', 'error');
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleRestoreModel = async (model: DeletedModelListItem) => {
    setRestoringModelId(model.model_id);
    try {
      await modelApi.restore(model.model_id);
      toast('模型已恢复', 'success');
      refreshModelAdminData();
    } catch {
      toast('恢复失败', 'error');
    } finally {
      setRestoringModelId(null);
    }
  };

  const restoreSelectedDeletedModels = async () => {
    const targets = deletedModels.filter((model) => selectedDeletedModelIds.has(model.model_id) && model.can_restore);
    if (targets.length === 0) {
      toast('选中的模型文件缺失，无法批量恢复', 'error');
      return;
    }
    setRestoringDeletedBatch(true);
    try {
      const results = await Promise.allSettled(targets.map((model) => modelApi.restore(model.model_id)));
      const restoredIds = new Set(
        targets.filter((_, index) => results[index]?.status === 'fulfilled').map((model) => model.model_id),
      );
      const failed = targets.length - restoredIds.size;
      setSelectedDeletedModelIds((prev) => {
        const next = new Set(prev);
        restoredIds.forEach((modelId) => next.delete(modelId));
        return next;
      });
      toast(
        failed > 0 ? `已恢复 ${restoredIds.size} 个模型，${failed} 个恢复失败` : `已恢复 ${restoredIds.size} 个模型`,
        failed > 0 ? 'error' : 'success',
      );
      refreshModelAdminData();
    } finally {
      setRestoringDeletedBatch(false);
    }
  };

  const toggleSelectDeletedModel = (modelId: string) => {
    setSelectedDeletedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const toggleSelectLoadedDeletedModels = () => {
    setSelectedDeletedModelIds((prev) => {
      const next = new Set(prev);
      if (allDeletedLoadedSelected) {
        deletedModelIds.forEach((modelId) => next.delete(modelId));
      } else {
        deletedModelIds.forEach((modelId) => next.add(modelId));
      }
      return next;
    });
  };

  const clearSelectedDeletedModels = () => {
    setSelectedDeletedModelIds(new Set());
  };

  const purgeDeletedModels = async (mode: 'selected' | 'all') => {
    const modelIds = Array.from(selectedDeletedModelIds);
    if (mode === 'selected' && modelIds.length === 0) return;
    setPurgingDeleted(true);
    try {
      const result = await modelApi.purgeDeleted(mode === 'all' ? { all: true } : { modelIds });
      const warningText = result.warnings > 0 ? `，${result.warnings} 个文件清理警告` : '';
      toast(`已彻底删除 ${result.deleted} 个模型${warningText}`, result.warnings > 0 ? 'error' : 'success');
      clearSelectedDeletedModels();
      setPurgeConfirmMode(null);
      refreshModelAdminData();
    } catch {
      toast('彻底删除失败', 'error');
    } finally {
      setPurgingDeleted(false);
    }
  };

  const handleTabChange = (tab: ModelAdminTab) => {
    startTransition(() => setActiveTab(tab));
  };
  const modelToolbarControls =
    activeTab === 'models' ? (
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
        {models.length > 0 ? (
          <span className="shrink-0 whitespace-nowrap text-xs text-on-surface-variant">
            已加载 <strong className="text-primary">{visibleModels.length}</strong> / 共{' '}
            <strong className="text-primary">{displayModelTotal}</strong> 个模型
            {selectedAllMatching ? (
              <>
                ，已选择 <strong className="text-primary">全部匹配的 {selectedModelCount}</strong> 个
              </>
            ) : selectedModelCount > 0 ? (
              <>
                ，已选择 <strong className="text-primary">{selectedModelCount}</strong> 个
              </>
            ) : null}
          </span>
        ) : null}
        {/* 分类筛选属于导航控件：即使当前分类下模型为 0，也必须保留，
            否则选中空分类后无法切回「全部分类」/其它分类（整个筛选条会随列表一起消失）。 */}
        <ModelCategoryFilter
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={categoryOptions}
          allValue={CATEGORY_FILTER_ALL}
        />
        {models.length > 0 ? (
          <>
            {!selectedAllMatching && displayModelTotal > visibleModels.length ? (
              <AdminButton
                onClick={selectAllMatchingModels}
                disabled={displayModelTotal === 0}
                icon="select_all"
                size="sm"
                variant="tonal"
              >
                选择全部
              </AdminButton>
            ) : null}
            {selectedModelCount > 0 ? (
              <>
                <AdminButton onClick={clearSelectedModels} icon="close" size="sm" variant="secondary">
                  取消选择
                </AdminButton>
                <AdminButton
                  onClick={() => setBatchDeleteOpen(true)}
                  disabled={batchDeleting}
                  icon="delete"
                  size="sm"
                  variant="danger"
                >
                  批量删除
                </AdminButton>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    ) : null;
  const purgeConfirmSelectedCount = purgeConfirmMode === 'all' ? deletedModelCount : selectedDeletedCount;
  const purgeConfirmTitle = purgeConfirmMode === 'all' ? '确认清空回收站' : '确认彻底删除';
  const purgeConfirmDescription =
    purgeConfirmMode === 'all'
      ? `将彻底删除回收站中的 ${purgeConfirmSelectedCount} 个模型及相关文件，此操作不可恢复。`
      : `将彻底删除选中的 ${purgeConfirmSelectedCount} 个模型及相关文件，此操作不可恢复。`;

  const toggleSelect = (name: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleSelectPage = () => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (allSuggestionsSelected) {
        suggestionNames.forEach((name) => next.delete(name));
      } else {
        suggestionNames.forEach((name) => next.add(name));
      }
      return next;
    });
  };

  const handleMerge = async () => {
    if (selectedSuggestionCount === 0) return;
    setMerging(true);
    try {
      const items = filteredSuggestions
        .filter((s) => selectedNames.has(s.name))
        .map((s) => ({
          name: s.name,
          modelIds: s.models.map((m) => m.id),
        }));
      const result = await modelApi.batchMerge(items);
      toast(`已合并 ${result.merged} 组`, 'success');
      setSelectedNames(new Set());
      sugMutate();
      suggestionCountMutate();
      groupMutate();
    } catch {
      toast('合并失败', 'error');
    } finally {
      setMerging(false);
    }
  };

  const beginEditGroup = (group: ModelGroupItem) => {
    setEditingGroupId(group.id);
    setGroupNameDraft(group.name);
  };

  const handleSaveGroup = async (group: ModelGroupItem) => {
    const name = groupNameDraft.trim();
    if (!name) {
      toast('分组名称不能为空', 'error');
      return;
    }
    setGroupAction(`rename:${group.id}`);
    try {
      await modelApi.updateModelGroup(group.id, { name });
      toast('分组已更新', 'success');
      setEditingGroupId(null);
      groupMutate();
      mutate();
    } catch {
      toast('更新分组失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleSetPrimary = async (group: ModelGroupItem, modelId: string) => {
    setGroupAction(`primary:${group.id}:${modelId}`);
    try {
      await modelApi.updateModelGroup(group.id, { primaryId: modelId });
      toast('已设置主版本', 'success');
      groupMutate();
      mutate();
    } catch {
      toast('设置主版本失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleRemoveFromGroup = async (group: ModelGroupItem, modelId: string) => {
    setGroupConfirm(null);
    setGroupAction(`remove:${group.id}:${modelId}`);
    try {
      await modelApi.removeModelFromGroup(group.id, modelId);
      toast('已移出分组', 'success');
      groupMutate();
      sugMutate();
      suggestionCountMutate();
      mutate();
    } catch {
      toast('移出分组失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleDeleteGroup = async (group: ModelGroupItem) => {
    setGroupConfirm(null);
    setGroupAction(`delete:${group.id}`);
    try {
      const result = await modelApi.deleteModelGroup(group.id);
      const msg =
        result.dissolvedModels > 1 ? `分组已解散，${result.dissolvedModels} 个模型已恢复独立显示` : '分组已解散';
      toast(msg, 'success');
      groupMutate();
      sugMutate();
      suggestionCountMutate();
      mutate();
    } catch {
      toast('解散分组失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  return (
    <>
      <UploadModalLoader open={uploadOpen} onClose={() => setUploadOpen(false)} onConverted={refreshModelAdminData} />
      <AdminManagementPage
        title="模型管理"
        description="统一维护模型文件、分类归属、预览重建和同名模型合并关系。"
        actions={
          <div className="flex items-center gap-2">
            <AdminButton
              onClick={() => setPreviewOpsOpen(true)}
              icon="view_in_ar"
              className="w-[122px]"
              variant="secondary"
            >
              预览运维
            </AdminButton>
            <AdminButton
              onClick={() => setUploadOpen(true)}
              onPointerEnter={preloadUploadModal}
              onPointerDown={preloadUploadModal}
              onFocus={preloadUploadModal}
              icon="cloud_upload"
              className="w-[122px]"
              variant="primary"
            >
              上传模型
            </AdminButton>
          </div>
        }
        toolbar={
          <div className="flex min-h-10 min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <div className="min-w-[280px] flex-1">
                <ResponsiveSectionTabs
                  tabs={modelAdminTabs}
                  value={activeTab}
                  onChange={(value) => handleTabChange(value as ModelAdminTab)}
                  mobileTitle="模型管理分类"
                />
              </div>
              {modelToolbarControls}
            </div>
            <AdminSearchField
              inputProps={
                activeTab === 'models'
                  ? searchInputProps
                  : activeTab === 'suggestions'
                    ? suggestionSearchInputProps
                    : activeTab === 'groups'
                      ? groupSearchInputProps
                      : deletedSearchInputProps
              }
              value={
                activeTab === 'models'
                  ? searchInputValue
                  : activeTab === 'suggestions'
                    ? suggestionSearchInputValue
                    : activeTab === 'groups'
                      ? groupSearchInputValue
                      : deletedSearchInputValue
              }
              onClear={() => {
                if (activeTab === 'models') setSearch('');
                else if (activeTab === 'suggestions') setSuggestionSearch('');
                else if (activeTab === 'groups') setGroupSearch('');
                else setDeletedSearch('');
              }}
              placeholder={
                activeTab === 'models'
                  ? '搜索模型...'
                  : activeTab === 'suggestions'
                    ? '搜索建议...'
                    : activeTab === 'groups'
                      ? '搜索分组...'
                      : '搜索已删除模型...'
              }
            />
          </div>
        }
      >
        <div className="admin-tab-panel min-h-0">
          {activeTab === 'suggestions' ? (
            sugLoading ? (
              <AdminLoadingState variant="list" label="同名合并建议加载中" />
            ) : (
              <div className={`${MODEL_ADMIN_PANEL_CLASS} p-3`}>
                {filteredSuggestions.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-surface-container-low rounded-sm border border-outline-variant/10">
                    <span className="text-sm text-on-surface">
                      已加载 <strong className="text-primary">{filteredSuggestions.length}</strong> / 共{' '}
                      <strong className="text-primary">{suggestionCount}</strong> 组建议
                      {selectedSuggestionCount > 0 && (
                        <>
                          ，已选择 <strong className="text-primary">{selectedSuggestionCount}</strong> 组
                        </>
                      )}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={toggleSelectPage}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-on-surface-variant bg-surface-container-high rounded-sm hover:text-on-surface hover:bg-surface-container-highest transition-colors"
                      >
                        <Icon name="checklist" size={16} />
                        {allSuggestionsSelected ? '取消全选' : '全选已加载'}
                      </button>
                      {selectedSuggestionCount > 0 && (
                        <button
                          onClick={() => setSelectedNames(new Set())}
                          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-on-surface-variant bg-surface-container-high rounded-sm hover:text-on-surface hover:bg-surface-container-highest transition-colors"
                        >
                          <Icon name="close" size={16} />
                          取消选择
                        </button>
                      )}
                      <button
                        onClick={handleMerge}
                        disabled={merging || selectedSuggestionCount === 0}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-primary bg-primary-container rounded-sm hover:opacity-90 disabled:opacity-50"
                      >
                        <Icon name="merge" size={16} />
                        {merging ? '合并中...' : `合并选中 (${selectedSuggestionCount} 组)`}
                      </button>
                    </div>
                  </div>
                )}
                <div className="space-y-3">
                  {filteredSuggestions.map((group) => (
                    <div
                      key={group.name}
                      className="overflow-hidden rounded-sm border border-outline-variant/10 bg-surface-container-low"
                    >
                      <div className="flex items-center gap-3 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedNames.has(group.name)}
                          onChange={() => toggleSelect(group.name)}
                          className="w-4 h-4 accent-primary-container rounded"
                        />
                        <span className="text-sm font-medium text-on-surface flex-1">{group.name}</span>
                        <span className="text-[10px] bg-surface-container-highest px-2 py-0.5 rounded-sm text-on-surface-variant font-mono">
                          {group.count} 个同名
                        </span>
                      </div>
                      <div className="px-4 pb-3 flex gap-2 overflow-x-auto">
                        {group.models.map((m) => (
                          <div key={m.id} className="shrink-0 w-16">
                            <div className="w-16 h-16 rounded-sm bg-surface-container-highest overflow-hidden border border-outline-variant/10">
                              <ModelThumbnail src={m.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                            </div>
                            <p className="text-[9px] text-on-surface-variant mt-1 truncate">
                              {m.originalName.replace(/\.[^.]+$/, '')}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {filteredSuggestions.length > 0 && (
                  <InfiniteLoadTrigger
                    hasMore={suggestionsHasMore}
                    isLoading={suggestionsLoadingMore}
                    onLoadMore={loadMoreSuggestions}
                  />
                )}
                {filteredSuggestions.length === 0 && (
                  <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                    <Icon name="merge" size={38} className="mb-3 text-on-surface-variant/25" />
                    <p className="text-sm font-medium text-on-surface">没有需要合并的同名模型</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      这里会保持和全部模型一致的内容区块，后续有建议时直接显示列表。
                    </p>
                  </div>
                )}
              </div>
            )
          ) : activeTab === 'deleted' ? (
            deletedLoading ? (
              <AdminLoadingState variant="table" label="回收站加载中" />
            ) : (
              <DeletedModelsPanel
                items={deletedModels}
                total={deletedTotal}
                isLoadingMore={deletedLoadingMore}
                hasMore={deletedHasMore}
                onLoadMore={loadMoreDeleted}
                onRestore={handleRestoreModel}
                onRestoreSelected={restoreSelectedDeletedModels}
                onToggleSelect={toggleSelectDeletedModel}
                onToggleSelectLoaded={toggleSelectLoadedDeletedModels}
                onClearSelection={clearSelectedDeletedModels}
                onPurgeSelected={() => setPurgeConfirmMode('selected')}
                onClearAll={() => setPurgeConfirmMode('all')}
                restoringId={restoringModelId}
                restoringSelected={restoringDeletedBatch}
                selectedIds={selectedDeletedModelIds}
                selectedCount={selectedDeletedCount}
                selectedRestorableCount={selectedRestorableDeletedCount}
                allLoadedSelected={allDeletedLoadedSelected}
                purging={purgingDeleted}
              />
            )
          ) : activeTab === 'groups' ? (
            groupsLoading ? (
              <AdminLoadingState variant="list" label="模型分组加载中" />
            ) : (
              <div className={`${MODEL_ADMIN_PANEL_CLASS} p-3`}>
                <div className="space-y-2">
                  {filteredGroups?.map((group) => {
                    const editing = editingGroupId === group.id;
                    const primaryId = group.primary?.id;
                    const expanded = expandedGroups.has(group.id);
                    const toggleExpand = () =>
                      setExpandedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      });
                    return (
                      <div
                        key={group.id}
                        className="bg-surface-container-low rounded-sm border border-outline-variant/10 overflow-hidden"
                      >
                        <div
                          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none"
                          onClick={() => {
                            if (!editing) toggleExpand();
                          }}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <Icon
                              name={expanded ? 'expand_more' : 'chevron_right'}
                              size={18}
                              className="shrink-0 text-on-surface-variant"
                            />
                            <Icon name="folder_special" size={18} className="shrink-0 text-primary-container" />
                            {editing ? (
                              <input
                                value={groupNameDraft}
                                onChange={(e) => setGroupNameDraft(e.target.value)}
                                className="min-w-0 flex-1 rounded-sm border border-outline-variant/25 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-on-surface">{group.name}</p>
                                <p className="text-[11px] text-on-surface-variant">
                                  {group.model_count} 个版本 · 主版本：{group.primary?.name || '未设置'}
                                </p>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            {editing ? (
                              <>
                                <button
                                  onClick={() => handleSaveGroup(group)}
                                  disabled={groupAction === `rename:${group.id}`}
                                  className="flex items-center gap-1.5 rounded-sm bg-primary-container px-3 py-2 text-xs font-medium text-on-primary disabled:opacity-50"
                                >
                                  <Icon name="save" size={14} />
                                  保存
                                </button>
                                <button
                                  onClick={() => setEditingGroupId(null)}
                                  className="rounded-sm border border-outline-variant/20 px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface"
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => beginEditGroup(group)}
                                className="flex items-center gap-1.5 rounded-sm border border-outline-variant/20 px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface"
                              >
                                <Icon name="edit" size={14} />
                                重命名
                              </button>
                            )}
                            <button
                              onClick={() => setGroupConfirm({ type: 'delete', group })}
                              disabled={groupAction === `delete:${group.id}`}
                              className="flex items-center gap-1.5 rounded-sm border border-error/20 px-3 py-2 text-xs text-error hover:bg-error/10 disabled:opacity-50"
                            >
                              <Icon name="close" size={14} />
                              解散
                            </button>
                          </div>
                        </div>
                        {expanded && (
                          <div className="divide-y divide-outline-variant/10">
                            {group.models.map((model) => {
                              const isPrimary = model.id === primaryId;
                              return (
                                <div key={model.id} className="flex items-center gap-3 px-4 py-3">
                                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-sm bg-surface-container-highest">
                                    <ModelThumbnail
                                      src={model.thumbnailUrl}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <p className="truncate text-sm font-medium text-on-surface">
                                        {model.originalName || model.name}
                                      </p>
                                      {isPrimary && (
                                        <span className="shrink-0 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                          主版本
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-on-surface-variant">
                                      <span>{formatSize(model.originalSize)}</span>
                                      <span>原始时间：{formatModelDateTime(model.fileModifiedAt)}</span>
                                      <span>上传时间：{formatModelDateTime(model.createdAt)}</span>
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <Link
                                      to={`/model/${model.id}`}
                                      target="_blank"
                                      className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-primary"
                                    >
                                      查看
                                    </Link>
                                    {!isPrimary && (
                                      <button
                                        onClick={() => handleSetPrimary(group, model.id)}
                                        disabled={groupAction === `primary:${group.id}:${model.id}`}
                                        className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-primary disabled:opacity-50"
                                      >
                                        设为主版本
                                      </button>
                                    )}
                                    <button
                                      onClick={() => setGroupConfirm({ type: 'remove', group, modelId: model.id })}
                                      disabled={
                                        group.model_count <= 2 || groupAction === `remove:${group.id}:${model.id}`
                                      }
                                      className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-error disabled:opacity-40"
                                    >
                                      移出
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {groupData?.length === 0 && (
                  <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                    <Icon name="folder_special" size={38} className="mb-3 text-on-surface-variant/25" />
                    <p className="text-sm font-medium text-on-surface">还没有已合并的模型分组</p>
                    <p className="mt-1 text-xs text-on-surface-variant">合并完成后会在这里统一维护主版本和分组关系。</p>
                  </div>
                )}
                {(groupData?.length ?? 0) > 0 && filteredGroups?.length === 0 && (
                  <div className="flex min-h-[200px] flex-col items-center justify-center text-center">
                    <p className="text-sm text-on-surface-variant">没有匹配「{groupSearch}」的分组</p>
                  </div>
                )}
              </div>
            )
          ) : isLoadingInitial ? (
            <AdminLoadingState
              variant="table"
              label="模型列表加载中"
              tableColumns="48px minmax(260px,1fr) 140px 80px 96px 80px 180px"
              tableCells={['checkbox', 'mediaTitle', 'text', 'chip', 'text', 'chip', 'actions']}
            />
          ) : (
            <>
              <div className={MODEL_ADMIN_PANEL_CLASS}>
                {/* table-fixed：列宽由表头定宽决定，不再随模型名/格式/分类内容长短抖动，
                    切换分类或翻页时各列宽度保持一致。模型列不指定宽度，吃剩余空间。 */}
                <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
                  <thead className={ADMIN_TABLE_HEAD_CLASS}>
                    <AdminTableHeadRow>
                      <AdminTableHeadCell className="w-12">
                        <input
                          type="checkbox"
                          checked={allVisibleModelsSelected}
                          disabled={visibleModelIds.length === 0}
                          onChange={toggleSelectVisibleModels}
                          className="h-4 w-4 accent-primary-container"
                          aria-label={allVisibleModelsSelected ? '取消选择已显示模型' : '选择已显示模型'}
                        />
                      </AdminTableHeadCell>
                      <AdminTableHeadCell>模型</AdminTableHeadCell>
                      <AdminTableHeadCell className="w-44">分类</AdminTableHeadCell>
                      <AdminTableHeadCell className="w-24">格式</AdminTableHeadCell>
                      <AdminTableHeadCell className="w-28">大小</AdminTableHeadCell>
                      <AdminTableHeadCell className="w-20">图纸</AdminTableHeadCell>
                      <AdminTableHeadCell className="w-64 text-right">操作</AdminTableHeadCell>
                    </AdminTableHeadRow>
                  </thead>
                  <tbody>
                    {visibleModels.map((m) => (
                      <tr
                        key={m.model_id}
                        className="border-b border-outline-variant/10 hover:bg-surface-container-high/50 transition-colors"
                      >
                        <td className="px-4 py-3 align-middle">
                          <input
                            type="checkbox"
                            checked={selectedModelIds.has(m.model_id)}
                            onChange={() => toggleSelectModel(m.model_id)}
                            className="h-4 w-4 accent-primary-container"
                            aria-label={`选择 ${m.name}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            to={`/model/${m.model_id}`}
                            target="_blank"
                            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                          >
                            <div className="w-10 h-10 rounded-sm bg-surface-container-highest shrink-0 overflow-hidden">
                              <ModelThumbnail src={m.thumbnail_url} alt="" className="w-full h-full object-cover" />
                            </div>
                            <div className="min-w-0">
                              <span className="block truncate text-on-surface font-medium">{m.name}</span>
                              {m.group && (
                                <span className="text-[10px] text-primary font-medium">
                                  {m.group.name} {m.group.is_primary ? '· 主版本' : ''} (共{m.group.variant_count}个)
                                </span>
                              )}
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-on-surface-variant">
                          <span className="block truncate" title={m.category || ''}>
                            {m.category || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono bg-surface-container-highest px-1.5 py-0.5 rounded-sm">
                            {m.format?.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-on-surface-variant font-mono">{formatSize(m.original_size)}</td>
                        <td className="px-4 py-3">
                          {m.drawing_url ? (
                            <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-sm font-medium">
                              PDF
                            </span>
                          ) : (
                            <span className="text-[10px] text-on-surface-variant/30">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              to={`/model/${m.model_id}`}
                              target="_blank"
                              className="flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-primary hover:bg-primary/10 rounded-sm transition-colors border border-outline-variant/20"
                            >
                              <Icon name="open_in_new" size={14} />
                              查看
                            </Link>
                            <button
                              onClick={() => setEditModel(m)}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20"
                            >
                              <Icon name="settings" size={14} />
                              编辑
                            </button>
                            <button
                              onClick={() => setDeleteTarget(m)}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-error hover:bg-error/10 rounded-sm transition-colors border border-outline-variant/20"
                            >
                              <Icon name="close" size={14} />
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {models.length > 0 && (
                      <tr>
                        <td colSpan={7}>
                          <InfiniteLoadTrigger
                            hasMore={hasMoreVisibleModels || hasMore}
                            isLoading={isLoadingMore}
                            onLoadMore={hasMoreVisibleModels ? loadMoreVisibleModels : loadMore}
                          />
                        </td>
                      </tr>
                    )}
                    {models.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-on-surface-variant">
                          没有找到模型
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <PreviewOperationsModal open={previewOpsOpen} onClose={() => setPreviewOpsOpen(false)} />
        <ConfirmDialog
          open={Boolean(groupConfirm)}
          onClose={() => {
            if (!groupAction) setGroupConfirm(null);
          }}
          onConfirm={() => {
            if (!groupConfirm) return;
            if (groupConfirm.type === 'remove') void handleRemoveFromGroup(groupConfirm.group, groupConfirm.modelId);
            else void handleDeleteGroup(groupConfirm.group);
          }}
          icon={groupConfirm?.type === 'delete' ? 'close' : 'logout'}
          title={groupConfirm?.type === 'delete' ? '确认解散分组' : '确认移出分组'}
          description={
            groupConfirm?.type === 'delete'
              ? `确定解散「${groupConfirm.group.name}」吗？模型文件不会删除，只会取消合并关系。`
              : '确定将该模型移出当前合并分组吗？模型不会被删除。'
          }
          confirmLabel={groupAction ? '处理中...' : groupConfirm?.type === 'delete' ? '确认解散' : '确认移出'}
          confirmDisabled={Boolean(groupAction)}
        />
        <ConfirmDialog
          open={Boolean(purgeConfirmMode)}
          onClose={() => {
            if (!purgingDeleted) setPurgeConfirmMode(null);
          }}
          onConfirm={() => {
            if (!purgeConfirmMode) return;
            void purgeDeletedModels(purgeConfirmMode);
          }}
          icon="delete_sweep"
          title={purgeConfirmTitle}
          description={purgeConfirmDescription}
          confirmLabel={purgingDeleted ? '删除中...' : purgeConfirmMode === 'all' ? '清空回收站' : '彻底删除'}
          confirmDisabled={purgingDeleted || purgeConfirmSelectedCount <= 0}
        />
        <EditDialog
          open={!!editModel}
          model={editModel}
          categories={categories || []}
          onClose={() => setEditModel(null)}
          onSaved={() => mutate()}
        />
        <AnimatePresence>
          {deleteTarget && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-surface-dim/70 backdrop-blur-sm"
              onClick={() => setDeleteTarget(null)}
            >
              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-surface-container-low rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-sm mx-4 p-6"
              >
                <h3 className="font-headline text-lg font-semibold text-on-surface mb-2">确认删除</h3>
                <p className="text-sm text-on-surface-variant mb-6">
                  确定要删除「{deleteTarget.name}」吗？删除后会从前台隐藏，保留恢复能力。
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setDeleteTarget(null)}
                    className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="px-4 py-2 bg-error text-white rounded-sm text-sm hover:bg-error/90 transition-colors disabled:opacity-50"
                  >
                    {deleting ? '删除中...' : '删除'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {batchDeleteOpen && selectedModelCount > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-surface-dim/70 backdrop-blur-sm"
              onClick={() => !batchDeleting && setBatchDeleteOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-surface-container-low rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-sm mx-4 p-6"
              >
                <h3 className="font-headline text-lg font-semibold text-on-surface mb-2">确认批量删除</h3>
                <p className="text-sm text-on-surface-variant mb-6">
                  {selectedAllMatching && ' 本次会按当前分类和搜索条件删除全部匹配模型。'}
                  确定要删除已选择的 {selectedModelCount}{' '}
                  个模型吗？删除后会从前台隐藏并进入回收站，可在文件仍存在时恢复。
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setBatchDeleteOpen(false)}
                    disabled={batchDeleting}
                    className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleBatchDelete}
                    disabled={batchDeleting}
                    className="px-4 py-2 bg-error text-white rounded-sm text-sm hover:bg-error/90 transition-colors disabled:opacity-50"
                  >
                    {batchDeleting ? '删除中...' : '确认删除'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </AdminManagementPage>
    </>
  );
}

function MobileContent() {
  const { toast } = useToast();
  const {
    value: search,
    draftValue: searchInputValue,
    setValue: setSearch,
    inputProps: searchInputProps,
  } = useImeSafeSearchInput();
  const [categoryFilter, setCategoryFilter] = useState(CATEGORY_FILTER_ALL);
  const [editModel, setEditModel] = useState<ServerModelListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerModelListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [selectedAllMatching, setSelectedAllMatching] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewOpsOpen, setPreviewOpsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ModelAdminTab>('models');

  const {
    items: models,
    total: modelTotal,
    isLoadingInitial,
    isLoadingMore,
    hasMore,
    loadMore,
    mutate,
  } = useModelAdminList(search, categoryFilter);
  const { data: modelCountDataM } = useSWR(MODEL_ADMIN_COUNT_KEY, () => modelApi.getModelCount({ grouped: false }));
  const displayModelTotalM =
    categoryFilter === CATEGORY_FILTER_ALL && !search.trim() ? (modelCountDataM?.total ?? modelTotal) : modelTotal;
  const {
    visibleItems: visibleModels,
    hasMore: hasMoreVisibleModels,
    loadMore: loadMoreVisibleModels,
  } = useVisibleItems(models, MOBILE_MODEL_VISIBLE_BATCH_SIZE, `${search.trim()}:${categoryFilter}`);
  const { data: catDataM } = useSWR('/categories-m', () => categoriesApi.tree());
  const categories = catDataM?.items || [];
  const categoryOptions = flattenCategoryOptions(categories);
  const visibleModelIds = visibleModels.map((model) => model.model_id);
  const selectedModelCount = selectedAllMatching ? displayModelTotalM : selectedModelIds.size;
  const allVisibleModelsSelected =
    visibleModelIds.length > 0 &&
    (selectedAllMatching || visibleModelIds.every((modelId) => selectedModelIds.has(modelId)));

  // Force refresh count + list when page mounts
  useEffect(() => {
    mutate(undefined, { revalidate: true });
    swrMutate(MODEL_ADMIN_COUNT_KEY);
  }, [mutate]);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupAction, setGroupAction] = useState<string | null>(null);
  const [groupConfirm, setGroupConfirm] = useState<ModelGroupConfirm | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const {
    value: groupSearch,
    draftValue: groupSearchInputValue,
    setValue: setGroupSearch,
    inputProps: groupSearchInputProps,
  } = useImeSafeSearchInput();
  const {
    value: suggestionSearch,
    draftValue: suggestionSearchInputValue,
    setValue: setSuggestionSearch,
    inputProps: suggestionSearchInputProps,
  } = useImeSafeSearchInput();
  const {
    value: deletedSearch,
    draftValue: deletedSearchInputValue,
    setValue: setDeletedSearch,
    inputProps: deletedSearchInputProps,
  } = useImeSafeSearchInput();
  const [restoringModelId, setRestoringModelId] = useState<string | null>(null);
  const [restoringDeletedBatch, setRestoringDeletedBatch] = useState(false);
  const [selectedDeletedModelIds, setSelectedDeletedModelIds] = useState<Set<string>>(new Set());
  const [purgingDeleted, setPurgingDeleted] = useState(false);
  const [purgeConfirmMode, setPurgeConfirmMode] = useState<DeletedPurgeMode | null>(null);
  const [deletedRefreshVersion, setDeletedRefreshVersion] = useState(0);
  const {
    groups: suggestionGroups,
    total: activeSuggestionCount,
    isLoading: sugLoading,
    isLoadingMore: suggestionsLoadingMore,
    hasMore: suggestionsHasMore,
    loadMore: loadMoreSuggestions,
    mutate: sugMutate,
  } = useMergeSuggestionPages(activeTab === 'suggestions');
  const { data: suggestionCountData, mutate: suggestionCountMutate } = useSWR(
    '/model-groups/suggestions/count-mobile',
    () => modelApi.getMergeSuggestions({ page: 1, pageSize: 1 }),
  );
  const {
    data: groupData,
    isLoading: groupsLoading,
    mutate: groupMutate,
  } = useSWR(activeTab === 'groups' ? '/model-groups-mobile' : null, () => modelApi.listModelGroups());
  const { data: groupCountData } = useSWR('/model-groups/count', () => modelApi.getModelGroupCount());
  const {
    items: deletedModels,
    total: deletedTotal,
    isLoading: deletedLoading,
    isLoadingMore: deletedLoadingMore,
    hasMore: deletedHasMore,
    loadMore: loadMoreDeleted,
    mutate: deletedMutate,
  } = useDeletedModelPages(deletedSearch, activeTab === 'deleted', deletedRefreshVersion);
  const { data: deletedCountData, mutate: deletedCountMutate } = useSWR('/models/deleted/count-mobile', () =>
    modelApi.listDeleted({ page: 1, pageSize: 1 }),
  );
  const deletedModelIds = deletedModels.map((model) => model.model_id);
  const selectedDeletedCount = selectedDeletedModelIds.size;
  const selectedRestorableDeletedCount = deletedModels.filter(
    (model) => selectedDeletedModelIds.has(model.model_id) && model.can_restore,
  ).length;
  const allDeletedLoadedSelected =
    deletedModelIds.length > 0 && deletedModelIds.every((modelId) => selectedDeletedModelIds.has(modelId));
  const groups = Array.isArray(groupData) ? groupData : [];
  const filteredGroups = groupSearch
    ? groups.filter(
        (g) =>
          g.name.toLowerCase().includes(groupSearch.toLowerCase()) ||
          g.models.some(
            (m) =>
              m.name.toLowerCase().includes(groupSearch.toLowerCase()) ||
              (m.originalName || '').toLowerCase().includes(groupSearch.toLowerCase()),
          ),
      )
    : groups;

  const filteredSuggestions = suggestionSearch
    ? suggestionGroups.filter((g) => g.name.toLowerCase().includes(suggestionSearch.toLowerCase()))
    : suggestionGroups;
  const suggestionNames = filteredSuggestions.map((group) => group.name);
  const selectedSuggestionCount = suggestionNames.filter((name) => selectedNames.has(name)).length;
  const allSuggestionsSelected = suggestionNames.length > 0 && selectedSuggestionCount === suggestionNames.length;
  const suggestionCount = activeTab === 'suggestions' ? activeSuggestionCount : (suggestionCountData?.total ?? 0);
  const mergedGroupCount = groupCountData?.total ?? groupData?.length;
  const deletedGlobalCount = deletedCountData?.total ?? 0;
  const deletedModelCount =
    activeTab === 'deleted'
      ? deletedSearch.trim()
        ? deletedTotal
        : Math.max(deletedTotal, deletedGlobalCount)
      : deletedGlobalCount;
  const modelAdminTabs: ResponsiveSectionTab[] = [
    { value: 'models', label: '全部模型', count: displayModelTotalM, icon: 'inventory_2' },
    { value: 'suggestions', label: '合并建议', count: suggestionCount, icon: 'merge_type' },
    { value: 'groups', label: '已合并', count: mergedGroupCount, icon: 'category' },
    { value: 'deleted', label: '回收站', count: deletedModelCount, icon: 'delete_sweep' },
  ];

  useEffect(() => {
    setSelectedNames(new Set());
  }, [activeTab]);

  useEffect(() => {
    setSelectedModelIds(new Set());
    setSelectedAllMatching(false);
  }, [activeTab, search, categoryFilter]);

  useEffect(() => {
    setSelectedDeletedModelIds(new Set());
  }, [activeTab, deletedSearch]);

  useEffect(() => {
    if (activeTab !== 'deleted') return;
    deletedMutate();
    deletedCountMutate();
  }, [activeTab, deletedMutate, deletedCountMutate]);

  useEffect(() => {
    if (activeTab !== 'deleted' || deletedSearch.trim() || deletedLoading) return;
    if (deletedModelCount > 0 && deletedModels.length === 0) {
      deletedMutate();
    }
  }, [activeTab, deletedSearch, deletedLoading, deletedModelCount, deletedModels.length, deletedMutate]);

  const refreshModelAdminData = () => {
    mutate();
    swrMutate(MODEL_ADMIN_COUNT_KEY);
    swrMutate('/categories-m');
    sugMutate();
    suggestionCountMutate();
    groupMutate();
    setDeletedRefreshVersion((version) => version + 1);
    deletedMutate();
    deletedCountMutate();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await modelApi.delete(deleteTarget.model_id);
      toast('已删除', 'success');
      setSelectedModelIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.model_id);
        return next;
      });
      refreshModelAdminData();
      setDeleteTarget(null);
    } catch {
      toast('删除失败', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelectModel = (modelId: string) => {
    if (selectedAllMatching) {
      setSelectedAllMatching(false);
      setSelectedModelIds(new Set(visibleModelIds.filter((id) => id !== modelId)));
      return;
    }
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const toggleSelectVisibleModels = () => {
    setSelectedAllMatching(false);
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (allVisibleModelsSelected) {
        visibleModelIds.forEach((modelId) => next.delete(modelId));
      } else {
        visibleModelIds.forEach((modelId) => next.add(modelId));
      }
      return next;
    });
  };

  const selectAllMatchingModels = () => {
    if (displayModelTotalM <= 0) return;
    setSelectedAllMatching(true);
    setSelectedModelIds(new Set());
  };

  const clearSelectedModels = () => {
    setSelectedAllMatching(false);
    setSelectedModelIds(new Set());
  };

  const handleBatchDelete = async () => {
    const modelIds = Array.from(selectedModelIds);
    if (!selectedAllMatching && modelIds.length === 0) return;
    setBatchDeleting(true);
    try {
      const result = await modelApi.batchDelete(
        selectedAllMatching
          ? {
              allMatching: true,
              filters: {
                search: search.trim() || undefined,
                categoryId: categoryFilter === CATEGORY_FILTER_ALL ? undefined : categoryFilter,
              },
            }
          : { modelIds },
      );
      const warningText = result.warnings > 0 ? `，${result.warnings} 个文件清理警告` : '';
      toast(`已删除 ${result.deleted} 个模型${warningText}`, result.warnings > 0 ? 'error' : 'success');
      clearSelectedModels();
      setBatchDeleteOpen(false);
      refreshModelAdminData();
    } catch {
      toast('批量删除失败', 'error');
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleRestoreModel = async (model: DeletedModelListItem) => {
    setRestoringModelId(model.model_id);
    try {
      await modelApi.restore(model.model_id);
      toast('模型已恢复', 'success');
      refreshModelAdminData();
    } catch {
      toast('恢复失败', 'error');
    } finally {
      setRestoringModelId(null);
    }
  };

  const restoreSelectedDeletedModels = async () => {
    const targets = deletedModels.filter((model) => selectedDeletedModelIds.has(model.model_id) && model.can_restore);
    if (targets.length === 0) {
      toast('选中的模型文件缺失，无法批量恢复', 'error');
      return;
    }
    setRestoringDeletedBatch(true);
    try {
      const results = await Promise.allSettled(targets.map((model) => modelApi.restore(model.model_id)));
      const restoredIds = new Set(
        targets.filter((_, index) => results[index]?.status === 'fulfilled').map((model) => model.model_id),
      );
      const failed = targets.length - restoredIds.size;
      setSelectedDeletedModelIds((prev) => {
        const next = new Set(prev);
        restoredIds.forEach((modelId) => next.delete(modelId));
        return next;
      });
      toast(
        failed > 0 ? `已恢复 ${restoredIds.size} 个模型，${failed} 个恢复失败` : `已恢复 ${restoredIds.size} 个模型`,
        failed > 0 ? 'error' : 'success',
      );
      refreshModelAdminData();
    } finally {
      setRestoringDeletedBatch(false);
    }
  };

  const toggleSelectDeletedModel = (modelId: string) => {
    setSelectedDeletedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const toggleSelectLoadedDeletedModels = () => {
    setSelectedDeletedModelIds((prev) => {
      const next = new Set(prev);
      if (allDeletedLoadedSelected) {
        deletedModelIds.forEach((modelId) => next.delete(modelId));
      } else {
        deletedModelIds.forEach((modelId) => next.add(modelId));
      }
      return next;
    });
  };

  const clearSelectedDeletedModels = () => {
    setSelectedDeletedModelIds(new Set());
  };

  const purgeDeletedModels = async (mode: 'selected' | 'all') => {
    const modelIds = Array.from(selectedDeletedModelIds);
    if (mode === 'selected' && modelIds.length === 0) return;
    setPurgingDeleted(true);
    try {
      const result = await modelApi.purgeDeleted(mode === 'all' ? { all: true } : { modelIds });
      const warningText = result.warnings > 0 ? `，${result.warnings} 个文件清理警告` : '';
      toast(`已彻底删除 ${result.deleted} 个模型${warningText}`, result.warnings > 0 ? 'error' : 'success');
      clearSelectedDeletedModels();
      setPurgeConfirmMode(null);
      refreshModelAdminData();
    } catch {
      toast('彻底删除失败', 'error');
    } finally {
      setPurgingDeleted(false);
    }
  };
  const purgeConfirmSelectedCount = purgeConfirmMode === 'all' ? deletedModelCount : selectedDeletedCount;
  const purgeConfirmTitle = purgeConfirmMode === 'all' ? '确认清空回收站' : '确认彻底删除';
  const purgeConfirmDescription =
    purgeConfirmMode === 'all'
      ? `将彻底删除回收站中的 ${purgeConfirmSelectedCount} 个模型及相关文件，此操作不可恢复。`
      : `将彻底删除选中的 ${purgeConfirmSelectedCount} 个模型及相关文件，此操作不可恢复。`;

  const toggleSelect = (name: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleSelectPage = () => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (allSuggestionsSelected) {
        suggestionNames.forEach((name) => next.delete(name));
      } else {
        suggestionNames.forEach((name) => next.add(name));
      }
      return next;
    });
  };

  const handleMerge = async () => {
    if (selectedSuggestionCount === 0) return;
    setMerging(true);
    try {
      const items = filteredSuggestions
        .filter((s) => selectedNames.has(s.name))
        .map((s) => ({
          name: s.name,
          modelIds: s.models.map((m) => m.id),
        }));
      const result = await modelApi.batchMerge(items);
      toast(`已合并 ${result.merged} 组`, 'success');
      setSelectedNames(new Set());
      sugMutate();
      suggestionCountMutate();
      groupMutate();
    } catch {
      toast('合并失败', 'error');
    } finally {
      setMerging(false);
    }
  };

  const handleMergeSingleSuggestion = async (group: { name: string; models: { id: string }[] }) => {
    if (group.models.length < 2) return;
    setMerging(true);
    try {
      const result = await modelApi.batchMerge([{ name: group.name, modelIds: group.models.map((m) => m.id) }]);
      toast(`已合并 ${result.merged} 组`, 'success');
      setSelectedNames((prev) => {
        const next = new Set(prev);
        next.delete(group.name);
        return next;
      });
      sugMutate();
      suggestionCountMutate();
      groupMutate();
      mutate();
    } catch {
      toast('合并失败', 'error');
    } finally {
      setMerging(false);
    }
  };

  const beginEditGroup = (group: ModelGroupItem) => {
    setEditingGroupId(group.id);
    setGroupNameDraft(group.name);
  };

  const handleSaveGroup = async (group: ModelGroupItem) => {
    const name = groupNameDraft.trim();
    if (!name) {
      toast('分组名称不能为空', 'error');
      return;
    }
    setGroupAction(`rename:${group.id}`);
    try {
      await modelApi.updateModelGroup(group.id, { name });
      toast('分组已更新', 'success');
      setEditingGroupId(null);
      groupMutate();
      mutate();
    } catch {
      toast('更新分组失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleSetPrimary = async (group: ModelGroupItem, modelId: string) => {
    setGroupAction(`primary:${group.id}:${modelId}`);
    try {
      await modelApi.updateModelGroup(group.id, { primaryId: modelId });
      toast('已设置主版本', 'success');
      groupMutate();
      mutate();
    } catch {
      toast('设置主版本失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleRemoveFromGroup = async (group: ModelGroupItem, modelId: string) => {
    setGroupConfirm(null);
    setGroupAction(`remove:${group.id}:${modelId}`);
    try {
      await modelApi.removeModelFromGroup(group.id, modelId);
      toast('已移出分组', 'success');
      groupMutate();
      sugMutate();
      suggestionCountMutate();
      mutate();
    } catch {
      toast('移出分组失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleDeleteGroup = async (group: ModelGroupItem) => {
    setGroupConfirm(null);
    setGroupAction(`delete:${group.id}`);
    try {
      const result = await modelApi.deleteModelGroup(group.id);
      const msg =
        result.dissolvedModels > 1 ? `分组已解散，${result.dissolvedModels} 个模型已恢复独立显示` : '分组已解散';
      toast(msg, 'success');
      groupMutate();
      sugMutate();
      suggestionCountMutate();
      mutate();
    } catch {
      toast('解散分组失败', 'error');
    } finally {
      setGroupAction(null);
    }
  };

  return (
    <>
      <UploadModalLoader open={uploadOpen} onClose={() => setUploadOpen(false)} onConverted={refreshModelAdminData} />
      <AdminManagementPage
        title="模型管理"
        description="维护模型库文件、合并建议和预览运维"
        contentClassName="gap-3"
        actions={
          <div className="flex items-center gap-2">
            <AdminButton
              onClick={() => setPreviewOpsOpen(true)}
              icon="view_in_ar"
              size="sm"
              variant="secondary"
              aria-label="打开预览运维工作台"
            >
              运维
            </AdminButton>
            <AdminButton
              onClick={() => setUploadOpen(true)}
              onPointerEnter={preloadUploadModal}
              onPointerDown={preloadUploadModal}
              onFocus={preloadUploadModal}
              icon="cloud_upload"
              size="sm"
              variant="primary"
            >
              上传
            </AdminButton>
          </div>
        }
      >
        {activeTab === 'models' && (
          <div className="grid gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-10 rounded-sm border border-outline-variant/30 bg-surface-container-high px-3 text-sm text-on-surface outline-none"
            >
              <option value={CATEGORY_FILTER_ALL}>全部分类</option>
              {categoryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <AdminSearchField
              inputProps={searchInputProps}
              value={searchInputValue}
              onClear={() => setSearch('')}
              placeholder="搜索模型..."
              className="md:w-full"
            />
          </div>
        )}
        {activeTab === 'groups' && (
          <AdminSearchField
            inputProps={groupSearchInputProps}
            value={groupSearchInputValue}
            onClear={() => setGroupSearch('')}
            placeholder="搜索分组..."
            className="md:w-full"
          />
        )}

        {activeTab === 'suggestions' && (
          <AdminSearchField
            inputProps={suggestionSearchInputProps}
            value={suggestionSearchInputValue}
            onClear={() => setSuggestionSearch('')}
            placeholder="搜索建议..."
            className="md:w-full"
          />
        )}
        {activeTab === 'deleted' && (
          <AdminSearchField
            inputProps={deletedSearchInputProps}
            value={deletedSearchInputValue}
            onClear={() => setDeletedSearch('')}
            placeholder="搜索已删除模型..."
            className="md:w-full"
          />
        )}
        <ResponsiveSectionTabs
          tabs={modelAdminTabs}
          value={activeTab}
          onChange={(value) => startTransition(() => setActiveTab(value as ModelAdminTab))}
          mobileTitle="模型管理分类"
        />

        {activeTab === 'models' && models.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-outline-variant/10 bg-surface-container-high px-3 py-2">
            <div className="min-w-0 text-xs text-on-surface-variant">
              已加载 <span className="font-bold text-primary-container">{visibleModels.length}</span> /{' '}
              {displayModelTotalM}
              {selectedAllMatching ? (
                <span>，已选全部匹配 {selectedModelCount}</span>
              ) : selectedModelCount > 0 ? (
                <span>，已选 {selectedModelCount}</span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {displayModelTotalM > visibleModels.length && (
                <button
                  onClick={selectAllMatchingModels}
                  disabled={displayModelTotalM === 0}
                  className="rounded-sm border border-primary/20 bg-primary/10 px-2.5 py-1.5 text-xs font-bold text-primary disabled:opacity-40"
                >
                  选择全部
                </button>
              )}
              <button
                onClick={toggleSelectVisibleModels}
                disabled={visibleModelIds.length === 0}
                className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant disabled:opacity-40"
              >
                {allVisibleModelsSelected ? '取消' : '全选'}
              </button>
              {selectedModelCount > 0 && (
                <button
                  onClick={() => setBatchDeleteOpen(true)}
                  disabled={batchDeleting}
                  className="rounded-sm border border-error/20 bg-error/10 px-2.5 py-1.5 text-xs font-bold text-error disabled:opacity-40"
                >
                  删除
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'suggestions' ? (
          sugLoading ? (
            <AdminLoadingState variant="list" rows={5} label="同名合并建议加载中" />
          ) : (
            <div className="admin-tab-panel space-y-3">
              {filteredSuggestions.length > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-container-high px-3 py-2">
                  <div className="min-w-0 text-xs text-on-surface-variant">
                    已加载 <span className="font-bold text-primary-container">{filteredSuggestions.length}</span> /{' '}
                    {suggestionCount}
                    {selectedSuggestionCount > 0 && <span>，已选 {selectedSuggestionCount}</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={toggleSelectPage}
                      className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant"
                    >
                      {allSuggestionsSelected ? '取消' : '全选'}
                    </button>
                    <button
                      onClick={handleMerge}
                      disabled={merging || selectedSuggestionCount === 0}
                      className="rounded-sm bg-primary-container px-3 py-1.5 text-xs font-bold text-on-primary disabled:opacity-40"
                    >
                      {merging ? '合并中' : '合并'}
                    </button>
                  </div>
                </div>
              )}
              {filteredSuggestions.map((group) => (
                <div key={group.name} className="rounded-lg bg-surface-container-high p-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedNames.has(group.name)}
                      onChange={() => toggleSelect(group.name)}
                      className="h-4 w-4 accent-primary-container"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-on-surface">{group.name}</p>
                      <p className="text-[11px] text-on-surface-variant">{group.count} 个同名模型</p>
                    </div>
                    <button
                      onClick={() => toggleSelect(group.name)}
                      className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant"
                    >
                      {selectedNames.has(group.name) ? '取消' : '选中'}
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2 overflow-x-auto scrollbar-hidden">
                    {group.models.map((m) => (
                      <div key={m.id} className="w-14 shrink-0">
                        <div className="h-14 w-14 overflow-hidden rounded bg-surface-container-highest">
                          <ModelThumbnail src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                        </div>
                        <p className="mt-1 truncate text-[9px] text-on-surface-variant">
                          {m.originalName.replace(/\.[^.]+$/, '')}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-outline-variant/10 pt-3">
                    <span className="text-[11px] text-on-surface-variant">
                      将这 {group.models.length} 个同名模型合并为一组
                    </span>
                    <button
                      onClick={() => handleMergeSingleSuggestion(group)}
                      disabled={merging || group.models.length < 2}
                      className="shrink-0 rounded-sm bg-primary-container px-3 py-1.5 text-xs font-bold text-on-primary disabled:opacity-40"
                    >
                      合并本组
                    </button>
                  </div>
                </div>
              ))}
              {filteredSuggestions.length > 0 && (
                <InfiniteLoadTrigger
                  hasMore={suggestionsHasMore}
                  isLoading={suggestionsLoadingMore}
                  onLoadMore={loadMoreSuggestions}
                />
              )}
              {filteredSuggestions.length === 0 && (
                <p className="rounded-lg bg-surface-container-high px-4 py-12 text-center text-sm text-on-surface-variant">
                  没有需要合并的同名模型
                </p>
              )}
            </div>
          )
        ) : activeTab === 'deleted' ? (
          deletedLoading ? (
            <AdminLoadingState variant="list" rows={5} label="回收站加载中" />
          ) : (
            <DeletedModelsPanel
              compact
              items={deletedModels}
              total={deletedTotal}
              isLoadingMore={deletedLoadingMore}
              hasMore={deletedHasMore}
              onLoadMore={loadMoreDeleted}
              onRestore={handleRestoreModel}
              onRestoreSelected={restoreSelectedDeletedModels}
              onToggleSelect={toggleSelectDeletedModel}
              onToggleSelectLoaded={toggleSelectLoadedDeletedModels}
              onClearSelection={clearSelectedDeletedModels}
              onPurgeSelected={() => setPurgeConfirmMode('selected')}
              onClearAll={() => setPurgeConfirmMode('all')}
              restoringId={restoringModelId}
              restoringSelected={restoringDeletedBatch}
              selectedIds={selectedDeletedModelIds}
              selectedCount={selectedDeletedCount}
              selectedRestorableCount={selectedRestorableDeletedCount}
              allLoadedSelected={allDeletedLoadedSelected}
              purging={purgingDeleted}
            />
          )
        ) : activeTab === 'groups' ? (
          groupsLoading ? (
            <AdminLoadingState variant="list" rows={5} label="模型分组加载中" />
          ) : (
            <div className="admin-tab-panel space-y-2">
              {filteredGroups?.map((group) => {
                const editing = editingGroupId === group.id;
                const primaryId = group.primary?.id;
                const expanded = expandedGroups.has(group.id);
                const toggleExpand = () =>
                  setExpandedGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.id)) next.delete(group.id);
                    else next.add(group.id);
                    return next;
                  });
                return (
                  <div key={group.id} className="rounded-lg bg-surface-container-high p-3">
                    <div
                      className="flex items-start gap-3 cursor-pointer"
                      onClick={() => {
                        if (!editing) toggleExpand();
                      }}
                    >
                      <Icon
                        name={expanded ? 'expand_more' : 'chevron_right'}
                        size={18}
                        className="mt-2 shrink-0 text-on-surface-variant"
                      />
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-surface-container-highest text-primary-container">
                        <Icon name="folder_special" size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        {editing ? (
                          <input
                            value={groupNameDraft}
                            onChange={(e) => setGroupNameDraft(e.target.value)}
                            className="w-full rounded-sm border border-outline-variant/25 bg-surface-container-lowest px-3 py-2 text-sm font-semibold text-on-surface outline-none focus:border-primary"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <>
                            <p className="truncate text-sm font-bold text-on-surface">{group.name}</p>
                            <p className="mt-0.5 text-[11px] text-on-surface-variant">
                              {group.model_count} 个版本 · 主版本：{group.primary?.name || '未设置'}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {editing ? (
                        <>
                          <button
                            onClick={() => handleSaveGroup(group)}
                            disabled={groupAction === `rename:${group.id}`}
                            className="rounded-sm bg-primary-container px-3 py-1.5 text-xs font-bold text-on-primary disabled:opacity-40"
                          >
                            保存
                          </button>
                          <button
                            onClick={() => setEditingGroupId(null)}
                            className="rounded-sm border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => beginEditGroup(group)}
                          className="rounded-sm border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant"
                        >
                          重命名
                        </button>
                      )}
                      <button
                        onClick={() => setGroupConfirm({ type: 'delete', group })}
                        disabled={groupAction === `delete:${group.id}`}
                        className="rounded-sm border border-error/20 px-3 py-1.5 text-xs text-error disabled:opacity-40"
                      >
                        解散分组
                      </button>
                    </div>
                    {expanded && (
                      <div className="mt-3 space-y-2">
                        {group.models.map((model) => {
                          const isPrimary = model.id === primaryId;
                          return (
                            <div key={model.id} className="rounded-lg bg-surface-container-low p-2.5">
                              <div className="flex items-start gap-2.5">
                                <Link
                                  to={`/model/${model.id}`}
                                  target="_blank"
                                  className="h-14 w-14 shrink-0 overflow-hidden rounded bg-surface-container-highest"
                                >
                                  <ModelThumbnail
                                    src={model.thumbnailUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                </Link>
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <p className="truncate text-xs font-semibold text-on-surface">
                                      {model.originalName || model.name}
                                    </p>
                                    {isPrimary && (
                                      <span className="shrink-0 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                        主版本
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 text-[10px] text-on-surface-variant">
                                    {formatSize(model.originalSize)} · {formatModelDateTime(model.createdAt)}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap justify-end gap-2">
                                <Link
                                  to={`/model/${model.id}`}
                                  target="_blank"
                                  className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant"
                                >
                                  查看
                                </Link>
                                {!isPrimary && (
                                  <button
                                    onClick={() => handleSetPrimary(group, model.id)}
                                    disabled={groupAction === `primary:${group.id}:${model.id}`}
                                    className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant disabled:opacity-40"
                                  >
                                    设为主版本
                                  </button>
                                )}
                                <button
                                  onClick={() => setGroupConfirm({ type: 'remove', group, modelId: model.id })}
                                  disabled={group.model_count <= 2 || groupAction === `remove:${group.id}:${model.id}`}
                                  className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant disabled:opacity-40"
                                >
                                  移出
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {groupData?.length === 0 && (
                <p className="rounded-lg bg-surface-container-high px-4 py-12 text-center text-sm text-on-surface-variant">
                  还没有已合并的模型分组
                </p>
              )}
            </div>
          )
        ) : isLoadingInitial ? (
          <AdminLoadingState variant="list" rows={5} label="模型列表加载中" />
        ) : (
          <div className="admin-tab-panel flex flex-col gap-3">
            {visibleModels.map((m) => (
              <Link
                key={m.model_id}
                to={`/model/${m.model_id}`}
                target="_blank"
                className={`flex items-stretch rounded-lg border border-outline-variant/10 bg-surface-container-high shadow-sm transition-colors hover:bg-surface-container-highest ${
                  selectedModelIds.has(m.model_id) ? 'ring-1 ring-primary-container/40' : ''
                }`}
              >
                <div
                  className="flex shrink-0 items-center pl-3"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedModelIds.has(m.model_id)}
                    onChange={() => toggleSelectModel(m.model_id)}
                    className="h-4 w-4 accent-primary-container"
                    aria-label={`选择 ${m.name}`}
                  />
                </div>
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-l-lg bg-surface-container-highest">
                  <ModelThumbnail src={m.thumbnail_url} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2.5">
                  <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-on-surface">
                    {m.name}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[10px] font-mono bg-surface-container-highest px-1 py-0.5 rounded-sm">
                      {m.format?.toUpperCase()}
                    </span>
                    <span className="text-[10px] text-on-surface-variant break-words">{m.category || '未分类'}</span>
                    <span className="text-[10px] text-on-surface-variant font-mono">{formatSize(m.original_size)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 pr-2.5" onClick={(e) => e.preventDefault()}>
                  <button
                    onClick={() => setEditModel(m)}
                    className="px-2 py-1.5 text-xs text-on-surface-variant hover:text-on-surface rounded-sm border border-outline-variant/20"
                  >
                    <Icon name="settings" size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(m)}
                    className="px-2 py-1.5 text-xs text-on-surface-variant hover:text-error rounded-sm border border-outline-variant/20"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              </Link>
            ))}
            {models.length > 0 && (
              <InfiniteLoadTrigger
                hasMore={hasMoreVisibleModels || hasMore}
                isLoading={isLoadingMore}
                onLoadMore={hasMoreVisibleModels ? loadMoreVisibleModels : loadMore}
              />
            )}
            {models.length === 0 && <p className="text-center text-on-surface-variant py-12 text-sm">没有找到模型</p>}
          </div>
        )}
      </AdminManagementPage>
      <PreviewOperationsModal open={previewOpsOpen} onClose={() => setPreviewOpsOpen(false)} compact />
      <ConfirmDialog
        open={Boolean(groupConfirm)}
        onClose={() => {
          if (!groupAction) setGroupConfirm(null);
        }}
        onConfirm={() => {
          if (!groupConfirm) return;
          if (groupConfirm.type === 'remove') void handleRemoveFromGroup(groupConfirm.group, groupConfirm.modelId);
          else void handleDeleteGroup(groupConfirm.group);
        }}
        icon={groupConfirm?.type === 'delete' ? 'close' : 'logout'}
        title={groupConfirm?.type === 'delete' ? '确认解散分组' : '确认移出分组'}
        description={
          groupConfirm?.type === 'delete'
            ? `确定解散「${groupConfirm.group.name}」吗？模型文件不会删除，只会取消合并关系。`
            : '确定将该模型移出当前合并分组吗？模型不会被删除。'
        }
        confirmLabel={groupAction ? '处理中...' : groupConfirm?.type === 'delete' ? '确认解散' : '确认移出'}
        confirmDisabled={Boolean(groupAction)}
      />
      <EditDialog
        open={!!editModel}
        model={editModel}
        categories={categories || []}
        onClose={() => setEditModel(null)}
        onSaved={() => mutate()}
      />
      <ConfirmDialog
        open={Boolean(purgeConfirmMode)}
        onClose={() => {
          if (!purgingDeleted) setPurgeConfirmMode(null);
        }}
        onConfirm={() => {
          if (!purgeConfirmMode) return;
          void purgeDeletedModels(purgeConfirmMode);
        }}
        icon="delete_sweep"
        title={purgeConfirmTitle}
        description={purgeConfirmDescription}
        confirmLabel={purgingDeleted ? '删除中...' : purgeConfirmMode === 'all' ? '清空回收站' : '彻底删除'}
        confirmDisabled={purgingDeleted || purgeConfirmSelectedCount <= 0}
      />
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-surface-dim/70 backdrop-blur-sm"
            onClick={() => setDeleteTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface-container-low rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-sm mx-4 p-5 sm:p-6"
            >
              <h3 className="font-headline text-base font-semibold text-on-surface mb-2">确认删除</h3>
              <p className="text-sm text-on-surface-variant mb-5 break-words">
                确定要删除「{deleteTarget.name}」吗？删除后会从前台隐藏，保留恢复能力。
              </p>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
                <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-on-surface-variant">
                  取消
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 bg-error text-white rounded-sm text-sm disabled:opacity-50"
                >
                  {deleting ? '删除中...' : '删除'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {batchDeleteOpen && selectedModelCount > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-surface-dim/70 backdrop-blur-sm"
            onClick={() => !batchDeleting && setBatchDeleteOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface-container-low rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-sm mx-4 p-5 sm:p-6"
            >
              <h3 className="font-headline text-base font-semibold text-on-surface mb-2">确认批量删除</h3>
              <p className="text-sm text-on-surface-variant mb-5 break-words">
                确定要删除已选择的 {selectedModelCount} 个模型吗？删除后会从前台隐藏并进入回收站，可在文件仍存在时恢复。
                {selectedAllMatching && ' 本次会按当前分类和搜索条件删除全部匹配模型。'}
              </p>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
                <button
                  onClick={() => setBatchDeleteOpen(false)}
                  disabled={batchDeleting}
                  className="px-4 py-2 text-sm text-on-surface-variant disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleBatchDelete}
                  disabled={batchDeleting}
                  className="px-4 py-2 bg-error text-white rounded-sm text-sm disabled:opacity-50"
                >
                  {batchDeleting ? '删除中...' : '确认删除'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default function ModelAdminPage() {
  useDocumentTitle('模型管理');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
