import { AnimatePresence, motion } from 'framer-motion';
import { lazy, memo, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import useSWR, { mutate as swrMutate } from 'swr';
import useSWRInfinite from 'swr/infinite';
import { categoriesApi, type CategoryItem } from '../api/categories';
import {
  modelApi,
  type DeletedModelListItem,
  type FailedModelListItem,
  type ModelGroupItem,
  type ServerModelListItem,
} from '../api/models';
import BatchCategoryDialog from '../components/model-admin/BatchCategoryDialog';
import EditDialog from '../components/model-admin/EditDialog';
import ImportModelsDialog from '../components/model-admin/ImportModelsDialog';
import ImportPreviewDialog from '../components/model-admin/ImportPreviewDialog';
import PreviewOperationsModal from '../components/model-admin/PreviewOperationsModal';
import { formatModelDateTime, formatSize } from '../components/model-admin/shared';
import { AdminButton } from '../components/shared/AdminControls';
import { AdminTableHeadCell, AdminTableHeadRow, ADMIN_TABLE_HEAD_CLASS } from '../components/shared/AdminDataTable';
import { AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import SelectMenu from '../components/shared/SelectMenu';
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
type ModelAdminTab = 'models' | 'suggestions' | 'groups' | 'failed' | 'deleted';
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
  const { t } = useTranslation();
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
          <p className="text-sm font-semibold text-on-surface">{t('modelAdminPage.uploadLoadingTitle')}</p>
          <p className="mt-0.5 text-xs text-on-surface-variant">{t('modelAdminPage.uploadLoadingDesc')}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          aria-label={t('modelAdminPage.closeUploadPanel')}
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
  // flatMap 结果必须 memo：数组引用稳定才能让 useVisibleItems/行级 memo/useCallback 级联生效
  const items = useMemo(() => pages.flatMap((page) => page.items), [pages]);
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
  const groups = useMemo(() => pages.flatMap((page) => page.data), [pages]);
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
  // flatMap 结果必须 memo：数组引用稳定才能让 useVisibleItems/行级 memo/useCallback 级联生效
  const items = useMemo(() => pages.flatMap((page) => page.items), [pages]);
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

function useFailedModelPages(search: string, enabled: boolean, refreshVersion: number) {
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const getKey = useCallback(
    (pageIndex: number, previousPageData: Awaited<ReturnType<typeof modelApi.listFailed>> | null) => {
      if (!enabled) return null;
      if (previousPageData && previousPageData.page >= previousPageData.totalPages) return null;
      return ['/models/failed', debouncedSearch, refreshVersion, pageIndex + 1] as const;
    },
    [debouncedSearch, enabled, refreshVersion],
  );

  const { data, error, isLoading, mutate, setSize, size } = useSWRInfinite(
    getKey,
    ([, query, , page]) =>
      modelApi.listFailed({
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
  // flatMap 结果必须 memo：数组引用稳定才能让 useVisibleItems/行级 memo/useCallback 级联生效
  const items = useMemo(() => pages.flatMap((page) => page.items), [pages]);
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
  const { t } = useTranslation();
  const hasItems = items.length > 0;
  const actionBusy = purging || restoringSelected;

  if (compact) {
    return (
      <div className="admin-tab-panel flex flex-col gap-3">
        {hasItems && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant/10 bg-surface-container-high px-3 py-2">
            <span className="text-xs text-on-surface-variant">
              <Trans
                i18nKey="modelAdminPage.loadedOfTotalCompact"
                values={{ loaded: items.length, total }}
                components={{ strong: <span className="font-bold text-primary-container" /> }}
              />
              {selectedCount > 0 && (
                <Trans i18nKey="modelAdminPage.selectedCompact" values={{ count: selectedCount }} />
              )}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <AdminButton onClick={onToggleSelectLoaded} disabled={actionBusy} size="sm" variant="secondary">
                {allLoadedSelected ? t('modelAdminPage.deselect') : t('modelAdminPage.selectAll')}
              </AdminButton>
              {selectedCount > 0 && (
                <>
                  <AdminButton onClick={onClearSelection} disabled={actionBusy} size="sm" variant="secondary">
                    {t('modelAdminPage.clearSelection')}
                  </AdminButton>
                  <AdminButton
                    onClick={onRestoreSelected}
                    disabled={actionBusy || selectedRestorableCount === 0}
                    size="sm"
                    variant="tonal"
                  >
                    {restoringSelected ? t('modelAdminPage.restoring') : t('modelAdminPage.restoreSelected')}
                  </AdminButton>
                  <AdminButton onClick={onPurgeSelected} disabled={actionBusy} size="sm" variant="danger">
                    {t('modelAdminPage.permanentDelete')}
                  </AdminButton>
                </>
              )}
              <AdminButton onClick={onClearAll} disabled={actionBusy || total === 0} size="sm" variant="danger">
                {t('modelAdminPage.emptyRecycleBin')}
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
                name="has"
                type="checkbox"
                checked={selectedIds.has(model.model_id)}
                onChange={() => onToggleSelect(model.model_id)}
                className="mt-3 h-4 w-4 shrink-0 accent-primary-container"
                aria-label={t('modelAdminPage.selectAria', { name: model.name })}
              />
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-surface-container-highest text-on-surface-variant">
                <Icon name="delete_sweep" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-on-surface">
                  {model.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-on-surface-variant">
                  <span>{model.category || t('modelAdminPage.uncategorized')}</span>
                  <span className="font-mono">{model.format?.toUpperCase()}</span>
                  <span className="font-mono">{formatSize(model.original_size)}</span>
                </div>
                <p className="mt-1 text-[10px] text-on-surface-variant">
                  {t('modelAdminPage.deletedAt', { time: formatModelDateTime(model.deleted_at) })}
                </p>
              </div>
              <button
                onClick={() => onRestore(model)}
                disabled={actionBusy || !model.can_restore || restoringId === model.model_id}
                className="shrink-0 rounded-sm border border-primary/25 px-2.5 py-1.5 text-xs font-medium text-primary disabled:cursor-not-allowed disabled:border-outline-variant/15 disabled:text-on-surface-variant/45"
              >
                {restoringId === model.model_id ? t('modelAdminPage.restoring') : t('modelAdminPage.restore')}
              </button>
            </div>
            {!model.can_restore && (
              <p className="mt-2 rounded-sm bg-error/10 px-2 py-1 text-[11px] text-error">
                {t('modelAdminPage.cannotRestore')}
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
            <p className="text-sm font-medium text-on-surface">{t('modelAdminPage.recycleBinEmpty')}</p>
            <p className="mt-1 text-xs text-on-surface-variant">{t('modelAdminPage.recycleBinEmptyDesc')}</p>
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
            <Trans
              i18nKey="modelAdminPage.deletedLoadedCount"
              values={{ loaded: items.length, total }}
              components={{ strong: <strong className="text-primary" /> }}
            />
            {selectedCount > 0 && (
              <Trans
                i18nKey="modelAdminPage.selectedInline"
                values={{ count: selectedCount }}
                components={{ strong: <strong className="text-primary" /> }}
              />
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
              {allLoadedSelected ? t('modelAdminPage.deselectAllLoaded') : t('modelAdminPage.selectAllLoaded')}
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
                  {t('modelAdminPage.clearSelection')}
                </AdminButton>
                <AdminButton
                  onClick={onRestoreSelected}
                  disabled={actionBusy || selectedRestorableCount === 0}
                  icon="restore"
                  size="sm"
                  variant="tonal"
                >
                  {restoringSelected ? t('modelAdminPage.restoringEllipsis') : t('modelAdminPage.restoreSelected')}
                </AdminButton>
                <AdminButton onClick={onPurgeSelected} disabled={actionBusy} icon="delete" size="sm" variant="danger">
                  {t('modelAdminPage.permanentDelete')}
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
              {t('modelAdminPage.emptyRecycleBin')}
            </AdminButton>
          </div>
        </div>
      )}
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className={ADMIN_TABLE_HEAD_CLASS}>
          <AdminTableHeadRow>
            <AdminTableHeadCell className="w-12">
              <input
                name="all-loaded-selected"
                type="checkbox"
                checked={allLoadedSelected}
                disabled={items.length === 0 || actionBusy}
                onChange={onToggleSelectLoaded}
                className="h-4 w-4 accent-primary-container"
                aria-label={
                  allLoadedSelected ? t('modelAdminPage.deselectVisibleAria') : t('modelAdminPage.selectVisibleAria')
                }
              />
            </AdminTableHeadCell>
            <AdminTableHeadCell>{t('modelAdminPage.columnModel')}</AdminTableHeadCell>
            <AdminTableHeadCell>{t('modelAdminPage.columnCategory')}</AdminTableHeadCell>
            <AdminTableHeadCell>{t('modelAdminPage.columnFormat')}</AdminTableHeadCell>
            <AdminTableHeadCell>{t('modelAdminPage.columnSize')}</AdminTableHeadCell>
            <AdminTableHeadCell>{t('modelAdminPage.columnDeletedAt')}</AdminTableHeadCell>
            <AdminTableHeadCell className="text-right">{t('modelAdminPage.columnActions')}</AdminTableHeadCell>
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
                  name="has"
                  type="checkbox"
                  checked={selectedIds.has(model.model_id)}
                  onChange={() => onToggleSelect(model.model_id)}
                  className="h-4 w-4 accent-primary-container"
                  aria-label={t('modelAdminPage.selectAria', { name: model.name })}
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
                      {t('modelAdminPage.originalFileLabel')}
                      {model.original_name || '—'}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-on-surface-variant">
                {model.category || t('modelAdminPage.uncategorized')}
              </td>
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
                  {restoringId === model.model_id
                    ? t('modelAdminPage.restoringEllipsis')
                    : model.can_restore
                      ? t('modelAdminPage.restore')
                      : t('modelAdminPage.fileMissing')}
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
                {t('modelAdminPage.recycleBinEmpty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// 转换失败模型面板：列表 + 单个/选中/全部清理（清理 = 清残留文件并删除记录，详情页随之 404）
function FailedModelsPanel({
  items,
  total,
  isLoadingMore,
  hasMore,
  onLoadMore,
  onClearOne,
  onImport,
  onClearSelected,
  onClearAll,
  onToggleSelect,
  onToggleSelectLoaded,
  onClearSelection,
  clearing,
  clearingId,
  selectedIds,
  selectedCount,
  allLoadedSelected,
  compact = false,
}: {
  items: FailedModelListItem[];
  total: number;
  isLoadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onClearOne: (model: FailedModelListItem) => void;
  onImport: (model: FailedModelListItem) => void;
  onClearSelected: () => void;
  onClearAll: () => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectLoaded: () => void;
  onClearSelection: () => void;
  clearing: boolean;
  clearingId: string | null;
  selectedIds: Set<string>;
  selectedCount: number;
  allLoadedSelected: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const actionBusy = clearing;

  if (compact) {
    return (
      <div className="admin-tab-panel flex flex-col gap-3">
        {items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant/10 bg-surface-container-high px-3 py-2">
            <span className="text-xs text-on-surface-variant">
              <Trans
                i18nKey="modelAdminPage.loadedOfTotalCompact"
                values={{ loaded: items.length, total }}
                components={{ strong: <span className="font-bold text-primary-container" /> }}
              />
              {selectedCount > 0 && (
                <Trans i18nKey="modelAdminPage.selectedCompact" values={{ count: selectedCount }} />
              )}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <AdminButton onClick={onToggleSelectLoaded} disabled={actionBusy} size="sm" variant="secondary">
                {allLoadedSelected ? t('modelAdminPage.deselect') : t('modelAdminPage.selectAll')}
              </AdminButton>
              {selectedCount > 0 && (
                <>
                  <AdminButton onClick={onClearSelection} disabled={actionBusy} size="sm" variant="secondary">
                    {t('modelAdminPage.clearSelection')}
                  </AdminButton>
                  <AdminButton onClick={onClearSelected} disabled={actionBusy} size="sm" variant="danger">
                    {t('modelAdminPage.clearSelected')}
                  </AdminButton>
                </>
              )}
              <AdminButton onClick={onClearAll} disabled={actionBusy || total === 0} size="sm" variant="danger">
                {t('modelAdminPage.clearAll')}
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
                name="has"
                type="checkbox"
                checked={selectedIds.has(model.model_id)}
                onChange={() => onToggleSelect(model.model_id)}
                className="mt-3 h-4 w-4 shrink-0 accent-primary-container"
                aria-label={t('modelAdminPage.selectAria', { name: model.name })}
              />
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-error/10 text-error">
                <Icon name="error" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-on-surface">
                  {model.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-on-surface-variant">
                  <span>{model.category || t('modelAdminPage.uncategorized')}</span>
                  <span className="font-mono">{model.format?.toUpperCase()}</span>
                  <span className="font-mono">{formatSize(model.original_size)}</span>
                </div>
                {model.error && (
                  <p className="mt-1 line-clamp-2 break-all rounded-sm bg-error/10 px-1.5 py-1 text-[10px] text-error">
                    {model.error}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1.5">
                <button
                  onClick={() => onImport(model)}
                  disabled={actionBusy}
                  className="rounded-sm border border-primary/25 px-2.5 py-1.5 text-xs font-medium text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('modelAdminPage.importArtifacts')}
                </button>
                <button
                  onClick={() => onClearOne(model)}
                  disabled={actionBusy || clearingId === model.model_id}
                  className="rounded-sm border border-error/25 px-2.5 py-1.5 text-xs font-medium text-error disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {clearingId === model.model_id ? t('modelAdminPage.clearing') : t('modelAdminPage.clear')}
                </button>
              </div>
            </div>
          </div>
        ))}
        {items.length > 0 && (
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={onLoadMore} />
        )}
        {items.length === 0 && (
          <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
            <Icon name="check_circle" size={38} className="mb-3 text-on-surface-variant/25" />
            <p className="text-sm font-medium text-on-surface">{t('modelAdminPage.noFailedModels')}</p>
            <p className="mt-1 text-xs text-on-surface-variant">{t('modelAdminPage.noFailedModelsDesc')}</p>
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
            <Trans
              i18nKey="modelAdminPage.failedLoadedCount"
              values={{ loaded: items.length, total }}
              components={{ strong: <strong className="text-primary" /> }}
            />
            {selectedCount > 0 && (
              <Trans
                i18nKey="modelAdminPage.selectedInline"
                values={{ count: selectedCount }}
                components={{ strong: <strong className="text-primary" /> }}
              />
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
              {allLoadedSelected ? t('modelAdminPage.deselectAllLoaded') : t('modelAdminPage.selectAllLoaded')}
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
                  {t('modelAdminPage.clearSelection')}
                </AdminButton>
                <AdminButton onClick={onClearSelected} disabled={actionBusy} icon="delete" size="sm" variant="danger">
                  {t('modelAdminPage.clearSelected')}
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
              {t('modelAdminPage.clearAllFull')}
            </AdminButton>
          </div>
        </div>
      )}
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className={ADMIN_TABLE_HEAD_CLASS}>
          <AdminTableHeadRow>
            <AdminTableHeadCell className="w-12">
              <input
                name="all-loaded-selected"
                type="checkbox"
                checked={allLoadedSelected}
                disabled={items.length === 0 || actionBusy}
                onChange={onToggleSelectLoaded}
                className="h-4 w-4 accent-primary-container"
                aria-label={
                  allLoadedSelected ? t('modelAdminPage.deselectVisibleAria') : t('modelAdminPage.selectVisibleAria')
                }
              />
            </AdminTableHeadCell>
            <AdminTableHeadCell>{t('modelAdminPage.columnModel')}</AdminTableHeadCell>
            <AdminTableHeadCell className="min-w-[220px]">{t('modelAdminPage.columnFailReason')}</AdminTableHeadCell>
            <AdminTableHeadCell>{t('modelAdminPage.columnCategory')}</AdminTableHeadCell>
            <AdminTableHeadCell>{t('modelAdminPage.columnSize')}</AdminTableHeadCell>
            <AdminTableHeadCell className="text-right">{t('modelAdminPage.columnActions')}</AdminTableHeadCell>
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
                  name="has"
                  type="checkbox"
                  checked={selectedIds.has(model.model_id)}
                  onChange={() => onToggleSelect(model.model_id)}
                  className="h-4 w-4 accent-primary-container"
                  aria-label={t('modelAdminPage.selectAria', { name: model.name })}
                />
              </td>
              <td className="px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-error/10 text-error">
                    <Icon name="error" size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="block max-w-[320px] truncate font-medium text-on-surface">{model.name}</p>
                    <p className="mt-0.5 max-w-[320px] truncate text-xs text-on-surface-variant">
                      {t('modelAdminPage.uploadedAt', { time: formatModelDateTime(model.created_at) })}
                    </p>
                  </div>
                </div>
              </td>
              <td className="max-w-[320px] px-4 py-3">
                <p className="line-clamp-2 break-all text-xs text-error" title={model.error || undefined}>
                  {model.error || t('modelAdminPage.noFailReason')}
                </p>
              </td>
              <td className="px-4 py-3 text-on-surface-variant">
                {model.category || t('modelAdminPage.uncategorized')}
              </td>
              <td className="px-4 py-3 font-mono text-on-surface-variant">{formatSize(model.original_size)}</td>
              <td className="px-4 py-3 text-right">
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <button
                    onClick={() => onImport(model)}
                    disabled={actionBusy}
                    className="rounded-sm border border-primary/25 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('modelAdminPage.importArtifacts')}
                  </button>
                  <button
                    onClick={() => onClearOne(model)}
                    disabled={actionBusy || clearingId === model.model_id}
                    className="rounded-sm border border-error/25 px-2.5 py-1.5 text-xs font-medium text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {clearingId === model.model_id ? t('modelAdminPage.clearingEllipsis') : t('modelAdminPage.clear')}
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {items.length > 0 && (
            <tr>
              <td colSpan={6}>
                <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={onLoadMore} />
              </td>
            </tr>
          )}
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-on-surface-variant">
                {t('modelAdminPage.noFailedModels')}
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
  const { t } = useTranslation();
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
  const label = selected ? selected.label : t('modelAdminPage.allCategories');

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
            {t('modelAdminPage.allCategories')}
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

interface ModelRowHandlers {
  onToggleSelect: (modelId: string) => void;
  /** 由 setState setter 直接传入（接受整行模型对象） */
  onEdit: (model: ServerModelListItem) => void;
  onDelete: (model: ServerModelListItem) => void;
}

/** 表格行 memo 化：搜索框每键 commit 都会重渲染整个页面组件，
    行级 props（模型对象引用 + 布尔选中态 + 稳定 handler）不变时跳过重渲染，消除打字卡顿 */
const ModelTableRow = memo(function ModelTableRow({
  model,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
}: ModelRowHandlers & { model: ServerModelListItem; selected: boolean }) {
  const { t } = useTranslation();
  return (
    <tr className="border-b border-outline-variant/10 hover:bg-surface-container-high/50 transition-colors">
      <td className="px-4 py-3 align-middle">
        <input
          name="has"
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(model.model_id)}
          className="h-4 w-4 accent-primary-container"
          aria-label={t('modelAdminPage.selectAria', { name: model.name })}
        />
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/model/${model.model_id}`}
          target="_blank"
          rel="noopener"
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <div className="w-10 h-10 rounded-sm bg-surface-container-highest shrink-0 overflow-hidden">
            <ModelThumbnail src={model.thumbnail_url} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0">
            <span className="block truncate text-on-surface font-medium">{model.name}</span>
            {model.group && (
              <span className="text-[10px] text-primary font-medium">
                {model.group.name} {model.group.is_primary ? t('modelAdminPage.primaryVersionDot') : ''}{' '}
                {t('modelAdminPage.groupVariantCount', { count: model.group.variant_count })}
              </span>
            )}
          </div>
        </Link>
      </td>
      <td className="px-4 py-3 text-on-surface-variant">
        <span className="block truncate" title={model.category || ''}>
          {model.category || '—'}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs font-mono bg-surface-container-highest px-1.5 py-0.5 rounded-sm">
          {model.format?.toUpperCase()}
        </span>
      </td>
      <td className="px-4 py-3 text-on-surface-variant font-mono">{formatSize(model.original_size)}</td>
      <td className="px-4 py-3">
        {model.drawing_url ? (
          <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-sm font-medium">PDF</span>
        ) : (
          <span className="text-[10px] text-on-surface-variant/30">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <Link
            to={`/model/${model.model_id}`}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-primary hover:bg-primary/10 rounded-sm transition-colors border border-outline-variant/20"
          >
            <Icon name="open_in_new" size={14} />
            {t('modelAdminPage.view')}
          </Link>
          <button
            onClick={() => onEdit(model)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20"
          >
            <Icon name="settings" size={14} />
            {t('common.edit')}
          </button>
          <button
            onClick={() => onDelete(model)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-error hover:bg-error/10 rounded-sm transition-colors border border-outline-variant/20"
          >
            <Icon name="close" size={14} />
            {t('common.delete')}
          </button>
        </div>
      </td>
    </tr>
  );
});

/** 移动端卡片行（与桌面 ModelTableRow 同一套 memo 策略） */
const ModelCard = memo(function ModelCard({
  model,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
}: ModelRowHandlers & { model: ServerModelListItem; selected: boolean }) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/model/${model.model_id}`}
      target="_blank"
      rel="noopener"
      className={`flex items-stretch rounded-lg border border-outline-variant/10 bg-surface-container-high shadow-sm transition-colors hover:bg-surface-container-highest ${
        selected ? 'ring-1 ring-primary-container/40' : ''
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
          name="has"
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(model.model_id)}
          className="h-4 w-4 accent-primary-container"
          aria-label={t('modelAdminPage.selectAria', { name: model.name })}
        />
      </div>
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-l-lg bg-surface-container-highest">
        <ModelThumbnail src={model.thumbnail_url} alt="" className="w-full h-full object-cover" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2.5">
        <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-on-surface">{model.name}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[10px] font-mono bg-surface-container-highest px-1 py-0.5 rounded-sm">
            {model.format?.toUpperCase()}
          </span>
          <span className="text-[10px] text-on-surface-variant break-words">
            {model.category || t('modelAdminPage.uncategorized')}
          </span>
          <span className="text-[10px] text-on-surface-variant font-mono">{formatSize(model.original_size)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pr-2.5" onClick={(e) => e.preventDefault()}>
        <button
          onClick={() => onEdit(model)}
          className="px-2 py-1.5 text-xs text-on-surface-variant hover:text-on-surface rounded-sm border border-outline-variant/20"
        >
          <Icon name="settings" size={14} />
        </button>
        <button
          onClick={() => onDelete(model)}
          className="px-2 py-1.5 text-xs text-on-surface-variant hover:text-error rounded-sm border border-outline-variant/20"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </Link>
  );
});

function DesktopContent() {
  const { toast } = useToast();
  const { t } = useTranslation();
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
  const [batchCategoryOpen, setBatchCategoryOpen] = useState(false);
  const [batchCategorySaving, setBatchCategorySaving] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewOpsOpen, setPreviewOpsOpen] = useState(false);
  const [importModelsOpen, setImportModelsOpen] = useState(false);
  const [exportingSelection, setExportingSelection] = useState(false);
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
  const {
    value: failedSearch,
    draftValue: failedSearchInputValue,
    setValue: setFailedSearch,
    inputProps: failedSearchInputProps,
  } = useImeSafeSearchInput();
  const [restoringModelId, setRestoringModelId] = useState<string | null>(null);
  const [restoringDeletedBatch, setRestoringDeletedBatch] = useState(false);
  const [selectedDeletedModelIds, setSelectedDeletedModelIds] = useState<Set<string>>(new Set());
  const [purgingDeleted, setPurgingDeleted] = useState(false);
  const [purgeConfirmMode, setPurgeConfirmMode] = useState<DeletedPurgeMode | null>(null);
  const [deletedRefreshVersion, setDeletedRefreshVersion] = useState(0);
  const [selectedFailedModelIds, setSelectedFailedModelIds] = useState<Set<string>>(new Set());
  const [clearingFailed, setClearingFailed] = useState(false);
  const [clearingFailedId, setClearingFailedId] = useState<string | null>(null);
  // 待确认的清理请求（单个/选中/全部）：走标准 ConfirmDialog，不再用原生 window.confirm
  const [failedClearRequest, setFailedClearRequest] = useState<{
    ids: string[];
    title: string;
    description: string;
  } | null>(null);
  const [importPreviewTarget, setImportPreviewTarget] = useState<FailedModelListItem | null>(null);
  const [failedRefreshVersion, setFailedRefreshVersion] = useState(0);
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
  const {
    items: failedModels,
    total: failedTotal,
    isLoading: failedLoading,
    isLoadingMore: failedLoadingMore,
    hasMore: failedHasMore,
    loadMore: loadMoreFailed,
    mutate: failedMutate,
  } = useFailedModelPages(failedSearch, activeTab === 'failed', failedRefreshVersion);
  const { data: failedCountData, mutate: failedCountMutate } = useSWR('/models/failed/count', () =>
    modelApi.listFailed({ page: 1, pageSize: 1 }),
  );
  const deletedModelIds = deletedModels.map((model) => model.model_id);
  const selectedDeletedCount = selectedDeletedModelIds.size;
  const selectedRestorableDeletedCount = deletedModels.filter(
    (model) => selectedDeletedModelIds.has(model.model_id) && model.can_restore,
  ).length;
  const allDeletedLoadedSelected =
    deletedModelIds.length > 0 && deletedModelIds.every((modelId) => selectedDeletedModelIds.has(modelId));
  const failedModelIds = failedModels.map((model) => model.model_id);
  const selectedFailedCount = selectedFailedModelIds.size;
  const allFailedLoadedSelected =
    failedModelIds.length > 0 && failedModelIds.every((modelId) => selectedFailedModelIds.has(modelId));
  const filteredSuggestions = suggestionSearch
    ? suggestionGroups.filter((g) => g.name.toLowerCase().includes(suggestionSearch.toLowerCase()))
    : suggestionGroups;
  const suggestionNames = filteredSuggestions.map((group) => group.name);
  const selectedSuggestionCount = suggestionNames.filter((name) => selectedNames.has(name)).length;
  const allSuggestionsSelected = suggestionNames.length > 0 && selectedSuggestionCount === suggestionNames.length;
  const suggestionCount = activeTab === 'suggestions' ? activeSuggestionCount : (suggestionCountData?.total ?? 0);
  const mergedGroupCount = groupCountData?.total ?? groupData?.length;
  const failedGlobalCount = failedCountData?.total ?? 0;
  const failedModelCount =
    activeTab === 'failed'
      ? failedSearch.trim()
        ? failedTotal
        : Math.max(failedTotal, failedGlobalCount)
      : failedGlobalCount;
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
    { value: 'models', label: t('modelAdminPage.tabAllModels'), count: displayModelTotal, icon: 'inventory_2' },
    {
      value: 'suggestions',
      label: t('modelAdminPage.tabMergeSuggestions'),
      count: suggestionCount,
      icon: 'merge_type',
    },
    { value: 'groups', label: t('modelAdminPage.tabMerged'), count: mergedGroupCount, icon: 'category' },
    { value: 'failed', label: t('modelAdminPage.tabFailed'), count: failedModelCount, icon: 'error' },
    { value: 'deleted', label: t('modelAdminPage.tabRecycleBin'), count: deletedModelCount, icon: 'delete_sweep' },
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
    setSelectedFailedModelIds(new Set());
  }, [activeTab, failedSearch]);

  useEffect(() => {
    if (activeTab !== 'failed') return;
    failedMutate();
    failedCountMutate();
  }, [activeTab, failedMutate, failedCountMutate]);

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
    setFailedRefreshVersion((version) => version + 1);
    failedMutate();
    failedCountMutate();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await modelApi.delete(deleteTarget.model_id);
      toast(t('modelAdminPage.deletedToast'), 'success');
      setSelectedModelIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.model_id);
        return next;
      });
      refreshModelAdminData();
      setDeleteTarget(null);
    } catch {
      toast(t('modelAdminPage.deleteFailed'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  // memo 行的稳定 handler：依赖 visibleModels（useVisibleItems 的 slice 结果，打字重渲染间引用稳定）
  const toggleSelectModel = useCallback(
    (modelId: string) => {
      if (selectedAllMatching) {
        setSelectedAllMatching(false);
        setSelectedModelIds(new Set(visibleModels.filter((m) => m.model_id !== modelId).map((m) => m.model_id)));
        return;
      }
      setSelectedModelIds((prev) => {
        const next = new Set(prev);
        if (next.has(modelId)) next.delete(modelId);
        else next.add(modelId);
        return next;
      });
    },
    [selectedAllMatching, visibleModels],
  );

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
    // 同时把已加载的行勾上：「选择全部」要看得见勾选反馈（批量操作仍走服务端全选语义）
    setSelectedModelIds(new Set(visibleModelIds));
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
      const warningText = result.warnings > 0 ? t('modelAdminPage.fileWarningInline', { count: result.warnings }) : '';
      toast(
        `${t('modelAdminPage.batchDeletedToast', { count: result.deleted })}${warningText}`,
        result.warnings > 0 ? 'error' : 'success',
      );
      clearSelectedModels();
      setBatchDeleteOpen(false);
      refreshModelAdminData();
    } catch {
      toast(t('modelAdminPage.batchDeleteFailed'), 'error');
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleBatchUpdateCategory = async (categoryId: string) => {
    setBatchCategorySaving(true);
    try {
      const result = await modelApi.batchUpdateCategory(
        selectedAllMatching
          ? {
              categoryId,
              allMatching: true,
              filters: {
                search: search.trim() || undefined,
                categoryId: categoryFilter === CATEGORY_FILTER_ALL ? undefined : categoryFilter,
              },
            }
          : { categoryId, modelIds: Array.from(selectedModelIds) },
      );
      const skipped = result.requested - result.updated;
      toast(
        `${t('modelAdminPage.categoryUpdatedToast', { count: result.updated })}${
          skipped > 0 ? t('modelAdminPage.categorySkippedInline', { count: skipped }) : ''
        }`,
        'success',
      );
      clearSelectedModels();
      setBatchCategoryOpen(false);
      refreshModelAdminData();
    } catch {
      toast(t('modelAdminPage.batchCategoryFailed'), 'error');
    } finally {
      setBatchCategorySaving(false);
    }
  };

  const handleRestoreModel = async (model: DeletedModelListItem) => {
    setRestoringModelId(model.model_id);
    try {
      await modelApi.restore(model.model_id);
      toast(t('modelAdminPage.modelRestored'), 'success');
      refreshModelAdminData();
    } catch {
      toast(t('modelAdminPage.restoreFailed'), 'error');
    } finally {
      setRestoringModelId(null);
    }
  };

  const restoreSelectedDeletedModels = async () => {
    const targets = deletedModels.filter((model) => selectedDeletedModelIds.has(model.model_id) && model.can_restore);
    if (targets.length === 0) {
      toast(t('modelAdminPage.restoreSelectedMissing'), 'error');
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
        failed > 0
          ? t('modelAdminPage.restoredWithFailures', { count: restoredIds.size, failed })
          : t('modelAdminPage.restoredCount', { count: restoredIds.size }),
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

  const toggleSelectFailedModel = (modelId: string) => {
    setSelectedFailedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const toggleSelectLoadedFailedModels = () => {
    setSelectedFailedModelIds((prev) => {
      const next = new Set(prev);
      if (allFailedLoadedSelected) {
        failedModelIds.forEach((modelId) => next.delete(modelId));
      } else {
        failedModelIds.forEach((modelId) => next.add(modelId));
      }
      return next;
    });
  };

  const clearSelectedFailedModels = () => {
    setSelectedFailedModelIds(new Set());
  };

  // 清理转换失败模型：清残留文件并删除记录（详情页随之 404）。
  // ids 为空 = 一键清理全部；确认弹窗由 ConfirmDialog 渲染（failedClearRequest）。
  const clearFailedModels = async (ids: string[]) => {
    // 单个清理时才点亮行内「清理中」状态：弹窗点取消不能把行卡在清理中
    if (ids.length === 1) setClearingFailedId(ids[0]);
    setClearingFailed(true);
    try {
      const result = await modelApi.clearFailed(ids);
      if (result.failed > 0) {
        toast(t('modelAdminPage.clearedWithFailures', { cleared: result.cleared, failed: result.failed }), 'error');
      } else {
        toast(t('modelAdminPage.clearedCount', { count: result.cleared }), 'success');
      }
      clearSelectedFailedModels();
      setClearingFailedId(null);
      refreshModelAdminData();
    } catch {
      toast(t('modelAdminPage.clearFailedError'), 'error');
    } finally {
      setFailedClearRequest(null);
      setClearingFailed(false);
    }
  };

  const handleClearFailedOne = (model: FailedModelListItem) => {
    setFailedClearRequest({
      ids: [model.model_id],
      title: t('modelAdminPage.confirmClearOneTitle'),
      description: t('modelAdminPage.confirmClearOneDesc', { name: model.name }),
    });
  };

  const handleClearFailedSelected = () => {
    setFailedClearRequest({
      ids: Array.from(selectedFailedModelIds),
      title: t('modelAdminPage.confirmClearSelectedTitle'),
      description: t('modelAdminPage.confirmClearSelectedDesc', { count: selectedFailedModelIds.size }),
    });
  };

  const handleClearFailedAll = () => {
    setFailedClearRequest({
      ids: [],
      title: t('modelAdminPage.confirmClearAllTitle'),
      description: t('modelAdminPage.confirmClearAllDesc', { count: failedModelCount }),
    });
  };

  // 打开离线转换产物导入弹窗（本地 convert:offline 产出的 .offline.zip）
  const handleOpenImportPreview = (model: FailedModelListItem) => {
    setImportPreviewTarget(model);
  };

  const purgeDeletedModels = async (mode: 'selected' | 'all') => {
    const modelIds = Array.from(selectedDeletedModelIds);
    if (mode === 'selected' && modelIds.length === 0) return;
    setPurgingDeleted(true);
    try {
      const result = await modelApi.purgeDeleted(mode === 'all' ? { all: true } : { modelIds });
      const warningText = result.warnings > 0 ? t('modelAdminPage.fileWarningInline', { count: result.warnings }) : '';
      toast(
        `${t('modelAdminPage.purgedToast', { count: result.deleted })}${warningText}`,
        result.warnings > 0 ? 'error' : 'success',
      );
      clearSelectedDeletedModels();
      setPurgeConfirmMode(null);
      refreshModelAdminData();
    } catch {
      toast(t('modelAdminPage.purgeFailed'), 'error');
    } finally {
      setPurgingDeleted(false);
    }
  };

  const handleTabChange = (tab: ModelAdminTab) => {
    startTransition(() => setActiveTab(tab));
  };

  // 模型库搬运：导出勾选模型为 zip 包（本地站用；服务器站导入）
  const handleExportSelected = async () => {
    const ids = Array.from(selectedModelIds).slice(0, 100);
    if (ids.length === 0 || exportingSelection) return;
    setExportingSelection(true);
    try {
      const blob = await modelApi.exportModels(ids);
      // 走 downloadBrowserBlob：同步 revokeObjectURL 会在浏览器异步读取 blob 前把 URL
      // 作废，模型包几十 MB 时下载到的是截断 zip（选型数据包导出同款坑已修）
      const { downloadBrowserBlob } = await import('../lib/browserDownload');
      await downloadBrowserBlob(
        blob,
        t('modelAdminPage.exportFileName', {
          count: ids.length,
          date: new Date().toISOString().slice(0, 10),
        }),
      );
      toast(t('modelAdminPage.exportedToast', { count: ids.length }), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('modelAdminPage.exportFailed'), 'error');
    } finally {
      setExportingSelection(false);
    }
  };

  const modelToolbarControls =
    activeTab === 'models' ? (
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
        {models.length > 0 ? (
          <span className="shrink-0 whitespace-nowrap text-xs text-on-surface-variant">
            <Trans
              i18nKey="modelAdminPage.modelsLoadedCount"
              values={{ loaded: visibleModels.length, total: displayModelTotal }}
              components={{ strong: <strong className="text-primary" /> }}
            />
            {selectedAllMatching ? (
              <Trans
                i18nKey="modelAdminPage.selectedAllMatchingInline"
                values={{ count: selectedModelCount }}
                components={{ strong: <strong className="text-primary" /> }}
              />
            ) : selectedModelCount > 0 ? (
              <Trans
                i18nKey="modelAdminPage.selectedInline"
                values={{ count: selectedModelCount }}
                components={{ strong: <strong className="text-primary" /> }}
              />
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
                {t('modelAdminPage.selectAllMatching')}
              </AdminButton>
            ) : null}
            {selectedModelCount > 0 ? (
              <>
                <AdminButton onClick={clearSelectedModels} icon="close" size="sm" variant="secondary">
                  {t('modelAdminPage.clearSelection')}
                </AdminButton>
                <AdminButton
                  onClick={handleExportSelected}
                  disabled={exportingSelection}
                  icon="download"
                  size="sm"
                  variant="tonal"
                >
                  {exportingSelection
                    ? t('modelAdminPage.exporting')
                    : selectedModelCount > 100
                      ? t('modelAdminPage.exportSelectedFirst100')
                      : t('modelAdminPage.exportSelected')}
                </AdminButton>
                <AdminButton
                  onClick={() => setBatchCategoryOpen(true)}
                  disabled={batchCategorySaving}
                  icon="drive_file_move"
                  size="sm"
                  variant="tonal"
                >
                  {t('modelAdminPage.batchChangeCategory')}
                </AdminButton>
                <AdminButton
                  onClick={() => setBatchDeleteOpen(true)}
                  disabled={batchDeleting}
                  icon="delete"
                  size="sm"
                  variant="danger"
                >
                  {t('modelAdminPage.batchDelete')}
                </AdminButton>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    ) : null;
  const purgeConfirmSelectedCount = purgeConfirmMode === 'all' ? deletedModelCount : selectedDeletedCount;
  const purgeConfirmTitle =
    purgeConfirmMode === 'all'
      ? t('modelAdminPage.confirmPurgeAllTitle')
      : t('modelAdminPage.confirmPurgeSelectedTitle');
  const purgeConfirmDescription =
    purgeConfirmMode === 'all'
      ? t('modelAdminPage.confirmPurgeAllDesc', { count: purgeConfirmSelectedCount })
      : t('modelAdminPage.confirmPurgeSelectedDesc', { count: purgeConfirmSelectedCount });

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
      toast(t('modelAdminPage.mergedToast', { count: result.merged }), 'success');
      setSelectedNames(new Set());
      sugMutate();
      suggestionCountMutate();
      groupMutate();
    } catch {
      toast(t('modelAdminPage.mergeFailed'), 'error');
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
      toast(t('modelAdminPage.groupNameRequired'), 'error');
      return;
    }
    setGroupAction(`rename:${group.id}`);
    try {
      await modelApi.updateModelGroup(group.id, { name });
      toast(t('modelAdminPage.groupUpdated'), 'success');
      setEditingGroupId(null);
      groupMutate();
      mutate();
    } catch {
      toast(t('modelAdminPage.groupUpdateFailed'), 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleSetPrimary = async (group: ModelGroupItem, modelId: string) => {
    setGroupAction(`primary:${group.id}:${modelId}`);
    try {
      await modelApi.updateModelGroup(group.id, { primaryId: modelId });
      toast(t('modelAdminPage.primarySet'), 'success');
      groupMutate();
      mutate();
    } catch {
      toast(t('modelAdminPage.primarySetFailed'), 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleRemoveFromGroup = async (group: ModelGroupItem, modelId: string) => {
    setGroupConfirm(null);
    setGroupAction(`remove:${group.id}:${modelId}`);
    try {
      await modelApi.removeModelFromGroup(group.id, modelId);
      toast(t('modelAdminPage.removedFromGroup'), 'success');
      groupMutate();
      sugMutate();
      suggestionCountMutate();
      mutate();
    } catch {
      toast(t('modelAdminPage.removeFromGroupFailed'), 'error');
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
        result.dissolvedModels > 1
          ? t('modelAdminPage.groupDissolvedMulti', { count: result.dissolvedModels })
          : t('modelAdminPage.groupDissolved');
      toast(msg, 'success');
      groupMutate();
      sugMutate();
      suggestionCountMutate();
      mutate();
    } catch {
      toast(t('modelAdminPage.dissolveGroupFailed'), 'error');
    } finally {
      setGroupAction(null);
    }
  };

  return (
    <>
      <UploadModalLoader open={uploadOpen} onClose={() => setUploadOpen(false)} onConverted={refreshModelAdminData} />
      <AdminManagementPage
        title={t('modelAdminPage.pageTitle')}
        description={t('modelAdminPage.pageDescription')}
        actions={
          <div className="flex items-center gap-2">
            {/* neutral 变体 = 灰底实色（保存设置按钮已保存态同款配色），尺寸与「上传模型」完全一致 */}
            <AdminButton
              onClick={() => setPreviewOpsOpen(true)}
              icon="view_in_ar"
              className="w-[122px]"
              variant="neutral"
            >
              {t('modelAdminPage.previewOps')}
            </AdminButton>
            <AdminButton
              onClick={() => setImportModelsOpen(true)}
              icon="cloud_download"
              className="w-[122px]"
              variant="neutral"
            >
              {t('modelAdminPage.importModels')}
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
              {t('modelAdminPage.uploadModels')}
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
                  mobileTitle={t('modelAdminPage.mobileTabsTitle')}
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
                      : activeTab === 'failed'
                        ? failedSearchInputProps
                        : deletedSearchInputProps
              }
              value={
                activeTab === 'models'
                  ? searchInputValue
                  : activeTab === 'suggestions'
                    ? suggestionSearchInputValue
                    : activeTab === 'groups'
                      ? groupSearchInputValue
                      : activeTab === 'failed'
                        ? failedSearchInputValue
                        : deletedSearchInputValue
              }
              onClear={() => {
                if (activeTab === 'models') setSearch('');
                else if (activeTab === 'suggestions') setSuggestionSearch('');
                else if (activeTab === 'groups') setGroupSearch('');
                else if (activeTab === 'failed') setFailedSearch('');
                else setDeletedSearch('');
              }}
              placeholder={
                activeTab === 'models'
                  ? t('modelAdminPage.searchModelsPlaceholder')
                  : activeTab === 'suggestions'
                    ? t('modelAdminPage.searchSuggestionsPlaceholder')
                    : activeTab === 'groups'
                      ? t('modelAdminPage.searchGroupsPlaceholder')
                      : activeTab === 'failed'
                        ? t('modelAdminPage.searchFailedPlaceholder')
                        : t('modelAdminPage.searchDeletedPlaceholder')
              }
            />
          </div>
        }
      >
        <div className="admin-tab-panel min-h-0">
          {activeTab === 'suggestions' ? (
            sugLoading ? (
              <AdminLoadingState variant="list" label={t('modelAdminPage.suggestionLoading')} />
            ) : (
              <div className={`${MODEL_ADMIN_PANEL_CLASS} p-3`}>
                {filteredSuggestions.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-surface-container-low rounded-sm border border-outline-variant/10">
                    <span className="text-sm text-on-surface">
                      <Trans
                        i18nKey="modelAdminPage.suggestionsLoadedCount"
                        values={{ loaded: filteredSuggestions.length, total: suggestionCount }}
                        components={{ strong: <strong className="text-primary" /> }}
                      />
                      {selectedSuggestionCount > 0 && (
                        <Trans
                          i18nKey="modelAdminPage.selectedGroupsInline"
                          values={{ count: selectedSuggestionCount }}
                          components={{ strong: <strong className="text-primary" /> }}
                        />
                      )}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={toggleSelectPage}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-on-surface-variant bg-surface-container-high rounded-sm hover:text-on-surface hover:bg-surface-container-highest transition-colors"
                      >
                        <Icon name="checklist" size={16} />
                        {allSuggestionsSelected
                          ? t('modelAdminPage.deselectAllLoaded')
                          : t('modelAdminPage.selectAllLoaded')}
                      </button>
                      {selectedSuggestionCount > 0 && (
                        <button
                          onClick={() => setSelectedNames(new Set())}
                          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-on-surface-variant bg-surface-container-high rounded-sm hover:text-on-surface hover:bg-surface-container-highest transition-colors"
                        >
                          <Icon name="close" size={16} />
                          {t('modelAdminPage.clearSelection')}
                        </button>
                      )}
                      <button
                        onClick={handleMerge}
                        disabled={merging || selectedSuggestionCount === 0}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-primary bg-primary-container rounded-sm hover:opacity-90 disabled:opacity-50"
                      >
                        <Icon name="merge" size={16} />
                        {merging
                          ? t('modelAdminPage.mergingEllipsis')
                          : t('modelAdminPage.mergeSelected', { count: selectedSuggestionCount })}
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
                          name="has"
                          type="checkbox"
                          checked={selectedNames.has(group.name)}
                          onChange={() => toggleSelect(group.name)}
                          className="w-4 h-4 accent-primary-container rounded"
                        />
                        <span className="text-sm font-medium text-on-surface flex-1">{group.name}</span>
                        <span className="text-[10px] bg-surface-container-highest px-2 py-0.5 rounded-sm text-on-surface-variant font-mono">
                          {t('modelAdminPage.sameNameCount', { count: group.count })}
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
                    <p className="text-sm font-medium text-on-surface">{t('modelAdminPage.noSuggestions')}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">{t('modelAdminPage.noSuggestionsDesc')}</p>
                  </div>
                )}
              </div>
            )
          ) : activeTab === 'failed' ? (
            failedLoading ? (
              <AdminLoadingState variant="table" label={t('modelAdminPage.failedLoading')} />
            ) : (
              <FailedModelsPanel
                items={failedModels}
                total={failedTotal}
                isLoadingMore={failedLoadingMore}
                hasMore={failedHasMore}
                onLoadMore={loadMoreFailed}
                onClearOne={handleClearFailedOne}
                onImport={handleOpenImportPreview}
                onClearSelected={handleClearFailedSelected}
                onClearAll={handleClearFailedAll}
                onToggleSelect={toggleSelectFailedModel}
                onToggleSelectLoaded={toggleSelectLoadedFailedModels}
                onClearSelection={clearSelectedFailedModels}
                clearing={clearingFailed}
                clearingId={clearingFailedId}
                selectedIds={selectedFailedModelIds}
                selectedCount={selectedFailedCount}
                allLoadedSelected={allFailedLoadedSelected}
              />
            )
          ) : activeTab === 'deleted' ? (
            deletedLoading ? (
              <AdminLoadingState variant="table" label={t('modelAdminPage.recycleBinLoading')} />
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
              <AdminLoadingState variant="list" label={t('modelAdminPage.groupLoading')} />
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
                                name="group-name-draft"
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
                                  {t('modelAdminPage.groupMeta', {
                                    count: group.model_count,
                                    primary: group.primary?.name || t('modelAdminPage.primaryNotSet'),
                                  })}
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
                                  {t('common.save')}
                                </button>
                                <button
                                  onClick={() => setEditingGroupId(null)}
                                  className="rounded-sm border border-outline-variant/20 px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface"
                                >
                                  {t('common.cancel')}
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => beginEditGroup(group)}
                                className="flex items-center gap-1.5 rounded-sm border border-outline-variant/20 px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface"
                              >
                                <Icon name="edit" size={14} />
                                {t('modelAdminPage.rename')}
                              </button>
                            )}
                            <button
                              onClick={() => setGroupConfirm({ type: 'delete', group })}
                              disabled={groupAction === `delete:${group.id}`}
                              className="flex items-center gap-1.5 rounded-sm border border-error/20 px-3 py-2 text-xs text-error hover:bg-error/10 disabled:opacity-50"
                            >
                              <Icon name="close" size={14} />
                              {t('modelAdminPage.dissolve')}
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
                                          {t('modelAdminPage.primaryBadge')}
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-on-surface-variant">
                                      <span>{formatSize(model.originalSize)}</span>
                                      <span>
                                        {t('modelAdminPage.originalTime', {
                                          time: formatModelDateTime(model.fileModifiedAt),
                                        })}
                                      </span>
                                      <span>
                                        {t('modelAdminPage.uploadTime', {
                                          time: formatModelDateTime(model.createdAt),
                                        })}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <Link
                                      to={`/model/${model.id}`}
                                      target="_blank"
                                      rel="noopener"
                                      className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-primary"
                                    >
                                      {t('modelAdminPage.view')}
                                    </Link>
                                    {!isPrimary && (
                                      <button
                                        onClick={() => handleSetPrimary(group, model.id)}
                                        disabled={groupAction === `primary:${group.id}:${model.id}`}
                                        className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-primary disabled:opacity-50"
                                      >
                                        {t('modelAdminPage.setPrimary')}
                                      </button>
                                    )}
                                    <button
                                      onClick={() => setGroupConfirm({ type: 'remove', group, modelId: model.id })}
                                      disabled={
                                        group.model_count <= 2 || groupAction === `remove:${group.id}:${model.id}`
                                      }
                                      className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-error disabled:opacity-40"
                                    >
                                      {t('modelAdminPage.removeFromGroupShort')}
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
                    <p className="text-sm font-medium text-on-surface">{t('modelAdminPage.noGroups')}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">{t('modelAdminPage.noGroupsDesc')}</p>
                  </div>
                )}
                {(groupData?.length ?? 0) > 0 && filteredGroups?.length === 0 && (
                  <div className="flex min-h-[200px] flex-col items-center justify-center text-center">
                    <p className="text-sm text-on-surface-variant">
                      {t('modelAdminPage.noMatchingGroups', { query: groupSearch })}
                    </p>
                  </div>
                )}
              </div>
            )
          ) : isLoadingInitial ? (
            <AdminLoadingState
              variant="table"
              label={t('modelAdminPage.modelListLoading')}
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
                          name="all-visible-models-selected"
                          type="checkbox"
                          checked={allVisibleModelsSelected}
                          disabled={visibleModelIds.length === 0}
                          onChange={toggleSelectVisibleModels}
                          className="h-4 w-4 accent-primary-container"
                          aria-label={
                            allVisibleModelsSelected
                              ? t('modelAdminPage.deselectVisibleAria')
                              : t('modelAdminPage.selectVisibleAria')
                          }
                        />
                      </AdminTableHeadCell>
                      <AdminTableHeadCell>{t('modelAdminPage.columnModel')}</AdminTableHeadCell>
                      <AdminTableHeadCell className="w-44">{t('modelAdminPage.columnCategory')}</AdminTableHeadCell>
                      <AdminTableHeadCell className="w-24">{t('modelAdminPage.columnFormat')}</AdminTableHeadCell>
                      <AdminTableHeadCell className="w-28">{t('modelAdminPage.columnSize')}</AdminTableHeadCell>
                      <AdminTableHeadCell className="w-20">{t('modelAdminPage.columnDrawing')}</AdminTableHeadCell>
                      <AdminTableHeadCell className="w-64 text-right">
                        {t('modelAdminPage.columnActions')}
                      </AdminTableHeadCell>
                    </AdminTableHeadRow>
                  </thead>
                  <tbody>
                    {visibleModels.map((m) => (
                      <ModelTableRow
                        key={m.model_id}
                        model={m}
                        selected={selectedModelIds.has(m.model_id)}
                        onToggleSelect={toggleSelectModel}
                        onEdit={setEditModel}
                        onDelete={setDeleteTarget}
                      />
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
                          {t('modelAdminPage.noModelsFound')}
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
          title={
            groupConfirm?.type === 'delete'
              ? t('modelAdminPage.confirmDissolveTitle')
              : t('modelAdminPage.confirmRemoveTitle')
          }
          description={
            groupConfirm?.type === 'delete'
              ? t('modelAdminPage.confirmDissolveDesc', { name: groupConfirm.group.name })
              : t('modelAdminPage.confirmRemoveDesc')
          }
          confirmLabel={
            groupAction
              ? t('modelAdminPage.processing')
              : groupConfirm?.type === 'delete'
                ? t('modelAdminPage.confirmDissolve')
                : t('modelAdminPage.confirmRemove')
          }
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
          confirmLabel={
            purgingDeleted
              ? t('modelAdminPage.deleting')
              : purgeConfirmMode === 'all'
                ? t('modelAdminPage.emptyRecycleBin')
                : t('modelAdminPage.permanentDelete')
          }
          confirmDisabled={purgingDeleted || purgeConfirmSelectedCount <= 0}
        />
        <ConfirmDialog
          open={Boolean(failedClearRequest)}
          onClose={() => {
            if (!clearingFailed) setFailedClearRequest(null);
          }}
          onConfirm={() => {
            if (!failedClearRequest) return;
            void clearFailedModels(failedClearRequest.ids);
          }}
          icon="delete_sweep"
          title={failedClearRequest?.title ?? ''}
          description={failedClearRequest?.description ?? ''}
          confirmLabel={clearingFailed ? t('modelAdminPage.clearingEllipsis') : t('modelAdminPage.confirmClear')}
          confirmDisabled={clearingFailed}
        />
        <EditDialog
          open={!!editModel}
          model={editModel}
          categories={categories || []}
          onClose={() => setEditModel(null)}
          onSaved={() => mutate()}
        />
        {importPreviewTarget && (
          <ImportPreviewDialog
            model={importPreviewTarget}
            onClose={() => setImportPreviewTarget(null)}
            onImported={() => {
              setImportPreviewTarget(null);
              refreshModelAdminData();
            }}
          />
        )}
        {importModelsOpen && (
          <ImportModelsDialog onClose={() => setImportModelsOpen(false)} onImported={refreshModelAdminData} />
        )}
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
                <h3 className="font-headline text-lg font-semibold text-on-surface mb-2">
                  {t('modelAdminPage.confirmDeleteTitle')}
                </h3>
                <p className="text-sm text-on-surface-variant mb-6">
                  {t('modelAdminPage.confirmDeleteDesc', { name: deleteTarget.name })}
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setDeleteTarget(null)}
                    className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="px-4 py-2 bg-error text-white rounded-sm text-sm hover:bg-error/90 transition-colors disabled:opacity-50"
                  >
                    {deleting ? t('modelAdminPage.deleting') : t('common.delete')}
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
                <h3 className="font-headline text-lg font-semibold text-on-surface mb-2">
                  {t('modelAdminPage.confirmBatchDeleteTitle')}
                </h3>
                <p className="text-sm text-on-surface-variant mb-6">
                  {selectedAllMatching && ` ${t('modelAdminPage.batchDeleteAllMatchingNote')} `}
                  {t('modelAdminPage.confirmBatchDeleteDesc', { count: selectedModelCount })}
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setBatchDeleteOpen(false)}
                    disabled={batchDeleting}
                    className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleBatchDelete}
                    disabled={batchDeleting}
                    className="px-4 py-2 bg-error text-white rounded-sm text-sm hover:bg-error/90 transition-colors disabled:opacity-50"
                  >
                    {batchDeleting ? t('modelAdminPage.deleting') : t('modelAdminPage.confirmDeleteLabel')}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <BatchCategoryDialog
          open={batchCategoryOpen && selectedModelCount > 0}
          saving={batchCategorySaving}
          categories={catData?.items || []}
          count={selectedModelCount}
          allMatching={selectedAllMatching}
          onClose={() => {
            if (!batchCategorySaving) setBatchCategoryOpen(false);
          }}
          onConfirm={handleBatchUpdateCategory}
        />
      </AdminManagementPage>
    </>
  );
}

function MobileContent() {
  const { toast } = useToast();
  const { t } = useTranslation();
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
  const [batchCategoryOpen, setBatchCategoryOpen] = useState(false);
  const [batchCategorySaving, setBatchCategorySaving] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewOpsOpen, setPreviewOpsOpen] = useState(false);
  const [importModelsOpen, setImportModelsOpen] = useState(false);
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
  const {
    value: failedSearch,
    draftValue: failedSearchInputValue,
    setValue: setFailedSearch,
    inputProps: failedSearchInputProps,
  } = useImeSafeSearchInput();
  const [restoringModelId, setRestoringModelId] = useState<string | null>(null);
  const [restoringDeletedBatch, setRestoringDeletedBatch] = useState(false);
  const [selectedDeletedModelIds, setSelectedDeletedModelIds] = useState<Set<string>>(new Set());
  const [purgingDeleted, setPurgingDeleted] = useState(false);
  const [purgeConfirmMode, setPurgeConfirmMode] = useState<DeletedPurgeMode | null>(null);
  const [deletedRefreshVersion, setDeletedRefreshVersion] = useState(0);
  const [selectedFailedModelIds, setSelectedFailedModelIds] = useState<Set<string>>(new Set());
  const [clearingFailed, setClearingFailed] = useState(false);
  const [clearingFailedId, setClearingFailedId] = useState<string | null>(null);
  // 待确认的清理请求（单个/选中/全部）：走标准 ConfirmDialog，不再用原生 window.confirm
  const [failedClearRequest, setFailedClearRequest] = useState<{
    ids: string[];
    title: string;
    description: string;
  } | null>(null);
  const [importPreviewTarget, setImportPreviewTarget] = useState<FailedModelListItem | null>(null);
  const [failedRefreshVersion, setFailedRefreshVersion] = useState(0);
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
  const {
    items: failedModels,
    total: failedTotal,
    isLoading: failedLoading,
    isLoadingMore: failedLoadingMore,
    hasMore: failedHasMore,
    loadMore: loadMoreFailed,
    mutate: failedMutate,
  } = useFailedModelPages(failedSearch, activeTab === 'failed', failedRefreshVersion);
  const { data: failedCountData, mutate: failedCountMutate } = useSWR('/models/failed/count-mobile', () =>
    modelApi.listFailed({ page: 1, pageSize: 1 }),
  );
  const deletedModelIds = deletedModels.map((model) => model.model_id);
  const selectedDeletedCount = selectedDeletedModelIds.size;
  const selectedRestorableDeletedCount = deletedModels.filter(
    (model) => selectedDeletedModelIds.has(model.model_id) && model.can_restore,
  ).length;
  const allDeletedLoadedSelected =
    deletedModelIds.length > 0 && deletedModelIds.every((modelId) => selectedDeletedModelIds.has(modelId));
  const failedModelIds = failedModels.map((model) => model.model_id);
  const selectedFailedCount = selectedFailedModelIds.size;
  const allFailedLoadedSelected =
    failedModelIds.length > 0 && failedModelIds.every((modelId) => selectedFailedModelIds.has(modelId));
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
  const failedGlobalCount = failedCountData?.total ?? 0;
  const failedModelCount =
    activeTab === 'failed'
      ? failedSearch.trim()
        ? failedTotal
        : Math.max(failedTotal, failedGlobalCount)
      : failedGlobalCount;
  const deletedGlobalCount = deletedCountData?.total ?? 0;
  const deletedModelCount =
    activeTab === 'deleted'
      ? deletedSearch.trim()
        ? deletedTotal
        : Math.max(deletedTotal, deletedGlobalCount)
      : deletedGlobalCount;
  const modelAdminTabs: ResponsiveSectionTab[] = [
    { value: 'models', label: t('modelAdminPage.tabAllModels'), count: displayModelTotalM, icon: 'inventory_2' },
    {
      value: 'suggestions',
      label: t('modelAdminPage.tabMergeSuggestions'),
      count: suggestionCount,
      icon: 'merge_type',
    },
    { value: 'groups', label: t('modelAdminPage.tabMerged'), count: mergedGroupCount, icon: 'category' },
    { value: 'failed', label: t('modelAdminPage.tabFailed'), count: failedModelCount, icon: 'error' },
    { value: 'deleted', label: t('modelAdminPage.tabRecycleBin'), count: deletedModelCount, icon: 'delete_sweep' },
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
    setSelectedFailedModelIds(new Set());
  }, [activeTab, failedSearch]);

  useEffect(() => {
    if (activeTab !== 'failed') return;
    failedMutate();
    failedCountMutate();
  }, [activeTab, failedMutate, failedCountMutate]);

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
    setFailedRefreshVersion((version) => version + 1);
    failedMutate();
    failedCountMutate();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await modelApi.delete(deleteTarget.model_id);
      toast(t('modelAdminPage.deletedToast'), 'success');
      setSelectedModelIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.model_id);
        return next;
      });
      refreshModelAdminData();
      setDeleteTarget(null);
    } catch {
      toast(t('modelAdminPage.deleteFailed'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  // memo 行的稳定 handler：依赖 visibleModels（useVisibleItems 的 slice 结果，打字重渲染间引用稳定）
  const toggleSelectModel = useCallback(
    (modelId: string) => {
      if (selectedAllMatching) {
        setSelectedAllMatching(false);
        setSelectedModelIds(new Set(visibleModels.filter((m) => m.model_id !== modelId).map((m) => m.model_id)));
        return;
      }
      setSelectedModelIds((prev) => {
        const next = new Set(prev);
        if (next.has(modelId)) next.delete(modelId);
        else next.add(modelId);
        return next;
      });
    },
    [selectedAllMatching, visibleModels],
  );

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
      const warningText = result.warnings > 0 ? t('modelAdminPage.fileWarningInline', { count: result.warnings }) : '';
      toast(
        `${t('modelAdminPage.batchDeletedToast', { count: result.deleted })}${warningText}`,
        result.warnings > 0 ? 'error' : 'success',
      );
      clearSelectedModels();
      setBatchDeleteOpen(false);
      refreshModelAdminData();
    } catch {
      toast(t('modelAdminPage.batchDeleteFailed'), 'error');
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleBatchUpdateCategory = async (categoryId: string) => {
    setBatchCategorySaving(true);
    try {
      const result = await modelApi.batchUpdateCategory(
        selectedAllMatching
          ? {
              categoryId,
              allMatching: true,
              filters: {
                search: search.trim() || undefined,
                categoryId: categoryFilter === CATEGORY_FILTER_ALL ? undefined : categoryFilter,
              },
            }
          : { categoryId, modelIds: Array.from(selectedModelIds) },
      );
      const skipped = result.requested - result.updated;
      toast(
        `${t('modelAdminPage.categoryUpdatedToast', { count: result.updated })}${
          skipped > 0 ? t('modelAdminPage.categorySkippedInline', { count: skipped }) : ''
        }`,
        'success',
      );
      clearSelectedModels();
      setBatchCategoryOpen(false);
      refreshModelAdminData();
    } catch {
      toast(t('modelAdminPage.batchCategoryFailed'), 'error');
    } finally {
      setBatchCategorySaving(false);
    }
  };

  const handleRestoreModel = async (model: DeletedModelListItem) => {
    setRestoringModelId(model.model_id);
    try {
      await modelApi.restore(model.model_id);
      toast(t('modelAdminPage.modelRestored'), 'success');
      refreshModelAdminData();
    } catch {
      toast(t('modelAdminPage.restoreFailed'), 'error');
    } finally {
      setRestoringModelId(null);
    }
  };

  const restoreSelectedDeletedModels = async () => {
    const targets = deletedModels.filter((model) => selectedDeletedModelIds.has(model.model_id) && model.can_restore);
    if (targets.length === 0) {
      toast(t('modelAdminPage.restoreSelectedMissing'), 'error');
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
        failed > 0
          ? t('modelAdminPage.restoredWithFailures', { count: restoredIds.size, failed })
          : t('modelAdminPage.restoredCount', { count: restoredIds.size }),
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

  const toggleSelectFailedModel = (modelId: string) => {
    setSelectedFailedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const toggleSelectLoadedFailedModels = () => {
    setSelectedFailedModelIds((prev) => {
      const next = new Set(prev);
      if (allFailedLoadedSelected) {
        failedModelIds.forEach((modelId) => next.delete(modelId));
      } else {
        failedModelIds.forEach((modelId) => next.add(modelId));
      }
      return next;
    });
  };

  const clearSelectedFailedModels = () => {
    setSelectedFailedModelIds(new Set());
  };

  // 清理转换失败模型：清残留文件并删除记录（详情页随之 404）。
  // ids 为空 = 一键清理全部；确认弹窗由 ConfirmDialog 渲染（failedClearRequest）。
  const clearFailedModels = async (ids: string[]) => {
    // 单个清理时才点亮行内「清理中」状态：弹窗点取消不能把行卡在清理中
    if (ids.length === 1) setClearingFailedId(ids[0]);
    setClearingFailed(true);
    try {
      const result = await modelApi.clearFailed(ids);
      if (result.failed > 0) {
        toast(t('modelAdminPage.clearedWithFailures', { cleared: result.cleared, failed: result.failed }), 'error');
      } else {
        toast(t('modelAdminPage.clearedCount', { count: result.cleared }), 'success');
      }
      clearSelectedFailedModels();
      setClearingFailedId(null);
      refreshModelAdminData();
    } catch {
      toast(t('modelAdminPage.clearFailedError'), 'error');
    } finally {
      setFailedClearRequest(null);
      setClearingFailed(false);
    }
  };

  const handleClearFailedOne = (model: FailedModelListItem) => {
    setFailedClearRequest({
      ids: [model.model_id],
      title: t('modelAdminPage.confirmClearOneTitle'),
      description: t('modelAdminPage.confirmClearOneDesc', { name: model.name }),
    });
  };

  const handleClearFailedSelected = () => {
    setFailedClearRequest({
      ids: Array.from(selectedFailedModelIds),
      title: t('modelAdminPage.confirmClearSelectedTitle'),
      description: t('modelAdminPage.confirmClearSelectedDesc', { count: selectedFailedModelIds.size }),
    });
  };

  const handleClearFailedAll = () => {
    setFailedClearRequest({
      ids: [],
      title: t('modelAdminPage.confirmClearAllTitle'),
      description: t('modelAdminPage.confirmClearAllDesc', { count: failedModelCount }),
    });
  };

  // 打开离线转换产物导入弹窗（本地 convert:offline 产出的 .offline.zip）
  const handleOpenImportPreview = (model: FailedModelListItem) => {
    setImportPreviewTarget(model);
  };

  const purgeDeletedModels = async (mode: 'selected' | 'all') => {
    const modelIds = Array.from(selectedDeletedModelIds);
    if (mode === 'selected' && modelIds.length === 0) return;
    setPurgingDeleted(true);
    try {
      const result = await modelApi.purgeDeleted(mode === 'all' ? { all: true } : { modelIds });
      const warningText = result.warnings > 0 ? t('modelAdminPage.fileWarningInline', { count: result.warnings }) : '';
      toast(
        `${t('modelAdminPage.purgedToast', { count: result.deleted })}${warningText}`,
        result.warnings > 0 ? 'error' : 'success',
      );
      clearSelectedDeletedModels();
      setPurgeConfirmMode(null);
      refreshModelAdminData();
    } catch {
      toast(t('modelAdminPage.purgeFailed'), 'error');
    } finally {
      setPurgingDeleted(false);
    }
  };
  const purgeConfirmSelectedCount = purgeConfirmMode === 'all' ? deletedModelCount : selectedDeletedCount;
  const purgeConfirmTitle =
    purgeConfirmMode === 'all'
      ? t('modelAdminPage.confirmPurgeAllTitle')
      : t('modelAdminPage.confirmPurgeSelectedTitle');
  const purgeConfirmDescription =
    purgeConfirmMode === 'all'
      ? t('modelAdminPage.confirmPurgeAllDesc', { count: purgeConfirmSelectedCount })
      : t('modelAdminPage.confirmPurgeSelectedDesc', { count: purgeConfirmSelectedCount });

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
      toast(t('modelAdminPage.mergedToast', { count: result.merged }), 'success');
      setSelectedNames(new Set());
      sugMutate();
      suggestionCountMutate();
      groupMutate();
    } catch {
      toast(t('modelAdminPage.mergeFailed'), 'error');
    } finally {
      setMerging(false);
    }
  };

  const handleMergeSingleSuggestion = async (group: { name: string; models: { id: string }[] }) => {
    if (group.models.length < 2) return;
    setMerging(true);
    try {
      const result = await modelApi.batchMerge([{ name: group.name, modelIds: group.models.map((m) => m.id) }]);
      toast(t('modelAdminPage.mergedToast', { count: result.merged }), 'success');
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
      toast(t('modelAdminPage.mergeFailed'), 'error');
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
      toast(t('modelAdminPage.groupNameRequired'), 'error');
      return;
    }
    setGroupAction(`rename:${group.id}`);
    try {
      await modelApi.updateModelGroup(group.id, { name });
      toast(t('modelAdminPage.groupUpdated'), 'success');
      setEditingGroupId(null);
      groupMutate();
      mutate();
    } catch {
      toast(t('modelAdminPage.groupUpdateFailed'), 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleSetPrimary = async (group: ModelGroupItem, modelId: string) => {
    setGroupAction(`primary:${group.id}:${modelId}`);
    try {
      await modelApi.updateModelGroup(group.id, { primaryId: modelId });
      toast(t('modelAdminPage.primarySet'), 'success');
      groupMutate();
      mutate();
    } catch {
      toast(t('modelAdminPage.primarySetFailed'), 'error');
    } finally {
      setGroupAction(null);
    }
  };

  const handleRemoveFromGroup = async (group: ModelGroupItem, modelId: string) => {
    setGroupConfirm(null);
    setGroupAction(`remove:${group.id}:${modelId}`);
    try {
      await modelApi.removeModelFromGroup(group.id, modelId);
      toast(t('modelAdminPage.removedFromGroup'), 'success');
      groupMutate();
      sugMutate();
      suggestionCountMutate();
      mutate();
    } catch {
      toast(t('modelAdminPage.removeFromGroupFailed'), 'error');
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
        result.dissolvedModels > 1
          ? t('modelAdminPage.groupDissolvedMulti', { count: result.dissolvedModels })
          : t('modelAdminPage.groupDissolved');
      toast(msg, 'success');
      groupMutate();
      sugMutate();
      suggestionCountMutate();
      mutate();
    } catch {
      toast(t('modelAdminPage.dissolveGroupFailed'), 'error');
    } finally {
      setGroupAction(null);
    }
  };

  return (
    <>
      <UploadModalLoader open={uploadOpen} onClose={() => setUploadOpen(false)} onConverted={refreshModelAdminData} />
      <AdminManagementPage
        title={t('modelAdminPage.pageTitle')}
        description={t('modelAdminPage.pageDescriptionMobile')}
        contentClassName="gap-3"
        actions={
          <div className="flex items-center gap-2">
            {/* neutral = 灰底实色，尺寸与「上传」（sm）完全一致，仅配色不同 */}
            <AdminButton
              onClick={() => setPreviewOpsOpen(true)}
              icon="view_in_ar"
              size="sm"
              variant="neutral"
              aria-label={t('modelAdminPage.openPreviewOpsAria')}
            >
              {t('modelAdminPage.previewOpsShort')}
            </AdminButton>
            <AdminButton onClick={() => setImportModelsOpen(true)} icon="cloud_download" size="sm" variant="neutral">
              {t('modelAdminPage.importShort')}
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
              {t('modelAdminPage.uploadShort')}
            </AdminButton>
          </div>
        }
      >
        {activeTab === 'models' && (
          <div className="grid gap-2">
            <SelectMenu
              variant="toolbar"
              ariaLabel={t('modelAdminPage.allCategories')}
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[
                { value: CATEGORY_FILTER_ALL, label: t('modelAdminPage.allCategories') },
                ...categoryOptions.map((option) => ({ value: option.id, label: option.label })),
              ]}
            />
            <AdminSearchField
              inputProps={searchInputProps}
              value={searchInputValue}
              onClear={() => setSearch('')}
              placeholder={t('modelAdminPage.searchModelsPlaceholder')}
              className="md:w-full"
            />
          </div>
        )}
        {activeTab === 'groups' && (
          <AdminSearchField
            inputProps={groupSearchInputProps}
            value={groupSearchInputValue}
            onClear={() => setGroupSearch('')}
            placeholder={t('modelAdminPage.searchGroupsPlaceholder')}
            className="md:w-full"
          />
        )}

        {activeTab === 'suggestions' && (
          <AdminSearchField
            inputProps={suggestionSearchInputProps}
            value={suggestionSearchInputValue}
            onClear={() => setSuggestionSearch('')}
            placeholder={t('modelAdminPage.searchSuggestionsPlaceholder')}
            className="md:w-full"
          />
        )}
        {activeTab === 'failed' && (
          <AdminSearchField
            inputProps={failedSearchInputProps}
            value={failedSearchInputValue}
            onClear={() => setFailedSearch('')}
            placeholder={t('modelAdminPage.searchFailedPlaceholder')}
            className="md:w-full"
          />
        )}
        {activeTab === 'deleted' && (
          <AdminSearchField
            inputProps={deletedSearchInputProps}
            value={deletedSearchInputValue}
            onClear={() => setDeletedSearch('')}
            placeholder={t('modelAdminPage.searchDeletedPlaceholder')}
            className="md:w-full"
          />
        )}
        <ResponsiveSectionTabs
          tabs={modelAdminTabs}
          value={activeTab}
          onChange={(value) => startTransition(() => setActiveTab(value as ModelAdminTab))}
          mobileTitle={t('modelAdminPage.mobileTabsTitle')}
        />

        {activeTab === 'models' && models.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-outline-variant/10 bg-surface-container-high px-3 py-2">
            <div className="min-w-0 text-xs text-on-surface-variant">
              <Trans
                i18nKey="modelAdminPage.loadedOfTotalCompact"
                values={{ loaded: visibleModels.length, total: displayModelTotalM }}
                components={{ strong: <span className="font-bold text-primary-container" /> }}
              />
              {selectedAllMatching ? (
                <Trans i18nKey="modelAdminPage.selectedAllMatchingCompact" values={{ count: selectedModelCount }} />
              ) : selectedModelCount > 0 ? (
                <Trans i18nKey="modelAdminPage.selectedCompact" values={{ count: selectedModelCount }} />
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {displayModelTotalM > visibleModels.length && (
                <button
                  onClick={selectAllMatchingModels}
                  disabled={displayModelTotalM === 0}
                  className="rounded-sm border border-primary/20 bg-primary/10 px-2.5 py-1.5 text-xs font-bold text-primary disabled:opacity-40"
                >
                  {t('modelAdminPage.selectAllMatching')}
                </button>
              )}
              <button
                onClick={toggleSelectVisibleModels}
                disabled={visibleModelIds.length === 0}
                className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant disabled:opacity-40"
              >
                {allVisibleModelsSelected ? t('modelAdminPage.deselect') : t('modelAdminPage.selectAll')}
              </button>
              {selectedModelCount > 0 && (
                <>
                  <button
                    onClick={() => setBatchCategoryOpen(true)}
                    disabled={batchCategorySaving}
                    className="rounded-sm border border-primary/20 bg-primary/10 px-2.5 py-1.5 text-xs font-bold text-primary disabled:opacity-40"
                  >
                    {t('modelAdminPage.changeCategoryShort')}
                  </button>
                  <button
                    onClick={() => setBatchDeleteOpen(true)}
                    disabled={batchDeleting}
                    className="rounded-sm border border-error/20 bg-error/10 px-2.5 py-1.5 text-xs font-bold text-error disabled:opacity-40"
                  >
                    {t('common.delete')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'suggestions' ? (
          sugLoading ? (
            <AdminLoadingState variant="list" rows={5} label={t('modelAdminPage.suggestionLoading')} />
          ) : (
            <div className="admin-tab-panel space-y-3">
              {filteredSuggestions.length > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-container-high px-3 py-2">
                  <div className="min-w-0 text-xs text-on-surface-variant">
                    <Trans
                      i18nKey="modelAdminPage.loadedOfTotalCompact"
                      values={{ loaded: filteredSuggestions.length, total: suggestionCount }}
                      components={{ strong: <span className="font-bold text-primary-container" /> }}
                    />
                    {selectedSuggestionCount > 0 && (
                      <Trans i18nKey="modelAdminPage.selectedCompact" values={{ count: selectedSuggestionCount }} />
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={toggleSelectPage}
                      className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant"
                    >
                      {allSuggestionsSelected ? t('modelAdminPage.deselect') : t('modelAdminPage.selectAll')}
                    </button>
                    <button
                      onClick={handleMerge}
                      disabled={merging || selectedSuggestionCount === 0}
                      className="rounded-sm bg-primary-container px-3 py-1.5 text-xs font-bold text-on-primary disabled:opacity-40"
                    >
                      {merging ? t('modelAdminPage.mergingShort') : t('modelAdminPage.mergeShort')}
                    </button>
                  </div>
                </div>
              )}
              {filteredSuggestions.map((group) => (
                <div key={group.name} className="rounded-lg bg-surface-container-high p-3">
                  <div className="flex items-center gap-3">
                    <input
                      name="has"
                      type="checkbox"
                      checked={selectedNames.has(group.name)}
                      onChange={() => toggleSelect(group.name)}
                      className="h-4 w-4 accent-primary-container"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-on-surface">{group.name}</p>
                      <p className="text-[11px] text-on-surface-variant">
                        {t('modelAdminPage.sameNameModelsCount', { count: group.count })}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleSelect(group.name)}
                      className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant"
                    >
                      {selectedNames.has(group.name) ? t('common.cancel') : t('modelAdminPage.selectShort')}
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
                      {t('modelAdminPage.mergeHint', { count: group.models.length })}
                    </span>
                    <button
                      onClick={() => handleMergeSingleSuggestion(group)}
                      disabled={merging || group.models.length < 2}
                      className="shrink-0 rounded-sm bg-primary-container px-3 py-1.5 text-xs font-bold text-on-primary disabled:opacity-40"
                    >
                      {t('modelAdminPage.mergeGroup')}
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
                  {t('modelAdminPage.noSuggestions')}
                </p>
              )}
            </div>
          )
        ) : activeTab === 'failed' ? (
          failedLoading ? (
            <AdminLoadingState variant="list" rows={5} label={t('modelAdminPage.failedLoading')} />
          ) : (
            <FailedModelsPanel
              compact
              items={failedModels}
              total={failedTotal}
              isLoadingMore={failedLoadingMore}
              hasMore={failedHasMore}
              onLoadMore={loadMoreFailed}
              onClearOne={handleClearFailedOne}
              onImport={handleOpenImportPreview}
              onClearSelected={handleClearFailedSelected}
              onClearAll={handleClearFailedAll}
              onToggleSelect={toggleSelectFailedModel}
              onToggleSelectLoaded={toggleSelectLoadedFailedModels}
              onClearSelection={clearSelectedFailedModels}
              clearing={clearingFailed}
              clearingId={clearingFailedId}
              selectedIds={selectedFailedModelIds}
              selectedCount={selectedFailedCount}
              allLoadedSelected={allFailedLoadedSelected}
            />
          )
        ) : activeTab === 'deleted' ? (
          deletedLoading ? (
            <AdminLoadingState variant="list" rows={5} label={t('modelAdminPage.recycleBinLoading')} />
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
            <AdminLoadingState variant="list" rows={5} label={t('modelAdminPage.groupLoading')} />
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
                            name="group-name-draft"
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
                              {t('modelAdminPage.groupMeta', {
                                count: group.model_count,
                                primary: group.primary?.name || t('modelAdminPage.primaryNotSet'),
                              })}
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
                            {t('common.save')}
                          </button>
                          <button
                            onClick={() => setEditingGroupId(null)}
                            className="rounded-sm border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant"
                          >
                            {t('common.cancel')}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => beginEditGroup(group)}
                          className="rounded-sm border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant"
                        >
                          {t('modelAdminPage.rename')}
                        </button>
                      )}
                      <button
                        onClick={() => setGroupConfirm({ type: 'delete', group })}
                        disabled={groupAction === `delete:${group.id}`}
                        className="rounded-sm border border-error/20 px-3 py-1.5 text-xs text-error disabled:opacity-40"
                      >
                        {t('modelAdminPage.dissolveGroup')}
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
                                  rel="noopener"
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
                                        {t('modelAdminPage.primaryBadge')}
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
                                  rel="noopener"
                                  className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant"
                                >
                                  {t('modelAdminPage.view')}
                                </Link>
                                {!isPrimary && (
                                  <button
                                    onClick={() => handleSetPrimary(group, model.id)}
                                    disabled={groupAction === `primary:${group.id}:${model.id}`}
                                    className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant disabled:opacity-40"
                                  >
                                    {t('modelAdminPage.setPrimary')}
                                  </button>
                                )}
                                <button
                                  onClick={() => setGroupConfirm({ type: 'remove', group, modelId: model.id })}
                                  disabled={group.model_count <= 2 || groupAction === `remove:${group.id}:${model.id}`}
                                  className="rounded-sm border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant disabled:opacity-40"
                                >
                                  {t('modelAdminPage.removeFromGroupShort')}
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
                  {t('modelAdminPage.noGroups')}
                </p>
              )}
            </div>
          )
        ) : isLoadingInitial ? (
          <AdminLoadingState variant="list" rows={5} label={t('modelAdminPage.modelListLoading')} />
        ) : (
          <div className="admin-tab-panel flex flex-col gap-3">
            {visibleModels.map((m) => (
              <ModelCard
                key={m.model_id}
                model={m}
                selected={selectedModelIds.has(m.model_id)}
                onToggleSelect={toggleSelectModel}
                onEdit={setEditModel}
                onDelete={setDeleteTarget}
              />
            ))}
            {models.length > 0 && (
              <InfiniteLoadTrigger
                hasMore={hasMoreVisibleModels || hasMore}
                isLoading={isLoadingMore}
                onLoadMore={hasMoreVisibleModels ? loadMoreVisibleModels : loadMore}
              />
            )}
            {models.length === 0 && (
              <p className="text-center text-on-surface-variant py-12 text-sm">{t('modelAdminPage.noModelsFound')}</p>
            )}
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
        title={
          groupConfirm?.type === 'delete'
            ? t('modelAdminPage.confirmDissolveTitle')
            : t('modelAdminPage.confirmRemoveTitle')
        }
        description={
          groupConfirm?.type === 'delete'
            ? t('modelAdminPage.confirmDissolveDesc', { name: groupConfirm.group.name })
            : t('modelAdminPage.confirmRemoveDesc')
        }
        confirmLabel={
          groupAction
            ? t('modelAdminPage.processing')
            : groupConfirm?.type === 'delete'
              ? t('modelAdminPage.confirmDissolve')
              : t('modelAdminPage.confirmRemove')
        }
        confirmDisabled={Boolean(groupAction)}
      />
      <EditDialog
        open={!!editModel}
        model={editModel}
        categories={categories || []}
        onClose={() => setEditModel(null)}
        onSaved={() => mutate()}
      />
      {importPreviewTarget && (
        <ImportPreviewDialog
          model={importPreviewTarget}
          onClose={() => setImportPreviewTarget(null)}
          onImported={() => {
            setImportPreviewTarget(null);
            refreshModelAdminData();
          }}
        />
      )}
      {importModelsOpen && (
        <ImportModelsDialog onClose={() => setImportModelsOpen(false)} onImported={refreshModelAdminData} />
      )}
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
        confirmLabel={
          purgingDeleted
            ? t('modelAdminPage.deleting')
            : purgeConfirmMode === 'all'
              ? t('modelAdminPage.emptyRecycleBin')
              : t('modelAdminPage.permanentDelete')
        }
        confirmDisabled={purgingDeleted || purgeConfirmSelectedCount <= 0}
      />
      <ConfirmDialog
        open={Boolean(failedClearRequest)}
        onClose={() => {
          if (!clearingFailed) setFailedClearRequest(null);
        }}
        onConfirm={() => {
          if (!failedClearRequest) return;
          void clearFailedModels(failedClearRequest.ids);
        }}
        icon="delete_sweep"
        title={failedClearRequest?.title ?? ''}
        description={failedClearRequest?.description ?? ''}
        confirmLabel={clearingFailed ? t('modelAdminPage.clearingEllipsis') : t('modelAdminPage.confirmClear')}
        confirmDisabled={clearingFailed}
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
              <h3 className="font-headline text-base font-semibold text-on-surface mb-2">
                {t('modelAdminPage.confirmDeleteTitle')}
              </h3>
              <p className="text-sm text-on-surface-variant mb-5 break-words">
                {t('modelAdminPage.confirmDeleteDesc', { name: deleteTarget.name })}
              </p>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
                <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-on-surface-variant">
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 bg-error text-white rounded-sm text-sm disabled:opacity-50"
                >
                  {deleting ? t('modelAdminPage.deleting') : t('common.delete')}
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
              <h3 className="font-headline text-base font-semibold text-on-surface mb-2">
                {t('modelAdminPage.confirmBatchDeleteTitle')}
              </h3>
              <p className="text-sm text-on-surface-variant mb-5 break-words">
                {t('modelAdminPage.confirmBatchDeleteDesc', { count: selectedModelCount })}
                {selectedAllMatching && ` ${t('modelAdminPage.batchDeleteAllMatchingNote')}`}
              </p>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
                <button
                  onClick={() => setBatchDeleteOpen(false)}
                  disabled={batchDeleting}
                  className="px-4 py-2 text-sm text-on-surface-variant disabled:opacity-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleBatchDelete}
                  disabled={batchDeleting}
                  className="px-4 py-2 bg-error text-white rounded-sm text-sm disabled:opacity-50"
                >
                  {batchDeleting ? t('modelAdminPage.deleting') : t('modelAdminPage.confirmDeleteLabel')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <BatchCategoryDialog
        open={batchCategoryOpen && selectedModelCount > 0}
        saving={batchCategorySaving}
        categories={categories}
        count={selectedModelCount}
        allMatching={selectedAllMatching}
        onClose={() => {
          if (!batchCategorySaving) setBatchCategoryOpen(false);
        }}
        onConfirm={handleBatchUpdateCategory}
      />
    </>
  );
}

export default function ModelAdminPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('modelAdminPage.pageTitle'));
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
