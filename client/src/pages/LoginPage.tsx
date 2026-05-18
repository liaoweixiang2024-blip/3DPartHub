import { motion } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
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
import { getErrorMessage } from '../lib/errorNotifications';
import { useResolvedPublicInterfaceTheme } from '../lib/interfaceThemePreference';
import { usePublicSettings } from '../lib/publicSettings';
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
}

type LoginLocationState = {
  from?: string;
};

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialMode =
    location.pathname === '/register' || new URLSearchParams(location.search).get('mode') === 'register'
      ? 'register'
      : 'login';
  const [mode, setMode] = useState<AuthMode>(initialMode);
  useDocumentTitle(mode === 'register' ? '注册' : '登录');
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
  const resolvedPublicTheme = useResolvedPublicInterfaceTheme(publicSettings, isDesktop);
  const ThemePackage = getInterfaceThemePackage(resolvedPublicTheme);
  const LoginTemplate = ThemePackage.templates.Login;

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

  useEffect(() => {
    if (publicSettings) setAllowRegister(publicSettings.allow_register ?? true);
  }, [publicSettings]);

  useEffect(() => {
    const requestedMode =
      location.pathname === '/register' || new URLSearchParams(location.search).get('mode') === 'register'
        ? 'register'
        : 'login';
    setMode(requestedMode);
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
      setErrors((prev) => ({ ...prev, email: '请输入正确的邮箱' }));
      return;
    }
    if (!captchaText) {
      setErrors((prev) => ({ ...prev, captchaText: '请输入图形验证码' }));
      return;
    }
    setSendingCode(true);
    setApiError('');
    try {
      await client.post('/auth/email-code', { email, captchaId, captchaText });
      setEmailCountdown(60);
      setErrors((prev) => ({ ...prev, captchaText: undefined }));
    } catch (err: unknown) {
      setApiError(getErrorMessage(err, '发送失败'));
      refreshCaptcha();
    } finally {
      setSendingCode(false);
    }
  };

  const validate = (): boolean => {
    const errs: FormErrors = {};
    if (!email) errs.email = '请输入邮箱';
    else if (!validateEmail(email)) errs.email = '邮箱格式不正确';
    if (!password) errs.password = '请输入密码';
    else if (password.length < 8) errs.password = '密码至少8位';
    if (mode === 'register') {
      if (!username) errs.username = '请输入用户名';
      if (password !== confirmPassword) errs.confirmPassword = '两次密码不一致';
      if (!captchaText) errs.captchaText = '请输入图形验证码';
      if (!emailCode) errs.emailCode = '请输入邮箱验证码';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

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
        });
        login(result.user, result.tokens, true);
        navigate(from, { replace: true });
      }
    } catch (err: unknown) {
      setApiError(getErrorMessage(err, mode === 'login' ? '邮箱或密码错误' : '注册失败，请重试'));
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
  };

  return (
    <PublicPageShell showMobileBottomNav={false}>
      <LoginTemplate
        mode={mode}
        brand={<BrandMark size="hero" centered className="mx-auto mb-3 max-w-full" />}
        title={<PageTitle>{mode === 'login' ? '欢迎回来' : '创建账户'}</PageTitle>}
        subtitle={
          <p className="text-sm text-on-surface-variant mt-2">
            {mode === 'login' ? '登录您的账户继续' : '注册以开始使用平台'}
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
                <AppFormLabel uppercase>联系人 / 用户名</AppFormLabel>
                <AppTextInput
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  error={Boolean(errors.username)}
                  fieldSize="lg"
                  placeholder="例如 张工"
                />
                {errors.username && <span className={APP_FIELD_ERROR_CLASS}>{errors.username}</span>}
              </div>
            )}

            {mode === 'register' && (
              <div>
                <AppFormLabel uppercase>手机号</AppFormLabel>
                <AppTextInput
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  fieldSize="lg"
                  placeholder="用于询价、工单联系（选填）"
                />
              </div>
            )}

            {mode === 'register' && (
              <div>
                <AppFormLabel uppercase>公司名称</AppFormLabel>
                <AppTextInput
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  fieldSize="lg"
                  placeholder="提交询价时自动带入（选填）"
                />
              </div>
            )}

            {mode === 'register' && (
              <div>
                <AppFormLabel uppercase>联系地址</AppFormLabel>
                <AppTextInput
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  fieldSize="lg"
                  placeholder="用于询价对接和交付确认（选填）"
                />
              </div>
            )}

            <div>
              <AppFormLabel uppercase>邮箱</AppFormLabel>
              <AppTextInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={Boolean(errors.email)}
                fieldSize="lg"
                placeholder="例如 name@company.com"
              />
              {errors.email && <span className={APP_FIELD_ERROR_CLASS}>{errors.email}</span>}
            </div>

            {mode === 'register' && (
              <div>
                <AppFormLabel uppercase>图形验证码</AppFormLabel>
                <div className="flex gap-2 items-center">
                  <AppTextInput
                    type="text"
                    value={captchaText}
                    onChange={(e) => setCaptchaText(e.target.value)}
                    className="min-w-0 flex-1 px-3"
                    error={Boolean(errors.captchaText)}
                    fieldSize="lg"
                    placeholder="验证码"
                    maxLength={4}
                  />
                  {captchaSvg && (
                    <button
                      type="button"
                      onClick={refreshCaptcha}
                      className="shrink-0 cursor-pointer rounded-sm overflow-hidden border border-outline-variant/30 hover:opacity-80 transition-opacity"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(captchaSvg) }}
                      style={{ width: 100, height: 40 }}
                    />
                  )}
                </div>
                {errors.captchaText && <span className={APP_FIELD_ERROR_CLASS}>{errors.captchaText}</span>}
              </div>
            )}

            {mode === 'register' && (
              <div>
                <AppFormLabel uppercase>邮箱验证码</AppFormLabel>
                <div className="flex gap-2">
                  <AppTextInput
                    type="text"
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value)}
                    className="min-w-0 flex-1 px-3"
                    error={Boolean(errors.emailCode)}
                    fieldSize="lg"
                    placeholder="6位验证码"
                    maxLength={6}
                  />
                  <button
                    type="button"
                    onClick={handleSendEmailCode}
                    disabled={emailCountdown > 0 || sendingCode}
                    className="shrink-0 px-3 py-2.5 text-sm rounded-sm border border-primary-container/50 text-primary-container hover:bg-primary-container/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {sendingCode ? '发送中...' : emailCountdown > 0 ? `${emailCountdown}s` : '发送验证码'}
                  </button>
                </div>
                {errors.emailCode && <span className={APP_FIELD_ERROR_CLASS}>{errors.emailCode}</span>}
              </div>
            )}

            <div>
              <AppFormLabel uppercase>密码</AppFormLabel>
              <div className="relative">
                <AppTextInput
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  error={Boolean(errors.password)}
                  fieldSize="lg"
                  placeholder="至少8位"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
                </button>
              </div>
              {errors.password && <span className={APP_FIELD_ERROR_CLASS}>{errors.password}</span>}
            </div>

            {mode === 'register' && (
              <div>
                <AppFormLabel uppercase>确认密码</AppFormLabel>
                <div className="relative">
                  <AppTextInput
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pr-10"
                    error={Boolean(errors.confirmPassword)}
                    fieldSize="lg"
                    placeholder="再次输入密码"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
                  </button>
                </div>
                {errors.confirmPassword && <span className={APP_FIELD_ERROR_CLASS}>{errors.confirmPassword}</span>}
              </div>
            )}

            {mode === 'login' && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-outline-variant/30 text-primary-container accent-primary-container"
                />
                <span className="text-sm text-on-surface-variant">记住登录</span>
              </label>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-container text-on-primary rounded-sm py-3 text-sm font-bold uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-50 active:scale-[0.98]"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Icon name="progress_activity" size={16} className="animate-spin" />
                  处理中...
                </span>
              ) : mode === 'login' ? (
                '登录'
              ) : (
                '注册'
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
                {mode === 'login' ? '没有账户？立即注册' : '已有账户？立即登录'}
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
                用户协议
              </a>
              <span>·</span>
              <a
                href="/legal/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-on-surface-variant transition-colors"
              >
                隐私声明
              </a>
            </div>
          </div>
        }
        backLink={
          <p className="text-center text-xs text-on-surface-variant mt-6">
            <Link to="/" className="hover:text-primary transition-colors">
              ← 返回首页
            </Link>
          </p>
        }
      />
    </PublicPageShell>
  );
}
