import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { getTickets, updateTicketStatus, type Ticket } from '../api/tickets';
import { AdminEmptyState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import { SkeletonList } from '../components/shared/Skeleton';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useVisibleItems } from '../hooks/useVisibleItems';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getBusinessConfig, statusInfo } from '../lib/businessConfig';
import { getCachedPublicSettings } from '../lib/publicSettings';
import { useAuthStore } from '../stores/useAuthStore';

function useTicketAdminData() {
  const { user } = useAuthStore();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
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

  async function loadTickets() {
    setLoading(true);
    try {
      const data = await getTickets();
      setTickets(data);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
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

  const filtered = filter === 'all' ? tickets : tickets.filter((t) => t.status === filter);
  const {
    visibleItems: visibleTickets,
    hasMore,
    loadMore,
  } = useVisibleItems(filtered, 60, `${filter}:${tickets.length}`);
  const counts: Record<string, number> = { all: tickets.length };
  for (const status of statuses.filter((s) => s.tab))
    counts[status.value] = tickets.filter((t) => t.status === status.value).length;

  return {
    user,
    loading,
    filter,
    setFilter,
    statuses,
    statusTabs,
    classificationMap,
    visibleTickets,
    filtered,
    hasMore,
    loadMore,
    counts,
    loadTickets,
    handleStatusChange,
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
        icon: tab.value === 'all' ? 'format_list_bulleted' : 'radio_button_checked',
      }))}
      value={active}
      onChange={onChange}
      mobileTitle="工单状态"
      countUnit="单"
    />
  );
}

function EmptyTickets() {
  return <AdminEmptyState icon="inbox" title="暂无工单" description="切换状态或等待用户提交新的技术支持工单。" />;
}

function DesktopContent() {
  const navigate = useNavigate();
  const {
    user,
    loading,
    filter,
    setFilter,
    statuses,
    statusTabs,
    classificationMap,
    visibleTickets,
    filtered,
    hasMore,
    loadMore,
    counts,
    loadTickets,
    handleStatusChange,
  } = useTicketAdminData();

  if (user?.role !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-on-surface-variant">无访问权限</p>
      </div>
    );
  }

  return (
    <AdminManagementPage
      title="工单处理"
      description="管理用户提交的模型需求工单"
      actions={
        <button
          onClick={loadTickets}
          className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container-high px-3.5 py-2 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface active:scale-[0.97]"
        >
          <Icon name="refresh" size={15} />
          刷新
        </button>
      }
      toolbar={<TicketStatusTabs tabs={statusTabs} active={filter} counts={counts} onChange={setFilter} />}
    >
      <div key={filter} className="admin-tab-panel">
        {loading ? (
          <SkeletonList rows={5} />
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
  );
}

function MobileContent() {
  const navigate = useNavigate();
  const {
    user,
    loading,
    filter,
    setFilter,
    statuses,
    statusTabs,
    classificationMap,
    visibleTickets,
    filtered,
    hasMore,
    loadMore,
    counts,
    loadTickets,
    handleStatusChange,
  } = useTicketAdminData();

  if (user?.role !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-on-surface-variant">无访问权限</p>
      </div>
    );
  }

  return (
    <AdminManagementPage
      title="工单处理"
      description="管理用户提交的模型需求工单"
      actions={
        <button
          onClick={loadTickets}
          className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container-high px-3 py-2 text-xs font-medium text-on-surface-variant active:scale-[0.97] transition-all"
        >
          <Icon name="refresh" size={14} />
          刷新
        </button>
      }
      toolbar={<TicketStatusTabs tabs={statusTabs} active={filter} counts={counts} onChange={setFilter} />}
    >
      <div key={filter} className="admin-tab-panel">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-surface-container-high rounded-xl animate-pulse" />
            ))}
          </div>
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
                  <div className="flex items-center gap-1.5 border-t border-outline-variant/8 px-3.5 py-2">
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
                  </div>
                </div>
              );
            })}
            <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
          </div>
        )}
      </div>
    </AdminManagementPage>
  );
}

export default function TicketAdminPage() {
  useDocumentTitle('工单处理');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
