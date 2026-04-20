import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import TopNav from '../components/shared/TopNav';
import BottomNav from '../components/shared/BottomNav';
import AppSidebar from '../components/shared/Sidebar';
import MobileNavDrawer from '../components/shared/MobileNavDrawer';
import Icon from '../components/shared/Icon';
import { useAuthStore } from '../stores/useAuthStore';
import { getTickets, updateTicketStatus, type Ticket } from '../api/tickets';

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: "待处理", color: "text-primary-container", bg: "bg-primary-container/10" },
  waiting_user: { label: "待回复", color: "text-amber-600", bg: "bg-amber-500/10" },
  in_progress: { label: "处理中", color: "text-blue-500", bg: "bg-blue-500/10" },
  resolved: { label: "已解决", color: "text-green-500", bg: "bg-green-500/10" },
  closed: { label: "已关闭", color: "text-on-surface-variant", bg: "bg-surface-container-highest" },
};

const CLASSIFICATION_MAP: Record<string, string> = {
  dimension: "尺寸问题",
  material: "材料问题",
  process: "工艺问题",
  other: "其他",
};

function Content() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => { loadTickets(); }, []);

  async function loadTickets() {
    setLoading(true);
    try { const data = await getTickets(); setTickets(data); } catch { setTickets([]); } finally { setLoading(false); }
  }

  async function handleStatusChange(id: string, status: string) {
    try { await updateTicketStatus(id, status); setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t))); } catch { /* ignore */ }
  }

  const filtered = filter === "all" ? tickets : tickets.filter((t) => t.status === filter);
  const counts = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === "open").length,
    waiting_user: tickets.filter((t) => t.status === "waiting_user").length,
    in_progress: tickets.filter((t) => t.status === "in_progress").length,
    resolved: tickets.filter((t) => t.status === "resolved").length,
    closed: tickets.filter((t) => t.status === "closed").length,
  };

  if (user?.role !== "ADMIN") {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-on-surface-variant">无访问权限</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-headline text-lg md:text-2xl font-bold tracking-tight text-on-surface uppercase">工单管理</h2>
          <p className="text-sm text-on-surface-variant mt-1">管理用户提交的模型需求工单</p>
        </div>
        <button onClick={loadTickets} className="flex items-center gap-2 px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface border border-outline-variant/20 rounded-sm transition-colors">
          <Icon name="refresh" size={16} />刷新
        </button>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {(["all", "open", "waiting_user", "in_progress", "resolved", "closed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-xs rounded-sm transition-colors ${filter === s ? "bg-primary-container text-on-primary font-bold" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}
          >
            {s === "all" ? "全部" : STATUS_MAP[s]?.label || s} ({counts[s]})
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Icon name="autorenew" size={32} className="text-on-surface-variant/30 animate-spin" />
        </div>
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
            const statusInfo = STATUS_MAP[ticket.status] || STATUS_MAP.open;
            return (
              <div key={ticket.id} className="bg-surface-container-low border border-outline-variant/15 rounded-sm p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-sm font-bold ${statusInfo.color} ${statusInfo.bg}`}>{statusInfo.label}</span>
                      <span className="text-[10px] text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded-sm">{CLASSIFICATION_MAP[ticket.classification] || ticket.classification}</span>
                    </div>
                    <p className="text-sm text-on-surface whitespace-pre-wrap mb-2">{ticket.description}</p>
                    {ticket.basePart && <p className="text-xs text-on-surface-variant">基准零件: {ticket.basePart}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-on-surface-variant">
                      <span className="flex items-center gap-1"><Icon name="person" size={12} />{ticket.user?.username || "未知用户"}</span>
                      <span className="flex items-center gap-1"><Icon name="schedule" size={12} />{new Date(ticket.createdAt).toLocaleString("zh-CN")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
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
    <div className="flex flex-col h-screen bg-surface">
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
