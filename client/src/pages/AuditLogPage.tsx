import { useState } from "react";
import useSWR from "swr";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";
import TopNav from "../components/shared/TopNav";
import BottomNav from "../components/shared/BottomNav";
import AppSidebar from "../components/shared/Sidebar";
import MobileNavDrawer from "../components/shared/MobileNavDrawer";
import Icon from "../components/shared/Icon";
import client from "../api/client";

interface AuditEntry {
  id: string;
  userId: string | null;
  username: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  details: any;
  createdAt: string;
}

const ACTION_MAP: Record<string, { label: string; color: string }> = {
  create: { label: "创建", color: "text-green-500 bg-green-500/10" },
  upload: { label: "上传", color: "text-green-500 bg-green-500/10" },
  update: { label: "更新", color: "text-blue-500 bg-blue-500/10" },
  delete: { label: "删除", color: "text-red-500 bg-red-500/10" },
  login: { label: "登录", color: "text-amber-500 bg-amber-500/10" },
  download: { label: "下载", color: "text-purple-500 bg-purple-500/10" },
  register: { label: "注册", color: "text-teal-500 bg-teal-500/10" },
  settings_update: { label: "设置", color: "text-cyan-500 bg-cyan-500/10" },
  favorite: { label: "收藏", color: "text-pink-500 bg-pink-500/10" },
  unfavorite: { label: "取消收藏", color: "text-on-surface-variant bg-surface-container-highest" },
  comment: { label: "评论", color: "text-indigo-500 bg-indigo-500/10" },
  ticket_create: { label: "创建工单", color: "text-primary-container bg-primary-container/10" },
  ticket_reply: { label: "回复工单", color: "text-blue-500 bg-blue-500/10" },
  ticket_status: { label: "工单状态", color: "text-amber-500 bg-amber-500/10" },
};

const RESOURCE_MAP: Record<string, string> = {
  model: "模型",
  user: "用户",
  settings: "系统设置",
  category: "分类",
  comment: "评论",
  auth: "认证",
  ticket: "工单",
  favorite: "收藏",
  download: "下载",
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-on-surface-variant/60 shrink-0 w-14">{label}</span>
      <span className="text-on-surface-variant min-w-0 break-all">{value}</span>
    </div>
  );
}

function LogRow({ log, isDesktop }: { log: AuditEntry; isDesktop: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const act = ACTION_MAP[log.action] || { label: log.action, color: "text-on-surface-variant bg-surface-container-highest" };
  const resLabel = RESOURCE_MAP[log.resource] || log.resource;

  const detailLines: { label: string; value: string }[] = [];
  if (log.resourceId) detailLines.push({ label: "资源ID", value: log.resourceId });
  if (log.details?.body) {
    const body = log.details.body;
    if (body.name) detailLines.push({ label: "名称", value: body.name });
    if (body.status) detailLines.push({ label: "状态", value: body.status });
    if (body.content) detailLines.push({ label: "内容", value: String(body.content).slice(0, 100) });
  }
  if (log.details?.path) detailLines.push({ label: "路径", value: log.details.path });
  if (log.details?.statusCode) detailLines.push({ label: "状态码", value: String(log.details.statusCode) });

  if (isDesktop) {
    return (
      <tr
        className="border-b border-outline-variant/5 hover:bg-surface-container-high/30 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-2.5 px-4">
          <span className={`text-[10px] px-2 py-0.5 rounded-sm font-bold ${act.color}`}>
            {act.label}
          </span>
        </td>
        <td className="py-2.5 px-4 text-xs text-on-surface-variant">{resLabel}</td>
        <td className="py-2.5 px-4 text-xs text-on-surface-variant/60 font-mono max-w-[120px] truncate" title={log.resourceId || ""}>
          {log.resourceId || "—"}
        </td>
        <td className="py-2.5 px-4 text-xs text-on-surface-variant/60">
          {log.username || (log.userId ? log.userId.slice(0, 8) + "..." : "系统")}
        </td>
        <td className="py-2.5 px-4 text-xs text-on-surface-variant/40 whitespace-nowrap">
          {new Date(log.createdAt).toLocaleString("zh-CN")}
        </td>
      </tr>
    );
  }

  return (
    <div
      className="bg-surface-container-low rounded-lg p-3 cursor-pointer active:bg-surface-container-high transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className={`text-[10px] px-2 py-0.5 rounded-sm font-bold ${act.color}`}>
          {act.label}
        </span>
        <span className="text-[10px] text-on-surface-variant bg-surface-container-highest px-1.5 py-0.5 rounded-sm">
          {resLabel}
        </span>
        <span className="text-[10px] text-on-surface-variant/40 ml-auto whitespace-nowrap">
          {new Date(log.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      {log.resourceId && (
        <p className="text-[11px] text-on-surface-variant/50 font-mono break-all">ID: {log.resourceId}</p>
      )}
      {expanded && detailLines.length > 0 && (
        <div className="mt-2 pt-2 border-t border-outline-variant/10 space-y-1">
          {detailLines.map((d, i) => (
            <DetailRow key={i} label={d.label} value={d.value} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AuditLogPage() {
  useDocumentTitle("操作日志");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [navOpen, setNavOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [filterAction, setFilterAction] = useState("");
  const [filterResource, setFilterResource] = useState("");

  const { data } = useSWR(
    `/audit?page=${page}&action=${filterAction}&resource=${filterResource}`,
    () => {
      const params: Record<string, string | number> = { page, size: 30 };
      if (filterAction) params.action = filterAction;
      if (filterResource) params.resource = filterResource;
      return client.get("/audit", { params }).then(r => {
        const d = (r.data as any)?.data ?? r.data;
        return d as { total: number; items: AuditEntry[]; page: number };
      });
    }
  );

  const logs = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / 30);

  const filterBar = (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={filterAction}
        onChange={e => { setFilterAction(e.target.value); setPage(1); }}
        className="bg-surface-container-high text-on-surface text-xs rounded-md px-2.5 py-1.5 border border-outline-variant/20 outline-none focus:border-primary min-w-0 flex-1 sm:flex-none"
      >
        <option value="">全部操作</option>
        {Object.entries(ACTION_MAP).map(([k, v]) => (
          <option key={k} value={k}>{v.label}</option>
        ))}
      </select>
      <select
        value={filterResource}
        onChange={e => { setFilterResource(e.target.value); setPage(1); }}
        className="bg-surface-container-high text-on-surface text-xs rounded-md px-2.5 py-1.5 border border-outline-variant/20 outline-none focus:border-primary min-w-0 flex-1 sm:flex-none"
      >
        <option value="">全部资源</option>
        {Object.entries(RESOURCE_MAP).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      {(filterAction || filterResource) && (
        <button
          onClick={() => { setFilterAction(""); setFilterResource(""); setPage(1); }}
          className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
        >
          清除筛选
        </button>
      )}
    </div>
  );

  const pagination = totalPages > 1 && (
    <div className="flex items-center justify-center gap-3 pt-4">
      <button
        onClick={() => setPage(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="p-1.5 rounded hover:bg-surface-container-high disabled:opacity-30 text-on-surface-variant"
      >
        <Icon name="arrow_back" size={16} />
      </button>
      <span className="text-xs text-on-surface-variant">{page} / {totalPages}</span>
      <button
        onClick={() => setPage(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="p-1.5 rounded hover:bg-surface-container-high disabled:opacity-30 text-on-surface-variant"
      >
        <Icon name="arrow_forward" size={16} />
      </button>
    </div>
  );

  if (isDesktop) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto p-8 scrollbar-hidden bg-surface-dim">
            <div className="space-y-6">
              <div>
                <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface uppercase">操作日志</h2>
                <p className="text-sm text-on-surface-variant mt-1">{total} 条记录</p>
              </div>
              {filterBar}
              <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-auto max-h-[calc(100vh-280px)]">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant font-bold">
                      <th className="py-3 px-4 text-left">操作</th>
                      <th className="py-3 px-4 text-left">资源</th>
                      <th className="py-3 px-4 text-left">资源ID</th>
                      <th className="py-3 px-4 text-left">用户</th>
                      <th className="py-3 px-4 text-left">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <LogRow key={log.id} log={log} isDesktop />
                    ))}
                  </tbody>
                </table>
                {logs.length === 0 && (
                  <div className="text-center py-12 text-on-surface-variant text-sm">暂无操作日志</div>
                )}
              </div>
              {pagination}
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen((v) => !v)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="flex-1 overflow-y-auto scrollbar-hidden bg-surface-dim">
        <div className="px-4 py-4 pb-20 space-y-3">
          <div>
            <h1 className="text-lg font-bold text-on-surface">操作日志</h1>
            <p className="text-xs text-on-surface-variant mt-0.5">{total} 条记录</p>
          </div>
          {filterBar}
          <div className="flex flex-col gap-2">
            {logs.map(log => (
              <LogRow key={log.id} log={log} isDesktop={false} />
            ))}
          </div>
          {logs.length === 0 && (
            <div className="text-center py-10 text-on-surface-variant text-sm">暂无操作日志</div>
          )}
          {pagination}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
