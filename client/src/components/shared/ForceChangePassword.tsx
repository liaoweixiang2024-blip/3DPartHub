import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../stores/useAuthStore';
import DialogOverlay from './DialogOverlay';
import { AppFormLabel, AppTextInput } from './FormControls';
import Icon from './Icon';
import { useToast } from './Toast';

/**
 * Global overlay that forces default/admin accounts to change their password.
 * Shown only for admins with user.mustChangePassword === true.
 */
export default function ForceChangePassword() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  if (user?.role !== 'ADMIN' || !user.mustChangePassword) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError(t('forcePassword.errors.minLength'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('forcePassword.errors.mismatch'));
      return;
    }

    setLoading(true);
    try {
      const result = await authApi.setInitialPassword(newPassword);
      if (result.tokens?.accessToken) {
        setAccessToken(result.tokens.accessToken, result.tokens.refreshToken ?? null);
      }
      updateUser({ ...(result.user || {}), mustChangePassword: false });
      setNewPassword('');
      setConfirmPassword('');
      toast(t('forcePassword.toasts.success'), 'success');
    } catch (err: unknown) {
      const resp = typeof err === 'object' && err !== null ? (err as Record<string, unknown>).response : undefined;
      const data = typeof resp === 'object' && resp !== null ? (resp as Record<string, unknown>).data : undefined;
      const msg =
        typeof data === 'object' && data !== null
          ? ((data as Record<string, unknown>).message as string) ||
            ((data as Record<string, unknown>).detail as string) ||
            t('forcePassword.errors.failed')
          : t('forcePassword.errors.failed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <DialogOverlay onClose={undefined} zIndex={100} backdropClassName="bg-black/60 backdrop-blur-sm" bottomOnMobile>
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-surface-container-low rounded-t-2xl sm:rounded-lg shadow-2xl border border-outline-variant/20 w-full max-w-md p-5 sm:p-8 max-h-[calc(100dvh-1rem)] overflow-y-auto"
        >
          <div className="flex flex-col items-center mb-6">
            <div className="w-14 h-14 rounded-full bg-primary-container/20 flex items-center justify-center mb-4">
              <svg
                className="w-7 h-7 text-primary-container"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-on-surface">{t('forcePassword.title')}</h2>
            <p className="text-sm text-on-surface-variant mt-2 text-center">{t('forcePassword.description')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <AppFormLabel uppercase className="mb-0">
                {t('forcePassword.newPassword')}
              </AppFormLabel>
              <div className="relative">
                <AppTextInput
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setError('');
                  }}
                  required
                  minLength={8}
                  placeholder={t('forcePassword.newPasswordPlaceholder')}
                  autoFocus
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                  aria-label={showNewPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  <Icon name={showNewPassword ? 'visibility_off' : 'visibility'} size={18} />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <AppFormLabel uppercase className="mb-0">
                {t('forcePassword.confirmPassword')}
              </AppFormLabel>
              <div className="relative">
                <AppTextInput
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError('');
                  }}
                  required
                  minLength={8}
                  placeholder={t('forcePassword.confirmPasswordPlaceholder')}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                  aria-label={showConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  <Icon name={showConfirmPassword ? 'visibility_off' : 'visibility'} size={18} />
                </button>
              </div>
            </div>
            {error && <p className="text-red-400 text-xs break-words">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-primary-container text-on-primary rounded-sm text-sm font-medium hover:bg-primary transition-colors disabled:opacity-50 mt-2"
            >
              {loading ? t('forcePassword.submitting') : t('forcePassword.submit')}
            </button>
          </form>
        </motion.div>
      </DialogOverlay>
    </AnimatePresence>
  );
}
