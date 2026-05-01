import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";
import InfiniteLoadTrigger from "../components/shared/InfiniteLoadTrigger";
import { AdminPageShell } from "../components/shared/AdminPageShell";
import { AdminEmptyState, AdminManagementPage } from "../components/shared/AdminManagementPage";
import ResponsiveSectionTabs from "../components/shared/ResponsiveSectionTabs";
import { getAllInquiries } from "../api/inquiries";
import { getCachedPublicSettings } from "../lib/publicSettings";
import { getBusinessConfig, statusInfo } from "../lib/businessConfig";

const INQUIRY_PAGE_SIZE = 20;
type InquiryStatusTab = { value: string; label: string };

function useInfiniteInquiries(statusFilter: string) {
  const { data, isLoading, setSize, size } = useSWRInfinite(
    (pageIndex, previousPageData: Awaited<ReturnType<typeof getAllInquiries>> | null) => {
      if (previousPageData && previousPageData.page * previousPageData.pageSize >= previousPageData.total) return null;
      return ["admin-inquiries", statusFilter, pageIndex + 1] as const;
    },
    ([, status, page]) => getAllInquiries(page, INQUIRY_PAGE_SIZE, status === "all" ? undefined : status)
  );

  useEffect(() => {
    setSize(1);
  }, [statusFilter, setSize]);

  const pages = data || [];
  const inquiries = pages.flatMap((page) => page.items);
  const total = pages[0]?.total ?? 0;
  const hasMore = inquiries.length < total;
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1]);
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

  return { inquiries, total, isLoading: isLoading && pages.length === 0, isLoadingMore, hasMore, loadMore };
}

function useInquiryStatusCounts(tabs: InquiryStatusTab[]) {
  const statusValues = tabs.map((tab) => tab.value);
  const { data } = useSWR(["admin-inquiry-status-counts", ...statusValues], async () => {
    const entries = await Promise.all(
      statusValues.map(async (status) => {
        const result = await getAllInquiries(1, 1, status === "all" ? undefined : status);
        return [status, result.total] as const;
      })
    );
    return Object.fromEntries(entries) as Record<string, number>;
  });

  return data ?? {};
}

function InquiryStatusTabs({
  tabs,
  active,
  counts,
  onChange,
}: {
  tabs: InquiryStatusTab[];
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
        icon: tab.value === "all" ? "format_list_bulleted" : "radio_button_checked",
      }))}
      value={active}
      onChange={onChange}
      mobileTitle="询价状态"
      countUnit="单"
    />
  );
}

function DesktopContent() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: settings } = useSWR("publicSettings", () => getCachedPublicSettings());
  const statuses = getBusinessConfig(settings).inquiryStatuses;
  const statusTabs = [{ value: "all", label: "全部" }, ...statuses.filter((s) => s.tab).map((s) => ({ value: s.value, label: s.label }))];
  const counts = useInquiryStatusCounts(statusTabs);

  const { inquiries, isLoading, isLoadingMore, hasMore, loadMore } = useInfiniteInquiries(statusFilter);

  return (
    <AdminManagementPage
      title="询价管理"
      description="跟进客户提交的选型询价和产品需求"
      toolbar={(
        <InquiryStatusTabs tabs={statusTabs} active={statusFilter} counts={counts} onChange={setStatusFilter} />
      )}
    >

      <div key={statusFilter} className="admin-tab-panel">
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-surface-container-low rounded-lg animate-pulse" />
          ))}
        </div>
      ) : inquiries.length === 0 ? (
        <AdminEmptyState
          icon="request_quote"
          title="暂无询价单"
          description="切换状态或等待用户提交新的选型询价。"
        />
      ) : (
        <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-auto max-h-[calc(100vh-260px)]">
          <div className="grid grid-cols-[80px_1fr_150px_120px_80px] gap-4 px-6 py-3 bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant font-bold border-b border-outline-variant/10 sticky top-0 z-10">
            <span>状态</span>
            <span>用户 / 产品</span>
            <span>公司</span>
            <span>时间</span>
            <span>操作</span>
          </div>
          {inquiries.map((inq) => {
            const info = statusInfo(statuses, inq.status);
            return (
              <div
                key={inq.id}
                className="grid grid-cols-[80px_1fr_150px_120px_80px] gap-4 px-6 py-4 border-b border-outline-variant/5 hover:bg-surface-container-high/50 transition-colors items-center"
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
                <span className="text-xs text-on-surface-variant">{new Date(inq.createdAt).toLocaleDateString("zh-CN")}</span>
                <button onClick={() => navigate(`/admin/inquiries/${inq.id}`)} className="text-xs text-primary-container hover:underline">
                  详情
                </button>
              </div>
            );
          })}
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={loadMore} />
        </div>
      )}
      </div>
    </AdminManagementPage>
  );
}

function MobileContent() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: settings } = useSWR("publicSettings", () => getCachedPublicSettings());
  const statuses = getBusinessConfig(settings).inquiryStatuses;
  const statusTabs = [{ value: "all", label: "全部" }, ...statuses.filter((s) => s.tab).map((s) => ({ value: s.value, label: s.label }))];
  const counts = useInquiryStatusCounts(statusTabs);

  const { inquiries, isLoading, isLoadingMore, hasMore, loadMore } = useInfiniteInquiries(statusFilter);

  return (
    <AdminManagementPage
      title="询价管理"
      description="跟进客户提交的选型询价和产品需求"
      toolbar={(
        <InquiryStatusTabs tabs={statusTabs} active={statusFilter} counts={counts} onChange={setStatusFilter} />
      )}
    >

      <div key={statusFilter} className="admin-tab-panel">
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-surface-container-high rounded-lg animate-pulse" />
          ))}
        </div>
      ) : inquiries.length === 0 ? (
        <AdminEmptyState
          icon="request_quote"
          title="暂无询价单"
          description="切换状态或等待用户提交新的选型询价。"
        />
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
                  <span>查看详情</span>
                </div>
              </div>
            );
          })}
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={loadMore} />
        </div>
      )}
      </div>
    </AdminManagementPage>
  );
}

export default function InquiryAdminPage() {
  useDocumentTitle("询价管理");
  const isDesktop = useMediaQuery("(min-width: 768px)");

  return (
    <AdminPageShell>
      {isDesktop ? <DesktopContent /> : <MobileContent />}
    </AdminPageShell>
  );
}
