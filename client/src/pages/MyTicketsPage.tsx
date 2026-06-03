import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import client from '../api/client';
import { AdminEmptyState, AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useVisibleItems } from '../hooks/useVisibleItems';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getBusinessConfig, statusInfo } from '../lib/businessConfig';
import { usePublicSettings } from '../lib/publicSettings';

interface MyTicket {
  id: string;
  basePart: string | null;
  classification: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_TICKET_STATUS_KEYS = new Set(['open', 'waiting_user', 'in_progress', 'resolved', 'closed']);
const DEFAULT_TICKET_CLASSIFICATION_KEYS = new Set(['dimension', 'material', 'novel', 'topology']);

function getTicketStatusLabel(status: string, fallback: string, t: TFunction) {
  return DEFAULT_TICKET_STATUS_KEYS.has(status) ? t(`ticketStatus.${status}`) : fallback;
}

function getTicketClassificationLabel(value: string, fallback: string, t: TFunction) {
  return DEFAULT_TICKET_CLASSIFICATION_KEYS.has(value) ? t(`ticketClassification.${value}.label`) : fallback;
}

function useMyTickets() {
  return useSWR<MyTicket[]>('/my-tickets', () =>
    client
      .get('/my-tickets')
      .then((r) => {
        const d = r.data;
        if (Array.isArray(d)) return d;
        if (d?.data && Array.isArray(d.data)) return d.data;
        return [];
      })
      .catch(() => []),
  );
}

function Content() {
  const { i18n, t } = useTranslation();
  const { data: tickets, isLoading, mutate } = useMyTickets();
  const { settings } = usePublicSettings();
  const business = getBusinessConfig(settings);
  const classificationMap = new Map(business.ticketClassifications.map((item) => [item.value, item.label]));
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);

  const list = tickets || [];
  const { visibleItems: visibleTickets, hasMore, loadMore } = useVisibleItems(list, 60, String(list.length));

  return (
    <AdminManagementPage
      title={t('myTickets.title')}
      meta={t('myTickets.meta', { count: list.length })}
      description={t('myTickets.description')}
      actions={
        list.length > 0 ? (
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
              {refreshing ? t('myTickets.refreshing') : t('myTickets.refresh')}
            </button>
            <Link
              to="/support"
              className="flex items-center gap-2 rounded-lg bg-primary-container px-5 py-2.5 text-sm font-medium text-on-primary hover:opacity-90"
            >
              <Icon name="add" size={16} />
              {t('myTickets.actionCreate')}
            </Link>
          </>
        ) : null
      }
    >
      {isLoading ? (
        <AdminLoadingState
          variant="table"
          label={t('myTickets.loading')}
          tableColumns="120px 120px minmax(0,1fr) 140px 160px"
          tableCells={['chip', 'chip', 'title', 'text', 'text']}
        />
      ) : list.length === 0 ? (
        <AdminEmptyState
          icon="inbox"
          title={t('myTickets.emptyTitle')}
          description={t('myTickets.emptyDescription')}
          action={
            <Link
              to="/support"
              className="rounded-md bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
            >
              {t('myTickets.emptyAction')}
            </Link>
          }
        />
      ) : (
        <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-auto">
          {/* Table header */}
          <div className="grid grid-cols-[120px_120px_1fr_140px_160px] gap-4 px-6 py-3 bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant font-bold border-b border-outline-variant/10 sticky top-0 z-10">
            <span>{t('myTickets.status')}</span>
            <span>{t('myTickets.category')}</span>
            <span>{t('myTickets.tableDescription')}</span>
            <span>{t('myTickets.basePart')}</span>
            <span>{t('myTickets.time')}</span>
          </div>
          {/* Table rows */}
          {visibleTickets.map((ticket) => {
            const info = statusInfo(business.ticketStatuses, ticket.status);
            const statusLabel = getTicketStatusLabel(ticket.status, info.label, t);
            const classificationLabel = getTicketClassificationLabel(
              ticket.classification,
              classificationMap.get(ticket.classification) || ticket.classification,
              t,
            );
            return (
              <div
                key={ticket.id}
                onClick={() => navigate(`/my-tickets/${ticket.id}`)}
                className="grid grid-cols-[120px_120px_1fr_140px_160px] gap-4 px-6 py-4 border-b border-outline-variant/5 hover:bg-surface-container-high/50 transition-colors items-center cursor-pointer"
              >
                <span
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-bold w-fit ${info.color || ''} ${info.bg || ''}`}
                >
                  <Icon
                    name={
                      ticket.status === 'resolved'
                        ? 'check_circle'
                        : ticket.status === 'in_progress'
                          ? 'build'
                          : ticket.status === 'waiting_user'
                            ? 'chat'
                            : 'schedule'
                    }
                    size={12}
                  />
                  {statusLabel}
                </span>
                <span className="text-xs text-on-surface-variant">{classificationLabel}</span>
                <p className="text-sm text-on-surface truncate">{ticket.description}</p>
                <span className="text-xs text-on-surface-variant truncate">{ticket.basePart || '—'}</span>
                <span className="text-xs text-on-surface-variant flex items-center gap-1">
                  <Icon name="schedule" size={12} className="shrink-0" />
                  {new Date(ticket.createdAt).toLocaleDateString(i18n.language)}
                </span>
              </div>
            );
          })}
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
        </div>
      )}
    </AdminManagementPage>
  );
}

function MobileContent() {
  const { i18n, t } = useTranslation();
  const { data: tickets, isLoading, mutate } = useMyTickets();
  const { settings } = usePublicSettings();
  const business = getBusinessConfig(settings);
  const classificationMap = new Map(business.ticketClassifications.map((item) => [item.value, item.label]));
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);

  const list = tickets || [];
  const { visibleItems: visibleTickets, hasMore, loadMore } = useVisibleItems(list, 40, String(list.length));

  return (
    <AdminManagementPage
      title={t('myTickets.title')}
      meta={t('myTickets.meta', { count: list.length })}
      description={t('myTickets.description')}
      actions={
        list.length > 0 ? (
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
              to="/support"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary-container px-3 text-xs font-medium text-on-primary"
            >
              <Icon name="add" size={14} />
              {t('myTickets.actionCreateShort')}
            </Link>
          </>
        ) : null
      }
    >
      {isLoading ? (
        <AdminLoadingState variant="list" rows={5} label={t('myTickets.loading')} />
      ) : list.length === 0 ? (
        <AdminEmptyState
          icon="inbox"
          title={t('myTickets.emptyTitle')}
          description={t('myTickets.emptyDescription')}
          action={
            <Link
              to="/support"
              className="rounded-md bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
            >
              {t('myTickets.emptyAction')}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {visibleTickets.map((ticket) => {
            const info = statusInfo(business.ticketStatuses, ticket.status);
            const statusLabel = getTicketStatusLabel(ticket.status, info.label, t);
            const classificationLabel = getTicketClassificationLabel(
              ticket.classification,
              classificationMap.get(ticket.classification) || ticket.classification,
              t,
            );
            return (
              <div
                key={ticket.id}
                onClick={() => navigate(`/my-tickets/${ticket.id}`)}
                className="bg-surface-container-high rounded-lg p-3.5 cursor-pointer active:bg-surface-container-highest transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-sm font-bold ${info.color || ''} ${info.bg || ''}`}>
                    {statusLabel}
                  </span>
                  <span className="text-[10px] text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded-sm">
                    {classificationLabel}
                  </span>
                </div>
                <p className="text-sm text-on-surface whitespace-pre-wrap break-words mb-2 line-clamp-3">
                  {ticket.description}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-on-surface-variant">
                  {ticket.basePart && (
                    <span className="break-all">{t('myTickets.basePartPrefix', { part: ticket.basePart })}</span>
                  )}
                  <span className="flex items-center gap-1 shrink-0">
                    <Icon name="schedule" size={11} />
                    {new Date(ticket.createdAt).toLocaleDateString(i18n.language)}
                  </span>
                </div>
              </div>
            );
          })}
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
        </div>
      )}
    </AdminManagementPage>
  );
}

export default function MyTicketsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('myTickets.title'));
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <Content /> : <MobileContent />}</AdminPageShell>;
}
