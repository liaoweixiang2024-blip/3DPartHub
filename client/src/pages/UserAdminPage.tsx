import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import client from '../api/client';
import { unwrapResponse } from '../api/response';
import { AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
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
  ADMIN: '管理员',
  EDITOR: '编辑者',
  VIEWER: '访客',
};

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-primary-container/15 text-primary',
  EDITOR: 'bg-blue-500/15 text-blue-400',
  VIEWER: 'bg-surface-container-highest text-on-surface-variant',
};

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
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const {
    value: search,
    draftValue: searchInputValue,
    setValue: setSearch,
    inputProps: searchInputProps,
  } = useImeSafeSearchInput();
  const [roleFilter, setRoleFilter] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();
  const { data: stats, mutate: mutateStats } = useSWR('/admin/users/stats', fetchUserStats);

  const { data, mutate, setSize, size, isLoading } = useSWRInfinite(
    (pageIndex, previousPageData: { total: number; items: UserItem[]; page: number; pageSize: number } | null) => {
      if (previousPageData && previousPageData.page * previousPageData.pageSize >= previousPageData.total) return null;
      return `/admin/users?page=${pageIndex + 1}&page_size=20${search ? `&search=${encodeURIComponent(search)}` : ''}${roleFilter ? `&role=${roleFilter}` : ''}`;
    },
    (key: string) => {
      const url = new URL(key, window.location.origin);
      return fetchUsers(Number(url.searchParams.get('page') || '1'), search, roleFilter);
    },
  );

  useEffect(() => {
    setSize(1);
  }, [roleFilter, search, setSize]);

  async function fetchUsers(p: number, s: string, role: string) {
    const res = await client.get('/admin/users', {
      params: { page: p, page_size: 20, search: s || undefined, role: role || undefined },
    });
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

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await setSize(1);
      await Promise.all([mutate(undefined, { revalidate: true }), mutateStats(undefined, { revalidate: true })]);
      toast('用户数据已刷新', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, '刷新用户数据失败'), 'error');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRoleChange(userId: string, role: string) {
    try {
      await client.put(`/admin/users/${userId}/role`, { role });
      toast('角色已更新', 'success');
      mutate();
      mutateStats();
    } catch (err: unknown) {
      toast(getErrorMessage(err, '修改失败'), 'error');
    }
  }

  async function handleDelete(userId: string, username: string) {
    if (!window.confirm(`确定删除用户「${username}」？此操作不可撤销。`)) return;
    try {
      await client.delete(`/admin/users/${userId}`);
      toast('用户已删除', 'success');
      mutate();
      mutateStats();
    } catch (err: unknown) {
      toast(getErrorMessage(err, '删除失败'), 'error');
    }
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
      </div>
      <SearchField
        inputProps={searchInputProps}
        value={searchInputValue}
        onClear={() => setSearch('')}
        placeholder="搜索用户名、邮箱、公司..."
        className="md:w-72 md:shrink-0"
      />
    </div>
  );

  const actions = (
    <button
      type="button"
      onClick={handleRefresh}
      disabled={refreshing}
      className={
        isDesktop
          ? 'flex items-center gap-2 rounded-lg border border-outline-variant/20 px-4 py-2.5 text-sm text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50'
          : 'inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant/20 px-3 text-xs text-on-surface-variant disabled:opacity-50'
      }
      aria-label="刷新"
    >
      <Icon name="refresh" size={isDesktop ? 16 : 14} className={refreshing ? 'animate-spin' : ''} />
      {isDesktop ? (refreshing ? '刷新中...' : '刷新') : null}
    </button>
  );

  const content = (
    <AdminManagementPage
      title="用户管理"
      description="管理用户角色、账号信息和使用数据"
      actions={actions}
      toolbar={toolbar}
    >
      {/* User list */}
      <div className="space-y-2">
        {isLoading && users.length === 0 && <AdminLoadingState variant="list" label="用户列表加载中" />}
        {users.map((u) => (
          <div key={u.id} className="bg-surface-container-low rounded-md border border-outline-variant/10 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-sm text-on-surface truncate">{u.username}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium ${ROLE_COLORS[u.role] || ROLE_COLORS.VIEWER}`}
                  >
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
                  <button
                    onClick={() => handleCopy(u.email, '邮箱')}
                    className="break-all text-left hover:text-primary-container"
                    title="复制邮箱"
                  >
                    {u.email}
                  </button>
                  {u.phone ? (
                    <button
                      onClick={() => handleCopy(u.phone, '电话')}
                      className="hover:text-primary-container"
                      title="复制电话"
                    >
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
