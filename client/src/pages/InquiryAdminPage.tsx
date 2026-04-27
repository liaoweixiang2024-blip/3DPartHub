import { useState } from "react";
import { useNavigate } from "react-router-dom";
import useSWR from "swr";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";
import TopNav from "../components/shared/TopNav";
import BottomNav from "../components/shared/BottomNav";
import AppSidebar from "../components/shared/Sidebar";
import MobileNavDrawer from "../components/shared/MobileNavDrawer";
import Icon from "../components/shared/Icon";
import Pagination from "../components/shared/Pagination";
import { getAllInquiries } from "../api/inquiries";
import { getCachedPublicSettings } from "../lib/publicSettings";
import { getBusinessConfig, statusInfo } from "../lib/businessConfig";

function DesktopContent() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const { data: settings } = useSWR("publicSettings", () => getCachedPublicSettings());
  const statuses = getBusinessConfig(settings).inquiryStatuses;
  const statusTabs = [{ value: "all", label: "全部" }, ...statuses.filter((s) => s.tab).map((s) => ({ value: s.value, label: s.label }))];

  const { data, isLoading } = useSWR(
    ["admin-inquiries", statusFilter, page],
    () => getAllInquiries(page, 20, statusFilter === "all" ? undefined : statusFilter)
  );
  const inquiries = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface uppercase">询价管理</h2>
          <p className="text-sm text-on-surface-variant mt-1">共 {total} 条询价单</p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-6 border-b border-outline-variant/10">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setStatusFilter(tab.value); setPage(1); }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              statusFilter === tab.value
                ? "border-primary-container text-primary-container"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-surface-container-low rounded-lg animate-pulse" />
          ))}
        </div>
      ) : inquiries.length === 0 ? (
        <div className="text-center py-20">
          <Icon name="request_quote" size={48} className="mx-auto mb-3 text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">暂无询价单</p>
        </div>
      ) : (
        <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-auto max-h-[calc(100vh-260px)]">
          <div className="grid grid-cols-[80px_1fr_140px_100px_120px_80px] gap-4 px-6 py-3 bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant font-bold border-b border-outline-variant/10 sticky top-0 z-10">
            <span>状态</span>
            <span>用户 / 产品</span>
            <span>公司</span>
            <span>金额</span>
            <span>时间</span>
            <span>操作</span>
          </div>
          {inquiries.map((inq) => {
            const info = statusInfo(statuses, inq.status);
            return (
              <div
                key={inq.id}
                className="grid grid-cols-[80px_1fr_140px_100px_120px_80px] gap-4 px-6 py-4 border-b border-outline-variant/5 hover:bg-surface-container-high/50 transition-colors items-center"
              >
                <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-md font-bold ${info.color || ""} ${info.bg || ""}`}>
                  {info.label}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-on-surface truncate">
                    {inq.items.map((it) => it.modelNo || it.productName).join("、")}
                  </p>
                  <p className="text-xs text-on-surface-variant">{inq.user?.username || "—"} · {inq.items.length} 项</p>
                </div>
                <span className="text-xs text-on-surface-variant truncate">{inq.user?.company || inq.company || "—"}</span>
                <span className="text-sm text-on-surface">{inq.totalAmount ? `¥${Number(inq.totalAmount).toFixed(2)}` : "—"}</span>
                <span className="text-xs text-on-surface-variant">{new Date(inq.createdAt).toLocaleDateString("zh-CN")}</span>
                <button onClick={() => navigate(`/admin/inquiries/${inq.id}`)} className="text-xs text-primary-container hover:underline">
                  详情
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} totalItems={total} onPageChange={setPage} className="mt-4 pb-0" />
    </>
  );
}

function MobileContent() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: settings } = useSWR("publicSettings", () => getCachedPublicSettings());
  const statuses = getBusinessConfig(settings).inquiryStatuses;
  const statusTabs = [{ value: "all", label: "全部" }, ...statuses.filter((s) => s.tab).map((s) => ({ value: s.value, label: s.label }))];

  const { data, isLoading } = useSWR(
    ["admin-inquiries", statusFilter],
    () => getAllInquiries(1, 50, statusFilter === "all" ? undefined : statusFilter)
  );
  const inquiries = data?.items ?? [];

  return (
    <div className="px-4 py-5 pb-20">
      <h1 className="text-lg font-bold text-on-surface mb-4">询价管理</h1>

      <div className="flex gap-1 mb-4 overflow-x-auto scrollbar-none">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              statusFilter === tab.value
                ? "bg-primary-container/15 text-primary-container font-bold"
                : "text-on-surface-variant bg-surface-container-high"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-surface-container-high rounded-lg animate-pulse" />
          ))}
        </div>
      ) : inquiries.length === 0 ? (
        <div className="text-center py-20">
          <Icon name="request_quote" size={48} className="mx-auto mb-3 text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">暂无询价单</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {inquiries.map((inq) => {
            const info = statusInfo(statuses, inq.status);
            return (
              <div
                key={inq.id}
                onClick={() => navigate(`/admin/inquiries/${inq.id}`)}
                className="bg-surface-container-high rounded-lg p-3.5 cursor-pointer active:bg-surface-container-highest transition-colors"
              >
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-sm font-bold ${info.color || ""} ${info.bg || ""}`}>{info.label}</span>
                <span className="text-[10px] text-on-surface-variant">{new Date(inq.createdAt).toLocaleDateString("zh-CN")}</span>
              </div>
                <p className="text-sm text-on-surface mb-1 line-clamp-2 break-words">
                  {inq.items.map((it) => it.modelNo || it.productName).join("、")}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
                  <span className="min-w-0 break-words">{inq.user?.username || "—"} · {inq.items.length} 项</span>
                  <span>{inq.totalAmount ? `¥${Number(inq.totalAmount).toFixed(2)}` : "待报价"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function InquiryAdminPage() {
  useDocumentTitle("询价管理");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [navOpen, setNavOpen] = useState(false);

  if (isDesktop) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto p-8 scrollbar-hidden bg-surface-dim">
            <DesktopContent />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen((p) => !p)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="flex-1 overflow-y-auto scrollbar-hidden bg-surface-dim">
        <MobileContent />
      </main>
      <BottomNav />
    </div>
  );
}
