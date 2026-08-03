import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { invitesApi, type AdminInviteItem } from '../api/invites';
import {
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminManagementPage,
} from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-primary-container/15 text-primary',
  used: 'bg-surface-container-highest text-on-surface-variant',
  revoked: 'bg-error/15 text-error',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-outline-variant/15 bg-surface-container-high px-4 py-2.5">
      <span className={`text-lg font-bold ${tone}`}>{value}</span>
      <span className="text-xs text-on-surface-variant">{label}</span>
    </div>
  );
}

export default function InviteAdminPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('invites.adminTitle'));
  const { data, error, isLoading, mutate } = useSWR<AdminInviteItem[]>('/admin/invites', () => invitesApi.adminList());
  const items = data ?? [];
  const activeCount = items.filter((i) => i.status === 'active').length;
  const usedCount = items.filter((i) => i.status === 'used').length;
  const revokedCount = items.filter((i) => i.status === 'revoked').length;

  if (isLoading) {
    return (
      <AdminPageShell>
        <AdminManagementPage title={t('invites.adminTitle')} description={t('invites.adminDescription')}>
          <AdminLoadingState variant="list" rows={5} label={t('invites.loading')} />
        </AdminManagementPage>
      </AdminPageShell>
    );
  }

  if (error) {
    return (
      <AdminPageShell>
        <AdminManagementPage title={t('invites.adminTitle')} description={t('invites.adminDescription')}>
          <AdminErrorState
            title={t('invites.loadFailed')}
            description={t('invites.loadFailedDesc')}
            onRetry={() => mutate()}
          />
        </AdminManagementPage>
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell>
      <AdminManagementPage
        title={t('invites.adminTitle')}
        meta={t('invites.count', { count: items.length })}
        description={t('invites.adminDescription')}
      >
        <div className="mb-4 flex flex-wrap gap-3">
          <Stat label={t('invites.status.active')} value={activeCount} tone="text-primary" />
          <Stat label={t('invites.status.used')} value={usedCount} tone="text-on-surface-variant" />
          <Stat label={t('invites.status.revoked')} value={revokedCount} tone="text-error" />
        </div>

        {items.length === 0 ? (
          <AdminEmptyState
            icon="card_giftcard"
            title={t('invites.emptyTitle')}
            description={t('invites.adminDescription')}
          />
        ) : (
          <div className="flex flex-col gap-2 pb-20">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-1.5 rounded-lg border border-outline-variant/15 bg-surface-container-high px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-surface-container-lowest px-2 py-0.5 font-mono text-sm text-on-surface">
                    {item.code}
                  </code>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      STATUS_STYLE[item.status] || STATUS_STYLE.used
                    }`}
                  >
                    {t(`invites.status.${item.status}`, { defaultValue: item.status })}
                  </span>
                  {item.note ? <span className="truncate text-xs text-on-surface-variant/70">{item.note}</span> : null}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-on-surface-variant/80">
                  <span>
                    {t('invites.creator')}：{item.createdBy?.username ?? '—'}
                  </span>
                  {item.usedBy ? <span>{t('invites.usedBy', { name: item.usedBy.username })}</span> : null}
                  <span>
                    {t('invites.created')}：{formatDate(item.createdAt)}
                  </span>
                  {item.expiresAt ? (
                    <span>
                      · {t('invites.expires')}：{formatDate(item.expiresAt)}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminManagementPage>
    </AdminPageShell>
  );
}
