import { useEffect, useState } from 'react';
import useSWR from 'swr';
import client from '../../api/client';
import { unwrapResponse } from '../../api/response';
import { getErrorMessage } from '../../lib/errorNotifications';
import { useAuthStore } from '../../stores/useAuthStore';
import DialogOverlay from '../shared/DialogOverlay';
import Icon from '../shared/Icon';
import { useToast } from '../shared/Toast';

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
  createdAt: string;
  _count: { downloads: number; favorites: number };
}

interface AuditItem {
  id: string;
  action: string;
  details: unknown;
  createdAt: string;
  userId: string | null;
}

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: '管理员' },
  { value: 'EDITOR', label: '编辑者' },
  { value: 'VIEWER', label: '访客' },
  { value: 'INTERNAL', label: '内部' },
];

const ROLE_BADGE: Record<string, string> = {
  ADMIN: 'bg-primary-container/15 text-primary',
  EDITOR: 'bg-blue-500/15 text-blue-400',
  VIEWER: 'bg-surface-container-highest text-on-surface-variant',
  INTERNAL: 'bg-teal-500/15 text-teal-400',
};

const ROLE_LABEL: Record<string, string> = {
  ADMIN: '管理员',
  EDITOR: '编辑者',
  VIEWER: '访客',
  INTERNAL: '内部',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
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
  const { toast } = useToast();
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
    return unwrapResponse<{ items: AuditItem[] }>(res);
  });

  // 切换用户时重置表单
  useEffect(() => {
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
      await client.put(`/admin/users/${user.id}`, payload);
      // 如果改的是当前登录用户，立即把 canInvite 同步到前端 store，
      // 无需重新登录即可看到「我的邀请码」入口的显隐变化
      const me = useAuthStore.getState().user;
      if (me && me.id === user.id) {
        useAuthStore.getState().updateUser({ canInvite });
      }
      toast('已保存', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(getErrorMessage(err, '保存失败'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword() {
    if (tempPassword.length < 8) {
      toast('密码至少 8 位', 'error');
      return;
    }
    setResetting(true);
    try {
      await client.post(`/admin/users/${user.id}/reset-password`, { password: tempPassword });
      toast('已重置密码并强制该用户重新登录', 'success');
      setTempPassword('');
      setMustChangePassword(true);
    } catch (err) {
      toast(getErrorMessage(err, '重置失败'), 'error');
    } finally {
      setResetting(false);
    }
  }

  async function handleSendResetEmail() {
    setSendingEmail(true);
    try {
      await client.post(`/admin/users/${user.id}/send-reset-email`);
      toast('重置邮件已发送', 'success');
    } catch (err) {
      toast(getErrorMessage(err, '发送失败'), 'error');
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
                {ROLE_LABEL[user.role] || user.role}
              </span>
              {user.disabled ? (
                <span className="rounded bg-error/15 px-1.5 py-0.5 text-[10px] font-medium text-error">已禁用</span>
              ) : null}
            </div>
            <p className="truncate text-xs text-on-surface-variant">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
            aria-label="关闭"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div>
            <span className={labelClass}>角色</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={labelClass}>公司</span>
              <input value={company} onChange={(e) => setCompany(e.target.value)} className={inputClass} />
            </div>
            <div>
              <span className={labelClass}>部门</span>
              <input value={department} onChange={(e) => setDepartment(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <span className={labelClass}>电话</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
          </div>

          <div>
            <span className={labelClass}>备注</span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface">
              <input
                type="checkbox"
                checked={mustChangePassword}
                onChange={(e) => setMustChangePassword(e.target.checked)}
                className="h-4 w-4"
              />
              下次登录强制改密
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface">
              <input
                type="checkbox"
                checked={disabled}
                onChange={(e) => setDisabled(e.target.checked)}
                className="h-4 w-4"
              />
              <span className={disabled ? 'text-error' : ''}>禁用账号</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface">
              <input
                type="checkbox"
                checked={canInvite}
                onChange={(e) => setCanInvite(e.target.checked)}
                className="h-4 w-4"
              />
              可生成邀请码
            </label>
          </div>

          {disabledChanged && disabled ? (
            <p className="rounded-md bg-error/10 px-2.5 py-1.5 text-xs text-error">
              保存后该用户将立即登出且无法登录。
            </p>
          ) : null}

          <div className="rounded-md border border-outline-variant/10 bg-surface-container-low px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-on-surface-variant">
              <Icon name="vpn_key" size={14} />
              重置密码
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                placeholder="设临时密码（≥8 位）"
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
                {resetting ? '处理中' : '设密码'}
              </button>
            </div>
            <button
              type="button"
              onClick={handleSendResetEmail}
              disabled={sendingEmail}
              className="mt-2 text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              {sendingEmail ? '发送中…' : '或发送重置邮件 →'}
            </button>
          </div>

          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-on-surface-variant">
              <Icon name="history" size={14} />
              最近管理操作
            </div>
            <div className="space-y-1 rounded-md bg-surface-container-low px-2.5 py-2 text-xs">
              {audit?.items?.length ? (
                audit.items.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 text-on-surface-variant">
                    <span className="truncate">{a.action}</span>
                    <span className="shrink-0 text-on-surface-variant/60">{formatDate(a.createdAt)}</span>
                  </div>
                ))
              ) : (
                <p className="text-on-surface-variant/60">暂无记录</p>
              )}
            </div>
          </div>

          <p className="text-[11px] text-on-surface-variant/60">
            下载 {user._count.downloads} · 收藏 {user._count.favorites} · 注册 {formatDate(user.createdAt)} · 最近登录{' '}
            {formatDate(user.lastLoginAt)}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-outline-variant/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-on-surface-variant hover:bg-surface-container-high"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-on-primary disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}
