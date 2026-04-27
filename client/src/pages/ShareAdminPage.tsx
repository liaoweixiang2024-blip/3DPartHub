import { useState } from "react";
import useSWR from "swr";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";
import TopNav from "../components/shared/TopNav";
import BottomNav from "../components/shared/BottomNav";
import AppSidebar from "../components/shared/Sidebar";
import MobileNavDrawer from "../components/shared/MobileNavDrawer";
import Icon from "../components/shared/Icon";
import Pagination from "../components/shared/Pagination";
import client from "../api/client";
import { useToast } from "../components/shared/Toast";
import { copyText } from "../lib/clipboard";

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

function fetchAdminShares(page: number, search: string) {
  return client.get("/admin/shares", { params: { page, page_size: PAGE_SIZE, search: search || undefined } })
    .then(({ data: resp }) => {
      const d = (resp as any)?.data ?? resp;
      return d as { total: number; items: ShareItem[]; page: number; pageSize: number };
    });
}

function fetchShareStats() {
  return client.get("/admin/shares/stats")
    .then(({ data: resp }) => {
      const d = (resp as any)?.data ?? resp;
      return d as ShareStats;
    });
}

function Content() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, mutate } = useSWR(
    `/admin/shares?p=${page}&s=${search}`,
    () => fetchAdminShares(page, search)
  );

  const { data: stats } = useSWR("/admin/shares/stats", fetchShareStats);

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-2xl md:font-headline md:font-bold md:tracking-tight md:uppercase font-bold text-on-surface">分享管理</h1>
        <span className="text-xs text-on-surface-variant">{total} 条记录</span>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            { label: "总数", value: stats.total, icon: "share", color: "text-primary-container" },
            { label: "活跃", value: stats.active, icon: "check_circle", color: "text-emerald-400" },
            { label: "已过期", value: stats.expired, icon: "schedule", color: "text-on-surface-variant" },
            { label: "总浏览", value: stats.totalViews, icon: "visibility", color: "text-blue-400" },
            { label: "总下载", value: stats.totalDownloads, icon: "download", color: "text-amber-400" },
          ].map(s => (
            <div key={s.label} className="bg-surface-container-low rounded-lg border border-outline-variant/10 p-3 flex items-center gap-2.5">
              <Icon name={s.icon} size={16} className={s.color} />
              <div>
                <p className="text-lg font-bold text-on-surface">{s.value}</p>
                <p className="text-[10px] text-on-surface-variant">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="flex items-center bg-surface-container-lowest rounded-md px-3 py-2 border border-outline-variant/20">
        <Icon name="search" size={16} className="text-on-surface-variant mr-2 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜索模型名、用户名..."
          className="bg-transparent border-none outline-none text-sm text-on-surface placeholder:text-on-surface-variant/50 w-full"
        />
        {search && (
          <button onClick={() => { setSearch(""); setPage(1); }} className="p-0.5 text-on-surface-variant hover:text-on-surface">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {/* List */}
      <div className="space-y-2">
        {items.length === 0 && (
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
      </div>

      <Pagination page={page} totalPages={totalPages} totalItems={total} onPageChange={setPage} className="mt-4 pb-1" />
    </div>
  );
}

export default function ShareAdminPage() {
  useDocumentTitle("分享管理");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [navOpen, setNavOpen] = useState(false);

  if (isDesktop) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto p-8 scrollbar-hidden bg-surface-dim">
            <Content />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen(prev => !prev)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="flex-1 overflow-y-auto scrollbar-hidden bg-surface-dim">
        <div className="px-4 py-4 pb-20">
          <Content />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
