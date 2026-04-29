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
import { getErrorMessage } from "../lib/errorNotifications";
import { copyText } from "../lib/clipboard";

interface UserItem {
  id: string;
  username: string;
  email: string;
  role: string;
  company: string | null;
  phone: string | null;
  createdAt: string;
  _count: { downloads: number; favorites: number };
}

interface UserStats {
  total: number;
  admin: number;
  editor: number;
  viewer: number;
  active: number;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "管理员",
  EDITOR: "编辑者",
  VIEWER: "访客",
};

const ROLE_COLORS: Record<string, string> = {
  ADMIN: "bg-primary-container/15 text-primary",
  EDITOR: "bg-blue-500/15 text-blue-400",
  VIEWER: "bg-surface-container-highest text-on-surface-variant",
};

const ROLE_OPTIONS = [
  { value: "", label: "全部角色" },
  { value: "ADMIN", label: "管理员" },
  { value: "EDITOR", label: "编辑者" },
  { value: "VIEWER", label: "访客" },
];

const numberFormatter = new Intl.NumberFormat("zh-CN");

function formatNumber(value: number | null | undefined) {
  return numberFormatter.format(value || 0);
}

async function fetchUserStats() {
  const res = await client.get("/admin/users/stats");
  return unwrapResponse<UserStats>(res);
}

export default function UserAdminPage() {
  useDocumentTitle("用户管理");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const { toast } = useToast();
  const { data: stats, mutate: mutateStats } = useSWR("/admin/users/stats", fetchUserStats);

  const { data, mutate, setSize, size, isLoading } = useSWRInfinite(
    (pageIndex, previousPageData: { total: number; items: UserItem[]; page: number; pageSize: number } | null) => {
      if (previousPageData && previousPageData.page * previousPageData.pageSize >= previousPageData.total) return null;
      return `/admin/users?page=${pageIndex + 1}&page_size=20${search ? `&search=${encodeURIComponent(search)}` : ""}${roleFilter ? `&role=${roleFilter}` : ""}`;
    },
    (key: string) => {
      const url = new URL(key, window.location.origin);
      return fetchUsers(Number(url.searchParams.get("page") || "1"), search, roleFilter);
    }
  );

  useEffect(() => {
    setSize(1);
  }, [roleFilter, search, setSize]);

  async function fetchUsers(p: number, s: string, role: string) {
    const res = await client.get("/admin/users", { params: { page: p, page_size: 20, search: s || undefined, role: role || undefined } });
    return unwrapResponse<{ total: number; items: UserItem[]; page: number; pageSize: number }>(res);
  }

  const pages = data || [];
  const users = pages.flatMap((pageData) => pageData.items);
  const total = pages[0]?.total || 0;
  const loadedCount = users.length;
  const hasMore = loadedCount < total;
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1]);
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

  async function handleRoleChange(userId: string, role: string) {
    try {
      await client.put(`/admin/users/${userId}/role`, { role });
      toast("角色已更新", "success");
      mutate();
      mutateStats();
    } catch (err: unknown) {
      toast(getErrorMessage(err, "修改失败"), "error");
    }
  }

  async function handleDelete(userId: string, username: string) {
    if (!window.confirm(`确定删除用户「${username}」？此操作不可撤销。`)) return;
    try {
      await client.delete(`/admin/users/${userId}`);
      toast("用户已删除", "success");
      mutate();
      mutateStats();
    } catch (err: unknown) {
      toast(getErrorMessage(err, "删除失败"), "error");
    }
  }

  async function handleCopy(value: string | null | undefined, label: string) {
    if (!value) return;
    try {
      await copyText(value);
      toast(`${label}已复制`, "success");
    } catch {
      toast(`${label}复制失败`, "error");
    }
  }

  const statItems = stats ? [
    { label: "总用户", value: stats.total, icon: "group", accent: "text-primary-container" },
    { label: "管理员", value: stats.admin, icon: "shield", accent: "text-amber-500" },
    { label: "编辑者", value: stats.editor, icon: "edit", accent: "text-blue-500" },
    { label: "访客", value: stats.viewer, icon: "person", accent: "text-on-surface-variant" },
    { label: "活跃用户", value: stats.active, icon: "check_circle", accent: "text-emerald-500" },
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
              {formatNumber(item.value)}
            </strong>
          </div>
        ))}
        {statItems.length === 0 && (
          <div className="col-span-full h-12 animate-pulse rounded-lg bg-surface-container-low" />
        )}
      </div>
      <div className="flex w-full flex-wrap items-center justify-end gap-3 xl:w-auto">
        <div className="relative h-9 w-full sm:w-36">
          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
            className="h-full w-full appearance-none border-0 border-b border-outline-variant/30 bg-transparent px-1 pr-7 text-center text-xs font-medium text-on-surface outline-none transition-colors hover:border-primary-container focus:border-primary-container"
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>{option.label}</option>
            ))}
          </select>
          <Icon name="expand_more" size={14} className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        </div>
        <div className="ml-auto flex h-9 w-full shrink-0 items-center px-1 sm:w-72">
          <Icon name="search" size={16} className="mr-2 shrink-0 text-on-surface-variant" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索用户名、邮箱、公司..."
            className="w-full border-none bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50"
          />
          {search && (
            <button onClick={() => setSearch("")} className="p-0.5 text-on-surface-variant hover:text-on-surface">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const content = (
    <AdminManagementPage
      title="用户管理"
      description="管理用户角色、账号信息和使用数据"
      toolbar={toolbar}
    >

      {/* User list */}
      <div className="space-y-2">
        {isLoading && users.length === 0 && (
          <div className="space-y-2">
            {[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-md bg-surface-container-low" />)}
          </div>
        )}
        {users.map((u) => (
          <div key={u.id} className="bg-surface-container-low rounded-md border border-outline-variant/10 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-sm text-on-surface truncate">{u.username}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium ${ROLE_COLORS[u.role] || ROLE_COLORS.VIEWER}`}>
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
                  <button onClick={() => handleCopy(u.email, "邮箱")} className="break-all text-left hover:text-primary-container" title="复制邮箱">
                    {u.email}
                  </button>
                  {u.phone ? (
                    <button onClick={() => handleCopy(u.phone, "电话")} className="hover:text-primary-container" title="复制电话">
                      {u.phone}
                    </button>
                  ) : null}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[10px] text-on-surface-variant/60">
                  {u.company && <span className="break-words">{u.company}</span>}
                  <span>下载 {u._count.downloads}</span>
                  <span>收藏 {u._count.favorites}</span>
                  <span>{new Date(u.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 shrink-0">
                <select
                  value={u.role}
                  onChange={(e) => handleRoleChange(u.id, e.target.value)}
                  className="text-xs bg-surface-container-high border border-outline-variant/20 rounded px-2 py-1 text-on-surface"
                >
                  <option value="ADMIN">管理员</option>
                  <option value="EDITOR">编辑者</option>
                  <option value="VIEWER">访客</option>
                </select>
                <button
                  onClick={() => handleDelete(u.id, u.username)}
                  className="p-1.5 text-on-surface-variant hover:text-error rounded transition-colors"
                  title="删除用户"
                >
                  <Icon name="delete" size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {users.length > 0 && <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={loadMore} />}
        {users.length === 0 && !isLoading && (
          <div className="text-center py-10 text-on-surface-variant text-sm">暂无用户数据</div>
        )}
      </div>
    </AdminManagementPage>
  );

  return <AdminPageShell>{content}</AdminPageShell>;
}
