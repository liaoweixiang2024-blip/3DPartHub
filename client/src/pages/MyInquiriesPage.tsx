import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import useSWR from "swr";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";
import TopNav from "../components/shared/TopNav";
import BottomNav from "../components/shared/BottomNav";
import AppSidebar from "../components/shared/Sidebar";
import MobileNavDrawer from "../components/shared/MobileNavDrawer";
import Icon from "../components/shared/Icon";
import { getMyInquiries, type Inquiry } from "../api/inquiries";
import { getCachedPublicSettings } from "../lib/publicSettings";
import { getBusinessConfig, statusInfo, type StatusConfig } from "../lib/businessConfig";

function StatusBadge({ status, statuses }: { status: string; statuses: StatusConfig[] }) {
  const info = statusInfo(statuses, status);
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md font-bold ${info.color || ""} ${info.bg || ""}`}>
      {info.label}
    </span>
  );
}

function DesktopContent() {
  const { data: inquiries = [], isLoading } = useSWR("my-inquiries", getMyInquiries);
  const { data: settings } = useSWR("publicSettings", () => getCachedPublicSettings());
  const statuses = getBusinessConfig(settings).inquiryStatuses;
  const navigate = useNavigate();

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface uppercase">我的询价</h2>
          <p className="text-sm text-on-surface-variant mt-1">{inquiries.length} 条记录</p>
        </div>
        <Link to="/selection" className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90">
          <Icon name="add" size={16} />新建询价
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-surface-container-low rounded-lg animate-pulse" />
          ))}
        </div>
      ) : inquiries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Icon name="request_quote" size={48} className="text-on-surface-variant/20" />
          <p className="text-sm text-on-surface-variant">暂无询价记录</p>
          <Link to="/selection" className="bg-primary-container text-on-primary px-6 py-2.5 rounded-lg text-sm font-medium hover:opacity-90">
            去选型
          </Link>
        </div>
      ) : (
        <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-auto">
          <div className="grid grid-cols-[80px_1fr_100px_120px_140px] gap-4 px-6 py-3 bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant font-bold border-b border-outline-variant/10 sticky top-0 z-10">
            <span>状态</span>
            <span>产品</span>
            <span>金额</span>
            <span>时间</span>
            <span>操作</span>
          </div>
          {inquiries.map((inq) => (
            <div key={inq.id} className="grid grid-cols-[80px_1fr_100px_120px_140px] gap-4 px-6 py-4 border-b border-outline-variant/5 hover:bg-surface-container-high/50 transition-colors items-center">
              <StatusBadge status={inq.status} statuses={statuses} />
              <div className="min-w-0">
                <p className="text-sm text-on-surface truncate">
                  {inq.items.map((it) => it.modelNo || it.productName).join("、")}
                </p>
                <p className="text-xs text-on-surface-variant">{inq.items.length} 个产品</p>
              </div>
              <span className="text-sm text-on-surface">
                {inq.totalAmount ? `¥${Number(inq.totalAmount).toFixed(2)}` : "—"}
              </span>
              <span className="text-xs text-on-surface-variant">
                {new Date(inq.createdAt).toLocaleDateString("zh-CN")}
              </span>
              <button
                onClick={() => navigate(`/my-inquiries/${inq.id}`)}
                className="text-xs text-primary-container hover:underline"
              >
                查看详情
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function MobileContent() {
  const { data: inquiries = [], isLoading } = useSWR("my-inquiries", getMyInquiries);
  const { data: settings } = useSWR("publicSettings", () => getCachedPublicSettings());
  const statuses = getBusinessConfig(settings).inquiryStatuses;
  const navigate = useNavigate();

  return (
    <div className="px-4 py-5 pb-20">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-on-surface">我的询价</h1>
          <p className="text-xs text-on-surface-variant mt-0.5">{inquiries.length} 条记录</p>
        </div>
        <Link to="/selection" className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-on-primary bg-primary-container rounded-lg">
          <Icon name="add" size={14} />新建
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-surface-container-high rounded-lg animate-pulse" />
          ))}
        </div>
      ) : inquiries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Icon name="request_quote" size={64} className="text-on-surface-variant/20" />
          <p className="text-on-surface-variant text-sm">暂无询价记录</p>
          <Link to="/selection" className="bg-primary-container text-on-primary px-6 py-2.5 rounded-sm text-sm font-bold hover:opacity-90">
            去选型
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {inquiries.map((inq) => (
            <div
              key={inq.id}
              onClick={() => navigate(`/my-inquiries/${inq.id}`)}
              className="bg-surface-container-high rounded-lg p-3.5 cursor-pointer active:bg-surface-container-highest transition-colors"
            >
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <StatusBadge status={inq.status} statuses={statuses} />
                <span className="text-[11px] text-on-surface-variant">
                  {new Date(inq.createdAt).toLocaleDateString("zh-CN")}
                </span>
              </div>
              <p className="text-sm text-on-surface mb-1 line-clamp-2 break-words">
                {inq.items.map((it) => it.modelNo || it.productName).join("、")}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
                <span>{inq.items.length} 个产品</span>
                <span>{inq.totalAmount ? `¥${Number(inq.totalAmount).toFixed(2)}` : "待报价"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MyInquiriesPage() {
  useDocumentTitle("我的询价");
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
