import { motion } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../api/auth';
import client from '../api/client';
import { unwrapResponse } from '../api/response';
import BrandMark from '../components/shared/BrandMark';
import { APP_FIELD_ERROR_CLASS, AppFormLabel, AppTextInput } from '../components/shared/FormControls';
import Icon from '../components/shared/Icon';
import { PageTitle } from '../components/shared/PagePrimitives';
import { PublicPageShell } from '../components/shared/PublicPageShell';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getErrorMessage } from '../lib/errorNotifications';
import { useFeatureFlags } from '../lib/publicSettings';
import { sanitizeHtml } from '../lib/sanitizeHtml';

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const featureFlags = useFeatureFlags();
  useDocumentTitle(t('auth.forgotPasswordTitle'));

  const [email, setEmail] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [errors, setErrors] = useState<{ email?: string; captchaText?: string }>({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const refreshCaptcha = useCallback(async () => {
    try {
      const res = await client.get('/auth/captcha');
      const data = unwrapResponse<{ captchaId: string; captchaSvg: string }>(res);
      setCaptchaSvg(data.captchaSvg);
      setCaptchaId(data.captchaId);
      setCaptchaText('');
    } catch {
      // surfaced on submit
    }
  }, []);

  useEffect(() => {
    if (featureFlags.passwordReset) refreshCaptcha();
  }, [featureFlags.passwordReset, refreshCaptcha]);

  // Feature disabled — bounce back to login.
  if (!featureFlags.passwordReset) {
    navigate('/login', { replace: true });
    return null;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: { email?: string; captchaText?: string } = {};
    if (!email) nextErrors.email = t('auth.errors.emailRequired');
    else if (!validateEmail(email)) nextErrors.email = t('auth.errors.emailInvalid');
    if (!captchaText) nextErrors.captchaText = t('auth.errors.captchaRequired');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    setApiError('');
    try {
      await authApi.requestPasswordReset(email, captchaId, captchaText);
      setSent(true);
    } catch (err: unknown) {
      setApiError(getErrorMessage(err, t('auth.errors.sendFailed')));
      refreshCaptcha();
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
            <PageTitle>{t('auth.forgotPasswordTitle')}</PageTitle>
            <p className="text-sm text-on-surface-variant mt-2">{t('auth.forgotPasswordSubtitle')}</p>
          </div>

          {sent ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-sm border border-success/30 bg-success-container/15 px-5 py-6 text-center"
            >
              <Icon name="check_circle" size={32} className="mx-auto mb-3 text-success" />
              <p className="text-sm text-on-surface">{t('auth.resetEmailSent')}</p>
              <Link
                to="/login"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Icon name="arrow_back" size={16} />
                {t('auth.backToLogin')}
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
                <AppFormLabel uppercase>{t('auth.email')}</AppFormLabel>
                <AppTextInput
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  error={Boolean(errors.email)}
                  fieldSize="lg"
                  placeholder={t('auth.emailPlaceholder')}
                  autoComplete="email"
                />
                {errors.email && <span className={APP_FIELD_ERROR_CLASS}>{errors.email}</span>}
              </div>

              <div>
                <AppFormLabel uppercase>{t('auth.captcha')}</AppFormLabel>
                <div className="flex gap-2">
                  <AppTextInput
                    type="text"
                    value={captchaText}
                    onChange={(e) => setCaptchaText(e.target.value)}
                    error={Boolean(errors.captchaText)}
                    fieldSize="lg"
                    maxLength={6}
                    placeholder={t('auth.captchaPlaceholder')}
                  />
                  {captchaSvg && (
                    <button
                      type="button"
                      onClick={refreshCaptcha}
                      className="shrink-0 cursor-pointer overflow-hidden rounded-sm border border-outline-variant/30 transition-opacity hover:opacity-80 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(captchaSvg) }}
                      style={{ width: 150, height: 44 }}
                      aria-label={t('auth.refreshCaptcha')}
                    />
                  )}
                </div>
                {errors.captchaText && <span className={APP_FIELD_ERROR_CLASS}>{errors.captchaText}</span>}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-primary px-4 text-sm font-bold text-on-primary shadow-sm transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading && <Icon name="progress_activity" size={16} className="animate-spin" />}
                {loading ? t('auth.sending') : t('auth.sendResetEmail')}
              </button>

              <div className="text-center">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-primary"
                >
                  <Icon name="arrow_back" size={16} />
                  {t('auth.backToLogin')}
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </PublicPageShell>
  );
}
