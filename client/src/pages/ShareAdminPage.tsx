import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import Icon from "../components/shared/Icon";
import InfiniteLoadTrigger from "../components/shared/InfiniteLoadTrigger";
import { AdminPageShell } from "../components/shared/AdminPageShell";
import { AdminManagementPage } from "../components/shared/AdminManagementPage";
import client from "../api/client";
import { unwrapResponse } from "../api/response";
import { useToast } from "../components/shared/Toast";
import { copyText } from "../lib/clipboard";
import type { ApiResponse } from "../types/api";

interface ShareItem {
  id: string;
  token: string;
  modelId: string;
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
}

const PAGE_SIZE = 20;

type AdminSharesResponse = { total: number; items: ShareItem[]; page: number; pageSize: number };

async function fetchAdminShares(page: number, search: string): Promise<AdminSharesResponse> {
  const res = await client.get<ApiResponse<AdminSharesResponse>>("/admin/shares", {
    params: { page, page_size: PAGE_SIZE, search: search || undefined },
  });
  return unwrapResponse<AdminSharesResponse>(res);
}

async function fetchShareStats(): Promise<ShareStats> {
  const res = await client.get<ApiResponse<ShareStats>>("/admin/shares/stats");
  return unwrapResponse<ShareStats>(res);
}

function Content() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, mutate, setSize, size, isLoading } = useSWRInfinite(
    (pageIndex, previousPageData: AdminSharesResponse | null) => {
      if (previousPageData && previousPageData.page * previousPageData.pageSize >= previousPageData.total) return null;
      return `/admin/shares?p=${pageIndex + 1}&s=${encodeURIComponent(search)}`;
    },
    (key: string) => {
      const url = new URL(key, window.location.origin);
      return fetchAdminShares(Number(url.searchParams.get("p") || "1"), search);
    }
  );

  useEffect(() => {
    setSize(1);
  }, [search, setSize]);

  const { data: stats } = useSWR("/admin/shares/stats", fetchShareStats);

  const pages = data || [];
  const items = pages.flatMap((pageData) => pageData.items);
  const total = pages[0]?.total || 0;
  const hasMore = items.length < total;
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1]);
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

  async function handleDelete(id: string) {
    try {
      await client.delete(`/admin/shares/${id}`);
      toast("已删除", "success");
      setDeleteId(null);
      mutate();
    } catch (err: any) {
      toast(err.response?.data?.detail || "删除失败", "error");
    }
  }

  async function handleCopy(token: string) {
    try {
      await copyText(`${window.location.origin}/share/${token}`);
      toast("链接已复制", "success");
    } catch {
      toast("复制失败，请手动复制链接", "error");
    }
  }

  function isExpired(expiresAt: string | null) {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  }

  const statItems = stats ? [
    { label: "总数", value: stats.total, icon: "share", accent: "text-primary-container" },
    { label: "活跃", value: stats.active, icon: "check_circle", accent: "text-emerald-500" },
    { label: "已过期", value: stats.expired, icon: "schedule", accent: "text-on-surface-variant" },
    { label: "总浏览", value: stats.totalViews, icon: "visibility", accent: "text-blue-500" },
    { label: "总下载", value: stats.totalDownloads, icon: "download", accent: "text-amber-500" },
  ] : [];

  const toolbar = (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-3">
      <div className="grid min-w-0 flex-1 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
        {statItems.map((item, index) => (
          <div
            key={item.label}
            className="flex min-h-12 flex-col items-center justify-center gap-1 border-b border-r border-outline-variant/12 px-3 py-2 text-center even:border-r-0 sm:even:border-r sm:[&:nth-child(3n)]:border-r-0 xl:border-b-0 xl:even:border-r xl:[&:nth-child(3n)]:border-r xl:[&:nth-child(5n)]:border-r-0"
          >
            <span className="flex min-w-0 items-center justify-center gap-1.5">
              <Icon name={item.icon} size={14} className={item.accent} />
              <span className="truncate text-[10px] text-on-surface-variant">{item.label}</span>
            </span>
            <strong className={`block max-w-full truncate tabular-nums leading-tight text-on-surface ${index === 0 ? "text-lg" : "text-base"}`}>
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
          placeholder="搜索模型名、用户名..."
          className="w-full border-none bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50"
        />
        {search && (
          <button onClick={() => setSearch("")} className="p-0.5 text-on-surface-variant hover:text-on-surface">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <AdminManagementPage
      title="分享管理"
      description="管理模型分享链接、访问权限和下载记录"
      toolbar={toolbar}
    >

      {/* List */}
      <div className="space-y-2">
        {isLoading && items.length === 0 && (
          <div className="space-y-2">
            {[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-md bg-surface-container-low" />)}
          </div>
        )}
        {items.length === 0 && !isLoading && (
          <div className="text-center py-12 text-on-surface-variant">
            <Icon name="share" size={40} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">暂无分享记录</p>
          </div>
        )}
        {items.map(s => {
          const expired = isExpired(s.expiresAt);
          return (
            <div key={s.id} className="bg-surface-container-low rounded-md border border-outline-variant/10 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-on-surface break-words sm:truncate sm:max-w-[200px]">{s.modelName}</span>
                    {expired ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium bg-on-surface-variant/10 text-on-surface-variant">已过期</span>
                    ) : s.expiresAt ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium bg-emerald-500/15 text-emerald-400">有效</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium bg-primary-container/15 text-primary-container">永久</span>
                    )}
                    {s.hasPassword && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium bg-amber-500/15 text-amber-400">有密码</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] text-on-surface-variant/70">
                    <span className="flex items-center gap-0.5"><Icon name="person" size={10} />{s.createdByUsername}</span>
                    <span className="flex items-center gap-0.5"><Icon name="visibility" size={10} />{s.viewCount} 次浏览</span>
                    <span className="flex items-center gap-0.5"><Icon name="download" size={10} />{s.downloadCount}{s.downloadLimit > 0 ? `/${s.downloadLimit}` : ""} 次下载</span>
                    {s.expiresAt && <span className="flex items-center gap-0.5"><Icon name="schedule" size={10} />{new Date(s.expiresAt).toLocaleDateString("zh-CN")}</span>}
                    <span>{new Date(s.createdAt).toLocaleDateString("zh-CN")}</span>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1 shrink-0">
                  <button
                    onClick={() => handleCopy(s.token)}
                    className="px-2 py-1 text-[10px] text-primary-container hover:bg-primary-container/10 rounded transition-colors"
                    title="复制链接"
                  >
                    <Icon name="link" size={14} />
                  </button>
                  {deleteId === s.id ? (
                    <>
                      <button onClick={() => handleDelete(s.id)} className="px-2 py-1 text-[10px] font-medium bg-error text-on-error-container rounded">确认</button>
                      <button onClick={() => setDeleteId(null)} className="px-2 py-1 text-[10px] text-on-surface-variant hover:bg-surface-container-high/50 rounded">取消</button>
                    </>
                  ) : (
                    <button
                      onClick={() => setDeleteId(s.id)}
                      className="px-2 py-1 text-[10px] text-error hover:bg-error-container/10 rounded transition-colors"
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
    </AdminManagementPage>
  );
}

export default function ShareAdminPage() {
  useDocumentTitle("分享管理");
  return <AdminPageShell><Content /></AdminPageShell>;
}
