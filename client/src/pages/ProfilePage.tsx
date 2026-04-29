import { useState, useRef, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { AnimatePresence, motion } from 'framer-motion';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { SkeletonList } from '../components/shared/Skeleton';
import Icon from '../components/shared/Icon';
import SafeImage from '../components/shared/SafeImage';
import { PageBody, PageHeader } from "../components/shared/PagePrimitives";
import { AdminPageShell } from "../components/shared/AdminPageShell";
import { authApi } from '../api/auth';
import { useNavigate } from 'react-router-dom';
import { listShares, deleteShare, type ShareLink } from '../api/shares';
import { useAuthStore } from '../stores/useAuthStore';
import { useToast } from '../components/shared/Toast';
import { copyText } from '../lib/clipboard';

const NOTIFICATION_ITEMS = [
  { key: 'ticket', label: '工单通知', desc: '工单回复、状态变更' },
  { key: 'inquiry', label: '询价通知', desc: '询价回复、处理状态变更' },
  { key: 'favorite', label: '收藏通知', desc: '有人收藏你的模型' },
  { key: 'model_conversion', label: '转换通知', desc: '模型转换完成或失败' },
  { key: 'download', label: '下载通知', desc: '模型被下载时通知' },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-primary-container' : 'bg-surface-container-highest'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-on-surface transition-transform ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

async function copyShareLink(token: string, toast: (message: string, type?: "success" | "error" | "info") => void) {
  try {
    await copyText(`${window.location.origin}/share/${token}`);
    toast('链接已复制', 'success');
  } catch {
    toast('复制失败，请手动复制链接', 'error');
  }
}

function NotificationPrefs({ compact = false }: { compact?: boolean }) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    authApi.getNotificationPrefs().then(p => {
      setPrefs(p);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleChange = (key: string, value: boolean) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
    setChanged(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await authApi.updateNotificationPrefs(prefs);
      setPrefs(updated);
      setChanged(false);
      toast('通知设置已保存', 'success');
    } catch {
      toast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Icon name="autorenew" size={20} className="text-on-surface-variant/30 animate-spin" />
      </div>
    );
  }

  if (compact) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Icon name="notifications" size={20} className="text-on-surface-variant" />
            <h3 className="font-headline text-sm font-semibold text-on-surface uppercase tracking-wide">通知设置</h3>
          </div>
          <Icon
            name="expand_more"
            size={20}
            className={`text-on-surface-variant/50 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
        {expanded && (
          <div className="mt-3 space-y-3">
            {NOTIFICATION_ITEMS.map(item => (
              <label key={item.key} className="flex items-center justify-between gap-3 rounded-md py-1">
                <div className="min-w-0">
                  <span className="text-sm text-on-surface">{item.label}</span>
                  <p className="text-[10px] leading-snug text-on-surface-variant/60">{item.desc}</p>
                </div>
                <div className="shrink-0">
                  <Toggle checked={prefs[item.key] !== false} onChange={(v) => handleChange(item.key, v)} />
                </div>
              </label>
            ))}
            {changed && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full mt-3 py-2 text-xs font-medium bg-primary-container text-on-primary rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? '保存中...' : '保存通知设置'}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-surface-container-low rounded-lg p-6 border border-outline-variant/10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Icon name="notifications" size={24} className="text-on-surface-variant" />
          <h3 className="font-headline text-sm font-semibold uppercase tracking-wide text-on-surface">通知偏好</h3>
        </div>
        <Icon
          name="expand_more"
          size={20}
          className={`text-on-surface-variant/50 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="mt-5 space-y-4">
          {NOTIFICATION_ITEMS.map(item => (
            <div key={item.key} className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm text-on-surface">{item.label}</span>
                <p className="text-xs text-on-surface-variant mt-0.5">{item.desc}</p>
              </div>
              <div className="shrink-0">
                <Toggle checked={prefs[item.key] !== false} onChange={(v) => handleChange(item.key, v)} />
              </div>
            </div>
          ))}
          {changed && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 text-xs font-medium bg-primary-container text-on-primary rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PasswordChangeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.newPassword.length < 8) {
      setError('新密码长度至少8位');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    setLoading(true);
    try {
      await authApi.changePassword(form.oldPassword, form.newPassword);
      toast('密码修改成功，请重新登录', 'success');
      onClose();
      setTimeout(() => {
        useAuthStore.getState().logout();
        window.location.replace("/login");
      }, 1000);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.response?.data?.detail || '密码修改失败，请重试';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-surface-dim/70 backdrop-blur-sm p-3 sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-low rounded-t-lg sm:rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-md p-4 sm:p-6 max-h-[calc(100dvh-1.5rem)] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-headline text-lg font-semibold text-on-surface">修改密码</h3>
              <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface transition-colors">
                <Icon name="close" size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">旧密码</label>
                <input
                  name="oldPassword"
                  type="password"
                  value={form.oldPassword}
                  onChange={handleChange}
                  required
                  autoComplete="current-password"
                  className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">新密码</label>
                <input
                  name="newPassword"
                  type="password"
                  value={form.newPassword}
                  onChange={handleChange}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">确认新密码</label>
                <input
                  name="confirmPassword"
                  type="password"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  required
                  autoComplete="new-password"
                  className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none"
                />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors">
                  取消
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 bg-primary-container text-on-primary rounded-sm text-sm hover:bg-primary transition-colors disabled:opacity-50"
                >
                  {loading ? '提交中...' : '确认修改'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MySharesSection({ compact = false }: { compact?: boolean }) {
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { data: shares, mutate } = useSWR<ShareLink[]>('/shares/mine', listShares);

  const items = shares || [];

  async function handleDelete(id: string) {
    try {
      await deleteShare(id);
      toast('已删除', 'success');
      setDeleteId(null);
      mutate();
    } catch (err: any) {
      toast(err.response?.data?.message || err.response?.data?.detail || '删除失败', 'error');
    }
  }

  function isExpired(expiresAt: string | null) {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  }

  if (compact) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="share" size={20} className="text-on-surface-variant" />
          <h3 className="font-headline text-sm font-semibold text-on-surface uppercase tracking-wide">我的分享</h3>
        </div>
        {items.length === 0 && (
          <div className="text-center py-6 text-on-surface-variant/50">
            <Icon name="share" size={28} className="mx-auto mb-1 opacity-30" />
            <p className="text-xs">暂无分享记录</p>
          </div>
        )}
        {items.map(s => {
          const expired = isExpired(s.expiresAt);
          return (
            <div key={s.id} className="bg-surface-container-lowest rounded-md border border-outline-variant/10 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm text-on-surface line-clamp-2 break-words min-w-0">{s.modelName || s.modelId}</span>
                {expired ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-on-surface-variant/10 text-on-surface-variant shrink-0">已过期</span>
                ) : s.expiresAt ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-emerald-500/15 text-emerald-400 shrink-0">有效</span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-primary-container/15 text-primary-container shrink-0">永久</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[10px] text-on-surface-variant/60">
                <span><Icon name="visibility" size={10} /> {s.viewCount}</span>
                <span><Icon name="download" size={10} /> {s.downloadCount}{s.downloadLimit > 0 ? `/${s.downloadLimit}` : ''}</span>
                {s.hasPassword && <span>有密码</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <button
                  onClick={() => copyShareLink(s.token, toast)}
                  className="px-2 py-1 text-[10px] text-primary-container hover:bg-primary-container/10 rounded transition-colors"
                >
                  <Icon name="link" size={12} className="inline mr-0.5" />复制链接
                </button>
                {deleteId === s.id ? (
                  <>
                    <button onClick={() => handleDelete(s.id)} className="px-2 py-1 text-[10px] font-medium bg-error text-on-error-container rounded">确认</button>
                    <button onClick={() => setDeleteId(null)} className="px-2 py-1 text-[10px] text-on-surface-variant hover:bg-surface-container-high/50 rounded">取消</button>
                  </>
                ) : (
                  <button
                    onClick={() => setDeleteId(s.id)}
                    className="px-2 py-1 text-[10px] text-error hover:bg-error-container/10 rounded transition-colors"
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="bg-surface-container-low rounded-lg p-6 border border-outline-variant/10">
      <div className="flex items-center gap-2 mb-5">
        <Icon name="share" size={24} className="text-on-surface-variant" />
        <h3 className="font-headline text-sm font-semibold uppercase tracking-wide text-on-surface">我的分享</h3>
        <span className="text-xs text-on-surface-variant ml-auto">{items.length} 条</span>
      </div>
      {items.length === 0 && (
        <div className="text-center py-8 text-on-surface-variant/50">
          <Icon name="share" size={36} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">暂无分享记录</p>
        </div>
      )}
      <div className="space-y-2">
        {items.map(s => {
          const expired = isExpired(s.expiresAt);
          return (
            <div key={s.id} className="bg-surface-container-lowest rounded-md border border-outline-variant/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-on-surface break-words sm:truncate sm:max-w-[240px]">{s.modelName || s.modelId}</span>
                    {expired ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium bg-on-surface-variant/10 text-on-surface-variant">已过期</span>
                    ) : s.expiresAt ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium bg-emerald-500/15 text-emerald-400">有效</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium bg-primary-container/15 text-primary-container">永久</span>
                    )}
                    {s.hasPassword && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium bg-amber-500/15 text-amber-400">有密码</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] text-on-surface-variant/70">
                    <span className="flex items-center gap-0.5"><Icon name="visibility" size={10} />{s.viewCount} 次浏览</span>
                    <span className="flex items-center gap-0.5"><Icon name="download" size={10} />{s.downloadCount}{s.downloadLimit > 0 ? `/${s.downloadLimit}` : ''} 次下载</span>
                    {s.expiresAt && <span className="flex items-center gap-0.5"><Icon name="schedule" size={10} />{new Date(s.expiresAt).toLocaleDateString('zh-CN')}</span>}
                    <span>{new Date(s.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => copyShareLink(s.token, toast)}
                    className="px-2 py-1 text-[10px] text-primary-container hover:bg-primary-container/10 rounded transition-colors"
                    title="复制链接"
                  >
                    <Icon name="link" size={14} />
                  </button>
                  {deleteId === s.id ? (
                    <>
                      <button onClick={() => handleDelete(s.id)} className="px-2 py-1 text-[10px] font-medium bg-error text-on-error-container rounded">确认</button>
                      <button onClick={() => setDeleteId(null)} className="px-2 py-1 text-[10px] text-on-surface-variant hover:bg-surface-container-high/50 rounded">取消</button>
                    </>
                  ) : (
                    <button
                      onClick={() => setDeleteId(s.id)}
                      className="px-2 py-1 text-[10px] text-error hover:bg-error-container/10 rounded transition-colors"
                      title="删除"
                    >
                      <Icon name="delete" size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DesktopContent() {
  const { user, updateUser } = useAuthStore();
  const { toast } = useToast();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    company: '',
    phone: '',
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const { data: profile, isLoading } = useSWR(user ? '/auth/profile' : null, () => authApi.getProfile());

  useEffect(() => {
    const src = profile || user;
    if (src) {
      setFormData({
        username: src.username || '',
        email: src.email || '',
        company: src.company || '',
        phone: src.phone || '',
      });
    }
  }, [profile, user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleDiscard = () => {
    const src = profile || user;
    if (src) {
      setFormData({
        username: src.username || '',
        email: src.email || '',
        company: src.company || '',
        phone: src.phone || '',
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await authApi.updateProfile(formData);
      updateUser(updated);
      setSaved(true);
      toast('设置已保存', 'success');
      setTimeout(() => setSaved(false), 3000);
    } catch {
      toast('保存失败，请重试', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('头像文件不能超过 2MB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const avatar = reader.result as string;
        const updated = await authApi.updateProfile({ avatar });
        updateUser(updated);
        toast('头像已更新', 'success');
      } catch {
        toast('头像上传失败', 'error');
      }
    };
    reader.readAsDataURL(file);
  }, [toast, updateUser]);

  if (isLoading) {
    return <SkeletonList rows={4} />;
  }

  return (
    <PageBody className="mx-auto max-w-6xl pb-12">
      <PageHeader
        title="个人设置"
        description={(
          <>
            用户: <span className="text-primary font-medium">{formData.username || formData.email}</span>
          </>
        )}
        actions={(
          <>
          {saved && (
            <span className="text-emerald-400 text-sm flex items-center gap-1">
              <Icon name="check_circle" size={20} />
              已保存
            </span>
          )}
          <button onClick={handleDiscard} className="px-4 py-2 bg-transparent text-outline border border-outline/40 hover:border-outline hover:text-on-surface transition-all rounded-sm text-sm uppercase tracking-wider">
            放弃修改
          </button>
          <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-primary-container text-on-primary rounded-sm text-sm uppercase tracking-wider hover:bg-primary transition-colors shadow-[0_0_15px_rgba(249,115,22,0.15)] disabled:opacity-50">
            {saving ? '保存中...' : '保存设置'}
          </button>
          </>
        )}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-4 bg-surface-container-low rounded-lg p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-primary-container/10 to-transparent rounded-bl-full pointer-events-none" />
          <div className="flex items-center gap-2 mb-6 border-b border-outline-variant/20 pb-4">
            <Icon name="badge" size={28} className="text-primary" />
            <h3 className="font-headline text-lg font-semibold uppercase tracking-wide text-on-surface">用户信息</h3>
          </div>
          <div className="flex flex-col items-center mb-8">
            <input ref={avatarInputRef} type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
            <div onClick={() => avatarInputRef.current?.click()} className="relative group cursor-pointer mb-4">
              <div className="w-24 h-24 rounded-full bg-surface-container-highest flex items-center justify-center">
                {user?.avatar ? (
                  <SafeImage src={user.avatar} alt="" className="w-full h-full rounded-full object-cover" fallbackIcon="person" />
                ) : (
                  <Icon name="person" size={48} className="text-on-surface-variant" />
                )}
              </div>
              <div className="absolute inset-0 rounded-full bg-surface-dim/60 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Icon name="upload" size={20} className="text-white" />
              </div>
            </div>
          </div>
          <div className="space-y-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-wider text-on-surface-variant">姓名</label>
              <input
                name="username"
                value={formData.username}
                onChange={handleChange}
                className="w-full bg-surface-container-lowest text-on-surface border-none border-l-2 border-transparent focus:border-primary focus:ring-0 px-4 py-2.5 text-sm transition-colors rounded-none"
                type="text"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-wider text-on-surface-variant">邮箱</label>
              <input
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="w-full bg-surface-container-lowest text-on-surface border-none border-l-2 border-transparent focus:border-primary focus:ring-0 px-4 py-2.5 text-sm transition-colors rounded-none"
                type="email"
              />
            </div>
          </div>
        </section>

        <section className="lg:col-span-8 bg-surface-container-low rounded-lg p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-6 border-b border-outline-variant/20 pb-4">
              <Icon name="domain" size={28} className="text-primary" />
              <h3 className="font-headline text-lg font-semibold uppercase tracking-wide text-on-surface">组织信息</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">公司名称</label>
                <input
                  name="company"
                  value={formData.company}
                  onChange={handleChange}
                  className="w-full bg-surface-container-lowest text-on-surface border-none border-l-2 border-transparent focus:border-primary focus:ring-0 px-4 py-2.5 text-sm transition-colors rounded-none"
                  type="text"
                  placeholder="填写公司名称"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">联系电话</label>
                <input
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className="w-full bg-surface-container-lowest text-on-surface border-none border-l-2 border-transparent focus:border-primary focus:ring-0 px-4 py-2.5 text-sm transition-colors rounded-none"
                  type="tel"
                  placeholder="填写联系电话"
                />
              </div>
            </div>
          </div>
          <div className="mt-8 bg-surface-container-high p-4 rounded-sm border border-outline-variant/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Icon name="lock" size={20} className="text-outline-variant" />
              <div>
                <h4 className="font-headline text-sm font-medium text-on-surface">密码安全</h4>
                <p className="text-xs text-on-secondary-container mt-0.5">定期更新密码以保障账户安全</p>
              </div>
            </div>
            <button onClick={() => setPwdOpen(true)} className="px-4 py-1.5 bg-transparent text-secondary border border-secondary/30 hover:border-secondary transition-colors rounded-sm text-xs uppercase tracking-wider">
              修改密码
            </button>
          </div>
        </section>

        <section className="lg:col-span-12">
          <NotificationPrefs />
        </section>

        <section className="lg:col-span-12">
          <MySharesSection />
        </section>
      </div>
      <PasswordChangeDialog open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </PageBody>
  );
}

function MobileContent() {
  const { user, updateUser } = useAuthStore();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    company: '',
    phone: '',
  });
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setFormData({
        username: user.username || '',
        email: user.email || '',
        company: user.company || '',
        phone: user.phone || '',
      });
    }
  }, [user]);

  const handleFieldChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await authApi.updateProfile(formData);
      updateUser(updated);
      setEditing(false);
      toast('设置已保存', 'success');
    } catch {
      toast('保存失败，请重试', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (user) {
      setFormData({
        username: user.username || '',
        email: user.email || '',
        company: user.company || '',
        phone: user.phone || '',
      });
    }
    setEditing(false);
  };

  const handleAvatarChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('头像文件不能超过 2MB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const avatar = reader.result as string;
        const updated = await authApi.updateProfile({ avatar });
        updateUser(updated);
        toast('头像已更新', 'success');
      } catch {
        toast('头像上传失败', 'error');
      }
    };
    reader.readAsDataURL(file);
  }, [toast, updateUser]);

  return (
    <PageBody className="px-4 py-5 pb-20">
      <PageHeader title="个人设置" />

      {/* Avatar + basic info */}
      <div className="flex items-center gap-4 rounded-lg bg-surface-container-high p-4">
        <input ref={avatarInputRef} type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
        <div onClick={() => avatarInputRef.current?.click()} className="relative group cursor-pointer shrink-0">
          <div className="h-14 w-14 rounded-full bg-surface-container-lowest flex items-center justify-center">
            {user?.avatar ? (
              <SafeImage src={user.avatar} alt="" className="w-full h-full rounded-full object-cover" fallbackIcon="person" />
            ) : (
              <Icon name="person" size={32} className="text-on-surface-variant/40" />
            )}
          </div>
          <div className="absolute inset-0 rounded-full bg-surface-dim/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Icon name="photo_camera" size={16} className="text-white" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-on-surface truncate">{user?.username || '用户'}</h2>
          <p className="text-xs text-on-surface-variant break-all line-clamp-2">{user?.email}</p>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 text-xs bg-primary-container text-on-primary rounded-md"
          >
            编辑
          </button>
        )}
      </div>

      {/* Editable fields */}
      {editing ? (
        <div className="space-y-3 rounded-lg bg-surface-container-high p-4">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">姓名</label>
            <input
              name="username"
              value={formData.username}
              onChange={handleFieldChange}
              className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-md outline-none"
              type="text"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">邮箱</label>
            <input
              name="email"
              value={formData.email}
              onChange={handleFieldChange}
              className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-md outline-none"
              type="email"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">公司名称</label>
            <input
              name="company"
              value={formData.company}
              onChange={handleFieldChange}
              className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-md outline-none"
              type="text"
              placeholder="填写公司名称"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">联系电话</label>
            <input
              name="phone"
              value={formData.phone}
              onChange={handleFieldChange}
              className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-md outline-none"
              type="tel"
              placeholder="填写联系电话"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleCancel}
              className="flex-1 py-2 text-xs text-on-surface-variant border border-outline-variant/40 rounded-md"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2 text-xs bg-primary-container text-on-primary rounded-md disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-high px-4 py-3">
            <div className="flex items-center gap-3">
              <Icon name="domain" size={20} className="text-on-surface/50" />
              <span className="text-sm text-on-surface">公司</span>
            </div>
            <span className="text-sm text-on-surface-variant text-right break-words min-w-0">{user?.company || '-'}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-high px-4 py-3">
            <div className="flex items-center gap-3">
              <Icon name="phone" size={20} className="text-on-surface/50" />
              <span className="text-sm text-on-surface">电话</span>
            </div>
            <span className="text-sm text-on-surface-variant text-right break-words min-w-0">{user?.phone || '-'}</span>
          </div>
        </div>
      )}

      {/* Password */}
      <button
        onClick={() => setPwdOpen(true)}
        className="w-full flex items-center justify-between rounded-lg bg-surface-container-high px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <Icon name="lock" size={20} className="text-on-surface/50" />
          <span className="text-sm text-on-surface">修改密码</span>
        </div>
        <Icon name="chevron_right" size={20} className="text-on-surface/30" />
      </button>

      {/* My Inquiries */}
      <button
        onClick={() => navigate('/my-inquiries')}
        className="w-full flex items-center justify-between rounded-lg bg-surface-container-high px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <Icon name="request_quote" size={20} className="text-on-surface/50" />
          <span className="text-sm text-on-surface">我的询价</span>
        </div>
        <Icon name="chevron_right" size={20} className="text-on-surface/30" />
      </button>

      {/* Notification prefs */}
      <div className="rounded-lg bg-surface-container-high p-4">
        <NotificationPrefs compact />
      </div>

      {/* My shares */}
      <div className="rounded-lg bg-surface-container-high p-4">
        <MySharesSection compact />
      </div>

      <PasswordChangeDialog open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </PageBody>
  );
}

export default function ProfilePage() {
  useDocumentTitle("个人设置");
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return (
    <AdminPageShell mobileContentClassName="p-0">
      {isDesktop ? <DesktopContent /> : <MobileContent />}
    </AdminPageShell>
  );
}
