import { useState, useRef, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { AnimatePresence, motion } from 'framer-motion';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { SkeletonList } from '../components/shared/Skeleton';
import TopNav from '../components/shared/TopNav';
import BottomNav from '../components/shared/BottomNav';
import AppSidebar from '../components/shared/Sidebar';
import MobileNavDrawer from '../components/shared/MobileNavDrawer';
import Icon from '../components/shared/Icon';
import { authApi } from '../api/auth';
import { useAuthStore } from '../stores/useAuthStore';
import { useToast } from '../components/shared/Toast';
import type { User } from '../types';

const NOTIFICATION_ITEMS = [
  { key: 'ticket', label: '工单通知', desc: '工单回复、状态变更' },
  { key: 'comment', label: '评论通知', desc: '有人评论你的模型' },
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

function NotificationPrefs({ compact = false }: { compact?: boolean }) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

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
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="notifications" size={20} className="text-primary-container" />
          <h3 className="font-headline text-sm font-semibold text-on-surface uppercase tracking-wide">通知设置</h3>
        </div>
        {NOTIFICATION_ITEMS.map(item => (
          <label key={item.key} className="flex items-center justify-between py-1">
            <div>
              <span className="text-sm text-on-surface">{item.label}</span>
              <p className="text-[10px] text-on-surface-variant/60">{item.desc}</p>
            </div>
            <Toggle checked={prefs[item.key] !== false} onChange={(v) => handleChange(item.key, v)} />
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
    );
  }

  return (
    <div className="bg-surface-container-low rounded-lg p-6 border border-outline-variant/10">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Icon name="notifications" size={24} className="text-primary-container" />
          <h3 className="font-headline text-sm font-semibold uppercase tracking-wide text-on-surface">通知偏好</h3>
        </div>
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
      <div className="space-y-4">
        {NOTIFICATION_ITEMS.map(item => (
          <div key={item.key} className="flex items-center justify-between">
            <div>
              <span className="text-sm text-on-surface">{item.label}</span>
              <p className="text-xs text-on-surface-variant mt-0.5">{item.desc}</p>
            </div>
            <Toggle checked={prefs[item.key] !== false} onChange={(v) => handleChange(item.key, v)} />
          </div>
        ))}
      </div>
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-surface-dim/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-low rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-md mx-4 p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-headline text-lg font-semibold text-on-surface">修改密码</h3>
              <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface transition-colors">
                <Icon name="close" size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">旧密码</label>
                <input
                  name="oldPassword"
                  type="password"
                  value={form.oldPassword}
                  onChange={handleChange}
                  required
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
                  className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none"
                />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <div className="flex justify-end gap-3 pt-2">
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
  const [copied, setCopied] = useState(false);
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
        const updated = await authApi.updateProfile({ avatar } as any);
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
    <div className="max-w-6xl mx-auto flex flex-col gap-8 pb-12">
      <div className="flex justify-between items-end mb-4">
        <div>
          <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface uppercase">个人设置</h2>
          <p className="text-on-secondary-container mt-2 text-sm">
            用户: <span className="text-primary font-medium">{formData.username || formData.email}</span>
          </p>
        </div>
        <div className="flex gap-3 items-center">
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
        </div>
      </div>

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
                  <img src={user.avatar} alt="" className="w-full h-full rounded-full object-cover" />
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
      </div>
      <PasswordChangeDialog open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </div>
  );
}

function MobileContent() {
  const { user, updateUser } = useAuthStore();
  const { toast } = useToast();
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
        const updated = await authApi.updateProfile({ avatar } as any);
        updateUser(updated);
        toast('头像已更新', 'success');
      } catch {
        toast('头像上传失败', 'error');
      }
    };
    reader.readAsDataURL(file);
  }, [toast, updateUser]);

  return (
    <div className="space-y-4 px-4 py-4 pb-6">
      <h1 className="text-lg font-bold text-on-surface">个人设置</h1>

      {/* Avatar + basic info */}
      <div className="flex items-center gap-4 rounded-lg bg-surface-container-high p-4">
        <input ref={avatarInputRef} type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
        <div onClick={() => avatarInputRef.current?.click()} className="relative group cursor-pointer shrink-0">
          <div className="h-14 w-14 rounded-full bg-surface-container-lowest flex items-center justify-center">
            {user?.avatar ? (
              <img src={user.avatar} alt="" className="w-full h-full rounded-full object-cover" />
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
          <p className="text-xs text-on-surface-variant truncate">{user?.email}</p>
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
          <div className="flex items-center justify-between rounded-lg bg-surface-container-high px-4 py-3">
            <div className="flex items-center gap-3">
              <Icon name="domain" size={20} className="text-on-surface/50" />
              <span className="text-sm text-on-surface">公司</span>
            </div>
            <span className="text-sm text-on-surface-variant">{user?.company || '-'}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-surface-container-high px-4 py-3">
            <div className="flex items-center gap-3">
              <Icon name="phone" size={20} className="text-on-surface/50" />
              <span className="text-sm text-on-surface">电话</span>
            </div>
            <span className="text-sm text-on-surface-variant">{user?.phone || '-'}</span>
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

      {/* Notification prefs */}
      <div className="rounded-lg bg-surface-container-high p-4">
        <NotificationPrefs compact />
      </div>

      <PasswordChangeDialog open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </div>
  );
}

export default function ProfilePage() {
  useDocumentTitle("个人设置");
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [navOpen, setNavOpen] = useState(false);

  if (isDesktop) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto p-8 scrollbar-hidden bg-surface-dim">
            <DesktopContent />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen(prev => !prev)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="flex-1 overflow-y-auto scrollbar-hidden bg-surface-dim">
        <MobileContent />
      </main>
      <BottomNav />
    </div>
  );
}
