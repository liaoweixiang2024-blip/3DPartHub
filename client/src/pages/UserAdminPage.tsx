import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import client from '../api/client';
import { unwrapResponse } from '../api/response';
import UserCreateDialog from '../components/admin/UserCreateDialog';
import UserEditDialog, { type AdminUserDetail } from '../components/admin/UserEditDialog';
import { AdminIconButton } from '../components/shared/AdminControls';
import { AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import SelectMenu from '../components/shared/SelectMenu';
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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

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
  lastActiveAt: string | null;
  createdAt: string;
  _count: { downloads: number; favorites: number; shareLinks: number };
}

interface UserStats {
  total: number;
  admin: number;
  editor: number;
  viewer: number;
  internal: number;
  active: number;
  disabled: number;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'userAdmin.roleLabel.ADMIN',
  EDITOR: 'userAdmin.roleLabel.EDITOR',
  VIEWER: 'userAdmin.roleLabel.VIEWER',
  INTERNAL: 'userAdmin.roleLabel.INTERNAL',
};

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-primary-container/15 text-primary',
  EDITOR: 'bg-blue-500/15 text-blue-400',
  VIEWER: 'bg-surface-container-highest text-on-surface-variant',
  INTERNAL: 'bg-teal-500/15 text-teal-400',
};

const SORT_OPTIONS = [
  { value: 'created_at', labelKey: 'userAdmin.sortCreatedAt' },
  { value: 'last_login', labelKey: 'userAdmin.sortLastActive' },
  { value: 'downloads', labelKey: 'userAdmin.sortDownloads' },
  { value: 'favorites', labelKey: 'userAdmin.sortFavorites' },
];

const ROLE_OPTIONS: Array<{ value: string }> = [
  { value: 'ADMIN' },
  { value: 'EDITOR' },
  { value: 'VIEWER' },
  { value: 'INTERNAL' },
];

const PERMISSION_HELP: Array<{ role: string; helpKey: string }> = [
  { role: 'ADMIN', helpKey: 'userAdmin.help.ADMIN' },
  { role: 'EDITOR', helpKey: 'userAdmin.help.EDITOR' },
  { role: 'VIEWER', helpKey: 'userAdmin.help.VIEWER' },
  { role: 'INTERNAL', helpKey: 'userAdmin.help.INTERNAL' },
];

function relativeTime(value: string | null, t: TFunction): string {
  if (!value) return t('userAdmin.neverLoggedIn');
  const ms = Date.now() - new Date(value).getTime();
  const day = Math.floor(ms / 86_400_000);
  if (day > 30) return new Date(value).toLocaleDateString();
  if (day > 0) return t('userAdmin.daysAgo', { count: day });
  const hour = Math.floor(ms / 3_600_000);
  if (hour > 0) return t('userAdmin.hoursAgo', { count: hour });
  const min = Math.floor(ms / 60_000);
  return min > 0 ? t('userAdmin.minutesAgo', { count: min }) : t('userAdmin.justNow');
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
  const { t } = useTranslation();
  return (
    <ResponsiveSectionTabs
      tabs={[
        { value: '', label: t('userAdmin.tabAll'), count: counts.all ?? 0, icon: 'group' },
        { value: 'ADMIN', label: t('userAdmin.roleLabel.ADMIN'), count: counts.ADMIN ?? 0, icon: 'shield' },
        { value: 'EDITOR', label: t('userAdmin.roleLabel.EDITOR'), count: counts.EDITOR ?? 0, icon: 'edit' },
        { value: 'VIEWER', label: t('userAdmin.roleLabel.VIEWER'), count: counts.VIEWER ?? 0, icon: 'person' },
        { value: 'INTERNAL', label: t('userAdmin.roleLabel.INTERNAL'), count: counts.INTERNAL ?? 0, icon: 'badge' },
      ]}
      value={active}
      onChange={onChange}
      mobileTitle={t('userAdmin.roleTabsTitle')}
      countUnit={t('userAdmin.countUnit')}
    />
  );
}

export default function UserAdminPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('userAdmin.title'));
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
  const [createOpen, setCreateOpen] = useState(false);
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
      toast(t('userAdmin.toastRefreshed'), 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, t('userAdmin.refreshFailed')), 'error');
    }
  }

  async function applyRoleChange(userId: string, role: string) {
    try {
      await client.put(`/admin/users/${userId}/role`, { role });
      toast(t('userAdmin.roleUpdated'), 'success');
      refreshAll();
    } catch (err: unknown) {
      toast(getErrorMessage(err, t('userAdmin.roleChangeFailed')), 'error');
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
      toast(user.disabled ? t('userAdmin.enabled') : t('userAdmin.disabled'), 'success');
      refreshAll();
    } catch (err: unknown) {
      toast(getErrorMessage(err, t('userAdmin.operationFailed')), 'error');
    }
  }

  // 解除登录锁定（登录防爆破：邮箱 5 次失败出验证码 / 30 次临时锁号 / IP 20 次锁网络，均 15 分钟自动解除）
  async function handleUnlockLogin(user: UserItem) {
    try {
      await client.post('/admin/users/unlock-login', { email: user.email });
      toast(t('userAdmin.unlockedToast', { name: user.username || user.email }), 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, t('userAdmin.unlockFailed')), 'error');
    }
  }

  async function handleDelete(userId: string) {
    try {
      await client.delete(`/admin/users/${userId}`);
      toast(t('userAdmin.userDeleted'), 'success');
      setDeleteTarget(null);
      selected.delete(userId);
      setSelected(new Set(selected));
      refreshAll();
    } catch (err: unknown) {
      toast(getErrorMessage(err, t('userAdmin.deleteFailed')), 'error');
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
        result.skipped.length > 0 ? t('userAdmin.batchSkipped', { count: result.skipped.length }) : '';
      toast(t('userAdmin.batchDone', { count: result.updated.length, skipped: skippedNote }), 'success');
      setSelected(new Set());
      setBatchConfirm(null);
      setBatchRole('');
      refreshAll();
    } catch (err: unknown) {
      toast(getErrorMessage(err, t('userAdmin.batchFailed')), 'error');
    }
  }

  function handleExport() {
    const params = new URLSearchParams({ sort });
    if (search) params.set('search', search);
    if (roleFilter) params.set('role', roleFilter);
    window.open(`/api/admin/users/export?${params.toString()}`, '_blank', 'noopener');
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
      toast(t('userAdmin.copiedToast', { label }), 'success');
    } catch {
      toast(t('userAdmin.copyFailedToast', { label }), 'error');
    }
  }

  const roleCounts = {
    all: stats?.total ?? 0,
    ADMIN: stats?.admin ?? 0,
    EDITOR: stats?.editor ?? 0,
    VIEWER: stats?.viewer ?? 0,
    INTERNAL: stats?.internal ?? 0,
  };

  const toolbar = (
    <div className="flex min-h-10 min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <UserRoleTabs active={roleFilter} counts={roleCounts} onChange={setRoleFilter} />
        {stats?.disabled ? (
          <p className="mt-1 text-[11px] text-error">{t('userAdmin.disabledCount', { count: stats.disabled })}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SelectMenu
          variant="toolbar"
          value={sort}
          options={SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          onChange={setSort}
          ariaLabel={t('userAdmin.sortAria')}
        />
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-outline-variant/20 bg-surface-container-high px-2.5 py-1.5 text-sm text-on-surface-variant hover:text-on-surface"
        >
          <Icon name="person_add" size={14} />
          {t('userAdmin.createUser')}
        </button>
        <button
          type="button"
          onClick={handleExport}
          className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-outline-variant/20 bg-surface-container-high px-2.5 py-1.5 text-sm text-on-surface-variant hover:text-on-surface"
        >
          <Icon name="download" size={14} />
          {t('userAdmin.export')}
        </button>
        <SearchField
          inputProps={searchInputProps}
          value={searchInputValue}
          onClear={() => setSearch('')}
          placeholder={t('userAdmin.searchPlaceholder')}
          className="w-full md:w-64"
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
        aria-label={t('userAdmin.helpTitle')}
        title={t('userAdmin.helpTitle')}
      >
        <Icon name="help_outline" size={18} />
      </button>
      <AdminRefreshButton onRefresh={handleRefresh} mobileIconOnly />
    </div>
  );

  const allSelected = users.length > 0 && selected.size >= users.length;

  const content = (
    <AdminManagementPage
      title={t('userAdmin.title')}
      description={t('userAdmin.description')}
      actions={actions}
      toolbar={toolbar}
    >
      {showHelp ? (
        <div className="mb-3 rounded-md border border-outline-variant/10 bg-surface-container-low px-3 py-2.5 text-xs">
          <div className="mb-1.5 flex items-center gap-1.5 font-medium text-on-surface">
            <Icon name="shield" size={14} />
            {t('userAdmin.helpTitle')}
          </div>
          <div className="space-y-1 text-on-surface-variant">
            {PERMISSION_HELP.map((p) => (
              <div key={p.role} className="flex gap-2">
                <span className="w-14 shrink-0 font-medium text-on-surface">{t(`userAdmin.roleLabel.${p.role}`)}</span>
                <span>{t(p.helpKey)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary-container/10 px-3 py-2">
          <span className="text-xs font-medium text-on-surface">
            {t('userAdmin.selectedCount', { count: selected.size })}
          </span>
          <SelectMenu
            variant="chip"
            value={batchRole}
            onChange={setBatchRole}
            ariaLabel={t('userAdmin.batchRolePlaceholder')}
            placeholder={t('userAdmin.batchRolePlaceholder')}
            options={ROLE_OPTIONS.map((o) => ({ value: o.value, label: t(`userAdmin.roleLabel.${o.value}`) }))}
          />
          <button
            type="button"
            disabled={!batchRole}
            onClick={() => batchRole && setBatchConfirm({ action: 'role', role: batchRole })}
            className="rounded bg-primary-container px-2.5 py-1 text-xs font-medium text-on-primary-container disabled:opacity-40"
          >
            {t('userAdmin.apply')}
          </button>
          <button
            type="button"
            onClick={() => setBatchConfirm({ action: 'disable' })}
            className="rounded border border-error/30 px-2.5 py-1 text-xs text-error hover:bg-error/10"
          >
            {t('userAdmin.disable')}
          </button>
          <button
            type="button"
            onClick={() => setBatchConfirm({ action: 'enable' })}
            className="rounded border border-outline-variant/30 px-2.5 py-1 text-xs text-on-surface-variant hover:bg-surface-container-high"
          >
            {t('userAdmin.enable')}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-on-surface-variant hover:text-on-surface"
          >
            {t('userAdmin.cancelSelection')}
          </button>
        </div>
      ) : null}

      {/* User list */}
      <div className="space-y-2">
        {isLoading && users.length === 0 && <AdminLoadingState variant="list" label={t('userAdmin.listLoading')} />}
        {users.length > 0 ? (
          <div className="flex items-center gap-2 px-1 pb-1 text-[11px] text-on-surface-variant">
            <input
              name="all-selected"
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="h-3.5 w-3.5"
            />
            <span>{t('userAdmin.selectAllCurrent')}</span>
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
                    name="is-selected"
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
                        title={t('userAdmin.clickToEdit')}
                      >
                        {u.username}
                      </button>
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
                          ROLE_COLORS[u.role] || ROLE_COLORS.VIEWER
                        }`}
                      >
                        {t(ROLE_LABELS[u.role] || '', { defaultValue: u.role })}
                      </span>
                      {u.disabled ? (
                        <span className="rounded-sm bg-error/15 px-1.5 py-0.5 text-[10px] font-medium text-error">
                          {t('userAdmin.disabled')}
                        </span>
                      ) : null}
                      {u.mustChangePassword ? (
                        <span className="rounded-sm bg-tertiary-container/30 px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                          {t('userAdmin.pendingPassword')}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
                      <button
                        onClick={() => handleCopy(u.email, t('userAdmin.emailLabel'))}
                        className="break-all text-left hover:text-primary-container"
                        title={t('userAdmin.copyEmailTitle')}
                      >
                        {u.email}
                      </button>
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-on-surface-variant/70">
                      {u.company ? <span className="break-words">{u.company}</span> : null}
                      {u.department ? <span>{u.department}</span> : null}
                      <span>{t('userAdmin.downloadsCount', { count: u._count.downloads })}</span>
                      <span>{t('userAdmin.favoritesCount', { count: u._count.favorites })}</span>
                      <span>{t('userAdmin.activeAt', { time: relativeTime(u.lastActiveAt ?? u.lastLoginAt, t) })}</span>
                      <span>{new Date(u.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-1.5">
                  <SelectMenu
                    variant="chip"
                    value={u.role}
                    onChange={(value) => handleRoleSelect(u.id, u.username, value)}
                    ariaLabel={t('userAdmin.roleLabelTitle')}
                    options={ROLE_OPTIONS.map((o) => ({ value: o.value, label: t(`userAdmin.roleLabel.${o.value}`) }))}
                  />
                  <AdminIconButton
                    icon={u.disabled ? 'lock_open' : 'block'}
                    onClick={() => handleQuickToggleDisable(u)}
                    size="icon-sm"
                    variant={u.disabled ? 'secondary' : 'danger'}
                    aria-label={u.disabled ? t('userAdmin.enable') : t('userAdmin.disable')}
                  />
                  <AdminIconButton
                    icon="edit"
                    onClick={() => setEditTarget(u)}
                    size="icon-sm"
                    aria-label={t('userAdmin.editUserAria')}
                  />
                  <AdminIconButton
                    icon="vpn_key"
                    onClick={() => handleUnlockLogin(u)}
                    size="icon-sm"
                    variant="secondary"
                    aria-label={t('userAdmin.unlockAria')}
                    title={t('userAdmin.unlockTitle')}
                  />
                  <AdminIconButton
                    icon="delete"
                    onClick={() => setDeleteTarget({ id: u.id, username: u.username })}
                    size="icon-sm"
                    variant="danger"
                    aria-label={t('userAdmin.deleteAria')}
                  />
                </div>
              </div>
            </div>
          );
        })}
        {users.length > 0 && <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={loadMore} />}
        {users.length === 0 && !isLoading && (
          <div className="py-10 text-center text-sm text-on-surface-variant">{t('userAdmin.noData')}</div>
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
      {createOpen ? <UserCreateDialog onClose={() => setCreateOpen(false)} onCreated={() => refreshAll()} /> : null}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget.id);
        }}
        title={t('userAdmin.deleteTitle')}
        description={t('userAdmin.deleteDescription', { name: deleteTarget?.username || '' })}
        confirmLabel={t('userAdmin.deleteConfirm')}
      />
      <ConfirmDialog
        open={Boolean(adminConfirm)}
        onClose={() => setAdminConfirm(null)}
        onConfirm={() => {
          if (adminConfirm) void applyRoleChange(adminConfirm.userId, 'ADMIN');
          setAdminConfirm(null);
        }}
        title={t('userAdmin.promoteTitle')}
        description={t('userAdmin.promoteDescription', { name: adminConfirm?.username || '' })}
        confirmLabel={t('userAdmin.promoteConfirm')}
      />
      <ConfirmDialog
        open={Boolean(batchConfirm)}
        onClose={() => setBatchConfirm(null)}
        onConfirm={() => {
          if (batchConfirm) void handleBatch(batchConfirm.action, batchConfirm.role);
        }}
        title={t('userAdmin.batchTitle')}
        description={
          batchConfirm?.action === 'disable'
            ? t('userAdmin.batchDisableDescription', { count: selected.size })
            : batchConfirm?.action === 'enable'
              ? t('userAdmin.batchEnableDescription', { count: selected.size })
              : t('userAdmin.batchRoleDescription', {
                  count: selected.size,
                  role: t(ROLE_LABELS[batchConfirm?.role ?? ''] ?? '', {
                    defaultValue: batchConfirm?.role ?? '',
                  }),
                })
        }
        confirmLabel={t('common.confirm')}
      />
    </AdminPageShell>
  );
}
