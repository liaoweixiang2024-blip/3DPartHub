import { motion } from 'framer-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { authApi } from '../api/auth';
import BrandMark from '../components/shared/BrandMark';
import { APP_FIELD_ERROR_CLASS, AppFormLabel, AppTextInput } from '../components/shared/FormControls';
import Icon from '../components/shared/Icon';
import { PageTitle } from '../components/shared/PagePrimitives';
import { PublicPageShell } from '../components/shared/PublicPageShell';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getErrorMessage } from '../lib/errorNotifications';

const MIN_LENGTH = 8;

function passwordStrength(pwd: string): { letters: boolean; numbers: boolean; symbols: boolean; ok: boolean } {
  const letters = /[a-zA-Z]/.test(pwd);
  const numbers = /[0-9]/.test(pwd);
  const symbols = /[^a-zA-Z0-9]/.test(pwd);
  return { letters, numbers, symbols, ok: Number(letters) + Number(numbers) + Number(symbols) >= 2 };
}

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  useDocumentTitle(t('auth.resetPasswordTitle'));

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string }>({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const strength = passwordStrength(password);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: { password?: string; confirmPassword?: string } = {};
    if (!password) nextErrors.password = t('auth.errors.passwordRequired');
    else if (password.length < MIN_LENGTH) nextErrors.password = t('auth.errors.passwordMin');
    else if (!strength.ok) nextErrors.password = t('auth.errors.passwordWeak');
    if (password !== confirmPassword) nextErrors.confirmPassword = t('auth.errors.confirmPasswordMismatch');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !token) return;

    setLoading(true);
    setApiError('');
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err: unknown) {
      setApiError(getErrorMessage(err, t('auth.errors.resetFailed')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicPageShell showMobileBottomNav={false}>
      <div className="flex min-h-dvh items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <BrandMark size="hero" centered className="mx-auto mb-3 max-w-full" />
            <PageTitle>{t('auth.resetPasswordTitle')}</PageTitle>
            <p className="text-sm text-on-surface-variant mt-2">{t('auth.resetPasswordSubtitle')}</p>
          </div>

          {done ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-sm border border-success/30 bg-success-container/15 px-5 py-6 text-center"
            >
              <Icon name="check_circle" size={32} className="mx-auto mb-3 text-success" />
              <p className="text-sm text-on-surface">{t('auth.resetSuccess')}</p>
              <Link
                to="/login"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Icon name="login" size={16} />
                {t('auth.goLogin')}
              </Link>
            </motion.div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="space-y-5 rounded-sm border border-outline-variant/20 bg-surface p-6 shadow-sm sm:p-8"
            >
              {apiError && (
                <div className="flex items-start gap-2 rounded-sm border border-error/30 bg-error-container/20 px-4 py-3 text-sm text-error">
                  <Icon name="error" size={20} className="mt-0.5 shrink-0" />
                  <span className="min-0 break-words">{apiError}</span>
                </div>
              )}

              <div>
                <AppFormLabel uppercase>{t('auth.newPassword')}</AppFormLabel>
                <div className="relative">
                  <AppTextInput
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    error={Boolean(errors.password)}
                    fieldSize="lg"
                    placeholder={t('auth.newPasswordPlaceholder')}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-on-surface-variant hover:text-on-surface"
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
                  </button>
                </div>
                {password && (
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    <span className={password.length >= MIN_LENGTH ? 'text-success' : 'text-on-surface-variant'}>
                      {password.length >= MIN_LENGTH ? '✓' : '○'} {t('auth.passwordMinLength', { n: MIN_LENGTH })}
                    </span>
                    <span className={strength.ok ? 'text-success' : 'text-on-surface-variant'}>
                      {strength.ok ? '✓' : '○'} {t('auth.passwordComplexity')}
                    </span>
                  </div>
                )}
                {errors.password && <span className={APP_FIELD_ERROR_CLASS}>{errors.password}</span>}
              </div>

              <div>
                <AppFormLabel uppercase>{t('auth.confirmPassword')}</AppFormLabel>
                <AppTextInput
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  error={Boolean(errors.confirmPassword)}
                  fieldSize="lg"
                  placeholder={t('auth.confirmPasswordPlaceholder')}
                  autoComplete="new-password"
                />
                {errors.confirmPassword && <span className={APP_FIELD_ERROR_CLASS}>{errors.confirmPassword}</span>}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-primary px-4 text-sm font-bold text-on-primary shadow-sm transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading && <Icon name="progress_activity" size={16} className="animate-spin" />}
                {loading ? t('auth.processing') : t('auth.resetPassword')}
              </button>
            </form>
          )}
        </div>
      </div>
    </PublicPageShell>
  );
}
