import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import client from '../../api/client';
import { unwrapResponse } from '../../api/response';
import { getErrorMessage } from '../../lib/errorNotifications';
import { useAuthStore } from '../../stores/useAuthStore';
import DialogOverlay from '../shared/DialogOverlay';
import SelectMenu from '../shared/SelectMenu';
import Icon from '../shared/Icon';
import { useToast } from '../shared/Toast';
import { useTranslation } from 'react-i18next';

export interface AdminUserDetail {
  id: string;
  username: string;
  email: string;
  role: string;
  company: string | null;
  phone: string | null;
  department: string | null;
  bio: string | null;
  disabled: boolean;
  mustChangePassword: boolean;
  canInvite: boolean;
  lastLoginAt: string | null;
  lastActiveAt?: string | null;
  createdAt: string;
  _count: { downloads: number; favorites: number };
}

interface AuditItem {
  id: string;
  action: string;
  details: unknown;
  createdAt: string;
  userId: string | null;
  operatorName?: string | null;
}

/** 登录尝试行（含失败）：details 里有 ip 与 statusCode（200=成功） */
interface LoginItem {
  id: string;
  details: unknown;
  createdAt: string;
}

/** 操作/登录区块折叠态显示条数（数据侧仍取 30/5，展开后限高滚动） */
const COLLAPSED_ROWS = 5;

const ROLE_OPTIONS = [
  { value: 'ADMIN', labelKey: 'userAdmin.roleLabel.ADMIN' },
  { value: 'EDITOR', labelKey: 'userAdmin.roleLabel.EDITOR' },
  { value: 'VIEWER', labelKey: 'userAdmin.roleLabel.VIEWER' },
  { value: 'INTERNAL', labelKey: 'userAdmin.roleLabel.INTERNAL' },
];

const ROLE_BADGE: Record<string, string> = {
  ADMIN: 'bg-primary-container/15 text-primary',
  EDITOR: 'bg-blue-500/15 text-blue-400',
  VIEWER: 'bg-surface-container-highest text-on-surface-variant',
  INTERNAL: 'bg-teal-500/15 text-teal-400',
};

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'userAdmin.roleLabel.ADMIN',
  EDITOR: 'userAdmin.roleLabel.EDITOR',
  VIEWER: 'userAdmin.roleLabel.VIEWER',
  INTERNAL: 'userAdmin.roleLabel.INTERNAL',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

/** 相对时间（与用户列表页 relativeTime 同款规则）：近期 x 前，>30 天回退日期 */
function relativeTime(value: string | null | undefined, t: TFunction, fallback: string): string {
  if (!value) return fallback;
  const ms = Date.now() - new Date(value).getTime();
  const day = Math.floor(ms / 86_400_000);
  if (day > 30) return new Date(value).toLocaleDateString();
  if (day > 0) return t('userAdmin.daysAgo', { count: day });
  const hour = Math.floor(ms / 3_600_000);
  if (hour > 0) return t('userAdmin.hoursAgo', { count: hour });
  const min = Math.floor(ms / 60_000);
  return min > 0 ? t('userAdmin.minutesAgo', { count: min }) : t('userAdmin.justNow');
}

/** 账号数据迷你卡：图标 + 值/标签（与列表页统计卡同族样式，紧凑版） */
function StatTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-outline-variant/10 bg-surface-container-low px-2 py-1.5">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-primary-container/10 text-primary">
        <Icon name={icon} size={13} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold leading-tight text-on-surface">{value}</span>
        <span className="block truncate text-[10px] leading-tight text-on-surface-variant">{label}</span>
      </span>
    </div>
  );
}

const inputClass =
  'w-full rounded-md border border-outline-variant/20 bg-surface-container-high px-2.5 py-1.5 text-sm text-on-surface outline-none focus:border-primary';
const labelClass = 'block text-xs font-medium text-on-surface-variant mb-1';

export default function UserEditDialog({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUserDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [company, setCompany] = useState(user.company ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [department, setDepartment] = useState(user.department ?? '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [mustChangePassword, setMustChangePassword] = useState(user.mustChangePassword);
  const [disabled, setDisabled] = useState(user.disabled);
  const [canInvite, setCanInvite] = useState(user.canInvite);
  const [saving, setSaving] = useState(false);

  // 重置密码（临时密码）
  const [tempPassword, setTempPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  const { data: audit } = useSWR(`/admin/users/${user.id}/audit`, async (url) => {
    const res = await client.get(url);
    return unwrapResponse<{ items: AuditItem[]; logins: LoginItem[] }>(res);
  });

  // 操作/登录区块默认各显示 COLLAPSED_ROWS 条，超出折叠（数据侧仍取 30/5），展开后限高滚动防撑爆弹窗
  const [opsExpanded, setOpsExpanded] = useState(false);
  const [loginsExpanded, setLoginsExpanded] = useState(false);
  useEffect(() => {
    setOpsExpanded(false);
    setLoginsExpanded(false);
  }, [user.id]);
  const ops = audit?.items ?? [];
  const logins = audit?.logins ?? [];
  const visibleOps = opsExpanded ? ops : ops.slice(0, COLLAPSED_ROWS);
  const visibleLogins = loginsExpanded ? logins : logins.slice(0, COLLAPSED_ROWS);

  // 切换用户时重置表单
  useEffect(() => {
    setEmail(user.email);
    setRole(user.role);
    setCompany(user.company ?? '');
    setPhone(user.phone ?? '');
    setDepartment(user.department ?? '');
    setBio(user.bio ?? '');
    setMustChangePassword(user.mustChangePassword);
    setDisabled(user.disabled);
    setCanInvite(user.canInvite);
    setTempPassword('');
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const roleChanged = role !== user.role;
  const disabledChanged = disabled !== user.disabled;
  const emailChanged = email.trim().toLowerCase() !== user.email;

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        company: company.trim() || null,
        phone: phone.trim() || null,
        department: department.trim() || null,
        bio: bio.trim() || null,
        mustChangePassword,
        disabled,
        canInvite,
      };
      if (roleChanged) payload.role = role;
      if (emailChanged) payload.email = email.trim();
      await client.put(`/admin/users/${user.id}`, payload);
      // 如果改的是当前登录用户，立即把 canInvite 同步到前端 store，
      // 无需重新登录即可看到「我的邀请码」入口的显隐变化
      const me = useAuthStore.getState().user;
      if (me && me.id === user.id) {
        useAuthStore
          .getState()
          .updateUser({ canInvite, ...(emailChanged ? { email: email.trim().toLowerCase() } : {}) });
      }
      toast(
        emailChanged ? t('userAdmin.edit.savedWithEmail') : t('userAdmin.edit.saved'),
        'success',
        emailChanged ? 6000 : undefined,
      );
      onSaved();
      onClose();
    } catch (err) {
      toast(getErrorMessage(err, t('userAdmin.edit.saveFailed')), 'error');
    } finally {
      setSaving(false);
    }
  }

  /** 审计行按请求路径还原具体操作（路径在 autoAudit details 里，历史记录同样生效）。
      self=true 表示是用户本人的自助操作（改资料/改密/换绑邮箱），与管理员操作区分展示 */
  function opLabelOf(a: AuditItem): { label: string; role?: string; self?: boolean } {
    const d = (a.details ?? {}) as { path?: unknown; method?: unknown; body?: { role?: unknown } };
    const path = typeof d.path === 'string' ? d.path : '';
    const method = typeof d.method === 'string' ? d.method : '';
    let label: string;
    let self = false;
    if (path.endsWith('/reset-password')) label = t('userAdmin.edit.opResetPassword');
    else if (path.endsWith('/send-reset-email')) label = t('userAdmin.edit.opSendResetEmail');
    else if (path.endsWith('/role')) label = t('userAdmin.edit.opRoleChange');
    else if (path === '/api/auth/profile') {
      label = t('userAdmin.edit.selfProfile');
      self = true;
    } else if (path === '/api/auth/password') {
      label = t('userAdmin.edit.selfPassword');
      self = true;
    } else if (path === '/api/auth/change-email') {
      label = t('userAdmin.edit.selfEmail');
      self = true;
    } else if (path === '/api/admin/users' && method === 'POST') label = t('userAdmin.edit.opCreate');
    else if (/^\/api\/admin\/users\/[^/]+$/.test(path) && method === 'PUT') label = t('userAdmin.edit.opUpdate');
    else if (method === 'DELETE') label = t('userAdmin.edit.opDelete');
    else label = t(`auditLog.action.${a.action}`, { defaultValue: a.action });
    const role = d.body?.role;
    return {
      label,
      self,
      role: typeof role === 'string' ? t(`userAdmin.roleLabel.${role}`, { defaultValue: role }) : undefined,
    };
  }

  async function handleResetPassword() {
    if (tempPassword.length < 8) {
      toast(t('userAdmin.edit.passwordMinLen'), 'error');
      return;
    }
    setResetting(true);
    try {
      await client.post(`/admin/users/${user.id}/reset-password`, { password: tempPassword });
      toast(t('userAdmin.edit.passwordResetDone'), 'success');
      setTempPassword('');
      setMustChangePassword(true);
    } catch (err) {
      toast(getErrorMessage(err, t('userAdmin.edit.resetFailed')), 'error');
    } finally {
      setResetting(false);
    }
  }

  async function handleSendResetEmail() {
    setSendingEmail(true);
    try {
      await client.post(`/admin/users/${user.id}/send-reset-email`);
      toast(t('userAdmin.edit.resetEmailSent'), 'success');
    } catch (err) {
      toast(getErrorMessage(err, t('userAdmin.edit.sendFailed')), 'error');
    } finally {
      setSendingEmail(false);
    }
  }

  return (
    <DialogOverlay onClose={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-outline-variant/10 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-on-surface">{user.username}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ROLE_BADGE[user.role] || ''}`}>
                {t(ROLE_LABEL[user.role] || '', { defaultValue: user.role })}
              </span>
              {user.disabled ? (
                <span className="rounded bg-error/15 px-1.5 py-0.5 text-[10px] font-medium text-error">
                  {t('userAdmin.disabled')}
                </span>
              ) : null}
            </div>
            <p className="truncate text-xs text-on-surface-variant">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
            aria-label={t('common.close')}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div>
            <span className={labelClass}>{t('userAdmin.edit.emailLabel')}</span>
            <input
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
            {emailChanged ? (
              <p className="mt-1 text-[11px] text-error">{t('userAdmin.edit.emailChangedHint')}</p>
            ) : null}
          </div>

          <div>
            <span className={labelClass}>{t('userAdmin.edit.roleLabel')}</span>
            <SelectMenu
              variant="field"
              value={role}
              onChange={setRole}
              ariaLabel={t('userAdmin.edit.roleLabel')}
              options={ROLE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={labelClass}>{t('userAdmin.edit.company')}</span>
              <input
                name="company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <span className={labelClass}>{t('userAdmin.edit.department')}</span>
              <input
                name="department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <span className={labelClass}>{t('userAdmin.edit.phone')}</span>
            <input name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
          </div>

          <div>
            <span className={labelClass}>{t('userAdmin.edit.bio')}</span>
            <textarea
              name="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface">
              <input
                name="must-change-password"
                type="checkbox"
                checked={mustChangePassword}
                onChange={(e) => setMustChangePassword(e.target.checked)}
                className="h-4 w-4"
              />
              {t('userAdmin.edit.mustChangePassword')}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface">
              <input
                name="disabled"
                type="checkbox"
                checked={disabled}
                onChange={(e) => setDisabled(e.target.checked)}
                className="h-4 w-4"
              />
              <span className={disabled ? 'text-error' : ''}>{t('userAdmin.edit.disableAccount')}</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface">
              <input
                name="can-invite"
                type="checkbox"
                checked={canInvite}
                onChange={(e) => setCanInvite(e.target.checked)}
                className="h-4 w-4"
              />
              {t('userAdmin.edit.canInvite')}
            </label>
          </div>

          {disabledChanged && disabled ? (
            <p className="rounded-md bg-error/10 px-2.5 py-1.5 text-xs text-error">
              {t('userAdmin.edit.disableWarning')}
            </p>
          ) : null}

          <div className="rounded-md border border-outline-variant/10 bg-surface-container-low px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-on-surface-variant">
              <Icon name="vpn_key" size={14} />
              {t('userAdmin.edit.resetPassword')}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                id="user-edit-temp-password"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                placeholder={t('userAdmin.edit.tempPasswordPlaceholder')}
                className={inputClass}
                type="password"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={resetting || !tempPassword}
                className="shrink-0 rounded-md bg-primary-container px-3 py-1.5 text-xs font-medium text-on-primary-container disabled:opacity-50"
              >
                {resetting ? t('userAdmin.edit.processing') : t('userAdmin.edit.setPassword')}
              </button>
            </div>
            <button
              type="button"
              onClick={handleSendResetEmail}
              disabled={sendingEmail}
              className="mt-2 text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              {sendingEmail ? t('userAdmin.edit.sending') : t('userAdmin.edit.sendResetEmail')}
            </button>
          </div>

          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-on-surface-variant">
              <Icon name="history" size={14} />
              {t('userAdmin.edit.recentOps')}
            </div>
            <div className="space-y-1 rounded-md bg-surface-container-low px-2.5 py-2 text-xs">
              {ops.length ? (
                <>
                  <div className={`space-y-1 ${opsExpanded ? 'max-h-56 overflow-y-auto custom-scrollbar' : ''}`}>
                    {visibleOps.map((a) => {
                      const { label, role, self } = opLabelOf(a);
                      return (
                        <div key={a.id} className="flex items-center justify-between gap-2 text-on-surface-variant">
                          <span className="truncate">
                            {label}
                            {role ? <span className="text-on-surface-variant/60">（{role}）</span> : null}
                            {self ? (
                              <span className="text-on-surface-variant/60"> · {t('userAdmin.edit.opSelf')}</span>
                            ) : a.operatorName ? (
                              <span className="text-on-surface-variant/60">
                                {' '}
                                · {t('userAdmin.edit.opBy', { name: a.operatorName })}
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-on-surface-variant/60">{formatDate(a.createdAt)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {ops.length > COLLAPSED_ROWS ? (
                    <button
                      type="button"
                      onClick={() => setOpsExpanded((v) => !v)}
                      className="w-full pt-0.5 text-left text-[11px] font-medium text-primary hover:underline"
                    >
                      {opsExpanded ? t('userAdmin.edit.showLess') : t('userAdmin.edit.showAll', { count: ops.length })}
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="text-on-surface-variant/60">{t('userAdmin.edit.noRecords')}</p>
              )}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-on-surface-variant">
              <Icon name="login" size={14} />
              {t('userAdmin.edit.recentLogins')}
            </div>
            <div className="space-y-1 rounded-md bg-surface-container-low px-2.5 py-2 text-xs">
              {logins.length ? (
                <>
                  <div className={`space-y-1 ${loginsExpanded ? 'max-h-56 overflow-y-auto custom-scrollbar' : ''}`}>
                    {visibleLogins.map((l) => {
                      const d = (l.details ?? {}) as { ip?: unknown; statusCode?: unknown };
                      const ok = d.statusCode === 200;
                      const ip = typeof d.ip === 'string' ? d.ip : '';
                      return (
                        <div key={l.id} className="flex items-center justify-between gap-2">
                          <span className={`truncate ${ok ? 'text-on-surface-variant' : 'text-error'}`}>
                            {ok ? t('userAdmin.edit.loginOk') : t('userAdmin.edit.loginFailed')}
                            {ip ? <span className="text-on-surface-variant/60"> · IP {ip}</span> : null}
                          </span>
                          <span className="shrink-0 text-on-surface-variant/60">{formatDate(l.createdAt)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {logins.length > COLLAPSED_ROWS ? (
                    <button
                      type="button"
                      onClick={() => setLoginsExpanded((v) => !v)}
                      className="w-full pt-0.5 text-left text-[11px] font-medium text-primary hover:underline"
                    >
                      {loginsExpanded
                        ? t('userAdmin.edit.showLess')
                        : t('userAdmin.edit.showAll', { count: logins.length })}
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="text-on-surface-variant/60">{t('userAdmin.edit.noRecords')}</p>
              )}
            </div>
          </div>

          {/* 账号数据：计数 + 关键时间改为迷你统计卡（原单行小字挤 5 项带秒级时间戳，难读） */}
          <div className="grid grid-cols-3 gap-1.5">
            <StatTile icon="download" label={t('userAdmin.edit.statDownloads')} value={String(user._count.downloads)} />
            <StatTile icon="star" label={t('userAdmin.edit.statFavorites')} value={String(user._count.favorites)} />
            <StatTile
              icon="event"
              label={t('userAdmin.edit.statRegistered')}
              value={new Date(user.createdAt).toLocaleDateString()}
            />
          </div>
          <div className="-mt-0.5 grid grid-cols-2 gap-1.5">
            <StatTile
              icon="login"
              label={t('userAdmin.edit.statLastLogin')}
              value={relativeTime(user.lastLoginAt, t, t('userAdmin.neverLoggedIn'))}
            />
            <StatTile
              icon="schedule"
              label={t('userAdmin.edit.statLastActive')}
              value={relativeTime(user.lastActiveAt, t, '—')}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-outline-variant/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-on-surface-variant hover:bg-surface-container-high"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-on-primary disabled:opacity-50"
          >
            {saving ? t('userAdmin.edit.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}
