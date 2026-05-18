import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import client from '../api/client';
import { unwrapResponse } from '../api/response';
import { AdminButton, AdminIconButton } from '../components/shared/AdminControls';
import { AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import AdminRefreshButton from '../components/shared/AdminRefreshButton';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SearchField from '../components/shared/SearchField';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { copyText } from '../lib/clipboard';
import { getErrorMessage } from '../lib/errorNotifications';
import type { ApiResponse } from '../types/api';

interface ShareItem {
  id: string;
  rawId: string;
  type: 'model' | 'selection';
  token: string;
  modelId: string | null;
  modelName: string;
  createdById: string;
  createdByUsername: string;
  allowPreview: boolean;
  allowDownload: boolean;
  downloadLimit: number;
  downloadCount: number;
  viewCount: number;
  hasPassword: boolean;
  expiresAt: string | null;
  createdAt: string;
}

interface ShareStats {
  total: number;
  active: number;
  expired: number;
  totalDownloads: number;
  totalViews: number;
  modelShares?: number;
  selectionShares?: number;
}

const PAGE_SIZE = 20;

type AdminSharesResponse = { total: number; items: ShareItem[]; page: number; pageSize: number };
type ShareFilter = 'all' | 'model' | 'selection' | 'active' | 'expired';

async function fetchAdminShares(page: number, search: string, filter: ShareFilter): Promise<AdminSharesResponse> {
  const res = await client.get<ApiResponse<AdminSharesResponse>>('/admin/shares', {
    params: { page, page_size: PAGE_SIZE, search: search || undefined, filter: filter === 'all' ? undefined : filter },
  });
  return unwrapResponse<AdminSharesResponse>(res);
}

async function fetchShareStats(): Promise<ShareStats> {
  const res = await client.get<ApiResponse<ShareStats>>('/admin/shares/stats');
  return unwrapResponse<ShareStats>(res);
}

function getSharePath(item: ShareItem) {
  return item.type === 'selection' ? `/selection/s/${item.token}` : `/share/${item.token}`;
}

function ShareFilterTabs({
  active,
  counts,
  onChange,
}: {
  active: ShareFilter;
  counts: Record<ShareFilter, number>;
  onChange: (value: ShareFilter) => void;
}) {
  return (
    <ResponsiveSectionTabs
      tabs={[
        { value: 'all', label: '全部', count: counts.all, icon: 'share' },
        { value: 'model', label: '模型', count: counts.model, icon: 'deployed_code' },
        { value: 'selection', label: '选型', count: counts.selection, icon: 'checklist' },
        { value: 'active', label: '活跃', count: counts.active, icon: 'check_circle' },
        { value: 'expired', label: '已过期', count: counts.expired, icon: 'schedule' },
      ]}
      value={active}
      onChange={(value) => onChange(value as ShareFilter)}
      mobileTitle="分享类型"
      countUnit="条"
    />
  );
}

function Content() {
  const { toast } = useToast();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const {
    value: search,
    draftValue: searchInputValue,
    setValue: setSearch,
    inputProps: searchInputProps,
  } = useImeSafeSearchInput();
  const [filter, setFilter] = useState<ShareFilter>('all');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const { data, mutate, setSize, size, isLoading } = useSWRInfinite(
    (pageIndex, previousPageData: AdminSharesResponse | null) => {
      if (previousPageData && previousPageData.page * previousPageData.pageSize >= previousPageData.total) return null;
      return `/admin/shares?p=${pageIndex + 1}&s=${encodeURIComponent(search)}&f=${filter}`;
    },
    (key: string) => {
      const url = new URL(key, window.location.origin);
      return fetchAdminShares(Number(url.searchParams.get('p') || '1'), search, filter);
    },
  );

  useEffect(() => {
    setSize(1);
    setSelectedIds(new Set());
    setDeleteId(null);
  }, [filter, search, setSize]);

  const { data: stats, mutate: mutateStats } = useSWR('/admin/shares/stats', fetchShareStats);

  const pages = useMemo(() => data || [], [data]);
  const items = useMemo(() => pages.flatMap((pageData) => pageData.items), [pages]);
  const total = pages[0]?.total || 0;
  const selectedCount = selectedIds.size;
  const hasMore = items.length < total;
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1]);
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

  async function handleRefresh() {
    try {
      await setSize(1);
      await Promise.all([mutate(undefined, { revalidate: true }), mutateStats(undefined, { revalidate: true })]);
      toast('分享数据已刷新', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, '刷新分享数据失败'), 'error');
    }
  }

  async function handleDelete(id: string) {
    try {
      await client.delete(`/admin/shares/${id}`);
      toast('已删除', 'success');
      setDeleteId(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await Promise.all([mutate(), mutateStats()]);
    } catch (err: unknown) {
      const detail = typeof err === 'object' && err !== null ? (err as Record<string, unknown>).response : undefined;
      const data = typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>).data : undefined;
      const msg =
        typeof data === 'object' && data !== null
          ? String((data as Record<string, unknown>).detail) || '删除失败'
          : '删除失败';
      toast(msg, 'error');
    }
  }

  async function handleBatchDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBatchDeleting(true);
    try {
      const res = await client.post<ApiResponse<{ ok: boolean; deleted: number }>>('/admin/shares/batch-delete', {
        ids,
      });
      const result = unwrapResponse<{ ok: boolean; deleted: number }>(res);
      toast(`已删除 ${result.deleted} 条分享`, 'success');
      setSelectedIds(new Set());
      setSelectMode(false);
      setBatchDeleteOpen(false);
      await Promise.all([mutate(), mutateStats()]);
    } catch (err: unknown) {
      const detail = typeof err === 'object' && err !== null ? (err as Record<string, unknown>).response : undefined;
      const data = typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>).data : undefined;
      const msg =
        typeof data === 'object' && data !== null
          ? String((data as Record<string, unknown>).detail) || '批量删除失败'
          : '批量删除失败';
      toast(msg, 'error');
    } finally {
      setBatchDeleting(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectMode() {
    setSelectMode((value) => {
      const next = !value;
      setDeleteId(null);
      if (!next) setSelectedIds(new Set());
      return next;
    });
  }

  async function handleCopy(item: ShareItem) {
    try {
      const path = item.type === 'selection' ? `/selection/s/${item.token}` : `/share/${item.token}`;
      await copyText(`${window.location.origin}${path}`);
      toast('链接已复制', 'success');
    } catch {
      toast('复制失败，请手动复制链接', 'error');
    }
  }

  function isExpired(expiresAt: string | null) {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  }

  const filterCounts: Record<ShareFilter, number> = {
    all: stats?.total ?? 0,
    model: stats?.modelShares ?? 0,
    selection: stats?.selectionShares ?? 0,
    active: stats?.active ?? 0,
    expired: stats?.expired ?? 0,
  };
  const hasAnyShare = (stats?.total ?? total) > 0;

  const toolbar = (
    <div className="flex min-h-10 min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <ShareFilterTabs active={filter} counts={filterCounts} onChange={setFilter} />
      </div>
      <SearchField
        inputProps={searchInputProps}
        value={searchInputValue}
        onClear={() => setSearch('')}
        placeholder="搜索模型、选型、用户名..."
        className="md:w-72 md:shrink-0"
      />
    </div>
  );

  const actions = (
    <div className="flex items-center gap-2">
      <AdminRefreshButton onRefresh={handleRefresh} mobileIconOnly />
      {hasAnyShare ? (
        <AdminButton
          onClick={toggleSelectMode}
          active={selectMode}
          icon={selectMode ? 'close' : 'checklist'}
          size={isDesktop ? 'md' : 'sm'}
          variant="secondary"
        >
          {isDesktop ? (selectMode ? '取消选择' : '批量管理') : selectMode ? '取消' : '批量'}
        </AdminButton>
      ) : null}
    </div>
  );

  return (
    <AdminManagementPage
      title="分享管理"
      description="管理模型分享链接、访问权限和下载记录"
      actions={actions}
      toolbar={toolbar}
    >
      {selectMode && selectedCount > 0 ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-outline-variant/20 bg-surface-container-high px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-on-surface">已选 {selectedCount} 个</span>
          <div className="flex-1" />
          <AdminButton onClick={() => setBatchDeleteOpen(true)} icon="delete" size="sm" variant="danger">
            删除分享
          </AdminButton>
          <AdminIconButton
            onClick={() => {
              setSelectMode(false);
              setSelectedIds(new Set());
            }}
            icon="close"
            size="icon-sm"
            variant="ghost"
            aria-label="取消选择"
          />
        </div>
      ) : null}
      {/* List */}
      <div className="space-y-2">
        {isLoading && items.length === 0 && <AdminLoadingState variant="list" label="分享列表加载中" />}
        {items.length === 0 && !isLoading && (
          <div className="text-center py-12 text-on-surface-variant">
            <Icon name="share" size={40} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">暂无分享记录</p>
          </div>
        )}
        {items.map((s) => {
          const expired = isExpired(s.expiresAt);
          const checked = selectedIds.has(s.id);
          return (
            <div
              key={s.id}
              className={`rounded-md border px-2.5 py-2 transition-colors sm:p-3 ${checked ? 'border-primary-container/35 bg-primary-container/8' : 'border-outline-variant/10 bg-surface-container-low'}`}
            >
              <div className="flex min-w-0 items-center gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2 sm:items-start sm:gap-3">
                  {selectMode ? (
                    <button
                      type="button"
                      onClick={() => toggleSelected(s.id)}
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors sm:mt-0.5 ${checked ? 'border-primary-container bg-primary-container text-on-primary' : 'border-outline-variant/35 text-transparent hover:border-primary-container/50'}`}
                      aria-label={checked ? '取消选择分享' : '选择分享'}
                    >
                      <Icon name="check" size={13} />
                    </button>
                  ) : null}
                  <Link
                    to={getSharePath(s)}
                    className="min-w-0 flex-1 rounded-md outline-none transition-colors hover:bg-surface-container/45 focus-visible:ring-2 focus-visible:ring-primary-container/45 sm:-mx-2 sm:px-2 sm:py-1"
                  >
                    <div className="flex min-w-0 items-center gap-1.5 sm:flex-wrap sm:gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-on-surface hover:text-primary-container sm:max-w-[240px]">
                        {s.modelName}
                      </span>
                      <Icon
                        name="open_in_new"
                        size={12}
                        className="hidden shrink-0 text-on-surface-variant/50 sm:block"
                      />
                      <span
                        className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
                          s.type === 'selection' ? 'bg-purple-500/15 text-purple-500' : 'bg-cyan-500/15 text-cyan-500'
                        }`}
                      >
                        {s.type === 'selection' ? '选型' : '模型'}
                      </span>
                      {expired ? (
                        <span className="hidden rounded-sm bg-on-surface-variant/10 px-1.5 py-0.5 text-[10px] font-medium text-on-surface-variant sm:inline-flex">
                          已过期
                        </span>
                      ) : s.expiresAt ? (
                        <span className="hidden rounded-sm bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 sm:inline-flex">
                          有效
                        </span>
                      ) : (
                        <span className="hidden rounded-sm bg-primary-container/15 px-1.5 py-0.5 text-[10px] font-medium text-primary-container sm:inline-flex">
                          永久
                        </span>
                      )}
                      {s.hasPassword && (
                        <span className="hidden rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 sm:inline-flex">
                          有密码
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] text-on-surface-variant/70 sm:mt-1.5 sm:flex-wrap sm:gap-x-3 sm:gap-y-1 sm:overflow-visible">
                      <span className="hidden min-w-0 items-center gap-0.5 truncate sm:flex">
                        <Icon name="person" size={10} />
                        {s.createdByUsername}
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5">
                        <Icon name="visibility" size={10} />
                        {s.viewCount}
                      </span>
                      {s.type === 'model' && (
                        <span className="flex shrink-0 items-center gap-0.5">
                          <Icon name="download" size={10} />
                          {s.downloadCount}
                          {s.downloadLimit > 0 ? `/${s.downloadLimit}` : ''}
                        </span>
                      )}
                      {s.expiresAt && (
                        <span className="hidden items-center gap-0.5 sm:flex">
                          <Icon name="schedule" size={10} />
                          {new Date(s.expiresAt).toLocaleDateString('zh-CN')}
                        </span>
                      )}
                      <span className="shrink-0">
                        {new Date(s.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                      </span>
                      <span className="min-w-0 truncate sm:hidden">{s.createdByUsername}</span>
                    </div>
                  </Link>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-0.5 sm:gap-1">
                  <button
                    onClick={() => handleCopy(s)}
                    className="rounded px-1.5 py-1 text-[10px] text-primary-container transition-colors hover:bg-primary-container/10 sm:px-2"
                    title="复制链接"
                  >
                    <Icon name="link" size={14} />
                  </button>
                  {selectMode ? null : deleteId === s.id ? (
                    <>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="px-2 py-1 text-[10px] font-medium bg-error text-on-error-container rounded"
                      >
                        确认
                      </button>
                      <button
                        onClick={() => setDeleteId(null)}
                        className="hidden px-2 py-1 text-[10px] text-on-surface-variant hover:bg-surface-container-high/50 rounded sm:inline-flex"
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setDeleteId(s.id)}
                      className="rounded px-1.5 py-1 text-[10px] text-error transition-colors hover:bg-error-container/10 sm:px-2"
                      title="删除"
                    >
                      <Icon name="delete" size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {items.length > 0 && <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={loadMore} />}
      </div>
      {batchDeleteOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => !batchDeleting && setBatchDeleteOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-error-container text-error">
                <Icon name="delete" size={20} />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-on-surface">批量删除分享</h3>
                <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
                  将删除已选的 {selectedCount} 条分享链接。删除后外部链接会立即失效，此操作不可恢复。
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBatchDeleteOpen(false)}
                disabled={batchDeleting}
                className="rounded-lg border border-outline-variant/25 px-4 py-2.5 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleBatchDelete}
                disabled={batchDeleting}
                className="rounded-lg bg-error px-4 py-2.5 text-sm font-bold text-on-error-container transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {batchDeleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminManagementPage>
  );
}

export default function ShareAdminPage() {
  useDocumentTitle('分享管理');
  return (
    <AdminPageShell>
      <Content />
    </AdminPageShell>
  );
}
