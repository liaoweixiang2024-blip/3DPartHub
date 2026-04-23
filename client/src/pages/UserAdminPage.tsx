import { useState, useEffect } from "react";
import useSWR from "swr";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";
import TopNav from "../components/shared/TopNav";
import BottomNav from "../components/shared/BottomNav";
import MobileNavDrawer from "../components/shared/MobileNavDrawer";
import AppSidebar from "../components/shared/Sidebar";
import Icon from "../components/shared/Icon";
import client from "../api/client";
import { useToast } from "../components/shared/Toast";

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

export default function UserAdminPage() {
  useDocumentTitle("用户管理");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [navOpen, setNavOpen] = useState(false);
  const toast = useToast();

  const { data, mutate } = useSWR(
    `/admin/users?page=${page}&page_size=20${search ? `&search=${search}` : ""}`,
    () => fetchUsers(page, search)
  );

  async function fetchUsers(p: number, s: string) {
    const { data: resp } = await client.get("/admin/users", { params: { page: p, page_size: 20, search: s || undefined } });
    const d = (resp as any)?.data ?? resp;
    return d as { total: number; items: UserItem[]; page: number; pageSize: number };
  }

  async function handleRoleChange(userId: string, role: string) {
    try {
      await client.put(`/admin/users/${userId}/role`, { role });
      toast("角色已更新", "success");
      mutate();
    } catch (err: any) {
      toast(err.response?.data?.detail || "修改失败", "error");
    }
  }

  async function handleDelete(userId: string, username: string) {
    if (!window.confirm(`确定删除用户「${username}」？此操作不可撤销。`)) return;
    try {
      await client.delete(`/admin/users/${userId}`);
      toast("用户已删除", "success");
      mutate();
    } catch (err: any) {
      toast(err.response?.data?.detail || "删除失败", "error");
    }
  }

  const users = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / 20);

  const content = (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg md:text-2xl md:font-headline md:font-bold md:tracking-tight md:uppercase font-bold text-on-surface">用户管理</h1>
        <span className="text-xs text-on-surface-variant">{total} 个用户</span>
      </div>

      {/* Search */}
      <div className="flex items-center bg-surface-container-lowest rounded-md px-3 py-2 border border-outline-variant/20">
        <Icon name="search" size={16} className="text-on-surface-variant mr-2 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜索用户名、邮箱、公司..."
          className="bg-transparent border-none outline-none text-sm text-on-surface placeholder:text-on-surface-variant/50 w-full"
        />
        {search && (
          <button onClick={() => { setSearch(""); setPage(1); }} className="p-0.5 text-on-surface-variant hover:text-on-surface">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {/* User list */}
      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="bg-surface-container-low rounded-md border border-outline-variant/10 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-on-surface truncate">{u.username}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium ${ROLE_COLORS[u.role] || ROLE_COLORS.VIEWER}`}>
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant mt-0.5">{u.email}</p>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-on-surface-variant/60">
                  {u.company && <span>{u.company}</span>}
                  <span>下载 {u._count.downloads}</span>
                  <span>收藏 {u._count.favorites}</span>
                  <span>{new Date(u.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
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
        {users.length === 0 && (
          <div className="text-center py-10 text-on-surface-variant text-sm">暂无用户数据</div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="p-1.5 rounded hover:bg-surface-container-high disabled:opacity-30">
            <Icon name="chevron_left" size={18} />
          </button>
          <span className="text-xs text-on-surface-variant">{page} / {totalPages}</span>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="p-1.5 rounded hover:bg-surface-container-high disabled:opacity-30">
            <Icon name="chevron_right" size={18} />
          </button>
        </div>
      )}
    </div>
  );

  if (isDesktop) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto p-8 scrollbar-hidden bg-surface-dim">
            {content}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen((v) => !v)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="flex-1 overflow-y-auto p-3 pb-20 scrollbar-hidden bg-surface-dim">
        {content}
      </main>
      <BottomNav />
    </div>
  );
}
