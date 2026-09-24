import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../stores/useAuthStore';
import Icon from './Icon';
import { useToast } from './Toast';

/**
 * 修改密码弹窗（个人设置 / 顶栏用户菜单共用）。
 * 通过 portal 挂到 document.body —— 无论从哪个容器渲染，fixed 定位都以视口为包含块，
 * 不受祖先 transform/backdrop-filter/主题宽度规则影响。
 */
export default function PasswordChangeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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

  return createPortal(
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
    </AnimatePresence>,
    document.body,
  );
}
