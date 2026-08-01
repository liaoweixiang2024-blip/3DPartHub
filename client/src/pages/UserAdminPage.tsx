import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import client from '../api/client';
import { unwrapResponse } from '../api/response';
import UserEditDialog, { type AdminUserDetail } from '../components/admin/UserEditDialog';
import { AdminIconButton } from '../components/shared/AdminControls';
import { AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import AdminRefreshButton from '../components/shared/AdminRefreshButton';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SearchField from '../components/shared/SearchField';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { copyText } from '../lib/clipboard';
import { getErrorMessage } from '../lib/errorNotifications';

interface UserItem {
  id: string;
  username: string;
  email: string;
  role: string;
  company: string | null;
  phone: string | null;
  department: string | null;
  bio: string | null;
  disabled: boolean;
  mustChangePassword: boolean;
  canInvite: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  _count: { downloads: number; favorites: number };
}

interface UserStats {
  total: number;
  admin: number;
  editor: number;
  viewer: number;
  active: number;
  disabled: number;
}

const ROLE_LABELS: Record<string, string> = { ADMIN: '管理员', EDITOR: '编辑者', VIEWER: '访客' };

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-primary-container/15 text-primary',
  EDITOR: 'bg-blue-500/15 text-blue-400',
  VIEWER: 'bg-surface-container-highest text-on-surface-variant',
};

const SORT_OPTIONS = [
  { value: 'created_at', label: '注册时间' },
  { value: 'last_login', label: '最近活跃' },
  { value: 'downloads', label: '下载次数' },
  { value: 'favorites', label: '收藏次数' },
];

const PERMISSION_HELP: Array<{ role: string; desc: string }> = [
  { role: '管理员', desc: '全部后台功能、用户管理、系统设置' },
  { role: '编辑者', desc: '上传/管理模型、内容审核、工单/询价处理' },
  { role: '访客', desc: '浏览、下载（受限额）、收藏、提交工单/询价' },
];

function relativeTime(value: string | null): string {
  if (!value) return '未登录';
  const ms = Date.now() - new Date(value).getTime();
  const day = Math.floor(ms / 86_400_000);
  if (day > 30) return new Date(value).toLocaleDateString();
  if (day > 0) return `${day} 天前`;
  const hour = Math.floor(ms / 3_600_000);
  if (hour > 0) return `${hour} 小时前`;
  const min = Math.floor(ms / 60_000);
  return min > 0 ? `${min} 分钟前` : '刚刚';
}

async function fetchUserStats() {
  const res = await client.get('/admin/users/stats');
  return unwrapResponse<UserStats>(res);
}

function UserRoleTabs({
  active,
  counts,
  onChange,
}: {
  active: string;
  counts: Record<string, number>;
  onChange: (value: string) => void;
}) {
  return (
    <ResponsiveSectionTabs
      tabs={[
        { value: '', label: '全部', count: counts.all ?? 0, icon: 'group' },
        { value: 'ADMIN', label: '管理员', count: counts.ADMIN ?? 0, icon: 'shield' },
        { value: 'EDITOR', label: '编辑者', count: counts.EDITOR ?? 0, icon: 'edit' },
        { value: 'VIEWER', label: '访客', count: counts.VIEWER ?? 0, icon: 'person' },
      ]}
      value={active}
      onChange={onChange}
      mobileTitle="用户角色"
      countUnit="人"
    />
  );
}

export default function UserAdminPage() {
  useDocumentTitle('用户管理');
  const {
    value: search,
    draftValue: searchInputValue,
    setValue: setSearch,
    inputProps: searchInputProps,
  } = useImeSafeSearchInput();
  const [roleFilter, setRoleFilter] = useState('');
  const [sort, setSort] = useState('created_at');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; username: string } | null>(null);
  const [editTarget, setEditTarget] = useState<UserItem | null>(null);
  const [adminConfirm, setAdminConfirm] = useState<{ userId: string; username: string } | null>(null);
  const [batchRole, setBatchRole] = useState('');
  const [batchConfirm, setBatchConfirm] = useState<{ action: 'role' | 'disable' | 'enable'; role?: string } | null>(
    null,
  );
  const [showHelp, setShowHelp] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { data: stats, mutate: mutateStats } = useSWR('/admin/users/stats', fetchUserStats);

  const listPageSize = 20;
  const { data, mutate, setSize, size, isLoading } = useSWRInfinite(
    (pageIndex, previousPageData: { total: number; items: UserItem[]; page: number; pageSize: number } | null) => {
      if (previousPageData && previousPageData.page * previousPageData.pageSize >= previousPageData.total) return null;
      const params = new URLSearchParams({
        page: String(pageIndex + 1),
        page_size: String(listPageSize),
        sort,
      });
      if (search) params.set('search', search);
      if (roleFilter) params.set('role', roleFilter);
      return `/admin/users?${params.toString()}`;
    },
    (key: string) => {
      const url = new URL(key, window.location.origin);
      return fetchUsers({
        page: Number(url.searchParams.get('page') || '1'),
        search,
        role: roleFilter,
        sort,
      });
    },
  );

  async function fetchUsers(opts: { page: number; search: string; role: string; sort: string }) {
    const res = await client.get('/admin/users', {
      params: {
        page: opts.page,
        page_size: listPageSize,
        search: opts.search || undefined,
        role: opts.role || undefined,
        sort: opts.sort,
      },
    });
    return unwrapResponse<{ total: number; items: UserItem[]; page: number; pageSize: number }>(res);
  }

  useEffect(() => {
    setSize(1);
    setSelected(new Set());
  }, [roleFilter, search, sort, setSize]);

  const pages = useMemo(() => data || [], [data]);
  const users = useMemo(() => pages.flatMap((pageData) => pageData.items), [pages]);
  const total = pages[0]?.total || 0;
  const loadedCount = users.length;
  const hasMore = loadedCount < total;
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1]);
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

  const refreshAll = useCallback(async () => {
    await Promise.all([mutate(undefined, { revalidate: true }), mutateStats(undefined, { revalidate: true })]);
  }, [mutate, mutateStats]);

  async function handleRefresh() {
    try {
      await setSize(1);
      await refreshAll();
      toast('用户数据已刷新', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, '刷新用户数据失败'), 'error');
    }
  }

  async function applyRoleChange(userId: string, role: string) {
    try {
      await client.put(`/admin/users/${userId}/role`, { role });
      toast('角色已更新', 'success');
      refreshAll();
    } catch (err: unknown) {
      toast(getErrorMessage(err, '修改失败'), 'error');
    }
  }

  function handleRoleSelect(userId: string, username: string, newRole: string) {
    if (newRole === 'ADMIN') {
      setAdminConfirm({ userId, username });
      return;
    }
    void applyRoleChange(userId, newRole);
  }

  async function handleQuickToggleDisable(user: UserItem) {
    try {
      await client.put(`/admin/users/${user.id}`, { disabled: !user.disabled });
      toast(user.disabled ? '已启用' : '已禁用', 'success');
      refreshAll();
    } catch (err: unknown) {
      toast(getErrorMessage(err, '操作失败'), 'error');
    }
  }

  async function handleDelete(userId: string) {
    try {
      await client.delete(`/admin/users/${userId}`);
      toast('用户已删除', 'success');
      setDeleteTarget(null);
      selected.delete(userId);
      setSelected(new Set(selected));
      refreshAll();
    } catch (err: unknown) {
      toast(getErrorMessage(err, '删除失败'), 'error');
    }
  }

  async function handleBatch(action: 'role' | 'disable' | 'enable', role?: string) {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      const payload: Record<string, unknown> = { ids, action };
      if (action === 'role' && role) payload.role = role;
      const res = await client.post('/admin/users/batch', payload);
      const result = unwrapResponse<{ updated: string[]; skipped: Array<{ id: string; reason: string }> }>(res);
      const skippedNote =
        result.skipped.length > 0 ? `，跳过 ${result.skipped.length} 项（最后一个管理员/自己/无需变更）` : '';
      toast(`已处理 ${result.updated.length} 项${skippedNote}`, 'success');
      setSelected(new Set());
      setBatchConfirm(null);
      setBatchRole('');
      refreshAll();
    } catch (err: unknown) {
      toast(getErrorMessage(err, '批量操作失败'), 'error');
    }
  }

  function handleExport() {
    const params = new URLSearchParams({ sort });
    if (search) params.set('search', search);
    if (roleFilter) params.set('role', roleFilter);
    window.open(`/api/admin/users/export?${params.toString()}`, '_blank');
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      if (prev.size >= users.length && users.length > 0) return new Set();
      return new Set(users.map((u) => u.id));
    });
  }

  async function handleCopy(value: string | null | undefined, label: string) {
    if (!value) return;
    try {
      await copyText(value);
      toast(`${label}已复制`, 'success');
    } catch {
      toast(`${label}复制失败`, 'error');
    }
  }

  const roleCounts = {
    all: stats?.total ?? 0,
    ADMIN: stats?.admin ?? 0,
    EDITOR: stats?.editor ?? 0,
    VIEWER: stats?.viewer ?? 0,
  };

  const toolbar = (
    <div className="flex min-h-10 min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <UserRoleTabs active={roleFilter} counts={roleCounts} onChange={setRoleFilter} />
        {stats?.disabled ? <p className="mt-1 text-[11px] text-error">已禁用 {stats.disabled} 人</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-md border border-outline-variant/20 bg-surface-container-high px-2 py-1.5 text-xs text-on-surface"
          aria-label="排序"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleExport}
          className="flex items-center gap-1 rounded-md border border-outline-variant/20 bg-surface-container-high px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-on-surface"
        >
          <Icon name="download" size={14} />
          导出
        </button>
        <SearchField
          inputProps={searchInputProps}
          value={searchInputValue}
          onClear={() => setSearch('')}
          placeholder="搜索用户名、邮箱、公司..."
          className="md:w-64"
        />
      </div>
    </div>
  );

  const actions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setShowHelp((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
        aria-label="角色权限说明"
        title="角色权限说明"
      >
        <Icon name="help_outline" size={18} />
      </button>
      <AdminRefreshButton onRefresh={handleRefresh} mobileIconOnly />
    </div>
  );

  const allSelected = users.length > 0 && selected.size >= users.length;

  const content = (
    <AdminManagementPage
      title="用户管理"
      description="管理用户角色、账号状态和使用数据"
      actions={actions}
      toolbar={toolbar}
    >
      {showHelp ? (
        <div className="mb-3 rounded-md border border-outline-variant/10 bg-surface-container-low px-3 py-2.5 text-xs">
          <div className="mb-1.5 flex items-center gap-1.5 font-medium text-on-surface">
            <Icon name="shield" size={14} />
            角色权限说明
          </div>
          <div className="space-y-1 text-on-surface-variant">
            {PERMISSION_HELP.map((p) => (
              <div key={p.role} className="flex gap-2">
                <span className="w-14 shrink-0 font-medium text-on-surface">{p.role}</span>
                <span>{p.desc}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary-container/10 px-3 py-2">
          <span className="text-xs font-medium text-on-surface">已选 {selected.size} 项</span>
          <select
            value={batchRole}
            onChange={(e) => setBatchRole(e.target.value)}
            className="rounded border border-outline-variant/20 bg-surface-container-high px-2 py-1 text-xs"
          >
            <option value="">改角色为…</option>
            <option value="ADMIN">管理员</option>
            <option value="EDITOR">编辑者</option>
            <option value="VIEWER">访客</option>
          </select>
          <button
            type="button"
            disabled={!batchRole}
            onClick={() => batchRole && setBatchConfirm({ action: 'role', role: batchRole })}
            className="rounded bg-primary-container px-2.5 py-1 text-xs font-medium text-on-primary-container disabled:opacity-40"
          >
            应用
          </button>
          <button
            type="button"
            onClick={() => setBatchConfirm({ action: 'disable' })}
            className="rounded border border-error/30 px-2.5 py-1 text-xs text-error hover:bg-error/10"
          >
            禁用
          </button>
          <button
            type="button"
            onClick={() => setBatchConfirm({ action: 'enable' })}
            className="rounded border border-outline-variant/30 px-2.5 py-1 text-xs text-on-surface-variant hover:bg-surface-container-high"
          >
            启用
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-on-surface-variant hover:text-on-surface"
          >
            取消选择
          </button>
        </div>
      ) : null}

      {/* User list */}
      <div className="space-y-2">
        {isLoading && users.length === 0 && <AdminLoadingState variant="list" label="用户列表加载中" />}
        {users.length > 0 ? (
          <div className="flex items-center gap-2 px-1 pb-1 text-[11px] text-on-surface-variant">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-3.5 w-3.5" />
            <span>全选当前页</span>
          </div>
        ) : null}
        {users.map((u) => {
          const isSelected = selected.has(u.id);
          return (
            <div
              key={u.id}
              className={`rounded-md border border-outline-variant/10 bg-surface-container-low p-3 transition-opacity ${
                u.disabled ? 'opacity-60' : ''
              } ${isSelected ? 'ring-1 ring-primary/40' : ''}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(u.id)}
                    className="mt-1 h-3.5 w-3.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setEditTarget(u)}
                        className="truncate text-left text-sm font-medium text-on-surface hover:text-primary"
                        title="点击编辑"
                      >
                        {u.username}
                      </button>
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
                          ROLE_COLORS[u.role] || ROLE_COLORS.VIEWER
                        }`}
                      >
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                      {u.disabled ? (
                        <span className="rounded-sm bg-error/15 px-1.5 py-0.5 text-[10px] font-medium text-error">
                          已禁用
                        </span>
                      ) : null}
                      {u.mustChangePassword ? (
                        <span className="rounded-sm bg-tertiary-container/30 px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                          待改密
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
                      <button
                        onClick={() => handleCopy(u.email, '邮箱')}
                        className="break-all text-left hover:text-primary-container"
                        title="复制邮箱"
                      >
                        {u.email}
                      </button>
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-on-surface-variant/70">
                      {u.company ? <span className="break-words">{u.company}</span> : null}
                      {u.department ? <span>{u.department}</span> : null}
                      <span>下载 {u._count.downloads}</span>
                      <span>收藏 {u._count.favorites}</span>
                      <span>活跃 {relativeTime(u.lastLoginAt)}</span>
                      <span>{new Date(u.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-1.5">
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleSelect(u.id, u.username, e.target.value)}
                    className="rounded border border-outline-variant/20 bg-surface-container-high px-2 py-1 text-xs text-on-surface"
                    title="角色"
                  >
                    <option value="ADMIN">管理员</option>
                    <option value="EDITOR">编辑者</option>
                    <option value="VIEWER">访客</option>
                  </select>
                  <AdminIconButton
                    icon={u.disabled ? 'lock_open' : 'block'}
                    onClick={() => handleQuickToggleDisable(u)}
                    size="icon-sm"
                    variant={u.disabled ? 'secondary' : 'danger'}
                    aria-label={u.disabled ? '启用' : '禁用'}
                  />
                  <AdminIconButton icon="edit" onClick={() => setEditTarget(u)} size="icon-sm" aria-label="编辑用户" />
                  <AdminIconButton
                    icon="delete"
                    onClick={() => setDeleteTarget({ id: u.id, username: u.username })}
                    size="icon-sm"
                    variant="danger"
                    aria-label="删除用户"
                  />
                </div>
              </div>
            </div>
          );
        })}
        {users.length > 0 && <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={loadMore} />}
        {users.length === 0 && !isLoading && (
          <div className="py-10 text-center text-sm text-on-surface-variant">暂无用户数据</div>
        )}
      </div>
    </AdminManagementPage>
  );

  return (
    <AdminPageShell>
      {content}
      {editTarget ? (
        <UserEditDialog
          user={editTarget as AdminUserDetail}
          onClose={() => setEditTarget(null)}
          onSaved={() => refreshAll()}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget.id);
        }}
        title="确认删除用户"
        description={`确定删除用户「${deleteTarget?.username || ''}」？此操作不可撤销。`}
        confirmLabel="确认删除"
      />
      <ConfirmDialog
        open={Boolean(adminConfirm)}
        onClose={() => setAdminConfirm(null)}
        onConfirm={() => {
          if (adminConfirm) void applyRoleChange(adminConfirm.userId, 'ADMIN');
          setAdminConfirm(null);
        }}
        title="提升为管理员"
        description={`确定将「${adminConfirm?.username || ''}」提升为管理员？该用户将拥有全部后台权限。`}
        confirmLabel="确认提升"
      />
      <ConfirmDialog
        open={Boolean(batchConfirm)}
        onClose={() => setBatchConfirm(null)}
        onConfirm={() => {
          if (batchConfirm) void handleBatch(batchConfirm.action, batchConfirm.role);
        }}
        title="确认批量操作"
        description={
          batchConfirm?.action === 'disable'
            ? `确定禁用选中的 ${selected.size} 个用户？他们将立即被登出。`
            : batchConfirm?.action === 'enable'
              ? `确定启用选中的 ${selected.size} 个用户？`
              : `确定将选中的 ${selected.size} 个用户角色改为${batchConfirm?.role === 'ADMIN' ? '管理员' : batchConfirm?.role === 'EDITOR' ? '编辑者' : '访客'}？`
        }
        confirmLabel="确认"
      />
    </AdminPageShell>
  );
}
