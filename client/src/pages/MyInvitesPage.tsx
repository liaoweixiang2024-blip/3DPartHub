import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { invitesApi, type InviteItem } from '../api/invites';
import {
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminManagementPage,
} from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { copyText } from '../lib/clipboard';
import { getErrorMessage } from '../lib/errorNotifications';
import { buildInviteUrl } from '../lib/inviteUrl';
import { usePublicSettings } from '../lib/publicSettings';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-primary-container/15 text-primary',
  used: 'bg-surface-container-highest text-on-surface-variant',
  revoked: 'bg-error/15 text-error',
};

function InviteRow({ item, origin, onRevoke }: { item: InviteItem; origin: string; onRevoke: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const inviteUrl = buildInviteUrl(item.code, origin);
  const used = item.status === 'used' || !!item.usedBy;

  async function copy(value: string, label: string) {
    try {
      await copyText(value);
      toast(t('invites.copied', { label }), 'success');
    } catch {
      toast(t('invites.copyFail'), 'error');
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-outline-variant/15 bg-surface-container-high px-3 py-2.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
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
          {used && item.usedBy ? (
            <span className="text-xs text-on-surface-variant">
              {t('invites.usedBy', { name: item.usedBy.username })}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-on-surface-variant/70">
          <span>
            {t('invites.created')}：{new Date(item.createdAt).toLocaleString()}
          </span>
          {item.expiresAt ? (
            <span>
              · {t('invites.expires')}：{new Date(item.expiresAt).toLocaleString()}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <button
          onClick={() => copy(item.code, t('invites.codeLabel'))}
          className="flex items-center gap-1 rounded-md border border-outline-variant/20 px-2.5 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high"
        >
          <Icon name="content_copy" size={14} />
          {t('invites.copyCode')}
        </button>
        <button
          onClick={() => copy(inviteUrl, t('invites.linkLabel'))}
          className="flex items-center gap-1 rounded-md bg-primary-container px-2.5 py-1.5 text-xs font-medium text-on-primary-container hover:opacity-90"
        >
          <Icon name="link" size={14} />
          {t('invites.copyLink')}
        </button>
        {!used ? (
          <button
            onClick={onRevoke}
            className="flex items-center gap-1 rounded-md border border-error/20 px-2.5 py-1.5 text-xs text-error hover:bg-error/10"
          >
            <Icon name="delete" size={14} />
            {t('invites.revoke')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function MyInvitesPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.myInvites'));
  const { toast } = useToast();
  const { data, error, isLoading, mutate } = useSWR<InviteItem[]>('/invites', () => invitesApi.list());
  const [creating, setCreating] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const items = data ?? [];
  const { settings } = usePublicSettings();
  const maxActive = settings?.invite_max_active_per_user ?? 10;
  const activeCount = items.filter((i) => i.status === 'active').length;
  const atLimit = maxActive > 0 && activeCount >= maxActive;

  async function handleCreate() {
    setCreating(true);
    try {
      await invitesApi.create();
      await mutate();
      toast(t('invites.createSuccess'), 'success');
    } catch (err) {
      toast(getErrorMessage(err, t('invites.createFail')), 'error');
    } finally {
      setCreating(false);
    }
  }

  async function confirmRevoke() {
    if (!revokeId) return;
    try {
      await invitesApi.revoke(revokeId);
      await mutate();
      toast(t('invites.revokeSuccess'), 'success');
    } catch (err) {
      toast(getErrorMessage(err, t('invites.revokeFail')), 'error');
    } finally {
      setRevokeId(null);
    }
  }

  const headerActions = (
    <button
      onClick={handleCreate}
      disabled={creating || atLimit}
      title={atLimit ? t('invites.limitReached') : undefined}
      className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary disabled:opacity-50"
    >
      <Icon name={creating ? 'progress_activity' : 'add'} size={16} className={creating ? 'animate-spin' : ''} />
      {creating ? t('invites.creating') : t('invites.create')}
    </button>
  );

  if (isLoading) {
    return (
      <AdminPageShell>
        <AdminManagementPage title={t('invites.title')} description={t('invites.description')}>
          <AdminLoadingState variant="list" rows={3} label={t('invites.loading')} />
        </AdminManagementPage>
      </AdminPageShell>
    );
  }

  if (error) {
    return (
      <AdminPageShell>
        <AdminManagementPage title={t('invites.title')} description={t('invites.description')}>
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
        title={t('invites.title')}
        meta={
          maxActive > 0
            ? t('invites.activeLimit', { active: activeCount, max: maxActive })
            : t('invites.count', { count: items.length })
        }
        description={t('invites.description')}
        actions={headerActions}
      >
        {items.length === 0 ? (
          <AdminEmptyState
            icon="card_giftcard"
            title={t('invites.emptyTitle')}
            description={t('invites.emptyDesc')}
            action={
              <button
                onClick={handleCreate}
                className="rounded-md bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary-container transition-opacity hover:opacity-90"
              >
                {t('invites.create')}
              </button>
            }
          />
        ) : (
          <div className="flex flex-col gap-2 pb-20">
            {items.map((item) => (
              <InviteRow key={item.id} item={item} origin={origin} onRevoke={() => setRevokeId(item.id)} />
            ))}
          </div>
        )}
        <ConfirmDialog
          open={!!revokeId}
          onClose={() => setRevokeId(null)}
          onConfirm={confirmRevoke}
          icon="delete"
          iconColor="text-error"
          iconBg="bg-error/15"
          title={t('invites.confirmRevokeTitle')}
          description={t('invites.confirmRevokeDesc')}
          confirmLabel={t('invites.revoke')}
          confirmClassName="flex-1 py-2.5 text-sm font-medium text-on-primary bg-error rounded-lg hover:opacity-90 transition-opacity"
        />
      </AdminManagementPage>
    </AdminPageShell>
  );
}
