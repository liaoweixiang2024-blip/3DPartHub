import { useState } from 'react';
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
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
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

export default function InviteAdminPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('invites.adminTitle'));
  const { data, error, isLoading, mutate } = useSWR<AdminInviteItem[]>('/admin/invites', () => invitesApi.adminList());
  const [statusFilter, setStatusFilter] = useState('');
  const items = data ?? [];
  const activeCount = items.filter((i) => i.status === 'active').length;
  const usedCount = items.filter((i) => i.status === 'used').length;
  const revokedCount = items.filter((i) => i.status === 'revoked').length;
  const filteredItems = statusFilter ? items.filter((i) => i.status === statusFilter) : items;

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
        toolbar={
          /* 状态分组与用户管理页同款 tab：计数即筛选。必须走 toolbar 而非 children：
             空状态的 absolute inset-0 覆盖层位于内容区内部，会把 children 里的 tabs 盖死 */
          <ResponsiveSectionTabs
            tabs={[
              { value: '', label: '全部', count: items.length, icon: 'card_giftcard' },
              { value: 'active', label: t('invites.status.active'), count: activeCount, icon: 'hourglass_empty' },
              { value: 'used', label: t('invites.status.used'), count: usedCount, icon: 'check_circle' },
              { value: 'revoked', label: t('invites.status.revoked'), count: revokedCount, icon: 'block' },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            mobileTitle="邀请码状态"
            countUnit="个"
          />
        }
      >
        {items.length === 0 ? (
          <AdminEmptyState icon="card_giftcard" title={t('invites.emptyTitle')} description={t('invites.emptyDesc')} />
        ) : filteredItems.length === 0 ? (
          <AdminEmptyState
            icon="card_giftcard"
            title="该状态下暂无邀请码"
            description="切换上方状态分类查看其他邀请码。"
          />
        ) : (
          <div className="flex flex-col gap-2 pt-3">
            {filteredItems.map((item) => (
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
