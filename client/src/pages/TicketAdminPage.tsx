import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteTicket, getTickets, updateTicketStatus, type Ticket } from '../api/tickets';
import { AdminEmptyState, AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SearchField from '../components/shared/SearchField';
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
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { settings } = usePublicSettings();
  const business = getBusinessConfig(settings);
  const statuses = business.ticketStatuses;
  const statusTabs = [
    { value: 'all', label: '全部' },
    ...statuses.filter((s) => s.tab).map((s) => ({ value: s.value, label: s.label })),
  ];
  const classificationMap = new Map(business.ticketClassifications.map((item) => [item.value, item.label]));

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
    setRefreshing(true);
    try {
      const data = await getTickets();
      setTickets(data);
      toast('工单数据已刷新', 'success');
    } catch (err) {
      toast(getErrorMessage(err, '刷新工单失败'), 'error');
    } finally {
      setRefreshing(false);
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
      toast('工单已删除', 'success');
    } catch (err) {
      toast(getErrorMessage(err, '删除工单失败'), 'error');
    } finally {
      setDeletingId(null);
    }
  }

  const searchText = normalizeSearchValue(search);
  const searchedTickets = tickets.filter((ticket) =>
    ticketMatchesSearch(ticket, searchText, classificationMap, statuses),
  );
  const filtered = filter === 'all' ? searchedTickets : searchedTickets.filter((t) => t.status === filter);
  const {
    visibleItems: visibleTickets,
    hasMore,
    loadMore,
  } = useVisibleItems(filtered, 60, `${filter}:${searchText}:${tickets.length}`);
  const counts: Record<string, number> = { all: searchedTickets.length };
  for (const status of statuses.filter((s) => s.tab))
    counts[status.value] = searchedTickets.filter((t) => t.status === status.value).length;

  return {
    user,
    loading,
    refreshing,
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
      mobileTitle="工单状态"
      countUnit="单"
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
  return (
    <div className="flex min-h-10 min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <TicketStatusTabs tabs={tabs} active={active} counts={counts} onChange={onTabChange} />
      </div>
      <AdminSearchField
        inputProps={searchInputProps}
        value={searchInputValue}
        onClear={onClearSearch}
        placeholder="搜索工单、用户、基准零件"
      />
    </div>
  );
}

function EmptyTickets() {
  return <AdminEmptyState icon="inbox" title="暂无工单" description="切换状态或等待用户提交新的技术支持工单。" />;
}

function DesktopContent() {
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<Ticket | null>(null);
  const {
    user,
    loading,
    refreshing,
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
        <p className="text-on-surface-variant">无访问权限</p>
      </div>
    );
  }

  return (
    <>
      <AdminManagementPage
        title="工单处理"
        description="管理用户提交的模型需求工单"
        actions={
          <button
            onClick={refreshTickets}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-outline-variant/20 px-4 py-2.5 text-sm text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50"
          >
            <Icon name="refresh" size={16} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? '刷新中...' : '刷新'}
          </button>
        }
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
            <AdminLoadingState variant="list" label="工单加载中" />
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
                      {info.label}
                    </span>
                    <span className="shrink-0 text-xs text-on-surface-variant bg-surface-container-high/80 px-2 py-0.5 rounded-md">
                      {classificationMap.get(ticket.classification) || ticket.classification}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-on-surface truncate">{ticket.description}</p>
                      <p className="text-[11px] text-on-surface-variant/70 mt-0.5">
                        {ticket.user?.username || '未知用户'}
                        {ticket.basePart ? ` · ${ticket.basePart}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-on-surface-variant/50 tabular-nums">
                      {new Date(ticket.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                    <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {ticket.status !== 'in_progress' && ticket.status !== 'resolved' && (
                        <button
                          onClick={() => handleStatusChange(ticket.id, 'in_progress')}
                          className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-blue-600 bg-blue-500/10 hover:bg-blue-500/20 active:scale-[0.96] transition-all"
                        >
                          处理
                        </button>
                      )}
                      {ticket.status === 'in_progress' && (
                        <button
                          onClick={() => handleStatusChange(ticket.id, 'resolved')}
                          className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/20 active:scale-[0.96] transition-all"
                        >
                          解决
                        </button>
                      )}
                      {ticket.status !== 'closed' && (
                        <button
                          onClick={() => handleStatusChange(ticket.id, 'closed')}
                          className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-on-surface-variant bg-surface-container-highest/70 hover:bg-surface-container-highest active:scale-[0.96] transition-all"
                        >
                          关闭
                        </button>
                      )}
                      {ticket.status === 'closed' && (
                        <button
                          onClick={() => handleStatusChange(ticket.id, 'open')}
                          className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-primary-container bg-primary-container/10 hover:bg-primary-container/20 active:scale-[0.96] transition-all"
                        >
                          重开
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(ticket)}
                        disabled={deletingId === ticket.id}
                        className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-error bg-error/10 hover:bg-error/15 active:scale-[0.96] transition-all disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingId === ticket.id ? '删除中' : '删除工单'}
                      </button>
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
        title="确认删除工单"
        description="删除后工单、回复记录和附件将不可恢复。"
        confirmLabel="删除工单"
      />
    </>
  );
}

function MobileContent() {
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<Ticket | null>(null);
  const {
    user,
    loading,
    refreshing,
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
        <p className="text-on-surface-variant">无访问权限</p>
      </div>
    );
  }

  return (
    <>
      <AdminManagementPage
        title="工单处理"
        description="管理用户提交的模型需求工单"
        actions={
          <button
            onClick={refreshTickets}
            disabled={refreshing}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant/20 px-3 text-xs text-on-surface-variant disabled:opacity-50"
            aria-label="刷新"
          >
            <Icon name="refresh" size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        }
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
            <AdminLoadingState variant="list" rows={5} label="工单加载中" />
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
                          {info.label}
                        </span>
                        <span className="text-[10px] text-on-surface-variant bg-surface-container-highest/80 px-2 py-0.5 rounded-md">
                          {classificationMap.get(ticket.classification) || ticket.classification}
                        </span>
                        <span className="text-[10px] text-on-surface-variant/50 ml-auto tabular-nums">
                          {new Date(ticket.createdAt).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                      <p className="text-sm text-on-surface mb-1.5 line-clamp-2 break-words leading-relaxed">
                        {ticket.description}
                      </p>
                      <div className="flex items-center justify-between gap-2 text-xs text-on-surface-variant/60">
                        <span className="truncate">{ticket.user?.username || '未知用户'}</span>
                        <Icon name="chevron_right" size={14} className="shrink-0 text-on-surface-variant/30" />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-outline-variant/8 px-3.5 py-2">
                      {ticket.status !== 'in_progress' && ticket.status !== 'resolved' && (
                        <button
                          onClick={() => handleStatusChange(ticket.id, 'in_progress')}
                          className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-blue-600 bg-blue-500/10 active:scale-[0.96] transition-all"
                        >
                          开始处理
                        </button>
                      )}
                      {ticket.status === 'in_progress' && (
                        <button
                          onClick={() => handleStatusChange(ticket.id, 'resolved')}
                          className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-emerald-600 bg-emerald-500/10 active:scale-[0.96] transition-all"
                        >
                          标记解决
                        </button>
                      )}
                      {ticket.status !== 'closed' ? (
                        <button
                          onClick={() => handleStatusChange(ticket.id, 'closed')}
                          className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-on-surface-variant bg-surface-container-highest/70 active:scale-[0.96] transition-all"
                        >
                          关闭
                        </button>
                      ) : (
                        <button
                          onClick={() => handleStatusChange(ticket.id, 'open')}
                          className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-primary-container bg-primary-container/10 active:scale-[0.96] transition-all"
                        >
                          重新打开
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(ticket)}
                        disabled={deletingId === ticket.id}
                        className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-error bg-error/10 active:scale-[0.96] transition-all disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingId === ticket.id ? '删除中' : '删除工单'}
                      </button>
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
        title="确认删除工单"
        description="删除后工单、回复记录和附件将不可恢复。"
        confirmLabel="删除工单"
      />
    </>
  );
}

export default function TicketAdminPage() {
  useDocumentTitle('工单处理');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
