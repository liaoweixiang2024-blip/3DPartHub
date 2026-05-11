import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { getMyInquiries } from '../api/inquiries';
import InquirySubmitDialog from '../components/inquiry/InquirySubmitDialog';
import { AdminEmptyState, AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useInquiryCart } from '../hooks/useInquiryCart';
import { useVisibleItems } from '../hooks/useVisibleItems';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import type { InquiryCartItem } from '../lib/inquiryCart';
import { getCustomerInquiryStatusView } from '../lib/inquiryCustomerStatus';

function StatusBadge({ status }: { status: string }) {
  const info = getCustomerInquiryStatusView(status);
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold ${info.badgeClassName}`}>
      {info.label}
    </span>
  );
}

function getCartItemTitle(item: InquiryCartItem) {
  if (item.modelNo && item.productName && item.productName !== item.modelNo) {
    return `${item.modelNo} · ${item.productName}`;
  }
  return item.modelNo || item.productName;
}

function getCustomerProgressText(status: string) {
  return getCustomerInquiryStatusView(status).progress;
}

function HistoryDivider({ count }: { count: number }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-on-surface-variant">
      <span>已提交询价</span>
      <span className="h-px flex-1 bg-outline-variant/10" />
      <span>{count} 条</span>
    </div>
  );
}

function HistoryEmpty() {
  return (
    <AdminEmptyState
      icon="request_quote"
      title="还没有提交询价"
      description="先在选型页把产品加入询价清单，提交后可在这里查看业务回复和处理进度。"
      action={
        <Link
          to="/selection"
          className="rounded-md bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
        >
          去选型
        </Link>
      }
    />
  );
}

function InquiryCartSection({ compact, onSubmitted }: { compact?: boolean; onSubmitted: () => void }) {
  const cart = useInquiryCart();
  const [submitOpen, setSubmitOpen] = useState(false);

  if (cart.items.length === 0) return null;

  return (
    <>
      <div className="mb-3 overflow-hidden rounded-lg border border-outline-variant/12 bg-surface-container-low">
        <div className="flex flex-col gap-2 border-b border-outline-variant/10 px-3 py-2.5 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Icon name="request_quote" size={15} className="text-primary-container" />
            <h2 className="text-xs font-semibold text-on-surface md:text-sm">待提交询价清单</h2>
            <span className="rounded-md bg-primary-container/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary-container">
              {cart.items.length} 项
            </span>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Link
              to="/selection"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-outline-variant/20 px-2.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high/50"
            >
              <Icon name="add" size={13} />
              继续选型
            </Link>
            <button
              onClick={cart.clear}
              className="h-8 px-2 text-xs font-medium text-on-surface-variant hover:text-on-surface"
            >
              清空
            </button>
            <button
              onClick={() => setSubmitOpen(true)}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-primary-container px-2.5 text-xs font-semibold text-on-primary hover:opacity-90"
            >
              <Icon name="send" size={13} />
              提交
            </button>
          </div>
        </div>

        <div className={`${compact ? 'divide-y divide-outline-variant/8' : 'divide-y divide-outline-variant/10'}`}>
          {cart.items.map((item) => (
            <div
              key={item.id}
              className="grid gap-2 px-3 py-2 md:grid-cols-[minmax(0,1fr)_70px_minmax(120px,200px)_28px] md:items-center"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-on-surface md:text-[13px]">{getCartItemTitle(item)}</p>
                <p className="mt-0.5 truncate text-[11px] text-on-surface-variant">
                  {Object.entries(item.specs || {})
                    .filter(([, value]) => value && value !== '—')
                    .slice(0, 2)
                    .map(([key, value]) => `${key}:${value}`)
                    .join(' ') || '待提交询价'}
                </p>
              </div>
              <input
                type="number"
                min={1}
                value={item.qty}
                onChange={(event) => cart.updateItem(item.id, { qty: Math.max(1, parseInt(event.target.value) || 1) })}
                className="h-8 rounded-md border border-outline-variant/20 bg-surface-container px-2 text-center text-xs text-on-surface outline-none focus:border-primary-container"
                aria-label="询价数量"
              />
              <input
                value={item.remark}
                onChange={(event) => cart.updateItem(item.id, { remark: event.target.value })}
                placeholder="备注"
                className="h-8 min-w-0 rounded-md border border-outline-variant/20 bg-surface-container px-2 text-xs text-on-surface outline-none focus:border-primary-container"
              />
              <button
                onClick={() => cart.removeItem(item.id)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                aria-label="移出询价清单"
              >
                <Icon name="delete" size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <InquirySubmitDialog
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        items={cart.items}
        onSubmitted={() => {
          cart.clear();
          onSubmitted();
        }}
      />
    </>
  );
}

function DesktopContent() {
  const { data: inquiries = [], isLoading, mutate } = useSWR('my-inquiries', getMyInquiries);
  const cart = useInquiryCart();
  const hasPendingCart = cart.items.length > 0;
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  const {
    visibleItems: visibleInquiries,
    hasMore,
    loadMore,
  } = useVisibleItems(inquiries, 60, String(inquiries.length));

  return (
    <AdminManagementPage
      title="我的询价记录"
      meta={`${inquiries.length} 条记录`}
      description="客户入口：查看已提交询价、业务回复和后续对接进度"
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
              发起询价
            </Link>
          </>
        ) : null
      }
    >
      <InquiryCartSection onSubmitted={() => mutate()} />
      <section className="flex min-h-0 flex-1 flex-col">
        {hasPendingCart && inquiries.length > 0 ? <HistoryDivider count={inquiries.length} /> : null}
        {isLoading ? (
          <AdminLoadingState
            variant="table"
            label="询价记录加载中"
            tableColumns="88px minmax(0,1fr) 220px 120px"
            tableCells={['chip', 'title', 'text', 'action']}
          />
        ) : inquiries.length === 0 && !hasPendingCart ? (
          <HistoryEmpty />
        ) : inquiries.length === 0 ? null : (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-outline-variant/10 bg-surface-container-low">
            <div className="sticky top-0 z-10 grid grid-cols-[88px_minmax(0,1fr)_220px_120px] gap-4 border-b border-outline-variant/10 bg-surface-container-low px-6 py-3 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              <span>状态</span>
              <span>询价内容</span>
              <span>当前进度</span>
              <span>查看</span>
            </div>
            {visibleInquiries.map((inq) => (
              <div
                key={inq.id}
                className="grid grid-cols-[88px_minmax(0,1fr)_220px_120px] items-center gap-4 border-b border-outline-variant/5 px-6 py-4 transition-colors hover:bg-surface-container-high/50"
              >
                <StatusBadge status={inq.status} />
                <div className="min-w-0">
                  <p className="truncate text-sm text-on-surface">
                    {inq.items.map((it) => it.modelNo || it.productName).join('、')}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    {inq.items.length} 个产品 · 提交于 {new Date(inq.createdAt).toLocaleDateString('zh-CN')}
                  </p>
                </div>
                <span className="text-xs leading-relaxed text-on-surface-variant">
                  {getCustomerProgressText(inq.status)}
                </span>
                <button
                  onClick={() => navigate(`/my-inquiries/${inq.id}`)}
                  className="text-xs text-primary-container hover:underline"
                >
                  查看进度
                </button>
              </div>
            ))}
            <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
          </div>
        )}
      </section>
    </AdminManagementPage>
  );
}

function MobileContent() {
  const { data: inquiries = [], isLoading, mutate } = useSWR('my-inquiries', getMyInquiries);
  const cart = useInquiryCart();
  const hasPendingCart = cart.items.length > 0;
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  const {
    visibleItems: visibleInquiries,
    hasMore,
    loadMore,
  } = useVisibleItems(inquiries, 40, String(inquiries.length));

  return (
    <AdminManagementPage
      title="我的询价记录"
      meta={`${inquiries.length} 条记录`}
      description="客户入口：查看业务回复和后续对接进度"
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
              发起
            </Link>
          </>
        ) : null
      }
    >
      <InquiryCartSection compact onSubmitted={() => mutate()} />
      <section className="flex min-h-0 flex-1 flex-col">
        {hasPendingCart && inquiries.length > 0 ? <HistoryDivider count={inquiries.length} /> : null}
        {isLoading ? (
          <AdminLoadingState variant="list" rows={5} label="询价记录加载中" />
        ) : inquiries.length === 0 && !hasPendingCart ? (
          <HistoryEmpty />
        ) : inquiries.length === 0 ? null : (
          <div className="flex flex-col gap-2.5">
            {visibleInquiries.map((inq) => (
              <div
                key={inq.id}
                onClick={() => navigate(`/my-inquiries/${inq.id}`)}
                className="cursor-pointer rounded-lg bg-surface-container-high p-3.5 transition-colors active:bg-surface-container-highest"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={inq.status} />
                  <span className="text-[11px] text-on-surface-variant">
                    {new Date(inq.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
                <p className="mb-1 line-clamp-2 break-words text-sm text-on-surface">
                  {inq.items.map((it) => it.modelNo || it.productName).join('、')}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
                  <span>{getCustomerProgressText(inq.status)}</span>
                  <span>查看进度</span>
                </div>
              </div>
            ))}
            <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
          </div>
        )}
      </section>
    </AdminManagementPage>
  );
}

export default function MyInquiriesPage() {
  useDocumentTitle('我的询价记录');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
