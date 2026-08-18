import { AnimatePresence, motion } from 'framer-motion';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { authApi } from '../api/auth';
import { listShares, type ShareLink } from '../api/shares';
import { AdminPageHero } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import { PageBody, PageHeader } from '../components/shared/PagePrimitives';
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import SafeImage from '../components/shared/SafeImage';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useFeatureFlags } from '../lib/publicSettings';
import { useAuthStore } from '../stores/useAuthStore';

const ROLE_LABEL_KEYS: Record<string, string> = {
  ADMIN: 'profile.roles.admin',
  EDITOR: 'profile.roles.editor',
  VIEWER: 'profile.roles.viewer',
  INTERNAL: 'profile.roles.internal',
};

const NOTIFICATION_ITEMS = ['ticket', 'inquiry', 'backup', 'favorite', 'model_conversion', 'download'] as const;

function normalizePhone(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[－—–]/g, '-')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, ' ');
}

function isValidPhone(value: unknown): boolean {
  const phone = normalizePhone(value);
  if (!phone) return true;
  if (phone.length > 32) return false;
  if (!/^\+?[0-9][0-9\s()-]{5,31}$/.test(phone)) return false;

  const digits = phone.replace(/\D/g, '');
  const noSpaceOrParen = phone.replace(/[()\s]/g, '');

  if (/^1[3-9]\d{9}$/.test(digits)) return true;
  if (/^(400|800)-?\d{3}-?\d{4}$/.test(noSpaceOrParen)) return true;
  if (/^0\d{2,3}-?\d{7,8}(-?\d{1,6})?$/.test(noSpaceOrParen)) return true;
  if (phone.startsWith('+') && digits.length >= 8 && digits.length <= 15) return true;

  return false;
}

function profileErrorMessage(error: unknown, fallback: string): string {
  const payload = (error as { response?: { data?: { detail?: unknown; message?: unknown } }; message?: unknown })
    ?.response?.data;
  if (typeof payload?.detail === 'string' && payload.detail) return payload.detail;
  if (typeof payload?.message === 'string' && payload.message) return payload.message;
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message ? message : fallback;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-primary-container' : 'bg-surface-container-highest'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-on-surface transition-transform ${checked ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  );
}

function NotificationPrefsLoadingState({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();

  return (
    <div className={`flex ${compact ? 'min-h-12' : 'min-h-24'}`}>
      <PageRefreshIndicator label={t('profile.notifications.refreshing')} />
    </div>
  );
}

function NotificationPrefs({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const showEmailPrefs = user?.role !== 'ADMIN';
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    authApi
      .getNotificationPrefs()
      .then((p) => {
        setPrefs(p);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleChange = (key: string, value: boolean) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    setChanged(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await authApi.updateNotificationPrefs(prefs);
      setPrefs(updated);
      setChanged(false);
      toast(t('profile.notifications.saved'), 'success');
    } catch {
      toast(t('profile.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <NotificationPrefsLoadingState compact={compact} />;
  }

  if (compact) {
    return (
      <div>
        <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon name="notifications" size={20} className="text-on-surface-variant" />
            <span className="text-sm text-on-surface">{t('profile.notifications.settings')}</span>
          </div>
          <Icon
            name="expand_more"
            size={20}
            className={`text-on-surface-variant/50 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
        {expanded && (
          <div className="mt-3 space-y-3">
            {NOTIFICATION_ITEMS.map((item) => (
              <div key={item} className="flex items-center justify-between gap-3 rounded-md py-1">
                <div className="min-w-0">
                  <span className="text-sm text-on-surface">{t(`profile.notifications.items.${item}.label`)}</span>
                  <p className="text-[10px] leading-snug text-on-surface-variant/60">
                    {t(`profile.notifications.items.${item}.description`)}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[10px] text-on-surface-variant">
                    <span>{t('profile.notifications.inApp')}</span>
                    <Toggle checked={prefs[item] !== false} onChange={(v) => handleChange(item, v)} />
                  </label>
                  {showEmailPrefs && (
                    <label className="flex items-center gap-1.5 text-[10px] text-on-surface-variant">
                      <span>{t('profile.notifications.email')}</span>
                      <Toggle
                        checked={prefs[`email_${item}`] !== false}
                        onChange={(v) => handleChange(`email_${item}`, v)}
                      />
                    </label>
                  )}
                </div>
              </div>
            ))}
            {changed && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full mt-3 py-2 text-xs font-medium bg-primary-container text-on-primary rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? t('profile.saving') : t('profile.notifications.saveSettings')}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-surface-container-low rounded-lg p-6 border border-outline-variant/10">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="notifications" size={24} className="text-on-surface-variant" />
          <h3 className="font-headline text-sm font-semibold uppercase tracking-wide text-on-surface">
            {t('profile.notifications.preferences')}
          </h3>
        </div>
        <Icon
          name="expand_more"
          size={20}
          className={`text-on-surface-variant/50 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="mt-5 space-y-4">
          {NOTIFICATION_ITEMS.map((item) => (
            <div key={item} className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm text-on-surface">{t(`profile.notifications.items.${item}.label`)}</span>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  {t(`profile.notifications.items.${item}.description`)}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-on-surface-variant">
                  <span>{t('profile.notifications.inApp')}</span>
                  <Toggle checked={prefs[item] !== false} onChange={(v) => handleChange(item, v)} />
                </label>
                {showEmailPrefs && (
                  <label className="flex items-center gap-2 text-xs text-on-surface-variant">
                    <span>{t('profile.notifications.email')}</span>
                    <Toggle
                      checked={prefs[`email_${item}`] !== false}
                      onChange={(v) => handleChange(`email_${item}`, v)}
                    />
                  </label>
                )}
              </div>
            </div>
          ))}
          {changed && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 text-xs font-medium bg-primary-container text-on-primary rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? t('profile.saving') : t('common.save')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ProfileDesktopLoadingState() {
  const { t } = useTranslation();

  return (
    <PageBody className="mx-auto max-w-6xl pb-12" data-profile-loading>
      <PageHeader title={t('profile.title')} />
      <div className="flex min-h-[360px]">
        <PageRefreshIndicator label={t('profile.refreshing')} />
      </div>
    </PageBody>
  );
}

function PasswordChangeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
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
      setError(t('profile.password.minLength'));
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError(t('profile.password.mismatch'));
      return;
    }
    setLoading(true);
    try {
      await authApi.changePassword(form.oldPassword, form.newPassword);
      toast(t('profile.password.changed'), 'success');
      onClose();
      setTimeout(() => {
        useAuthStore.getState().logout();
        window.location.replace('/login');
      }, 1000);
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string; detail?: string } } }).response?.data;
      const msg = data?.message || data?.detail || t('profile.password.changeFailed');
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
              <h3 className="font-headline text-lg font-semibold text-on-surface">{t('profile.password.title')}</h3>
              <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface transition-colors">
                <Icon name="close" size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">
                  {t('profile.password.current')}
                </label>
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
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">
                  {t('profile.password.new')}
                </label>
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
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">
                  {t('profile.password.confirm')}
                </label>
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
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 bg-primary-container text-on-primary rounded-sm text-sm hover:bg-primary transition-colors disabled:opacity-50"
                >
                  {loading ? t('profile.submitting') : t('profile.password.submit')}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MobileSharesMenu() {
  const { t } = useTranslation();
  const { data: shares } = useSWR<ShareLink[]>('/shares/mine', listShares);
  const count = shares?.length ?? 0;

  return (
    <Link
      to="/my-shares"
      className="w-full flex items-center justify-between rounded-lg bg-surface-container-high px-4 py-3 text-left"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Icon name="share" size={20} className="text-on-surface/50" />
        <span className="text-sm text-on-surface">{t('profile.myShares')}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-on-surface-variant">
        <span className="text-xs">{t('profile.recordCount', { count })}</span>
        <Icon name="chevron_right" size={20} className="text-on-surface/30" />
      </div>
    </Link>
  );
}

function DesktopContent() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const { toast } = useToast();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    company: '',
    phone: '',
    department: '',
    address: '',
    bio: '',
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const { data: profile, isLoading } = useSWR(user ? '/auth/profile' : null, () => authApi.getProfile());
  const currentProfile = profile || user;
  const role = currentProfile?.role || '';
  const roleLabel = ROLE_LABEL_KEYS[role] ? t(ROLE_LABEL_KEYS[role]) : role;
  const dateLocale = i18n.resolvedLanguage || i18n.language;

  useEffect(() => {
    const src = profile || user;
    if (src) {
      setFormData({
        username: src.username || '',
        email: src.email || '',
        company: src.company || '',
        phone: src.phone || '',
        department: src.department || '',
        address: src.address || '',
        bio: src.bio || '',
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
        department: src.department || '',
        address: src.address || '',
        bio: src.bio || '',
      });
    }
  };

  const handleSave = async () => {
    if (!isValidPhone(formData.phone)) {
      toast(t('profile.phoneInvalid'), 'error');
      return;
    }
    const payload = { ...formData, phone: normalizePhone(formData.phone) };
    setSaving(true);
    try {
      const updated = await authApi.updateProfile(payload);
      setFormData((prev) => ({ ...prev, phone: updated.phone || payload.phone }));
      updateUser(updated);
      setSaved(true);
      toast(t('profile.saved'), 'success');
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      toast(profileErrorMessage(error, t('profile.saveFailed')), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        toast(t('profile.avatarTooLarge'), 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const avatar = reader.result as string;
          const updated = await authApi.updateProfile({ avatar });
          updateUser(updated);
          toast(t('profile.avatarUpdated'), 'success');
        } catch {
          toast(t('profile.avatarUploadFailed'), 'error');
        }
      };
      reader.readAsDataURL(file);
    },
    [t, toast, updateUser],
  );

  if (isLoading) {
    return <ProfileDesktopLoadingState />;
  }

  return (
    <PageBody className="mx-auto max-w-6xl pb-12">
      <PageHeader
        title={t('profile.title')}
        description={
          <>
            {t('profile.userPrefix')}{' '}
            <span className="text-primary font-medium">{formData.username || formData.email}</span>
          </>
        }
        actions={
          <>
            {saved && (
              <span className="text-emerald-400 text-sm flex items-center gap-1">
                <Icon name="check_circle" size={20} />
                {t('profile.saved')}
              </span>
            )}
            <button
              onClick={handleDiscard}
              className="px-4 py-2 bg-transparent text-outline border border-outline/40 hover:border-outline hover:text-on-surface transition-all rounded-sm text-sm uppercase tracking-wider"
            >
              {t('profile.discard')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-primary-container text-on-primary rounded-sm text-sm uppercase tracking-wider hover:bg-primary transition-colors shadow-[0_0_15px_rgba(249,115,22,0.15)] disabled:opacity-50"
            >
              {saving ? t('profile.saving') : t('profile.saveSettings')}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-4 bg-surface-container-low rounded-lg p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-primary-container/10 to-transparent rounded-bl-full pointer-events-none" />
          <div className="flex items-center gap-2 mb-6 border-b border-outline-variant/20 pb-4">
            <Icon name="badge" size={28} className="text-primary" />
            <h3 className="font-headline text-lg font-semibold uppercase tracking-wide text-on-surface">
              {t('profile.userInfo')}
            </h3>
          </div>
          <div className="flex flex-col items-center mb-8">
            <input ref={avatarInputRef} type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
            <div onClick={() => avatarInputRef.current?.click()} className="relative group cursor-pointer mb-4">
              <div className="w-24 h-24 rounded-full bg-surface-container-highest flex items-center justify-center">
                {user?.avatar ? (
                  <SafeImage
                    src={user.avatar}
                    alt=""
                    className="w-full h-full rounded-full object-cover"
                    fallbackIcon="person"
                  />
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
              <label className="text-xs uppercase tracking-wider text-on-surface-variant">{t('profile.name')}</label>
              <input
                name="username"
                value={formData.username}
                onChange={handleChange}
                className="w-full bg-surface-container-lowest text-on-surface border-none border-l-2 border-transparent focus:border-primary focus:ring-0 px-4 py-2.5 text-sm transition-colors rounded-none"
                type="text"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-wider text-on-surface-variant">{t('profile.email')}</label>
              <input
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="w-full bg-surface-container-lowest text-on-surface border-none border-l-2 border-transparent focus:border-primary focus:ring-0 px-4 py-2.5 text-sm transition-colors rounded-none"
                type="email"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-wider text-on-surface-variant">{t('profile.bio')}</label>
              <textarea
                name="bio"
                value={formData.bio}
                onChange={(e) => setFormData((prev) => ({ ...prev, bio: e.target.value }))}
                maxLength={500}
                rows={3}
                className="w-full bg-surface-container-lowest text-on-surface border-none border-l-2 border-transparent focus:border-primary focus:ring-0 px-4 py-2.5 text-sm transition-colors rounded-none resize-none"
                placeholder={t('profile.bioPlaceholder')}
              />
              <span className="text-[10px] text-on-surface-variant/50 text-right">{formData.bio.length}/500</span>
            </div>
          </div>
        </section>

        <section className="lg:col-span-8 bg-surface-container-low rounded-lg p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-6 border-b border-outline-variant/20 pb-4">
              <Icon name="domain" size={28} className="text-primary" />
              <h3 className="font-headline text-lg font-semibold uppercase tracking-wide text-on-surface">
                {t('profile.organizationInfo')}
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">
                  {t('profile.company')}
                </label>
                <input
                  name="company"
                  value={formData.company}
                  onChange={handleChange}
                  className="w-full bg-surface-container-lowest text-on-surface border-none border-l-2 border-transparent focus:border-primary focus:ring-0 px-4 py-2.5 text-sm transition-colors rounded-none"
                  type="text"
                  placeholder={t('profile.companyPlaceholder')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">
                  {t('profile.department')}
                </label>
                <input
                  name="department"
                  value={formData.department}
                  onChange={handleChange}
                  className="w-full bg-surface-container-lowest text-on-surface border-none border-l-2 border-transparent focus:border-primary focus:ring-0 px-4 py-2.5 text-sm transition-colors rounded-none"
                  type="text"
                  placeholder={t('profile.departmentPlaceholder')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">{t('profile.phone')}</label>
                <input
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className="w-full bg-surface-container-lowest text-on-surface border-none border-l-2 border-transparent focus:border-primary focus:ring-0 px-4 py-2.5 text-sm transition-colors rounded-none"
                  type="tel"
                  inputMode="tel"
                  maxLength={32}
                  placeholder={t('profile.phonePlaceholder')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">
                  {t('profile.address')}
                </label>
                <input
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  className="w-full bg-surface-container-lowest text-on-surface border-none border-l-2 border-transparent focus:border-primary focus:ring-0 px-4 py-2.5 text-sm transition-colors rounded-none"
                  type="text"
                  placeholder={t('profile.addressPlaceholder')}
                />
              </div>
            </div>
          </div>
          <div className="mt-8 bg-surface-container-high p-4 rounded-sm border border-outline-variant/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Icon name="lock" size={20} className="text-outline-variant" />
              <div>
                <h4 className="font-headline text-sm font-medium text-on-surface">{t('profile.password.security')}</h4>
                <p className="text-xs text-on-secondary-container mt-0.5">{t('profile.password.securityDesc')}</p>
              </div>
            </div>
            <button
              onClick={() => setPwdOpen(true)}
              className="px-4 py-1.5 bg-transparent text-secondary border border-secondary/30 hover:border-secondary transition-colors rounded-sm text-xs uppercase tracking-wider"
            >
              {t('profile.password.title')}
            </button>
          </div>
        </section>

        <section className="lg:col-span-12 bg-surface-container-low rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4 border-b border-outline-variant/20 pb-4">
            <Icon name="shield" size={24} className="text-primary" />
            <h3 className="font-headline text-sm font-semibold uppercase tracking-wide text-on-surface">
              {t('profile.accountInfo')}
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <span className="text-xs uppercase tracking-wider text-on-surface-variant">{t('profile.role')}</span>
              <p className="text-sm text-on-surface mt-1">{roleLabel || '-'}</p>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wider text-on-surface-variant">{t('profile.joinedAt')}</span>
              <p className="text-sm text-on-surface mt-1">
                {currentProfile?.createdAt
                  ? new Date(currentProfile.createdAt).toLocaleDateString(dateLocale, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : '-'}
              </p>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wider text-on-surface-variant">{t('profile.userId')}</span>
              <p className="text-xs text-on-surface-variant font-mono mt-1 break-all">{currentProfile?.id}</p>
            </div>
          </div>
        </section>

        <section className="lg:col-span-12">
          <NotificationPrefs />
        </section>
      </div>
      <PasswordChangeDialog open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </PageBody>
  );
}

function MobileContent() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const { toast } = useToast();
  const navigate = useNavigate();
  const featureFlags = useFeatureFlags();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    company: '',
    phone: '',
    department: '',
    address: '',
    bio: '',
  });
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const role = user?.role || '';
  const roleLabel = ROLE_LABEL_KEYS[role] ? t(ROLE_LABEL_KEYS[role]) : role;
  const dateLocale = i18n.resolvedLanguage || i18n.language;

  useEffect(() => {
    if (user) {
      setFormData({
        username: user.username || '',
        email: user.email || '',
        company: user.company || '',
        phone: user.phone || '',
        department: user.department || '',
        address: user.address || '',
        bio: user.bio || '',
      });
    }
  }, [user]);

  const handleFieldChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async () => {
    if (!isValidPhone(formData.phone)) {
      toast(t('profile.phoneInvalid'), 'error');
      return;
    }
    const payload = { ...formData, phone: normalizePhone(formData.phone) };
    setSaving(true);
    try {
      const updated = await authApi.updateProfile(payload);
      setFormData((prev) => ({ ...prev, phone: updated.phone || payload.phone }));
      updateUser(updated);
      setEditing(false);
      toast(t('profile.saved'), 'success');
    } catch (error) {
      toast(profileErrorMessage(error, t('profile.saveFailed')), 'error');
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
        department: user.department || '',
        address: user.address || '',
        bio: user.bio || '',
      });
    }
    setEditing(false);
  };

  const handleAvatarChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        toast(t('profile.avatarTooLarge'), 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const avatar = reader.result as string;
          const updated = await authApi.updateProfile({ avatar });
          updateUser(updated);
          toast(t('profile.avatarUpdated'), 'success');
        } catch {
          toast(t('profile.avatarUploadFailed'), 'error');
        }
      };
      reader.readAsDataURL(file);
    },
    [t, toast, updateUser],
  );

  return (
    <PageBody className="pb-20 space-y-4">
      <AdminPageHero title={t('profile.title')} description={t('profile.description')} />

      {/* Avatar + basic info */}
      <div className="flex items-center gap-4 rounded-lg bg-surface-container-high p-4">
        <input ref={avatarInputRef} type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
        <div onClick={() => avatarInputRef.current?.click()} className="relative group cursor-pointer shrink-0">
          <div className="h-14 w-14 rounded-full bg-surface-container-lowest flex items-center justify-center">
            {user?.avatar ? (
              <SafeImage
                src={user.avatar}
                alt=""
                className="w-full h-full rounded-full object-cover"
                fallbackIcon="person"
              />
            ) : (
              <Icon name="person" size={32} className="text-on-surface-variant/40" />
            )}
          </div>
          <div className="absolute inset-0 rounded-full bg-surface-dim/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Icon name="photo_camera" size={16} className="text-white" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-on-surface truncate">{user?.username || t('common.user')}</h2>
            <span className="shrink-0 rounded-md bg-primary-container/15 px-1.5 py-0.5 text-[10px] font-medium text-primary-container">
              {roleLabel || '-'}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant break-all line-clamp-2">{user?.email}</p>
          {user?.createdAt && (
            <p className="text-[10px] text-on-surface-variant/50 mt-0.5">
              {t('profile.joinedDate', {
                date: new Date(user.createdAt).toLocaleDateString(dateLocale, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }),
              })}
            </p>
          )}
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 text-xs bg-primary-container text-on-primary rounded-md"
          >
            {t('common.edit')}
          </button>
        )}
      </div>

      {/* Editable fields */}
      {editing ? (
        <div className="space-y-3 rounded-lg bg-surface-container-high p-4">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">{t('profile.name')}</label>
            <input
              name="username"
              value={formData.username}
              onChange={handleFieldChange}
              className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-md outline-none"
              type="text"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">{t('profile.email')}</label>
            <input
              name="email"
              value={formData.email}
              onChange={handleFieldChange}
              className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-md outline-none"
              type="email"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">
              {t('profile.company')}
            </label>
            <input
              name="company"
              value={formData.company}
              onChange={handleFieldChange}
              className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-md outline-none"
              type="text"
              placeholder={t('profile.companyPlaceholder')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">{t('profile.phone')}</label>
            <input
              name="phone"
              value={formData.phone}
              onChange={handleFieldChange}
              className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-md outline-none"
              type="tel"
              inputMode="tel"
              maxLength={32}
              placeholder={t('profile.phonePlaceholder')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">
              {t('profile.department')}
            </label>
            <input
              name="department"
              value={formData.department}
              onChange={handleFieldChange}
              className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-md outline-none"
              type="text"
              placeholder={t('profile.departmentPlaceholder')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">
              {t('profile.address')}
            </label>
            <input
              name="address"
              value={formData.address}
              onChange={handleFieldChange}
              className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-md outline-none"
              type="text"
              placeholder={t('profile.addressPlaceholder')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">{t('profile.bio')}</label>
            <textarea
              name="bio"
              value={formData.bio}
              onChange={(e) => setFormData((prev) => ({ ...prev, bio: e.target.value }))}
              maxLength={500}
              rows={2}
              className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-md outline-none resize-none"
              placeholder={t('profile.bioPlaceholder')}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleCancel}
              className="flex-1 py-2 text-xs text-on-surface-variant border border-outline-variant/40 rounded-md"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2 text-xs bg-primary-container text-on-primary rounded-md disabled:opacity-50"
            >
              {saving ? t('profile.saving') : t('common.save')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-high px-4 py-3">
            <div className="flex items-center gap-3 shrink-0">
              <Icon name="domain" size={20} className="text-on-surface/50" />
              <span className="text-sm text-on-surface">{t('profile.companyShort')}</span>
            </div>
            <span className="text-sm text-on-surface-variant text-right truncate min-w-0">{user?.company || '-'}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-high px-4 py-3">
            <div className="flex items-center gap-3">
              <Icon name="phone" size={20} className="text-on-surface/50" />
              <span className="text-sm text-on-surface">{t('profile.phoneShort')}</span>
            </div>
            <span className="text-sm text-on-surface-variant text-right truncate min-w-0">{user?.phone || '-'}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-high px-4 py-3">
            <div className="flex items-center gap-3 shrink-0">
              <Icon name="badge" size={20} className="text-on-surface/50" />
              <span className="text-sm text-on-surface">{t('profile.department')}</span>
            </div>
            <span className="text-sm text-on-surface-variant text-right truncate min-w-0">
              {user?.department || '-'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-high px-4 py-3">
            <div className="flex items-center gap-3 shrink-0">
              <Icon name="link" size={20} className="text-on-surface/50" />
              <span className="text-sm text-on-surface">{t('profile.address')}</span>
            </div>
            <span className="text-sm text-on-surface-variant text-right truncate min-w-0">{user?.address || '-'}</span>
          </div>
          {user?.bio && (
            <div className="rounded-lg bg-surface-container-high px-4 py-3">
              <div className="flex items-center gap-3 mb-1">
                <Icon name="description" size={20} className="text-on-surface/50" />
                <span className="text-sm text-on-surface">{t('profile.bio')}</span>
              </div>
              <p className="text-sm text-on-surface-variant pl-8">{user.bio}</p>
            </div>
          )}
        </div>
      )}

      {/* Password */}
      <button
        onClick={() => setPwdOpen(true)}
        className="w-full flex items-center justify-between rounded-lg bg-surface-container-high px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <Icon name="lock" size={20} className="text-on-surface/50" />
          <span className="text-sm text-on-surface">{t('profile.password.title')}</span>
        </div>
        <Icon name="chevron_right" size={20} className="text-on-surface/30" />
      </button>

      {/* My Inquiries */}
      {featureFlags.inquiry && (
        <button
          onClick={() => navigate('/my-inquiries')}
          className="w-full flex items-center justify-between rounded-lg bg-surface-container-high px-4 py-3 text-left"
        >
          <div className="flex items-center gap-3">
            <Icon name="request_quote" size={20} className="text-on-surface/50" />
            <span className="text-sm text-on-surface">{t('profile.myInquiries')}</span>
          </div>
          <Icon name="chevron_right" size={20} className="text-on-surface/30" />
        </button>
      )}

      {/* Notification prefs */}
      <div className="rounded-lg bg-surface-container-high px-4 py-3">
        <NotificationPrefs compact />
      </div>

      {/* My shares */}
      {featureFlags.shares && <MobileSharesMenu />}

      <PasswordChangeDialog open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </PageBody>
  );
}

export default function ProfilePage() {
  const { t } = useTranslation();

  useDocumentTitle(t('profile.title'));
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return <AdminPageShell>{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>;
}
