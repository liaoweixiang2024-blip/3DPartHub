import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { deleteInquiry, getAllInquiries, type Inquiry } from '../api/inquiries';
import InquirySalesAssignmentDialog from '../components/inquiry/InquirySalesAssignmentDialog';
import { AdminEmptyState, AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SearchField from '../components/shared/SearchField';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getBusinessConfig, statusInfo } from '../lib/businessConfig';
import { getErrorMessage } from '../lib/errorNotifications';
import { exportInquiriesEditableXlsx } from '../lib/inquiryExport';
import { usePublicSettings } from '../lib/publicSettings';

const INQUIRY_PAGE_SIZE = 20;
type InquiryStatusTab = { value: string; label: string };
type SearchInputProps = ReturnType<typeof useImeSafeSearchInput>['inputProps'];

const INQUIRY_TAB_ICONS: Record<string, string> = {
  all: 'checklist',
  submitted: 'inbox',
  quoted: 'receipt_long',
  accepted: 'check_circle',
  rejected: 'close',
};

async function fetchAllFilteredInquiries(statusFilter: string, search: string) {
  const pageSize = 100;
  let page = 1;
  let total = 0;
  const items: Inquiry[] = [];
  do {
    const result = await getAllInquiries(
      page,
      pageSize,
      statusFilter === 'all' ? undefined : statusFilter,
      search || undefined,
    );
    total = result.total;
    items.push(...result.items);
    if (result.items.length === 0) break;
    page += 1;
  } while (items.length < total);
  return items;
}

function AdminSearchField({
  inputProps,
  value,
  onClear,
}: {
  inputProps: SearchInputProps;
  value: string;
  onClear: () => void;
}) {
  return (
    <SearchField
      inputProps={inputProps}
      value={value}
      onClear={onClear}
      placeholder="搜索询价、客户、产品"
      className="md:w-72 md:shrink-0"
    />
  );
}

function useInfiniteInquiries(statusFilter: string, search: string) {
  const { data, isLoading, mutate, setSize, size } = useSWRInfinite(
    (pageIndex, previousPageData: Awaited<ReturnType<typeof getAllInquiries>> | null) => {
      if (previousPageData && previousPageData.page * previousPageData.pageSize >= previousPageData.total) return null;
      return ['admin-inquiries', statusFilter, search, pageIndex + 1] as const;
    },
    ([, status, query, page]) =>
      getAllInquiries(page, INQUIRY_PAGE_SIZE, status === 'all' ? undefined : status, query || undefined),
  );

  useEffect(() => {
    setSize(1);
  }, [search, statusFilter, setSize]);

  const pages = data || [];
  const inquiries = pages.flatMap((page) => page.items);
  const total = pages[0]?.total ?? 0;
  const hasMore = inquiries.length < total;
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1]);
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

  return {
    inquiries,
    total,
    isLoading: isLoading && pages.length === 0,
    isLoadingMore,
    hasMore,
    loadMore,
    mutate,
    setSize,
  };
}

function useInquiryStatusCounts(tabs: InquiryStatusTab[], search: string) {
  const statusValues = tabs.map((tab) => tab.value);
  const { data, mutate } = useSWR(['admin-inquiry-status-counts', search, ...statusValues], async () => {
    const entries = await Promise.all(
      statusValues.map(async (status) => {
        const result = await getAllInquiries(1, 1, status === 'all' ? undefined : status, search || undefined);
        return [status, result.total] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<string, number>;
  });

  return { counts: data ?? {}, refreshCounts: mutate };
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
        icon: INQUIRY_TAB_ICONS[tab.value] || 'circle_dot',
      }))}
      value={active}
      onChange={onChange}
      mobileTitle="询价状态"
      countUnit="单"
    />
  );
}

function InquiryAdminToolbar({
  tabs,
  active,
  counts,
  onTabChange,
  searchInputProps,
  searchInputValue,
  onClearSearch,
}: {
  tabs: InquiryStatusTab[];
  active: string;
  counts: Record<string, number>;
  onTabChange: (value: string) => void;
  searchInputProps: SearchInputProps;
  searchInputValue: string;
  onClearSearch: () => void;
}) {
  return (
    <div className="flex min-h-10 min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <InquiryStatusTabs tabs={tabs} active={active} counts={counts} onChange={onTabChange} />
      </div>
      <AdminSearchField inputProps={searchInputProps} value={searchInputValue} onClear={onClearSearch} />
    </div>
  );
}

function DesktopContent() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    value: search,
    draftValue: searchInputValue,
    setValue: setSearch,
    inputProps: searchInputProps,
  } = useImeSafeSearchInput();
  const [statusFilter, setStatusFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<Inquiry | null>(null);
  const [assignmentTarget, setAssignmentTarget] = useState<Inquiry | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { settings } = usePublicSettings();
  const statuses = getBusinessConfig(settings).inquiryStatuses;
  const statusTabs = [
    { value: 'all', label: '全部' },
    ...statuses.filter((s) => s.tab).map((s) => ({ value: s.value, label: s.label })),
  ];
  const { counts, refreshCounts } = useInquiryStatusCounts(statusTabs, search);

  const {
    inquiries,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    mutate: refreshInquiries,
    setSize,
  } = useInfiniteInquiries(statusFilter, search);

  async function confirmDeleteInquiry() {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    setDeletingId(targetId);
    try {
      await deleteInquiry(targetId);
      await Promise.all([refreshInquiries(), refreshCounts()]);
      toast('询价单已删除', 'success');
    } catch (err) {
      toast(getErrorMessage(err, '删除询价单失败'), 'error');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await setSize(1);
      await Promise.all([
        refreshInquiries(undefined, { revalidate: true }),
        refreshCounts(undefined, { revalidate: true }),
      ]);
      toast('询价数据已刷新', 'success');
    } catch (err) {
      toast(getErrorMessage(err, '刷新询价失败'), 'error');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const exportItems = await fetchAllFilteredInquiries(statusFilter, search);
      if (exportItems.length === 0) {
        toast('当前条件下没有可导出的询价单', 'error');
        return;
      }
      const suffix = [statusFilter === 'all' ? 'all' : statusFilter, search ? 'search' : ''].filter(Boolean).join('_');
      await exportInquiriesEditableXlsx({
        inquiries: exportItems,
        statuses,
        filenamePrefix: `inquiries_${suffix}`,
      });
      toast(`已导出 ${exportItems.length} 条询价单，已按产品明细展开`, 'success');
    } catch (err) {
      toast(getErrorMessage(err, '导出询价单失败'), 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <AdminManagementPage
        title="询价处理工作台"
        description="管理员入口：处理客户询价、分配销售、导出业务明细"
        actions={
          <>
            <button
              onClick={handleExport}
              disabled={exporting || isLoading}
              className="flex items-center gap-2 rounded-lg border border-outline-variant/20 px-4 py-2.5 text-sm text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50"
            >
              <Icon name="download" size={16} />
              {exporting ? '导出中...' : '导出明细'}
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-lg border border-outline-variant/20 px-4 py-2.5 text-sm text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50"
            >
              <Icon name="refresh" size={16} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? '刷新中...' : '刷新'}
            </button>
          </>
        }
        toolbar={
          <InquiryAdminToolbar
            tabs={statusTabs}
            active={statusFilter}
            counts={counts}
            onTabChange={setStatusFilter}
            searchInputProps={searchInputProps}
            searchInputValue={searchInputValue}
            onClearSearch={() => setSearch('')}
          />
        }
      >
        <div key={statusFilter} className="admin-tab-panel">
          {isLoading ? (
            <AdminLoadingState
              variant="table"
              label="询价单加载中"
              tableColumns="88px minmax(0,1fr) 170px 120px 150px"
              tableCells={['chip', 'title', 'text', 'text', 'action']}
            />
          ) : inquiries.length === 0 ? (
            <AdminEmptyState
              icon="request_quote"
              title="暂无待处理询价"
              description="切换状态、搜索客户/产品，或等待客户提交新的选型询价。"
            />
          ) : (
            <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-auto max-h-[calc(100vh-260px)]">
              <div className="grid grid-cols-[88px_minmax(0,1fr)_170px_120px_150px] gap-4 px-6 py-3 bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant font-bold border-b border-outline-variant/10 sticky top-0 z-10">
                <span>状态</span>
                <span>客户 / 询价内容</span>
                <span>联系方式</span>
                <span>提交时间</span>
                <span>处理</span>
              </div>
              {inquiries.map((inq) => {
                const info = statusInfo(statuses, inq.status);
                return (
                  <div
                    key={inq.id}
                    className="grid grid-cols-[88px_minmax(0,1fr)_170px_120px_150px] gap-4 px-6 py-4 border-b border-outline-variant/5 hover:bg-surface-container-high/50 transition-colors items-center"
                  >
                    <span
                      className={`inline-flex items-center text-xs px-2 py-0.5 rounded-md font-bold ${info.color || ''} ${info.bg || ''}`}
                    >
                      {info.label}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-on-surface truncate">
                        {inq.items.map((it) => it.modelNo || it.productName).join('、')}
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        客户：{inq.contactName || inq.user?.username || '—'} · {inq.items.length} 项
                        {inq.salesAssignee ? ` · 对接：${inq.salesAssignee.username}` : ''}
                      </p>
                    </div>
                    <div className="min-w-0 text-xs text-on-surface-variant">
                      <p className="truncate">{inq.contactPhone || inq.user?.phone || '未留电话'}</p>
                      <p className="mt-0.5 truncate">{inq.company || inq.user?.company || '未留公司'}</p>
                    </div>
                    <span className="text-xs text-on-surface-variant">
                      {new Date(inq.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/admin/inquiries/${inq.id}`)}
                        className="text-xs text-primary-container hover:underline"
                      >
                        处理
                      </button>
                      {inq.status !== 'cancelled' && inq.status !== 'rejected' ? (
                        <button
                          type="button"
                          onClick={() => setAssignmentTarget(inq)}
                          className="text-xs text-green-600 hover:underline"
                        >
                          {inq.salesAssignee ? '改派' : '分配销售'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(inq)}
                        disabled={deletingId === inq.id}
                        className="text-xs text-error hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingId === inq.id ? '删除中' : '删除记录'}
                      </button>
                    </div>
                  </div>
                );
              })}
              <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={loadMore} />
            </div>
          )}
        </div>
      </AdminManagementPage>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteInquiry}
        title="确认删除询价单"
        description="删除后询价单、产品明细和沟通记录将不可恢复。"
        confirmLabel="删除询价单"
      />
      <InquirySalesAssignmentDialog
        open={Boolean(assignmentTarget)}
        inquiry={assignmentTarget}
        onClose={() => setAssignmentTarget(null)}
        onAssigned={async () => {
          await Promise.all([
            refreshInquiries(undefined, { revalidate: true }),
            refreshCounts(undefined, { revalidate: true }),
          ]);
        }}
      />
    </>
  );
}

function MobileContent() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    value: search,
    draftValue: searchInputValue,
    setValue: setSearch,
    inputProps: searchInputProps,
  } = useImeSafeSearchInput();
  const [statusFilter, setStatusFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<Inquiry | null>(null);
  const [assignmentTarget, setAssignmentTarget] = useState<Inquiry | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { settings } = usePublicSettings();
  const statuses = getBusinessConfig(settings).inquiryStatuses;
  const statusTabs = [
    { value: 'all', label: '全部' },
    ...statuses.filter((s) => s.tab).map((s) => ({ value: s.value, label: s.label })),
  ];
  const { counts, refreshCounts } = useInquiryStatusCounts(statusTabs, search);

  const {
    inquiries,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    mutate: refreshInquiries,
    setSize,
  } = useInfiniteInquiries(statusFilter, search);

  async function confirmDeleteInquiry() {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    setDeletingId(targetId);
    try {
      await deleteInquiry(targetId);
      await Promise.all([refreshInquiries(), refreshCounts()]);
      toast('询价单已删除', 'success');
    } catch (err) {
      toast(getErrorMessage(err, '删除询价单失败'), 'error');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await setSize(1);
      await Promise.all([
        refreshInquiries(undefined, { revalidate: true }),
        refreshCounts(undefined, { revalidate: true }),
      ]);
      toast('询价数据已刷新', 'success');
    } catch (err) {
      toast(getErrorMessage(err, '刷新询价失败'), 'error');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const exportItems = await fetchAllFilteredInquiries(statusFilter, search);
      if (exportItems.length === 0) {
        toast('当前条件下没有可导出的询价单', 'error');
        return;
      }
      const suffix = [statusFilter === 'all' ? 'all' : statusFilter, search ? 'search' : ''].filter(Boolean).join('_');
      await exportInquiriesEditableXlsx({
        inquiries: exportItems,
        statuses,
        filenamePrefix: `inquiries_${suffix}`,
      });
      toast(`已导出 ${exportItems.length} 条询价单，已按产品明细展开`, 'success');
    } catch (err) {
      toast(getErrorMessage(err, '导出询价单失败'), 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <AdminManagementPage
        title="询价处理工作台"
        description="管理员入口：处理客户询价、分配销售、导出业务明细"
        actions={
          <>
            <button
              onClick={handleExport}
              disabled={exporting || isLoading}
              className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-outline-variant/20 text-on-surface-variant transition-colors active:bg-surface-container-high disabled:opacity-50"
              aria-label={exporting ? '正在导出询价单' : '导出询价单'}
            >
              <Icon name="download" size={17} className={exporting ? 'animate-pulse' : ''} />
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-outline-variant/20 text-on-surface-variant transition-colors active:bg-surface-container-high disabled:opacity-50"
              aria-label={refreshing ? '正在刷新询价数据' : '刷新询价数据'}
            >
              <Icon name="refresh" size={17} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </>
        }
        toolbar={
          <InquiryAdminToolbar
            tabs={statusTabs}
            active={statusFilter}
            counts={counts}
            onTabChange={setStatusFilter}
            searchInputProps={searchInputProps}
            searchInputValue={searchInputValue}
            onClearSearch={() => setSearch('')}
          />
        }
      >
        <div key={statusFilter} className="admin-tab-panel">
          {isLoading ? (
            <AdminLoadingState variant="list" rows={5} label="询价单加载中" />
          ) : inquiries.length === 0 ? (
            <AdminEmptyState
              icon="request_quote"
              title="暂无待处理询价"
              description="切换状态、搜索客户/产品，或等待客户提交新的选型询价。"
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
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-sm font-bold ${info.color || ''} ${info.bg || ''}`}
                      >
                        {info.label}
                      </span>
                      <span className="text-[10px] text-on-surface-variant">
                        {new Date(inq.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    <p className="text-sm text-on-surface mb-1 line-clamp-2 break-words">
                      {inq.items.map((it) => it.modelNo || it.productName).join('、')}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
                      <span className="min-w-0 break-words">
                        客户：{inq.contactName || inq.user?.username || '—'} · {inq.items.length} 项
                        {inq.salesAssignee ? ` · ${inq.salesAssignee.username}跟进` : ''}
                      </span>
                      <div className="flex items-center gap-3">
                        <span>处理</span>
                        {inq.status !== 'cancelled' && inq.status !== 'rejected' ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setAssignmentTarget(inq);
                            }}
                            className="font-medium text-green-600"
                          >
                            {inq.salesAssignee ? '改派' : '分配销售'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeleteTarget(inq);
                          }}
                          disabled={deletingId === inq.id}
                          className="font-medium text-error disabled:opacity-60"
                        >
                          {deletingId === inq.id ? '删除中' : '删除记录'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={loadMore} />
            </div>
          )}
        </div>
      </AdminManagementPage>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteInquiry}
        title="确认删除询价单"
        description="删除后询价单、产品明细和沟通记录将不可恢复。"
        confirmLabel="删除询价单"
      />
      <InquirySalesAssignmentDialog
        open={Boolean(assignmentTarget)}
        inquiry={assignmentTarget}
        onClose={() => setAssignmentTarget(null)}
        onAssigned={async () => {
          await Promise.all([
            refreshInquiries(undefined, { revalidate: true }),
            refreshCounts(undefined, { revalidate: true }),
          ]);
        }}
      />
    </>
  );
}

export default function InquiryAdminPage() {
  useDocumentTitle('询价处理工作台');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
