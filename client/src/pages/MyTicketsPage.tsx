import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import useSWR from 'swr';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { SkeletonList } from '../components/shared/Skeleton';
import TopNav from '../components/shared/TopNav';
import BottomNav from '../components/shared/BottomNav';
import AppSidebar from '../components/shared/Sidebar';
import MobileNavDrawer from '../components/shared/MobileNavDrawer';
import Icon from '../components/shared/Icon';
import client from '../api/client';

interface MyTicket {
  id: string;
  basePart: string | null;
  classification: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: '待处理', color: 'text-primary-container', bg: 'bg-primary-container/10' },
  waiting_user: { label: '待回复', color: 'text-amber-600', bg: 'bg-amber-500/10' },
  in_progress: { label: '处理中', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  resolved: { label: '已解决', color: 'text-green-500', bg: 'bg-green-500/10' },
  closed: { label: '已关闭', color: 'text-on-surface-variant', bg: 'bg-surface-container-highest' },
};

const CLASSIFICATION_MAP: Record<string, string> = {
  dimension: '尺寸修改',
  material: '材料变更',
  novel: '新零件设计',
  topology: '拓扑错误报告',
  process: '工艺问题',
  other: '其他',
};

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
  const navigate = useNavigate();

  const list = tickets || [];

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface uppercase">我的工单</h2>
          <p className="text-sm text-on-surface-variant mt-1">{list.length} 条记录</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => mutate()} className="flex items-center gap-2 px-4 py-2.5 text-sm text-on-surface-variant hover:text-on-surface border border-outline-variant/20 rounded-lg transition-colors">
            <Icon name="refresh" size={16} />刷新
          </button>
          <Link to="/support" className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90">
            <Icon name="add" size={16} />新建工单
          </Link>
        </div>
      </div>

      {isLoading ? (
        <SkeletonList rows={4} />
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Icon name="inbox" size={48} className="text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">暂无工单记录</p>
          <Link to="/support" className="bg-primary-container text-on-primary px-6 py-2.5 rounded-lg text-sm font-medium hover:opacity-90">
            提交工单
          </Link>
        </div>
      ) : (
        <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[120px_120px_1fr_140px_160px] gap-4 px-6 py-3 bg-surface-container-high text-xs uppercase tracking-wider text-on-surface-variant font-bold border-b border-outline-variant/10">
            <span>状态</span>
            <span>分类</span>
            <span>描述</span>
            <span>基础零件</span>
            <span>时间</span>
          </div>
          {/* Table rows */}
          {list.map((ticket) => {
            const statusInfo = STATUS_MAP[ticket.status] || STATUS_MAP.open;
            return (
              <div key={ticket.id} onClick={() => navigate(`/my-tickets/${ticket.id}`)} className="grid grid-cols-[120px_120px_1fr_140px_160px] gap-4 px-6 py-4 border-b border-outline-variant/5 hover:bg-surface-container-high/50 transition-colors items-center cursor-pointer">
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-bold w-fit ${statusInfo.color} ${statusInfo.bg}`}>
                  <Icon name={ticket.status === 'resolved' ? 'check_circle' : ticket.status === 'in_progress' ? 'build' : ticket.status === 'waiting_user' ? 'chat' : 'schedule'} size={12} />
                  {statusInfo.label}
                </span>
                <span className="text-xs text-on-surface-variant">
                  {CLASSIFICATION_MAP[ticket.classification] || ticket.classification}
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
        </div>
      )}
    </>
  );
}

function MobileContent() {
  const { data: tickets, isLoading, mutate } = useMyTickets();
  const navigate = useNavigate();

  const list = tickets || [];

  return (
    <div className="px-4 py-5 pb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-on-surface">我的工单</h1>
          <p className="text-xs text-on-surface-variant mt-0.5">{list.length} 条记录</p>
        </div>
        <Link to="/support" className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-on-primary bg-primary-container rounded-lg">
          <Icon name="add" size={14} />新建
        </Link>
      </div>

      {isLoading ? (
        <SkeletonList rows={4} />
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Icon name="inbox" size={64} className="text-on-surface-variant/20" />
          <p className="text-on-surface-variant text-sm">暂无工单记录</p>
          <Link to="/support" className="bg-primary-container text-on-primary px-6 py-2.5 rounded-sm text-sm font-bold uppercase tracking-wider hover:opacity-90 transition-opacity">提交工单</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.map((ticket) => {
            const statusInfo = STATUS_MAP[ticket.status] || STATUS_MAP.open;
            return (
              <div key={ticket.id} onClick={() => navigate(`/my-tickets/${ticket.id}`)} className="bg-surface-container-high rounded-lg p-3.5 cursor-pointer active:bg-surface-container-highest transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-sm font-bold ${statusInfo.color} ${statusInfo.bg}`}>
                    {statusInfo.label}
                  </span>
                  <span className="text-[10px] text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded-sm">
                    {CLASSIFICATION_MAP[ticket.classification] || ticket.classification}
                  </span>
                </div>
                <p className="text-sm text-on-surface whitespace-pre-wrap mb-2 line-clamp-3">{ticket.description}</p>
                <div className="flex items-center gap-3 text-[11px] text-on-surface-variant">
                  {ticket.basePart && <span>零件: {ticket.basePart}</span>}
                  <span className="flex items-center gap-1">
                    <Icon name="schedule" size={11} />
                    {new Date(ticket.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MyTicketsPage() {
  useDocumentTitle('我的工单');
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [navOpen, setNavOpen] = useState(false);

  if (isDesktop) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto p-8 scrollbar-hidden bg-surface-dim">
            <Content />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen((prev) => !prev)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="flex-1 overflow-y-auto scrollbar-hidden bg-surface-dim">
        <MobileContent />
      </main>
      <BottomNav />
    </div>
  );
}
