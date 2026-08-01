import { motion } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { authApi } from '../api/auth';
import client from '../api/client';
import { unwrapResponse } from '../api/response';
import BrandMark from '../components/shared/BrandMark';
import { APP_FIELD_ERROR_CLASS, AppFormLabel, AppTextInput } from '../components/shared/FormControls';
import Icon from '../components/shared/Icon';
import { PageTitle } from '../components/shared/PagePrimitives';
import { PublicPageShell } from '../components/shared/PublicPageShell';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getUsernamePolicy, validateRegisterUsername } from '../lib/authValidation';
import { getErrorMessage } from '../lib/errorNotifications';
import { useResolvedPublicInterfaceTheme } from '../lib/interfaceThemePreference';
import { useFeatureFlags, usePublicSettings } from '../lib/publicSettings';
import { sanitizeHtml } from '../lib/sanitizeHtml';
import { useAuthStore } from '../stores/useAuthStore';
import { getInterfaceThemePackage } from '../themes/interfaceThemes/registry';

type AuthMode = 'login' | 'register';

interface FormErrors {
  email?: string;
  password?: string;
  username?: string;
  confirmPassword?: string;
  captchaText?: string;
  emailCode?: string;
  inviteCode?: string;
}

type LoginLocationState = {
  from?: string;
};

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const initialMode =
    location.pathname === '/register' ||
    new URLSearchParams(location.search).get('mode') === 'register' ||
    Boolean(new URLSearchParams(location.search).get('invite'))
      ? 'register'
      : 'login';
  const [mode, setMode] = useState<AuthMode>(initialMode);
  useDocumentTitle(mode === 'register' ? t('auth.register') : t('auth.login'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const from = (location.state as LoginLocationState | null)?.from || '/';
  const login = useAuthStore((s) => s.login);
  const [allowRegister, setAllowRegister] = useState(true);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const { settings: publicSettings } = usePublicSettings();
  const featureFlags = useFeatureFlags();
  const resolvedPublicTheme = useResolvedPublicInterfaceTheme(publicSettings, isDesktop);
  const ThemePackage = getInterfaceThemePackage(resolvedPublicTheme);
  const LoginTemplate = ThemePackage.templates.Login;
  const usernamePolicy = getUsernamePolicy(publicSettings);

  // Captcha state
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaText, setCaptchaText] = useState('');

  // Email code state
  const [emailCode, setEmailCode] = useState('');
  const [emailCountdown, setEmailCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [address, setAddress] = useState('');
  const [inviteCode, setInviteCode] = useState(() => new URLSearchParams(location.search).get('invite') || '');

  useEffect(() => {
    if (publicSettings) setAllowRegister(publicSettings.allow_register ?? true);
  }, [publicSettings]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedMode =
      location.pathname === '/register' || params.get('mode') === 'register' || Boolean(params.get('invite'))
        ? 'register'
        : 'login';
    setMode(requestedMode);
    const invite = params.get('invite');
    if (invite) setInviteCode(invite);
  }, [location.pathname, location.search]);

  // Fetch captcha on mount and when switching to register
  const refreshCaptcha = useCallback(async () => {
    try {
      const res = await client.get('/auth/captcha');
      const d = unwrapResponse<{ captchaSvg: string; captchaId: string }>(res);
      setCaptchaSvg(d.captchaSvg);
      setCaptchaId(d.captchaId);
      setCaptchaText('');
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    if (mode === 'register') refreshCaptcha();
  }, [mode, refreshCaptcha]);

  // Countdown timer
  useEffect(() => {
    if (emailCountdown <= 0) return;
    const timer = setTimeout(() => setEmailCountdown(emailCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [emailCountdown]);

  const handleSendEmailCode = async () => {
    if (!email || !validateEmail(email)) {
      setErrors((prev) => ({ ...prev, email: t('auth.errors.emailInvalidInput') }));
      return;
    }
    if (!captchaText) {
      setErrors((prev) => ({ ...prev, captchaText: t('auth.errors.captchaRequired') }));
      return;
    }
    setSendingCode(true);
    setApiError('');
    try {
      await client.post('/auth/email-code', { email, captchaId, captchaText });
      setEmailCountdown(60);
      setErrors((prev) => ({ ...prev, captchaText: undefined }));
    } catch (err: unknown) {
      setApiError(getErrorMessage(err, t('auth.errors.sendFailed')));
      refreshCaptcha();
    } finally {
      setSendingCode(false);
    }
  };

  const validate = (): boolean => {
    const errs: FormErrors = {};
    if (!email) errs.email = t('auth.errors.emailRequired');
    else if (!validateEmail(email)) errs.email = t('auth.errors.emailInvalid');
    if (!password) errs.password = t('auth.errors.passwordRequired');
    else if (password.length < 8) errs.password = t('auth.errors.passwordMin');
    if (mode === 'register') {
      const usernameError = validateRegisterUsername(username, publicSettings, t);
      if (usernameError) errs.username = usernameError;
      if (password !== confirmPassword) errs.confirmPassword = t('auth.errors.confirmPasswordMismatch');
      if (!captchaText) errs.captchaText = t('auth.errors.captchaRequired');
      if (!emailCode) errs.emailCode = t('auth.errors.emailCodeRequired');
      if (featureFlags.invite && !inviteCode.trim()) {
        errs.inviteCode = t('auth.errors.inviteCodeRequired');
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleUsernameChange = useCallback(
    (value: string) => {
      setUsername(value);
      const usernameError = validateRegisterUsername(value, publicSettings, t);
      setErrors((prev) => ({ ...prev, username: usernameError || undefined }));
    },
    [publicSettings, t],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setApiError('');

    try {
      if (mode === 'login') {
        const result = await authApi.login({ email, password, rememberMe });
        login(result.user, result.tokens, rememberMe);
        navigate(from, { replace: true });
      } else {
        const result = await authApi.register({
          username,
          email,
          password,
          emailCode,
          phone: phone || undefined,
          company: company || undefined,
          address: address || undefined,
          inviteCode: featureFlags.invite && inviteCode.trim() ? inviteCode.trim() : undefined,
        });
        login(result.user, result.tokens, true);
        navigate(from, { replace: true });
      }
    } catch (err: unknown) {
      setApiError(
        getErrorMessage(err, mode === 'login' ? t('auth.errors.loginFailed') : t('auth.errors.registerFailed')),
      );
      if (mode === 'register') refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode);
    setErrors({});
    setApiError('');
    setEmailCode('');
    setCaptchaText('');
    setPhone('');
    setCompany('');
    setAddress('');
    setInviteCode('');
  };

  return (
    <PublicPageShell showMobileBottomNav={false}>
      <LoginTemplate
        mode={mode}
        brand={<BrandMark size="hero" centered className="mx-auto mb-3 max-w-full" />}
        title={<PageTitle>{mode === 'login' ? t('auth.loginTitle') : t('auth.registerTitle')}</PageTitle>}
        subtitle={
          <p className="text-sm text-on-surface-variant mt-2">
            {mode === 'login' ? t('auth.loginSubtitle') : t('auth.registerSubtitle')}
          </p>
        }
        form={
          <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-5">
            {apiError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="bg-error-container/20 border border-error/30 rounded-sm px-4 py-3 text-sm text-error flex items-start gap-2"
              >
                <Icon name="error" size={20} className="shrink-0 mt-0.5" />
                <span className="min-w-0 break-words">{apiError}</span>
              </motion.div>
            )}

            {mode === 'register' && (
              <div>
                <AppFormLabel uppercase>{t('auth.username')}</AppFormLabel>
                <AppTextInput
                  type="text"
                  value={username}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                  onBlur={() => {
                    const usernameError = validateRegisterUsername(username, publicSettings, t);
                    setErrors((prev) => ({ ...prev, username: usernameError || undefined }));
                  }}
                  error={Boolean(errors.username)}
                  fieldSize="lg"
                  maxLength={usernamePolicy.max}
                  placeholder={t('auth.usernamePlaceholder')}
                />
                {errors.username && <span className={APP_FIELD_ERROR_CLASS}>{errors.username}</span>}
              </div>
            )}

            {mode === 'register' && (
              <div>
                <AppFormLabel uppercase>{t('auth.phone')}</AppFormLabel>
                <AppTextInput
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  fieldSize="lg"
                  placeholder={t('auth.phonePlaceholder')}
                />
              </div>
            )}

            {mode === 'register' && (
              <div>
                <AppFormLabel uppercase>{t('auth.company')}</AppFormLabel>
                <AppTextInput
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  fieldSize="lg"
                  placeholder={t('auth.companyPlaceholder')}
                />
              </div>
            )}

            {mode === 'register' && (
              <div>
                <AppFormLabel uppercase>{t('auth.address')}</AppFormLabel>
                <AppTextInput
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  fieldSize="lg"
                  placeholder={t('auth.addressPlaceholder')}
                />
              </div>
            )}

            {mode === 'register' && featureFlags.invite && (
              <div>
                <AppFormLabel uppercase>{t('auth.inviteCode')}</AppFormLabel>
                <AppTextInput
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  fieldSize="lg"
                  placeholder={t('auth.inviteCodePlaceholder')}
                />
                {errors.inviteCode && <span className={APP_FIELD_ERROR_CLASS}>{errors.inviteCode}</span>}
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
              />
              {errors.email && <span className={APP_FIELD_ERROR_CLASS}>{errors.email}</span>}
            </div>

            {mode === 'register' && (
              <div>
                <AppFormLabel uppercase>{t('auth.captcha')}</AppFormLabel>
                <div className="flex gap-2 items-center">
                  <AppTextInput
                    type="text"
                    value={captchaText}
                    onChange={(e) => setCaptchaText(e.target.value)}
                    className="min-w-0 flex-1 px-3"
                    error={Boolean(errors.captchaText)}
                    fieldSize="lg"
                    placeholder={t('auth.codePlaceholder')}
                    maxLength={6}
                  />
                  {captchaSvg && (
                    <button
                      type="button"
                      onClick={refreshCaptcha}
                      className="shrink-0 cursor-pointer rounded-sm overflow-hidden border border-outline-variant/30 hover:opacity-80 transition-opacity [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(captchaSvg) }}
                      style={{ width: 150, height: 44 }}
                    />
                  )}
                </div>
                {errors.captchaText && <span className={APP_FIELD_ERROR_CLASS}>{errors.captchaText}</span>}
              </div>
            )}

            {mode === 'register' && (
              <div>
                <AppFormLabel uppercase>{t('auth.emailCode')}</AppFormLabel>
                <div className="flex gap-2">
                  <AppTextInput
                    type="text"
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value)}
                    className="min-w-0 flex-1 px-3"
                    error={Boolean(errors.emailCode)}
                    fieldSize="lg"
                    placeholder={t('auth.codePlaceholder')}
                    maxLength={6}
                  />
                  <button
                    type="button"
                    onClick={handleSendEmailCode}
                    disabled={emailCountdown > 0 || sendingCode}
                    className="shrink-0 px-3 py-2.5 text-sm rounded-sm border border-primary-container/50 text-primary-container hover:bg-primary-container/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {sendingCode ? t('auth.sending') : emailCountdown > 0 ? `${emailCountdown}s` : t('auth.sendCode')}
                  </button>
                </div>
                {errors.emailCode && <span className={APP_FIELD_ERROR_CLASS}>{errors.emailCode}</span>}
              </div>
            )}

            <div>
              <AppFormLabel uppercase>{t('auth.password')}</AppFormLabel>
              <div className="relative">
                <AppTextInput
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  error={Boolean(errors.password)}
                  fieldSize="lg"
                  placeholder={t('auth.passwordPlaceholder')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
                </button>
              </div>
              {errors.password && <span className={APP_FIELD_ERROR_CLASS}>{errors.password}</span>}
            </div>

            {mode === 'register' && (
              <div>
                <AppFormLabel uppercase>{t('auth.confirmPassword')}</AppFormLabel>
                <div className="relative">
                  <AppTextInput
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pr-10"
                    error={Boolean(errors.confirmPassword)}
                    fieldSize="lg"
                    placeholder={t('auth.confirmPasswordPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
                  </button>
                </div>
                {errors.confirmPassword && <span className={APP_FIELD_ERROR_CLASS}>{errors.confirmPassword}</span>}
              </div>
            )}

            {mode === 'login' && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-outline-variant/30 text-primary-container accent-primary-container"
                  />
                  <span className="text-sm text-on-surface-variant">{t('auth.rememberMe')}</span>
                </label>
                {featureFlags.passwordReset && (
                  <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                    {t('auth.forgotPassword')}
                  </Link>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-container text-on-primary rounded-sm py-3 text-sm font-bold uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-50 active:scale-[0.98]"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Icon name="progress_activity" size={16} className="animate-spin" />
                  {t('auth.processing')}
                </span>
              ) : mode === 'login' ? (
                t('auth.login')
              ) : (
                t('auth.register')
              )}
            </button>
          </form>
        }
        modeSwitch={
          allowRegister ? (
            <div className="px-6 sm:px-8 pb-6 text-center">
              <button
                onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
                className="text-sm text-primary hover:underline underline-offset-4"
              >
                {mode === 'login' ? t('auth.noAccount') : t('auth.switchToLogin')}
              </button>
            </div>
          ) : null
        }
        legalLinks={
          <div className="px-6 sm:px-8 pb-6 sm:pb-8 text-center space-y-2">
            <div className="flex items-center justify-center gap-3 text-xs text-on-surface-variant/60">
              <a
                href="/legal/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-on-surface-variant transition-colors"
              >
                {t('auth.terms')}
              </a>
              <span>·</span>
              <a
                href="/legal/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-on-surface-variant transition-colors"
              >
                {t('auth.privacy')}
              </a>
            </div>
          </div>
        }
        backLink={
          <p className="text-center text-xs text-on-surface-variant mt-6">
            <Link to="/" className="hover:text-primary transition-colors">
              ← {t('auth.returnHome')}
            </Link>
          </p>
        }
      />
    </PublicPageShell>
  );
}
