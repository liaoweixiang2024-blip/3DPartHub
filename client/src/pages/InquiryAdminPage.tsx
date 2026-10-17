import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { deleteInquiry, getAllInquiries, type Inquiry } from '../api/inquiries';
import InquirySalesAssignmentDialog from '../components/inquiry/InquirySalesAssignmentDialog';
import { AdminButton, AdminIconButton } from '../components/shared/AdminControls';
import {
  ADMIN_ROW_META_CLASS,
  ADMIN_ROW_TITLE_CLASS,
  AdminGridHeader,
  AdminGridRow,
} from '../components/shared/AdminDataTable';
import { AdminEmptyState, AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import AdminRefreshButton from '../components/shared/AdminRefreshButton';
import ConfirmDialog from '../components/shared/ConfirmDialog';
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
const INQUIRY_ADMIN_GRID_COLUMNS = '76px minmax(220px,1fr) 150px 104px minmax(224px,max-content)';
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
  const { t } = useTranslation();
  return (
    <SearchField
      inputProps={inputProps}
      value={value}
      onClear={onClear}
      placeholder={t('inquiryAdminPage.searchPlaceholder')}
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

  const pages = useMemo(() => data || [], [data]);
  const inquiries = useMemo(() => pages.flatMap((page) => page.items), [pages]);
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
  const { t } = useTranslation();
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
      mobileTitle={t('inquiryAdminPage.statusTitle')}
      countUnit={t('inquiryAdminPage.countUnit')}
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
  const { t } = useTranslation();
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
  const [exporting, setExporting] = useState(false);
  const { settings } = usePublicSettings();
  const business = useMemo(() => getBusinessConfig(settings), [settings]);
  const statuses = business.inquiryStatuses;
  const statusTabs = useMemo(
    () => [
      { value: 'all', label: t('inquiryAdminPage.tabAll') },
      ...statuses.filter((s) => s.tab).map((s) => ({ value: s.value, label: s.label })),
    ],
    [statuses, t],
  );
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
      toast(t('inquiryAdminPage.inquiryDeleted'), 'success');
    } catch (err) {
      toast(getErrorMessage(err, t('inquiryAdminPage.deleteFail')), 'error');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRefresh() {
    try {
      await setSize(1);
      await Promise.all([
        refreshInquiries(undefined, { revalidate: true }),
        refreshCounts(undefined, { revalidate: true }),
      ]);
      toast(t('inquiryAdminPage.dataRefreshed'), 'success');
    } catch (err) {
      toast(getErrorMessage(err, t('inquiryAdminPage.refreshFail')), 'error');
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const exportItems = await fetchAllFilteredInquiries(statusFilter, search);
      if (exportItems.length === 0) {
        toast(t('inquiryAdminPage.exportEmpty'), 'error');
        return;
      }
      const suffix = [statusFilter === 'all' ? 'all' : statusFilter, search ? 'search' : ''].filter(Boolean).join('_');
      await exportInquiriesEditableXlsx({
        inquiries: exportItems,
        statuses,
        filenamePrefix: `inquiries_${suffix}`,
      });
      toast(t('inquiryAdminPage.exportSuccess', { count: exportItems.length }), 'success');
    } catch (err) {
      toast(getErrorMessage(err, t('inquiryAdminPage.exportFail')), 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <AdminManagementPage
        title={t('inquiryAdminPage.title')}
        description={t('inquiryAdminPage.description')}
        actions={
          <>
            <AdminButton
              onClick={handleExport}
              disabled={exporting || isLoading}
              icon="download"
              iconClassName={exporting ? 'animate-pulse' : ''}
              variant="secondary"
            >
              {exporting ? t('inquiryAdminPage.exporting') : t('inquiryAdminPage.exportDetail')}
            </AdminButton>
            <AdminRefreshButton onRefresh={handleRefresh} />
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
              label={t('inquiryAdminPage.loadingLabel')}
              tableColumns="88px minmax(0,1fr) 170px 120px 150px"
              tableCells={['chip', 'title', 'text', 'text', 'action']}
            />
          ) : inquiries.length === 0 ? (
            <AdminEmptyState
              icon="request_quote"
              title={t('inquiryAdminPage.emptyTitle')}
              description={t('inquiryAdminPage.emptyDesc')}
            />
          ) : (
            <div className="max-h-[calc(100vh-260px)] overflow-auto rounded-xl border border-outline-variant/15 bg-surface-container-low">
              <AdminGridHeader columns={INQUIRY_ADMIN_GRID_COLUMNS} className="gap-4 px-6">
                <span>{t('inquiryAdminPage.colStatus')}</span>
                <span>{t('inquiryAdminPage.colCustomer')}</span>
                <span>{t('inquiryAdminPage.colContact')}</span>
                <span>{t('inquiryAdminPage.colTime')}</span>
                <span className="text-right">{t('inquiryAdminPage.colAction')}</span>
              </AdminGridHeader>
              {inquiries.map((inq) => {
                const info = statusInfo(statuses, inq.status);
                return (
                  <AdminGridRow key={inq.id} columns={INQUIRY_ADMIN_GRID_COLUMNS} className="gap-4 px-6 py-4">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${info.color || ''} ${info.bg || ''}`}
                    >
                      {t(`inquiryStatus.${inq.status}.label`, { defaultValue: info.label })}
                    </span>
                    <div className="min-w-0">
                      <p className={ADMIN_ROW_TITLE_CLASS}>
                        {inq.items.map((it) => it.modelNo || it.productName).join('、')}
                      </p>
                      <p className={ADMIN_ROW_META_CLASS}>
                        {t('inquiryAdminPage.customerMeta', {
                          name: inq.contactName || inq.user?.username || '—',
                          count: inq.items.length,
                        })}
                        {inq.salesAssignee
                          ? t('inquiryAdminPage.assigneeSuffix', { name: inq.salesAssignee.username })
                          : ''}
                      </p>
                    </div>
                    <div className="min-w-0 text-xs text-on-surface-variant">
                      <p className="truncate">{inq.contactPhone || inq.user?.phone || t('inquiryAdminPage.noPhone')}</p>
                      <p className="mt-0.5 truncate">
                        {inq.company || inq.user?.company || t('inquiryAdminPage.noCompany')}
                      </p>
                    </div>
                    <span className="text-xs text-on-surface-variant">
                      {new Date(inq.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                      <AdminButton onClick={() => navigate(`/admin/inquiries/${inq.id}`)} size="sm" variant="tonal">
                        {t('inquiryAdminPage.actionHandle')}
                      </AdminButton>
                      {inq.status !== 'cancelled' && inq.status !== 'rejected' ? (
                        <AdminButton onClick={() => setAssignmentTarget(inq)} size="sm" variant="success">
                          {inq.salesAssignee ? t('inquiryAdminPage.reassign') : t('inquiryAdminPage.assignSales')}
                        </AdminButton>
                      ) : null}
                      <AdminButton
                        onClick={() => setDeleteTarget(inq)}
                        disabled={deletingId === inq.id}
                        size="sm"
                        variant="danger"
                      >
                        {deletingId === inq.id ? t('inquiryAdminPage.deleting') : t('inquiryAdminPage.deleteRecord')}
                      </AdminButton>
                    </div>
                  </AdminGridRow>
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
        title={t('inquiryAdminPage.confirmTitle')}
        description={t('inquiryAdminPage.confirmDesc')}
        confirmLabel={t('inquiryAdminPage.confirmDeleteLabel')}
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
  const { t } = useTranslation();
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
  const [exporting, setExporting] = useState(false);
  const { settings } = usePublicSettings();
  const business = useMemo(() => getBusinessConfig(settings), [settings]);
  const statuses = business.inquiryStatuses;
  const statusTabs = useMemo(
    () => [
      { value: 'all', label: t('inquiryAdminPage.tabAll') },
      ...statuses.filter((s) => s.tab).map((s) => ({ value: s.value, label: s.label })),
    ],
    [statuses, t],
  );
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
      toast(t('inquiryAdminPage.inquiryDeleted'), 'success');
    } catch (err) {
      toast(getErrorMessage(err, t('inquiryAdminPage.deleteFail')), 'error');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRefresh() {
    try {
      await setSize(1);
      await Promise.all([
        refreshInquiries(undefined, { revalidate: true }),
        refreshCounts(undefined, { revalidate: true }),
      ]);
      toast(t('inquiryAdminPage.dataRefreshed'), 'success');
    } catch (err) {
      toast(getErrorMessage(err, t('inquiryAdminPage.refreshFail')), 'error');
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const exportItems = await fetchAllFilteredInquiries(statusFilter, search);
      if (exportItems.length === 0) {
        toast(t('inquiryAdminPage.exportEmpty'), 'error');
        return;
      }
      const suffix = [statusFilter === 'all' ? 'all' : statusFilter, search ? 'search' : ''].filter(Boolean).join('_');
      await exportInquiriesEditableXlsx({
        inquiries: exportItems,
        statuses,
        filenamePrefix: `inquiries_${suffix}`,
      });
      toast(t('inquiryAdminPage.exportSuccess', { count: exportItems.length }), 'success');
    } catch (err) {
      toast(getErrorMessage(err, t('inquiryAdminPage.exportFail')), 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <AdminManagementPage
        title={t('inquiryAdminPage.title')}
        description={t('inquiryAdminPage.description')}
        actions={
          <>
            <AdminIconButton
              onClick={handleExport}
              disabled={exporting || isLoading}
              icon="download"
              iconClassName={exporting ? 'animate-pulse' : ''}
              aria-label={exporting ? t('inquiryAdminPage.ariaExporting') : t('inquiryAdminPage.ariaExport')}
            />
            <AdminRefreshButton
              onRefresh={handleRefresh}
              ariaLabel={t('inquiryAdminPage.ariaRefresh')}
              mobileIconOnly
            />
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
            <AdminLoadingState variant="list" rows={5} label={t('inquiryAdminPage.loadingLabel')} />
          ) : inquiries.length === 0 ? (
            <AdminEmptyState
              icon="request_quote"
              title={t('inquiryAdminPage.emptyTitle')}
              description={t('inquiryAdminPage.emptyDesc')}
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
                        {t(`inquiryStatus.${inq.status}.label`, { defaultValue: info.label })}
                      </span>
                      <span className="text-[10px] text-on-surface-variant">
                        {new Date(inq.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    <p className="text-sm text-on-surface mb-1 line-clamp-2 break-words">
                      {inq.items.map((it) => it.modelNo || it.productName).join('、')}
                    </p>
                    <div className="text-xs text-on-surface-variant">
                      <span className="block min-w-0 break-words">
                        {t('inquiryAdminPage.customerMeta', {
                          name: inq.contactName || inq.user?.username || '—',
                          count: inq.items.length,
                        })}
                        {inq.salesAssignee
                          ? t('inquiryAdminPage.followBySuffix', { name: inq.salesAssignee.username })
                          : ''}
                      </span>
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-outline-variant/10 pt-3">
                        <AdminButton
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/admin/inquiries/${inq.id}`);
                          }}
                          size="sm"
                          variant="tonal"
                        >
                          {t('inquiryAdminPage.actionHandle')}
                        </AdminButton>
                        {inq.status !== 'cancelled' && inq.status !== 'rejected' ? (
                          <AdminButton
                            onClick={(event) => {
                              event.stopPropagation();
                              setAssignmentTarget(inq);
                            }}
                            size="sm"
                            variant="success"
                          >
                            {inq.salesAssignee ? t('inquiryAdminPage.reassign') : t('inquiryAdminPage.assignSales')}
                          </AdminButton>
                        ) : null}
                        <AdminButton
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeleteTarget(inq);
                          }}
                          disabled={deletingId === inq.id}
                          size="sm"
                          variant="danger"
                        >
                          {deletingId === inq.id ? t('inquiryAdminPage.deleting') : t('inquiryAdminPage.deleteRecord')}
                        </AdminButton>
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
        title={t('inquiryAdminPage.confirmTitle')}
        description={t('inquiryAdminPage.confirmDesc')}
        confirmLabel={t('inquiryAdminPage.confirmDeleteLabel')}
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
  const { t } = useTranslation();
  useDocumentTitle(t('inquiryAdminPage.title'));
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
