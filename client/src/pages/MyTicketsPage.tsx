import { Link, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { SkeletonList } from '../components/shared/Skeleton';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import { AdminPageShell } from "../components/shared/AdminPageShell";
import { AdminEmptyState, AdminManagementPage } from "../components/shared/AdminManagementPage";
import client from '../api/client';
import { getCachedPublicSettings } from '../lib/publicSettings';
import { getBusinessConfig, statusInfo } from '../lib/businessConfig';
import { useVisibleItems } from '../hooks/useVisibleItems';

interface MyTicket {
  id: string;
  basePart: string | null;
  classification: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function useMyTickets() {
  return useSWR<MyTicket[]>('/my-tickets', () =>
    client.get('/my-tickets').then((r) => {
      const d = r.data;
      if (Array.isArray(d)) return d;
      if (d?.data && Array.isArray(d.data)) return d.data;
      return [];
    }).catch(() => [])
  );
}

function Content() {
  const { data: tickets, isLoading, mutate } = useMyTickets();
  const { data: settings } = useSWR("publicSettings", () => getCachedPublicSettings());
  const business = getBusinessConfig(settings);
  const classificationMap = new Map(business.ticketClassifications.map((item) => [item.value, item.label]));
  const navigate = useNavigate();

  const list = tickets || [];
  const { visibleItems: visibleTickets, hasMore, loadMore } = useVisibleItems(list, 60, String(list.length));

  return (
    <AdminManagementPage
      title="我的工单"
      meta={`${list.length} 条记录`}
      description="查看你提交的技术支持工单和处理状态"
      actions={list.length > 0 ? (
          <>
            <button onClick={() => mutate()} className="flex items-center gap-2 rounded-lg border border-outline-variant/20 px-4 py-2.5 text-sm text-on-surface-variant transition-colors hover:text-on-surface">
              <Icon name="refresh" size={16} />刷新
            </button>
            <Link to="/support" className="flex items-center gap-2 rounded-lg bg-primary-container px-5 py-2.5 text-sm font-medium text-on-primary hover:opacity-90">
              <Icon name="add" size={16} />新建工单
            </Link>
          </>
      ) : null}
    >

      {isLoading ? (
        <SkeletonList rows={4} />
      ) : list.length === 0 ? (
        <AdminEmptyState
          icon="inbox"
          title="暂无工单记录"
          description="提交技术支持工单后，可以在这里跟进处理状态。"
          action={<Link to="/support" className="rounded-md bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90">提交工单</Link>}
        />
      ) : (
        <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-auto">
          {/* Table header */}
          <div className="grid grid-cols-[120px_120px_1fr_140px_160px] gap-4 px-6 py-3 bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant font-bold border-b border-outline-variant/10 sticky top-0 z-10">
            <span>状态</span>
            <span>分类</span>
            <span>描述</span>
            <span>基础零件</span>
            <span>时间</span>
          </div>
          {/* Table rows */}
          {visibleTickets.map((ticket) => {
            const info = statusInfo(business.ticketStatuses, ticket.status);
            return (
              <div key={ticket.id} onClick={() => navigate(`/my-tickets/${ticket.id}`)} className="grid grid-cols-[120px_120px_1fr_140px_160px] gap-4 px-6 py-4 border-b border-outline-variant/5 hover:bg-surface-container-high/50 transition-colors items-center cursor-pointer">
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-bold w-fit ${info.color || ""} ${info.bg || ""}`}>
                  <Icon name={ticket.status === 'resolved' ? 'check_circle' : ticket.status === 'in_progress' ? 'build' : ticket.status === 'waiting_user' ? 'chat' : 'schedule'} size={12} />
                  {info.label}
                </span>
                <span className="text-xs text-on-surface-variant">
                  {classificationMap.get(ticket.classification) || ticket.classification}
                </span>
                <p className="text-sm text-on-surface truncate">{ticket.description}</p>
                <span className="text-xs text-on-surface-variant truncate">{ticket.basePart || '—'}</span>
                <span className="text-xs text-on-surface-variant flex items-center gap-1">
                  <Icon name="schedule" size={12} className="shrink-0" />
                  {new Date(ticket.createdAt).toLocaleDateString('zh-CN')}
                </span>
              </div>
            );
          })}
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
        </div>
      )}
    </AdminManagementPage>
  );
}

function MobileContent() {
  const { data: tickets, isLoading } = useMyTickets();
  const { data: settings } = useSWR("publicSettings", () => getCachedPublicSettings());
  const business = getBusinessConfig(settings);
  const classificationMap = new Map(business.ticketClassifications.map((item) => [item.value, item.label]));
  const navigate = useNavigate();

  const list = tickets || [];
  const { visibleItems: visibleTickets, hasMore, loadMore } = useVisibleItems(list, 40, String(list.length));

  return (
    <AdminManagementPage
      title="我的工单"
      description="查看你提交的技术支持工单和处理状态"
      actions={list.length > 0 ? (
        <Link to="/support" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary-container px-3 text-xs font-medium text-on-primary">
          <Icon name="add" size={14} />新建
        </Link>
      ) : null}
    >

      {isLoading ? (
        <SkeletonList rows={4} />
      ) : list.length === 0 ? (
        <AdminEmptyState
          icon="inbox"
          title="暂无工单记录"
          description="提交技术支持工单后，可以在这里跟进处理状态。"
          action={<Link to="/support" className="rounded-md bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90">提交工单</Link>}
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {visibleTickets.map((ticket) => {
            const info = statusInfo(business.ticketStatuses, ticket.status);
            return (
              <div key={ticket.id} onClick={() => navigate(`/my-tickets/${ticket.id}`)} className="bg-surface-container-high rounded-lg p-3.5 cursor-pointer active:bg-surface-container-highest transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-sm font-bold ${info.color || ""} ${info.bg || ""}`}>
                    {info.label}
                  </span>
                  <span className="text-[10px] text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded-sm">
                    {classificationMap.get(ticket.classification) || ticket.classification}
                  </span>
                </div>
                <p className="text-sm text-on-surface whitespace-pre-wrap break-words mb-2 line-clamp-3">{ticket.description}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-on-surface-variant">
                  {ticket.basePart && <span className="break-all">零件: {ticket.basePart}</span>}
                  <span className="flex items-center gap-1 shrink-0">
                    <Icon name="schedule" size={11} />
                    {new Date(ticket.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </div>
            );
          })}
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
        </div>
      )}
    </AdminManagementPage>
  );
}

export default function MyTicketsPage() {
  useDocumentTitle('我的工单');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return (
    <AdminPageShell>
      {isDesktop ? <Content /> : <MobileContent />}
    </AdminPageShell>
  );
}
