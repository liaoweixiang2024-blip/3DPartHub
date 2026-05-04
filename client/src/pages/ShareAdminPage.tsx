import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import useSWRInfinite from 'swr/infinite';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import { AdminManagementPage } from '../components/shared/AdminManagementPage';
import client from '../api/client';
import { unwrapResponse } from '../api/response';
import { useToast } from '../components/shared/Toast';
import { copyText } from '../lib/clipboard';
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

async function fetchAdminShares(page: number, search: string): Promise<AdminSharesResponse> {
  const res = await client.get<ApiResponse<AdminSharesResponse>>('/admin/shares', {
    params: { page, page_size: PAGE_SIZE, search: search || undefined },
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

function Content() {
  const { toast } = useToast();
  const { mutate: mutateGlobal } = useSWRConfig();
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const { data, mutate, setSize, size, isLoading } = useSWRInfinite(
    (pageIndex, previousPageData: AdminSharesResponse | null) => {
      if (previousPageData && previousPageData.page * previousPageData.pageSize >= previousPageData.total) return null;
      return `/admin/shares?p=${pageIndex + 1}&s=${encodeURIComponent(search)}`;
    },
    (key: string) => {
      const url = new URL(key, window.location.origin);
      return fetchAdminShares(Number(url.searchParams.get('p') || '1'), search);
    },
  );

  useEffect(() => {
    setSize(1);
    setSelectedIds(new Set());
  }, [search, setSize]);

  const { data: stats } = useSWR('/admin/shares/stats', fetchShareStats);

  const pages = data || [];
  const items = pages.flatMap((pageData) => pageData.items);
  const total = pages[0]?.total || 0;
  const visibleIds = items.map((item) => item.id);
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const selectedCount = selectedIds.size;
  const hasMore = items.length < total;
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1]);
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

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
      mutate();
      mutateGlobal('/admin/shares/stats');
    } catch (err: any) {
      toast(err.response?.data?.detail || '删除失败', 'error');
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
      setBatchDeleteOpen(false);
      await mutate();
      mutateGlobal('/admin/shares/stats');
    } catch (err: any) {
      toast(err.response?.data?.detail || '批量删除失败', 'error');
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

  function toggleSelectVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
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

  const statItems = stats
    ? [
        { label: '总数', value: stats.total, icon: 'share', accent: 'text-primary-container' },
        { label: '模型', value: stats.modelShares ?? 0, icon: 'deployed_code', accent: 'text-cyan-500' },
        { label: '选型', value: stats.selectionShares ?? 0, icon: 'fact_check', accent: 'text-purple-500' },
        { label: '活跃', value: stats.active, icon: 'check_circle', accent: 'text-emerald-500' },
        { label: '已过期', value: stats.expired, icon: 'schedule', accent: 'text-on-surface-variant' },
        { label: '总浏览', value: stats.totalViews, icon: 'visibility', accent: 'text-blue-500' },
        { label: '总下载', value: stats.totalDownloads, icon: 'download', accent: 'text-amber-500' },
      ]
    : [];

  const toolbar = (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-3">
      <div className="grid min-w-0 flex-1 grid-cols-2 sm:grid-cols-3 xl:grid-cols-7">
        {statItems.map((item, index) => (
          <div
            key={item.label}
            className="flex min-h-12 flex-col items-center justify-center gap-1 border-b border-r border-outline-variant/12 px-3 py-2 text-center even:border-r-0 sm:even:border-r sm:[&:nth-child(3n)]:border-r-0 xl:border-b-0 xl:even:border-r xl:[&:nth-child(3n)]:border-r xl:[&:nth-child(7n)]:border-r-0"
          >
            <span className="flex min-w-0 items-center justify-center gap-1.5">
              <Icon name={item.icon} size={14} className={item.accent} />
              <span className="truncate text-[10px] text-on-surface-variant">{item.label}</span>
            </span>
            <strong
              className={`block max-w-full truncate tabular-nums leading-tight text-on-surface ${index === 0 ? 'text-lg' : 'text-base'}`}
            >
              {item.value}
            </strong>
          </div>
        ))}
        {statItems.length === 0 && (
          <div className="col-span-full h-12 animate-pulse rounded-lg bg-surface-container-low" />
        )}
      </div>
      <div className="ml-auto flex h-9 w-full shrink-0 items-center px-1 sm:w-72">
        <Icon name="search" size={16} className="mr-2 shrink-0 text-on-surface-variant" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索模型、选型、用户名..."
          className="w-full border-none bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50"
        />
        {search && (
          <button onClick={() => setSearch('')} className="p-0.5 text-on-surface-variant hover:text-on-surface">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      {items.length > 0 && (
        <div className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-outline-variant/10 pt-2">
          <button
            type="button"
            onClick={toggleSelectVisible}
            className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          >
            <span
              className={`grid h-4 w-4 place-items-center rounded border ${allVisibleSelected ? 'border-primary-container bg-primary-container text-on-primary' : 'border-outline-variant/40'}`}
            >
              {allVisibleSelected ? <Icon name="check" size={12} /> : null}
            </span>
            {allVisibleSelected ? '取消全选已加载' : '全选已加载'}
          </button>
          {selectedCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-on-surface-variant">
                已选 <strong className="text-on-surface">{selectedCount}</strong> 条
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="rounded-lg px-2.5 py-1.5 text-xs text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                取消选择
              </button>
              <button
                type="button"
                onClick={() => setBatchDeleteOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-error-container px-3 py-1.5 text-xs font-bold text-error transition-opacity hover:opacity-90"
              >
                <Icon name="delete" size={14} />
                批量删除
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <AdminManagementPage title="分享管理" description="管理模型分享链接、访问权限和下载记录" toolbar={toolbar}>
      {/* List */}
      <div className="space-y-2">
        {isLoading && items.length === 0 && (
          <div className="space-y-2">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-20 animate-pulse rounded-md bg-surface-container-low" />
            ))}
          </div>
        )}
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
                  <button
                    type="button"
                    onClick={() => toggleSelected(s.id)}
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors sm:mt-0.5 ${checked ? 'border-primary-container bg-primary-container text-on-primary' : 'border-outline-variant/35 text-transparent hover:border-primary-container/50'}`}
                    aria-label={checked ? '取消选择分享' : '选择分享'}
                  >
                    <Icon name="check" size={13} />
                  </button>
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
                  {deleteId === s.id ? (
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
