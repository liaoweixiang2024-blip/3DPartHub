import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { deleteTicket, getTickets, updateTicketStatus, type Ticket } from '../api/tickets';
import { AdminButton } from '../components/shared/AdminControls';
import { AdminEmptyState, AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import AdminRefreshButton from '../components/shared/AdminRefreshButton';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SearchField from '../components/shared/SearchField';
import TicketSourceLink from '../components/shared/TicketSourceLink';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { useVisibleItems } from '../hooks/useVisibleItems';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getBusinessConfig, statusInfo } from '../lib/businessConfig';
import { getErrorMessage } from '../lib/errorNotifications';
import { usePublicSettings } from '../lib/publicSettings';
import { useAuthStore } from '../stores/useAuthStore';

type SearchInputProps = ReturnType<typeof useImeSafeSearchInput>['inputProps'];

const TICKET_TAB_ICONS: Record<string, string> = {
  all: 'checklist',
  open: 'inbox',
  waiting_user: 'chat',
  in_progress: 'build',
  resolved: 'check_circle',
  closed: 'lock',
};

function normalizeSearchValue(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function AdminSearchField({
  inputProps,
  value,
  onClear,
  placeholder,
}: {
  inputProps: SearchInputProps;
  value: string;
  onClear: () => void;
  placeholder: string;
}) {
  return (
    <SearchField
      inputProps={inputProps}
      value={value}
      onClear={onClear}
      placeholder={placeholder}
      className="md:w-72 md:shrink-0"
    />
  );
}

function ticketMatchesSearch(
  ticket: Ticket,
  searchText: string,
  classificationMap: Map<string, string>,
  statuses: ReturnType<typeof getBusinessConfig>['ticketStatuses'],
) {
  if (!searchText) return true;
  const statusLabel = statusInfo(statuses, ticket.status).label;
  return [
    ticket.id,
    ticket.description,
    ticket.basePart,
    ticket.sourceUrl,
    ticket.classification,
    classificationMap.get(ticket.classification),
    ticket.status,
    statusLabel,
    ticket.user?.username,
    ticket.user?.email,
    ticket.createdAt,
    ticket.updatedAt,
  ].some((value) => normalizeSearchValue(value).includes(searchText));
}

function useTicketAdminData() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { toast } = useToast();
  const {
    value: search,
    draftValue: searchInputValue,
    setValue: setSearch,
    inputProps: searchInputProps,
  } = useImeSafeSearchInput();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { settings } = usePublicSettings();
  const business = useMemo(() => getBusinessConfig(settings), [settings]);
  const statuses = business.ticketStatuses;
  const statusTabs = useMemo(
    () => [
      { value: 'all', label: t('ticketAdminPage.tabAll') },
      ...statuses.filter((s) => s.tab).map((s) => ({ value: s.value, label: s.label })),
    ],
    [statuses, t],
  );
  const classificationMap = useMemo(
    () => new Map(business.ticketClassifications.map((item) => [item.value, item.label])),
    [business.ticketClassifications],
  );

  useEffect(() => {
    loadTickets();
  }, []);

  async function loadTickets(options: { silent?: boolean } = {}) {
    if (!options.silent) setLoading(true);
    try {
      const data = await getTickets();
      setTickets(data);
    } catch {
      if (!options.silent) setTickets([]);
    } finally {
      if (!options.silent) setLoading(false);
    }
  }

  async function refreshTickets() {
    try {
      const data = await getTickets();
      setTickets(data);
      toast(t('ticketAdminPage.dataRefreshed'), 'success');
    } catch (err) {
      toast(getErrorMessage(err, t('ticketAdminPage.refreshFail')), 'error');
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await updateTicketStatus(id, status);
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    } catch {
      /* ignore */
    }
  }

  async function handleDeleteTicket(id: string) {
    setDeletingId(id);
    try {
      await deleteTicket(id);
      setTickets((prev) => prev.filter((ticket) => ticket.id !== id));
      toast(t('ticketAdminPage.ticketDeleted'), 'success');
    } catch (err) {
      toast(getErrorMessage(err, t('ticketAdminPage.deleteFail')), 'error');
    } finally {
      setDeletingId(null);
    }
  }

  const searchText = normalizeSearchValue(search);
  const searchedTickets = useMemo(
    () => tickets.filter((ticket) => ticketMatchesSearch(ticket, searchText, classificationMap, statuses)),
    [classificationMap, searchText, statuses, tickets],
  );
  const filtered = useMemo(
    () => (filter === 'all' ? searchedTickets : searchedTickets.filter((t) => t.status === filter)),
    [filter, searchedTickets],
  );
  const {
    visibleItems: visibleTickets,
    hasMore,
    loadMore,
  } = useVisibleItems(filtered, 60, `${filter}:${searchText}:${tickets.length}`);
  const counts: Record<string, number> = useMemo(() => {
    const next: Record<string, number> = { all: searchedTickets.length };
    for (const status of statuses.filter((s) => s.tab))
      next[status.value] = searchedTickets.filter((t) => t.status === status.value).length;
    return next;
  }, [searchedTickets, statuses]);

  return {
    user,
    loading,
    filter,
    setFilter,
    searchInputValue,
    setSearch,
    searchInputProps,
    statuses,
    statusTabs,
    classificationMap,
    visibleTickets,
    filtered,
    hasMore,
    loadMore,
    counts,
    deletingId,
    loadTickets,
    refreshTickets,
    handleStatusChange,
    handleDeleteTicket,
  };
}

function TicketStatusTabs({
  tabs,
  active,
  counts,
  onChange,
}: {
  tabs: Array<{ value: string; label: string }>;
  active: string;
  counts: Record<string, number>;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ResponsiveSectionTabs
      tabs={tabs.map((tab) => ({
        value: tab.value,
        label: tab.label,
        count: counts[tab.value] ?? 0,
        icon: TICKET_TAB_ICONS[tab.value] || 'circle_dot',
      }))}
      value={active}
      onChange={onChange}
      mobileTitle={t('ticketAdminPage.statusTitle')}
      countUnit={t('ticketAdminPage.countUnit')}
    />
  );
}

function TicketAdminToolbar({
  tabs,
  active,
  counts,
  onTabChange,
  searchInputProps,
  searchInputValue,
  onClearSearch,
}: {
  tabs: Array<{ value: string; label: string }>;
  active: string;
  counts: Record<string, number>;
  onTabChange: (value: string) => void;
  searchInputProps: SearchInputProps;
  searchInputValue: string;
  onClearSearch: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-10 min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <TicketStatusTabs tabs={tabs} active={active} counts={counts} onChange={onTabChange} />
      </div>
      <AdminSearchField
        inputProps={searchInputProps}
        value={searchInputValue}
        onClear={onClearSearch}
        placeholder={t('ticketAdminPage.searchPlaceholder')}
      />
    </div>
  );
}

function EmptyTickets() {
  const { t } = useTranslation();
  return (
    <AdminEmptyState
      icon="inbox"
      title={t('ticketAdminPage.emptyTitle')}
      description={t('ticketAdminPage.emptyDesc')}
    />
  );
}

function DesktopContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<Ticket | null>(null);
  const {
    user,
    loading,
    filter,
    setFilter,
    searchInputValue,
    setSearch,
    searchInputProps,
    statuses,
    statusTabs,
    classificationMap,
    visibleTickets,
    filtered,
    hasMore,
    loadMore,
    counts,
    deletingId,
    refreshTickets,
    handleStatusChange,
    handleDeleteTicket,
  } = useTicketAdminData();

  if (user?.role !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-on-surface-variant">{t('ticketAdminPage.noAccess')}</p>
      </div>
    );
  }

  return (
    <>
      <AdminManagementPage
        title={t('ticketAdminPage.title')}
        description={t('ticketAdminPage.description')}
        actions={<AdminRefreshButton onRefresh={refreshTickets} />}
        toolbar={
          <TicketAdminToolbar
            tabs={statusTabs}
            active={filter}
            counts={counts}
            onTabChange={setFilter}
            searchInputProps={searchInputProps}
            searchInputValue={searchInputValue}
            onClearSearch={() => setSearch('')}
          />
        }
      >
        <div key={filter} className="admin-tab-panel">
          {loading ? (
            <AdminLoadingState variant="list" label={t('ticketAdminPage.loadingLabel')} />
          ) : filtered.length === 0 ? (
            <EmptyTickets />
          ) : (
            <div className="overflow-auto max-h-[calc(100vh-260px)] space-y-2">
              {visibleTickets.map((ticket) => {
                const info = statusInfo(statuses, ticket.status);
                return (
                  <div
                    key={ticket.id}
                    onClick={() => navigate(`/admin/tickets/${ticket.id}`)}
                    className="group flex items-center gap-4 rounded-xl bg-surface-container-low border border-outline-variant/8 px-5 py-3.5 cursor-pointer transition-all hover:bg-surface-container-high/60 hover:border-outline-variant/15 hover:shadow-sm"
                  >
                    <span
                      className={`shrink-0 inline-flex items-center text-[11px] px-2.5 py-1 rounded-lg font-bold ${info.color || ''} ${info.bg || ''}`}
                    >
                      {t(`ticketStatus.${ticket.status}`, { defaultValue: info.label })}
                    </span>
                    <span className="shrink-0 text-xs text-on-surface-variant bg-surface-container-high/80 px-2 py-0.5 rounded-md">
                      {t(`ticketClassification.${ticket.classification}.label`, {
                        defaultValue: classificationMap.get(ticket.classification) || ticket.classification,
                      })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-on-surface truncate">{ticket.description}</p>
                      <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-on-surface-variant/70">
                        <span className="shrink-0">{ticket.user?.username || t('ticketAdminPage.unknownUser')}</span>
                        {ticket.basePart || ticket.sourceUrl ? (
                          <>
                            <span className="shrink-0">·</span>
                            <TicketSourceLink
                              basePart={ticket.basePart}
                              sourceUrl={ticket.sourceUrl}
                              className="min-w-0 text-[11px]"
                            />
                          </>
                        ) : null}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-on-surface-variant/50 tabular-nums">
                      {new Date(ticket.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                    <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {ticket.status !== 'in_progress' && ticket.status !== 'resolved' && (
                        <AdminButton
                          onClick={() => handleStatusChange(ticket.id, 'in_progress')}
                          size="sm"
                          variant="warning"
                        >
                          {t('ticketAdminPage.actionProcess')}
                        </AdminButton>
                      )}
                      {ticket.status === 'in_progress' && (
                        <AdminButton
                          onClick={() => handleStatusChange(ticket.id, 'resolved')}
                          size="sm"
                          variant="success"
                        >
                          {t('ticketAdminPage.actionResolve')}
                        </AdminButton>
                      )}
                      {ticket.status !== 'closed' && (
                        <AdminButton
                          onClick={() => handleStatusChange(ticket.id, 'closed')}
                          size="sm"
                          variant="secondary"
                        >
                          {t('ticketAdminPage.actionClose')}
                        </AdminButton>
                      )}
                      {ticket.status === 'closed' && (
                        <AdminButton onClick={() => handleStatusChange(ticket.id, 'open')} size="sm" variant="tonal">
                          {t('ticketAdminPage.actionReopen')}
                        </AdminButton>
                      )}
                      <AdminButton
                        onClick={() => setDeleteTarget(ticket)}
                        disabled={deletingId === ticket.id}
                        size="sm"
                        variant="danger"
                      >
                        {deletingId === ticket.id ? t('ticketAdminPage.deleting') : t('ticketAdminPage.deleteTicket')}
                      </AdminButton>
                      <span className="ml-0.5 text-on-surface-variant/30 group-hover:text-on-surface-variant/60 transition-colors">
                        <Icon name="chevron_right" size={16} />
                      </span>
                    </div>
                  </div>
                );
              })}
              <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
            </div>
          )}
        </div>
      </AdminManagementPage>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          const targetId = deleteTarget.id;
          setDeleteTarget(null);
          handleDeleteTicket(targetId);
        }}
        title={t('ticketAdminPage.confirmTitle')}
        description={t('ticketAdminPage.confirmDesc')}
        confirmLabel={t('ticketAdminPage.deleteTicket')}
      />
    </>
  );
}

function MobileContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<Ticket | null>(null);
  const {
    user,
    loading,
    filter,
    setFilter,
    searchInputValue,
    setSearch,
    searchInputProps,
    statuses,
    statusTabs,
    classificationMap,
    visibleTickets,
    filtered,
    hasMore,
    loadMore,
    counts,
    deletingId,
    refreshTickets,
    handleStatusChange,
    handleDeleteTicket,
  } = useTicketAdminData();

  if (user?.role !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-on-surface-variant">{t('ticketAdminPage.noAccess')}</p>
      </div>
    );
  }

  return (
    <>
      <AdminManagementPage
        title={t('ticketAdminPage.title')}
        description={t('ticketAdminPage.description')}
        actions={<AdminRefreshButton onRefresh={refreshTickets} mobileIconOnly />}
        toolbar={
          <TicketAdminToolbar
            tabs={statusTabs}
            active={filter}
            counts={counts}
            onTabChange={setFilter}
            searchInputProps={searchInputProps}
            searchInputValue={searchInputValue}
            onClearSearch={() => setSearch('')}
          />
        }
      >
        <div key={filter} className="admin-tab-panel">
          {loading ? (
            <AdminLoadingState variant="list" rows={5} label={t('ticketAdminPage.loadingLabel')} />
          ) : filtered.length === 0 ? (
            <EmptyTickets />
          ) : (
            <div className="flex flex-col gap-2.5">
              {visibleTickets.map((ticket) => {
                const info = statusInfo(statuses, ticket.status);
                return (
                  <div
                    key={ticket.id}
                    className="bg-surface-container-low rounded-xl border border-outline-variant/8 overflow-hidden active:bg-surface-container-high/60 transition-all"
                  >
                    <div
                      onClick={() => navigate(`/admin/tickets/${ticket.id}`)}
                      className="cursor-pointer px-3.5 pt-3 pb-2"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${info.color || ''} ${info.bg || ''}`}
                        >
                          {t(`ticketStatus.${ticket.status}`, { defaultValue: info.label })}
                        </span>
                        <span className="text-[10px] text-on-surface-variant bg-surface-container-highest/80 px-2 py-0.5 rounded-md">
                          {t(`ticketClassification.${ticket.classification}.label`, {
                            defaultValue: classificationMap.get(ticket.classification) || ticket.classification,
                          })}
                        </span>
                        <span className="text-[10px] text-on-surface-variant/50 ml-auto tabular-nums">
                          {new Date(ticket.createdAt).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                      <p className="text-sm text-on-surface mb-1.5 line-clamp-2 break-words leading-relaxed">
                        {ticket.description}
                      </p>
                      <div className="flex items-center justify-between gap-2 text-xs text-on-surface-variant/60">
                        <span className="truncate">{ticket.user?.username || t('ticketAdminPage.unknownUser')}</span>
                        <Icon name="chevron_right" size={14} className="shrink-0 text-on-surface-variant/30" />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-outline-variant/8 px-3.5 py-2">
                      {ticket.status !== 'in_progress' && ticket.status !== 'resolved' && (
                        <AdminButton
                          onClick={() => handleStatusChange(ticket.id, 'in_progress')}
                          size="sm"
                          variant="warning"
                        >
                          {t('ticketAdminPage.actionProcessLong')}
                        </AdminButton>
                      )}
                      {ticket.status === 'in_progress' && (
                        <AdminButton
                          onClick={() => handleStatusChange(ticket.id, 'resolved')}
                          size="sm"
                          variant="success"
                        >
                          {t('ticketAdminPage.actionResolveLong')}
                        </AdminButton>
                      )}
                      {ticket.status !== 'closed' ? (
                        <AdminButton
                          onClick={() => handleStatusChange(ticket.id, 'closed')}
                          size="sm"
                          variant="secondary"
                        >
                          {t('ticketAdminPage.actionClose')}
                        </AdminButton>
                      ) : (
                        <AdminButton onClick={() => handleStatusChange(ticket.id, 'open')} size="sm" variant="tonal">
                          {t('ticketAdminPage.actionReopenLong')}
                        </AdminButton>
                      )}
                      <AdminButton
                        onClick={() => setDeleteTarget(ticket)}
                        disabled={deletingId === ticket.id}
                        size="sm"
                        variant="danger"
                      >
                        {deletingId === ticket.id ? t('ticketAdminPage.deleting') : t('ticketAdminPage.deleteTicket')}
                      </AdminButton>
                    </div>
                  </div>
                );
              })}
              <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
            </div>
          )}
        </div>
      </AdminManagementPage>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          const targetId = deleteTarget.id;
          setDeleteTarget(null);
          handleDeleteTicket(targetId);
        }}
        title={t('ticketAdminPage.confirmTitle')}
        description={t('ticketAdminPage.confirmDesc')}
        confirmLabel={t('ticketAdminPage.deleteTicket')}
      />
    </>
  );
}

export default function TicketAdminPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('ticketAdminPage.title'));
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
