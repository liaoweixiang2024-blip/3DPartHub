import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  batchDeleteNotifications,
  type Notification,
  type NotificationReadFilter,
} from '../api/notifications';
import { AdminEmptyState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getErrorMessage } from '../lib/errorNotifications';
import { useAuthStore } from '../stores/useAuthStore';

const PAGE_SIZE = 20;

const TYPE_META: Record<string, { icon: string; color: string }> = {
  ticket: { icon: 'assignment_add', color: 'text-primary-container bg-primary-container/10' },
  comment: { icon: 'chat', color: 'text-blue-500 bg-blue-500/10' },
  favorite: { icon: 'star', color: 'text-pink-500 bg-pink-500/10' },
  download: { icon: 'download', color: 'text-purple-500 bg-purple-500/10' },
  success: { icon: 'check_circle', color: 'text-green-500 bg-green-500/10' },
  error: { icon: 'error', color: 'text-red-500 bg-red-500/10' },
  info: { icon: 'notifications', color: 'text-primary-container bg-primary-container/10' },
  model_conversion: { icon: 'view_in_ar', color: 'text-cyan-500 bg-cyan-500/10' },
  inquiry: { icon: 'request_quote', color: 'text-amber-500 bg-amber-500/10' },
  backup: { icon: 'database', color: 'text-orange-500 bg-orange-500/10' },
};

const TYPE_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: '', labelKey: 'notificationsPage.typeAll' },
  { value: 'ticket', labelKey: 'notificationsPage.typeTicket' },
  { value: 'inquiry', labelKey: 'notificationsPage.typeInquiry' },
  { value: 'favorite', labelKey: 'notificationsPage.typeFavorite' },
  { value: 'download', labelKey: 'notificationsPage.typeDownload' },
  { value: 'model_conversion', labelKey: 'notificationsPage.typeModelConversion' },
  { value: 'backup', labelKey: 'notificationsPage.typeBackup' },
  { value: 'comment', labelKey: 'notificationsPage.typeComment' },
];

function getTypeMeta(type: string) {
  return TYPE_META[type] || TYPE_META.info;
}

// 与 NotificationPanel 同款路由解析（页面独立维护，避免跨组件耦合）
function getNotificationRoute(n: Notification, isAdmin: boolean): string | null {
  if (n.actionPath) return n.actionPath;
  if (n.type === 'backup') return isAdmin ? '/admin/settings#backup' : null;
  if (!n.relatedId) return null;
  if (n.type === 'ticket')
    return isAdmin ? `/admin/tickets/${n.relatedId}#messages` : `/my-tickets/${n.relatedId}#messages`;
  if (n.type === 'comment') return `/model/${n.relatedId}`;
  if (n.type === 'favorite') return `/model/${n.relatedId}`;
  if (n.type === 'download') return `/model/${n.relatedId}`;
  if (n.type === 'success') return `/model/${n.relatedId}`;
  if (n.type === 'error') return `/model/${n.relatedId}`;
  if (n.type === 'model_conversion') return `/model/${n.relatedId}`;
  if (n.type === 'inquiry') {
    return isAdmin ? `/admin/inquiries/${n.relatedId}#messages` : `/my-inquiries/${n.relatedId}#messages`;
  }
  return null;
}

function formatTime(dateStr: string, locale: string) {
  const d = new Date(dateStr);
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function NotificationRow({
  n,
  isAdmin,
  selectMode,
  selected,
  onToggleSelect,
  onRead,
  onDelete,
  onNavigate,
}: {
  n: Notification;
  isAdmin: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onRead: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigate: (route: string) => void;
}) {
  const { i18n, t } = useTranslation();
  const meta = getTypeMeta(n.type);
  const route = getNotificationRoute(n, isAdmin);

  const handleClick = () => {
    if (selectMode) {
      onToggleSelect(n.id);
      return;
    }
    if (!n.read) onRead(n.id);
    if (route) onNavigate(route);
  };

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleClick();
        }
      }}
      aria-pressed={selectMode ? selected : undefined}
      className={`group flex items-start gap-3 border-b border-outline-variant/5 px-4 py-3.5 transition-colors last:border-b-0 sm:px-5 ${
        selectMode
          ? `cursor-pointer outline-none hover:bg-surface-container-highest/50 ${selected ? 'bg-primary-container/10' : ''}`
          : route
            ? 'cursor-pointer outline-none hover:bg-surface-container-highest/50 focus-visible:bg-surface-container-highest/50 focus-visible:ring-2 focus-visible:ring-primary/30 active:bg-surface-container-highest'
            : 'cursor-default'
      } ${!selectMode && n.read ? 'opacity-70' : ''}`}
    >
      {selectMode ? (
        <span
          className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
            selected ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant/40 text-transparent'
          }`}
        >
          <Icon name="check" size={14} />
        </span>
      ) : null}
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.color}`}>
        <Icon name={meta.icon} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary-container" />}
          <p className={`truncate text-sm text-on-surface ${!n.read ? 'font-medium' : ''}`}>{n.title}</p>
        </div>
        <p className="mt-0.5 break-words text-xs leading-relaxed text-on-surface-variant">{n.message}</p>
        <div className="mt-1.5 flex min-w-0 items-center gap-3">
          <p className="shrink-0 text-[11px] text-on-surface-variant/50">{formatTime(n.createdAt, i18n.language)}</p>
          {!selectMode && route && (
            <span className="inline-flex min-w-0 items-center gap-0.5 text-[11px] font-medium text-primary-container opacity-80 transition-opacity group-hover:opacity-100">
              <span>{t('notificationsPage.openDetail')}</span>
              <Icon name="chevron_right" size={12} />
            </span>
          )}
        </div>
      </div>
      {!selectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(n.id);
          }}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-on-surface-variant/40 opacity-60 transition-all hover:bg-error-container/10 hover:text-error focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
          title={t('common.delete')}
          aria-label={t('notificationsPage.deleteAria')}
          data-tooltip-ignore
        >
          <Icon name="delete_outline" size={15} />
        </button>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN';
  const [readFilter, setReadFilter] = useState<NotificationReadFilter>('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  // 批量管理（对齐我的分享页交互）
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);

  useDocumentTitle(t('notificationsPage.title'));

  const swrKey = ['my-notifications', readFilter, typeFilter, page] as const;
  const { data, error, isLoading, mutate } = useSWR(swrKey, ([, read, type, p]) =>
    getNotifications(p, PAGE_SIZE, { read, type: type || undefined }),
  );

  const notifications = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleRead = async (id: string) => {
    try {
      await markAsRead(id);
      await mutate();
    } catch (err) {
      toast(getErrorMessage(err, t('notificationsPage.markReadFailed')), 'error');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllAsRead();
      toast(t('notificationsPage.markAllSuccess'), 'success');
      await mutate();
    } catch (err) {
      toast(getErrorMessage(err, t('notificationsPage.markAllFailed')), 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteNotification(id);
      await mutate();
    } catch (err) {
      toast(getErrorMessage(err, t('notificationsPage.deleteFailed')), 'error');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = notifications.map((n) => n.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleBatchDelete = () => {
    if (!selectedIds.size) return;
    setBatchConfirmOpen(true);
  };

  const confirmBatchDelete = async () => {
    setBatchConfirmOpen(false);
    const ids = Array.from(selectedIds);
    try {
      const result = await batchDeleteNotifications(ids);
      toast(t('notificationsPage.batchDeleted', { count: result?.count ?? ids.length }), 'success');
      exitSelectMode();
      setPage(1);
      await mutate();
    } catch (err) {
      toast(getErrorMessage(err, t('notificationsPage.batchDeleteFailed')), 'error');
    }
  };

  const changeFilter = (next: { read?: NotificationReadFilter; type?: string }) => {
    if (next.read !== undefined) setReadFilter(next.read);
    if (next.type !== undefined) setTypeFilter(next.type);
    setPage(1);
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-outline-variant/20 p-0.5">
        {(['all', 'unread', 'read'] as NotificationReadFilter[]).map((value) => (
          <button
            key={value}
            onClick={() => changeFilter({ read: value })}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
              readFilter === value
                ? 'bg-primary-container font-medium text-on-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {t(`notificationsPage.filter.${value}`)}
          </button>
        ))}
      </div>
      <select
        value={typeFilter}
        onChange={(e) => changeFilter({ type: e.target.value })}
        className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-1.5 text-xs text-on-surface outline-none focus:border-primary"
      >
        {TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {t(opt.labelKey)}
          </option>
        ))}
      </select>
    </div>
  );

  const allVisibleSelected = notifications.length > 0 && notifications.every((n) => selectedIds.has(n.id));

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {selectMode && (
        <>
          <button
            onClick={toggleSelectAllVisible}
            className="rounded-lg border border-outline-variant/20 px-3 py-2 text-xs text-on-surface-variant transition-colors hover:text-on-surface"
          >
            {allVisibleSelected ? t('notificationsPage.unselectAll') : t('notificationsPage.selectCurrent')}
          </button>
          <button
            onClick={handleBatchDelete}
            disabled={!selectedIds.size}
            className="flex items-center gap-1.5 rounded-lg border border-error/30 px-3 py-2 text-xs text-error transition-colors hover:bg-error-container/10 disabled:opacity-40"
          >
            <Icon name="delete" size={14} />
            {t('notificationsPage.batchDelete', { count: selectedIds.size })}
          </button>
        </>
      )}
      {!selectMode && notifications.some((n) => !n.read) && (
        <button
          onClick={handleMarkAllRead}
          className="flex items-center gap-1.5 rounded-lg border border-outline-variant/20 px-3 py-2 text-xs text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <Icon name="done_all" size={14} />
          {t('notificationsPage.markAllRead')}
        </button>
      )}
      <button
        type="button"
        onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors ${
          selectMode
            ? 'border-primary/30 bg-primary-container/10 text-primary'
            : 'border-outline-variant/20 text-on-surface-variant hover:text-on-surface'
        }`}
      >
        <Icon name={selectMode ? 'close' : 'checklist'} size={14} />
        {selectMode ? t('notificationsPage.cancelSelect') : t('notificationsPage.batchOperation')}
      </button>
    </div>
  );

  let content: React.ReactNode;
  if (isLoading && !data) {
    content = (
      <div className="flex min-h-48 items-center justify-center">
        <PageRefreshIndicator label={t('notificationsPage.loading')} />
      </div>
    );
  } else if (error) {
    content = <AdminEmptyState icon="error" title={t('notificationsPage.loadFailed')} description="" />;
  } else if (notifications.length === 0) {
    content = (
      <AdminEmptyState
        icon="notifications"
        title={t('notificationsPage.empty')}
        description={t('notificationsPage.emptyDesc')}
      />
    );
  } else {
    content = (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-outline-variant/10 bg-surface-container-low">
          {notifications.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              isAdmin={isAdmin}
              selectMode={selectMode}
              selected={selectedIds.has(n.id)}
              onToggleSelect={toggleSelect}
              onRead={handleRead}
              onDelete={handleDelete}
              onNavigate={navigate}
            />
          ))}
        </div>
        {totalPages > 1 && (
          <div className="flex shrink-0 items-center justify-center gap-4 py-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 rounded-lg border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
            >
              <Icon name="chevron_left" size={14} />
              {t('notificationsPage.prevPage')}
            </button>
            <span className="text-xs text-on-surface-variant">
              {t('notificationsPage.pageInfo', { page, total: totalPages })}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 rounded-lg border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
            >
              {t('notificationsPage.nextPage')}
              <Icon name="chevron_right" size={14} />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <AdminPageShell>
      <AdminManagementPage
        title={t('notificationsPage.title')}
        meta={t('notificationsPage.meta', { count: total })}
        description={t('notificationsPage.description')}
        toolbar={toolbar}
        actions={actions}
      >
        {content}
      </AdminManagementPage>
      <ConfirmDialog
        open={batchConfirmOpen}
        onClose={() => setBatchConfirmOpen(false)}
        onConfirm={confirmBatchDelete}
        title={t('notificationsPage.batchConfirmTitle', { count: selectedIds.size })}
        description={t('notificationsPage.batchConfirmDesc')}
        confirmLabel={t('notificationsPage.batchConfirmDelete')}
      />
    </AdminPageShell>
  );
}
