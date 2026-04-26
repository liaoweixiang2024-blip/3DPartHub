import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { SkeletonList } from '../components/shared/Skeleton';
import TopNav from '../components/shared/TopNav';
import BottomNav from '../components/shared/BottomNav';
import AppSidebar from '../components/shared/Sidebar';
import MobileNavDrawer from '../components/shared/MobileNavDrawer';
import Icon from '../components/shared/Icon';
import { useAuthStore } from '../stores/useAuthStore';
import { getTickets, updateTicketStatus, type Ticket } from '../api/tickets';
import useSWR from 'swr';
import { getCachedPublicSettings } from '../lib/publicSettings';
import { getBusinessConfig, statusInfo } from '../lib/businessConfig';

function Content() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const { data: settings } = useSWR("publicSettings", () => getCachedPublicSettings());
  const business = getBusinessConfig(settings);
  const statuses = business.ticketStatuses;
  const statusTabs = statuses.filter((s) => s.tab);
  const classificationMap = new Map(business.ticketClassifications.map((item) => [item.value, item.label]));

  useEffect(() => { loadTickets(); }, []);

  async function loadTickets() {
    setLoading(true);
    try { const data = await getTickets(); setTickets(data); } catch { setTickets([]); } finally { setLoading(false); }
  }

  async function handleStatusChange(id: string, status: string) {
    try { await updateTicketStatus(id, status); setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t))); } catch { /* ignore */ }
  }

  const filtered = filter === "all" ? tickets : tickets.filter((t) => t.status === filter);
  const counts: Record<string, number> = { all: tickets.length };
  for (const status of statusTabs) counts[status.value] = tickets.filter((t) => t.status === status.value).length;

  if (user?.role !== "ADMIN") {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-on-surface-variant">无访问权限</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h2 className="font-headline text-lg md:text-2xl font-bold tracking-tight text-on-surface uppercase">工单管理</h2>
          <p className="text-sm text-on-surface-variant mt-1">管理用户提交的模型需求工单</p>
        </div>
        <button onClick={loadTickets} className="flex items-center justify-center gap-2 px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface border border-outline-variant/20 rounded-sm transition-colors w-full sm:w-auto">
          <Icon name="refresh" size={16} />刷新
        </button>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {[{ value: "all", label: "全部" }, ...statusTabs].map((s) => (
          <button
            key={s.value}
            onClick={() => setFilter(s.value)}
            className={`px-3 py-1.5 text-xs rounded-sm transition-colors ${filter === s.value ? "bg-primary-container text-on-primary font-bold" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}
          >
            {s.label} ({counts[s.value] ?? 0})
          </button>
        ))}
      </div>

      {loading && (
        <SkeletonList rows={5} />
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Icon name="inbox" size={48} className="text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">暂无工单</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="flex flex-col gap-3">
          {filtered.map((ticket) => {
            const info = statusInfo(statuses, ticket.status);
            return (
              <div key={ticket.id} className="bg-surface-container-low border border-outline-variant/15 rounded-sm p-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-sm font-bold ${info.color || ""} ${info.bg || ""}`}>{info.label}</span>
                      <span className="text-[10px] text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded-sm">{classificationMap.get(ticket.classification) || ticket.classification}</span>
                    </div>
                    <p className="text-sm text-on-surface whitespace-pre-wrap break-words mb-2">{ticket.description}</p>
                    {ticket.basePart && <p className="text-xs text-on-surface-variant break-all">基准零件: {ticket.basePart}</p>}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-on-surface-variant">
                      <span className="flex items-center gap-1 min-w-0"><Icon name="person" size={12} className="shrink-0" /><span className="truncate">{ticket.user?.username || "未知用户"}</span></span>
                      <span className="flex items-center gap-1 shrink-0"><Icon name="schedule" size={12} />{new Date(ticket.createdAt).toLocaleString("zh-CN")}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 shrink-0">
                    <button onClick={() => navigate(`/admin/tickets/${ticket.id}`)} className="px-2.5 py-1 text-xs text-primary border border-primary/30 rounded-sm hover:bg-primary/10 transition-colors">查看详情</button>
                    {ticket.status !== "in_progress" && ticket.status !== "resolved" && (
                      <button onClick={() => handleStatusChange(ticket.id, "in_progress")} className="px-2.5 py-1 text-xs text-blue-500 border border-blue-500/30 rounded-sm hover:bg-blue-500/10 transition-colors">开始处理</button>
                    )}
                    {ticket.status === "in_progress" && (
                      <button onClick={() => handleStatusChange(ticket.id, "resolved")} className="px-2.5 py-1 text-xs text-green-500 border border-green-500/30 rounded-sm hover:bg-green-500/10 transition-colors">标记解决</button>
                    )}
                    {ticket.status !== "closed" && (
                      <button onClick={() => handleStatusChange(ticket.id, "closed")} className="px-2.5 py-1 text-xs text-on-surface-variant border border-outline-variant/20 rounded-sm hover:bg-surface-container-highest transition-colors">关闭</button>
                    )}
                    {ticket.status === "closed" && (
                      <button onClick={() => handleStatusChange(ticket.id, "open")} className="px-2.5 py-1 text-xs text-primary-container border border-primary-container/30 rounded-sm hover:bg-primary-container/10 transition-colors">重新打开</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function TicketAdminPage() {
  useDocumentTitle("工单管理");
  const isDesktop = useMediaQuery("(min-width: 768px)");
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
        <div className="px-4 py-4 pb-20">
          <Content />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
