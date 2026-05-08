import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { getMyInquiries } from '../api/inquiries';
import { AdminEmptyState, AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useVisibleItems } from '../hooks/useVisibleItems';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getBusinessConfig, statusInfo, type StatusConfig } from '../lib/businessConfig';
import { getCachedPublicSettings } from '../lib/publicSettings';

function StatusBadge({ status, statuses }: { status: string; statuses: StatusConfig[] }) {
  const info = statusInfo(statuses, status);
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md font-bold ${info.color || ''} ${info.bg || ''}`}
    >
      {info.label}
    </span>
  );
}

function DesktopContent() {
  const { data: inquiries = [], isLoading, mutate } = useSWR('my-inquiries', getMyInquiries);
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
  const statuses = getBusinessConfig(settings).inquiryStatuses;
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  const {
    visibleItems: visibleInquiries,
    hasMore,
    loadMore,
  } = useVisibleItems(inquiries, 60, String(inquiries.length));

  return (
    <AdminManagementPage
      title="我的询价"
      meta={`${inquiries.length} 条记录`}
      description="查看你提交过的选型询价和处理进度"
      actions={
        inquiries.length > 0 ? (
          <>
            <button
              onClick={() => {
                setRefreshing(true);
                mutate().finally(() => setRefreshing(false));
              }}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-lg border border-outline-variant/20 px-4 py-2.5 text-sm text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50"
            >
              <Icon name="refresh" size={16} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? '刷新中...' : '刷新'}
            </button>
            <Link
              to="/selection"
              className="flex items-center gap-2 rounded-lg bg-primary-container px-5 py-2.5 text-sm font-medium text-on-primary hover:opacity-90"
            >
              <Icon name="add" size={16} />
              新建询价
            </Link>
          </>
        ) : null
      }
    >
      {isLoading ? (
        <AdminLoadingState
          variant="table"
          label="询价记录加载中"
          tableColumns="80px minmax(0,1fr) 120px 140px"
          tableCells={['chip', 'title', 'text', 'action']}
        />
      ) : inquiries.length === 0 ? (
        <AdminEmptyState
          icon="request_quote"
          title="暂无询价记录"
          description="提交选型询价后，可以在这里查看处理进度和历史记录。"
          action={
            <Link
              to="/selection"
              className="rounded-md bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
            >
              去选型
            </Link>
          }
        />
      ) : (
        <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-auto">
          <div className="grid grid-cols-[80px_1fr_120px_140px] gap-4 px-6 py-3 bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant font-bold border-b border-outline-variant/10 sticky top-0 z-10">
            <span>状态</span>
            <span>产品</span>
            <span>时间</span>
            <span>操作</span>
          </div>
          {visibleInquiries.map((inq) => (
            <div
              key={inq.id}
              className="grid grid-cols-[80px_1fr_120px_140px] gap-4 px-6 py-4 border-b border-outline-variant/5 hover:bg-surface-container-high/50 transition-colors items-center"
            >
              <StatusBadge status={inq.status} statuses={statuses} />
              <div className="min-w-0">
                <p className="text-sm text-on-surface truncate">
                  {inq.items.map((it) => it.modelNo || it.productName).join('、')}
                </p>
                <p className="text-xs text-on-surface-variant">{inq.items.length} 个产品</p>
              </div>
              <span className="text-xs text-on-surface-variant">
                {new Date(inq.createdAt).toLocaleDateString('zh-CN')}
              </span>
              <button
                onClick={() => navigate(`/my-inquiries/${inq.id}`)}
                className="text-xs text-primary-container hover:underline"
              >
                查看详情
              </button>
            </div>
          ))}
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
        </div>
      )}
    </AdminManagementPage>
  );
}

function MobileContent() {
  const { data: inquiries = [], isLoading, mutate } = useSWR('my-inquiries', getMyInquiries);
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
  const statuses = getBusinessConfig(settings).inquiryStatuses;
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  const {
    visibleItems: visibleInquiries,
    hasMore,
    loadMore,
  } = useVisibleItems(inquiries, 40, String(inquiries.length));

  return (
    <AdminManagementPage
      title="我的询价"
      meta={`${inquiries.length} 条记录`}
      description="查看你提交过的选型询价和处理进度"
      actions={
        inquiries.length > 0 ? (
          <>
            <button
              onClick={() => {
                setRefreshing(true);
                mutate().finally(() => setRefreshing(false));
              }}
              disabled={refreshing}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant/20 px-3 text-xs text-on-surface-variant disabled:opacity-50"
            >
              <Icon name="refresh" size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <Link
              to="/selection"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary-container px-3 text-xs font-medium text-on-primary"
            >
              <Icon name="add" size={14} />
              新建
            </Link>
          </>
        ) : null
      }
    >
      {isLoading ? (
        <AdminLoadingState variant="list" rows={5} label="询价记录加载中" />
      ) : inquiries.length === 0 ? (
        <AdminEmptyState
          icon="request_quote"
          title="暂无询价记录"
          description="提交选型询价后，可以在这里查看处理进度和历史记录。"
          action={
            <Link
              to="/selection"
              className="rounded-md bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
            >
              去选型
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {visibleInquiries.map((inq) => (
            <div
              key={inq.id}
              onClick={() => navigate(`/my-inquiries/${inq.id}`)}
              className="bg-surface-container-high rounded-lg p-3.5 cursor-pointer active:bg-surface-container-highest transition-colors"
            >
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <StatusBadge status={inq.status} statuses={statuses} />
                <span className="text-[11px] text-on-surface-variant">
                  {new Date(inq.createdAt).toLocaleDateString('zh-CN')}
                </span>
              </div>
              <p className="text-sm text-on-surface mb-1 line-clamp-2 break-words">
                {inq.items.map((it) => it.modelNo || it.productName).join('、')}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
                <span>{inq.items.length} 个产品</span>
                <span>查看详情</span>
              </div>
            </div>
          ))}
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
        </div>
      )}
    </AdminManagementPage>
  );
}

export default function MyInquiriesPage() {
  useDocumentTitle('我的询价');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
