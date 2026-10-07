import { useState } from 'react';
import client from '../../api/client';
import { unwrapResponse } from '../../api/response';
import { copyText } from '../../lib/clipboard';
import { getErrorMessage } from '../../lib/errorNotifications';
import DialogOverlay from '../shared/DialogOverlay';
import Icon from '../shared/Icon';
import { useToast } from '../shared/Toast';

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: '管理员' },
  { value: 'EDITOR', label: '编辑者' },
  { value: 'VIEWER', label: '访客' },
  { value: 'INTERNAL', label: '内部' },
];

const TEMP_PASSWORD_LENGTH = 12;

/** 生成随机临时密码（大小写字母+数字，crypto 随机源），供管理员转交给新用户 */
function generateTempPassword(): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const values = crypto.getRandomValues(new Uint32Array(TEMP_PASSWORD_LENGTH));
  return Array.from(values, (v) => charset[v % charset.length]).join('');
}

const inputClass =
  'w-full rounded-md border border-outline-variant/20 bg-surface-container-high px-2.5 py-1.5 text-sm text-on-surface outline-none focus:border-primary';
const labelClass = 'block text-xs font-medium text-on-surface-variant mb-1';

export default function UserCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('VIEWER');
  const [company, setCompany] = useState('');
  const [department, setDepartment] = useState('');
  const [phone, setPhone] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [saving, setSaving] = useState(false);

  const canSubmit = username.trim() && email.trim() && password;

  async function handleCreate() {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const res = await client.post('/admin/users', {
        username: username.trim(),
        email: email.trim(),
        password,
        role,
        company: company.trim() || null,
        department: department.trim() || null,
        phone: phone.trim() || null,
        mustChangePassword,
      });
      unwrapResponse(res);
      toast(`已创建用户「${username.trim()}」，请将初始密码转交给对方`, 'success', 6000);
      onCreated();
      onClose();
    } catch (err) {
      toast(getErrorMessage(err, '创建用户失败'), 'error');
    } finally {
      setSaving(false);
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
          <div className="flex min-w-0 items-center gap-2">
            <Icon name="person_add" size={18} className="text-primary-container" />
            <span className="truncate text-sm font-semibold text-on-surface">新增用户</span>
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
            <span className={labelClass}>用户名 *</span>
            <input
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="字母、数字、下划线、连字符、点"
              className={inputClass}
              autoFocus
            />
          </div>

          <div>
            <span className={labelClass}>角色</span>
            {/* 分段选择器：4 个固定角色直接点选，省去原生 select 展开步骤；选中态仅中性色填充 */}
            <div className="grid grid-cols-4 gap-1.5">
              {ROLE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setRole(o.value)}
                  className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                    role === o.value
                      ? 'border-transparent bg-on-surface-variant/90 text-surface'
                      : 'border-outline-variant/20 bg-surface-container-high text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={labelClass}>邮箱 *</span>
            <input
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com（登录账号）"
              className={inputClass}
            />
          </div>

          <div>
            <span className={labelClass}>初始密码 *</span>
            <div className="flex gap-2">
              <input
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位"
                className={inputClass}
                type="text"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setPassword(generateTempPassword())}
                title="随机生成临时密码"
                className="shrink-0 rounded-md border border-outline-variant/20 bg-surface-container-high px-2.5 text-on-surface-variant hover:text-on-surface"
              >
                <Icon name="refresh" size={15} />
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!password) return;
                  try {
                    await copyText(password);
                    toast('初始密码已复制', 'success');
                  } catch {
                    toast('复制失败', 'error');
                  }
                }}
                title="复制密码（转交给新用户）"
                className="shrink-0 rounded-md border border-outline-variant/20 bg-surface-container-high px-2.5 text-on-surface-variant hover:text-on-surface"
              >
                <Icon name="content_copy" size={15} />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-on-surface-variant/60">建议用随机临时密码，创建后复制转交给对方</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={labelClass}>公司</span>
              <input
                name="company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <span className={labelClass}>部门</span>
              <input
                name="department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <span className={labelClass}>电话</span>
            <input name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
          </div>

          <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm text-on-surface">
            <input
              name="must-change-password"
              type="checkbox"
              checked={mustChangePassword}
              onChange={(e) => setMustChangePassword(e.target.checked)}
              className="h-4 w-4"
            />
            首次登录强制修改密码
          </label>
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
            onClick={handleCreate}
            disabled={!canSubmit || saving}
            className="rounded-md bg-primary-container px-4 py-1.5 text-sm font-medium text-on-primary-container disabled:opacity-50"
          >
            {saving ? '创建中…' : '创建用户'}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}
