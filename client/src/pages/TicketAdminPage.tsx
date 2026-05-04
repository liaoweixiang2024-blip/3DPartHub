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
          className="inline-flex items-center gap-1.5 rounded-md border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container"
        >
          <Icon name="refresh" size={16} />
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
          <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-auto max-h-[calc(100vh-260px)]">
            <div className="grid grid-cols-[90px_110px_minmax(0,1fr)_140px_130px_170px] gap-4 px-6 py-3 bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant font-bold border-b border-outline-variant/10 sticky top-0 z-10">
              <span>状态</span>
              <span>分类</span>
              <span>用户 / 描述</span>
              <span>基础零件</span>
              <span>时间</span>
              <span className="text-right">操作</span>
            </div>
            {visibleTickets.map((ticket) => {
              const info = statusInfo(statuses, ticket.status);
              return (
                <div
                  key={ticket.id}
                  className="grid grid-cols-[90px_110px_minmax(0,1fr)_140px_130px_170px] gap-4 px-6 py-4 border-b border-outline-variant/5 hover:bg-surface-container-high/50 transition-colors items-center"
                >
                  <span
                    className={`inline-flex w-fit items-center text-xs px-2 py-0.5 rounded-md font-bold ${info.color || ''} ${info.bg || ''}`}
                  >
                    {info.label}
                  </span>
                  <span className="text-xs text-on-surface-variant truncate">
                    {classificationMap.get(ticket.classification) || ticket.classification}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-on-surface truncate">{ticket.description}</p>
                    <p className="text-xs text-on-surface-variant">{ticket.user?.username || '未知用户'}</p>
                  </div>
                  <span className="text-xs text-on-surface-variant truncate">{ticket.basePart || '—'}</span>
                  <span className="text-xs text-on-surface-variant">
                    {new Date(ticket.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    <button
                      onClick={() => navigate(`/admin/tickets/${ticket.id}`)}
                      className="text-xs text-primary-container hover:underline"
                    >
                      详情
                    </button>
                    {ticket.status !== 'in_progress' && ticket.status !== 'resolved' && (
                      <button
                        onClick={() => handleStatusChange(ticket.id, 'in_progress')}
                        className="text-xs text-blue-500 hover:underline"
                      >
                        处理
                      </button>
                    )}
                    {ticket.status === 'in_progress' && (
                      <button
                        onClick={() => handleStatusChange(ticket.id, 'resolved')}
                        className="text-xs text-green-500 hover:underline"
                      >
                        解决
                      </button>
                    )}
                    {ticket.status !== 'closed' && (
                      <button
                        onClick={() => handleStatusChange(ticket.id, 'closed')}
                        className="text-xs text-on-surface-variant hover:underline"
                      >
                        关闭
                      </button>
                    )}
                    {ticket.status === 'closed' && (
                      <button
                        onClick={() => handleStatusChange(ticket.id, 'open')}
                        className="text-xs text-primary-container hover:underline"
                      >
                        重开
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
          className="inline-flex items-center gap-1.5 rounded-md border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-xs font-medium text-on-surface"
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
              <div key={i} className="h-20 bg-surface-container-high rounded-lg animate-pulse" />
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
                  className="bg-surface-container-high rounded-lg p-3.5 active:bg-surface-container-highest transition-colors"
                >
                  <div onClick={() => navigate(`/admin/tickets/${ticket.id}`)} className="cursor-pointer">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-sm font-bold ${info.color || ''} ${info.bg || ''}`}
                      >
                        {info.label}
                      </span>
                      <span className="text-[10px] text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded-sm">
                        {classificationMap.get(ticket.classification) || ticket.classification}
                      </span>
                      <span className="text-[10px] text-on-surface-variant">
                        {new Date(ticket.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    <p className="text-sm text-on-surface mb-1 line-clamp-2 break-words">{ticket.description}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
                      <span className="min-w-0 break-words">{ticket.user?.username || '未知用户'}</span>
                      <span>查看详情</span>
                    </div>
                    {ticket.basePart && (
                      <p className="mt-1 text-[11px] text-on-surface-variant break-all">基准零件：{ticket.basePart}</p>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-outline-variant/10 pt-3">
                    {ticket.status !== 'in_progress' && ticket.status !== 'resolved' && (
                      <button
                        onClick={() => handleStatusChange(ticket.id, 'in_progress')}
                        className="px-2.5 py-1 text-xs text-blue-500 border border-blue-500/30 rounded-sm"
                      >
                        开始处理
                      </button>
                    )}
                    {ticket.status === 'in_progress' && (
                      <button
                        onClick={() => handleStatusChange(ticket.id, 'resolved')}
                        className="px-2.5 py-1 text-xs text-green-500 border border-green-500/30 rounded-sm"
                      >
                        标记解决
                      </button>
                    )}
                    {ticket.status !== 'closed' ? (
                      <button
                        onClick={() => handleStatusChange(ticket.id, 'closed')}
                        className="px-2.5 py-1 text-xs text-on-surface-variant border border-outline-variant/20 rounded-sm"
                      >
                        关闭
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStatusChange(ticket.id, 'open')}
                        className="px-2.5 py-1 text-xs text-primary-container border border-primary-container/30 rounded-sm"
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
