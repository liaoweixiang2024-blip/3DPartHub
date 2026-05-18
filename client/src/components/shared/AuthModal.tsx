import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authApi } from '../../api/auth';
import client from '../../api/client';
import { unwrapResponse } from '../../api/response';
import { getErrorMessage } from '../../lib/errorNotifications';
import { useResolvedPublicInterfaceTheme } from '../../lib/interfaceThemePreference';
import { usePublicSettings } from '../../lib/publicSettings';
import { sanitizeHtml } from '../../lib/sanitizeHtml';
import { useAuthStore } from '../../stores/useAuthStore';
import { getInterfaceThemePackage } from '../../themes/interfaceThemes/registry';
import BrandMark from './BrandMark';
import { APP_FIELD_ERROR_CLASS, AppFormLabel, AppTextInput } from './FormControls';
import Icon from './Icon';

type AuthMode = 'login' | 'register';

interface AuthModalProps {
  initialMode?: AuthMode;
  open: boolean;
  returnUrl?: string;
  onClose: () => void;
}

interface FormErrors {
  captchaText?: string;
  confirmPassword?: string;
  email?: string;
  emailCode?: string;
  password?: string;
  username?: string;
}

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getCurrentPath(location: ReturnType<typeof useLocation>) {
  return `${location.pathname}${location.search}${location.hash}`;
}

export default function AuthModal({ initialMode = 'login', open, returnUrl, onClose }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailCountdown, setEmailCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [address, setAddress] = useState('');
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();
  const { settings } = usePublicSettings();
  const resolvedTheme = useResolvedPublicInterfaceTheme(settings);
  const interfaceTheme = getInterfaceThemePackage(resolvedTheme).manifest.key;
  const allowRegister = settings?.allow_register ?? true;

  const resetTransient = useCallback((nextMode: AuthMode) => {
    setMode(nextMode);
    setErrors({});
    setApiError('');
    setCaptchaText('');
    setEmailCode('');
    setEmailCountdown(0);
    setPhone('');
    setCompany('');
    setAddress('');
  }, []);

  useEffect(() => {
    if (!open) return;
    resetTransient(initialMode);
  }, [initialMode, open, resetTransient]);

  const refreshCaptcha = useCallback(async () => {
    try {
      const res = await client.get('/auth/captcha');
      const data = unwrapResponse<{ captchaId: string; captchaSvg: string }>(res);
      setCaptchaSvg(data.captchaSvg);
      setCaptchaId(data.captchaId);
      setCaptchaText('');
    } catch {
      // Captcha failures are surfaced when the user submits or requests email code.
    }
  }, []);

  useEffect(() => {
    if (open && mode === 'register') refreshCaptcha();
  }, [mode, open, refreshCaptcha]);

  useEffect(() => {
    if (!open || emailCountdown <= 0) return;
    const timer = window.setTimeout(() => setEmailCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [emailCountdown, open]);

  const validate = () => {
    const nextErrors: FormErrors = {};
    if (!email) nextErrors.email = '请输入邮箱';
    else if (!validateEmail(email)) nextErrors.email = '邮箱格式不正确';
    if (!password) nextErrors.password = '请输入密码';
    else if (password.length < 8) nextErrors.password = '密码至少8位';
    if (mode === 'register') {
      if (!username) nextErrors.username = '请输入用户名';
      if (password !== confirmPassword) nextErrors.confirmPassword = '两次密码不一致';
      if (!captchaText) nextErrors.captchaText = '请输入图形验证码';
      if (!emailCode) nextErrors.emailCode = '请输入邮箱验证码';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setApiError('');

    try {
      if (mode === 'login') {
        const result = await authApi.login({ email, password, rememberMe });
        login(result.user, result.tokens, rememberMe);
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
      }

      onClose();
      const target = returnUrl && returnUrl !== '/login' ? returnUrl : getCurrentPath(location);
      if (target && target !== getCurrentPath(location)) {
        navigate(target, { replace: true });
      }
    } catch (err: unknown) {
      setApiError(getErrorMessage(err, mode === 'login' ? '邮箱或密码错误' : '注册失败，请重试'));
      if (mode === 'register') refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const heading = mode === 'login' ? '登录您的账户' : '注册新账户';
  const AuthDialog = getInterfaceThemePackage(interfaceTheme).templates.AuthDialog;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="auth-modal-overlay fixed inset-0 z-[10000] flex items-center justify-center bg-black/45 px-4 py-5 backdrop-blur-sm"
          data-interface-theme={interfaceTheme}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <AuthDialog
            mode={mode}
            brand={<BrandMark size="hero" centered className="mx-auto mb-3 max-w-full" eagerLoad />}
            title={
              <h1 id="auth-modal-title" className="text-lg font-bold text-on-surface">
                {heading}
              </h1>
            }
            subtitle={null}
            closeLabel="关闭登录弹窗"
            onClose={onClose}
          >
            <form onSubmit={handleSubmit} className="space-y-5 p-6 sm:p-8">
              {apiError && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="flex items-start gap-2 rounded-sm border border-error/30 bg-error-container/20 px-4 py-3 text-sm text-error"
                >
                  <Icon name="error" size={20} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words">{apiError}</span>
                </motion.div>
              )}

              {mode === 'register' && (
                <div>
                  <AppFormLabel uppercase>联系人 / 用户名</AppFormLabel>
                  <AppTextInput
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
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
                    onChange={(event) => setPhone(event.target.value)}
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
                    onChange={(event) => setCompany(event.target.value)}
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
                    onChange={(event) => setAddress(event.target.value)}
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
                  onChange={(event) => setEmail(event.target.value)}
                  error={Boolean(errors.email)}
                  fieldSize="lg"
                  placeholder="例如 name@company.com"
                />
                {errors.email && <span className={APP_FIELD_ERROR_CLASS}>{errors.email}</span>}
              </div>

              {mode === 'register' && (
                <div>
                  <AppFormLabel uppercase>图形验证码</AppFormLabel>
                  <div className="flex items-center gap-2">
                    <AppTextInput
                      type="text"
                      value={captchaText}
                      onChange={(event) => setCaptchaText(event.target.value)}
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
                        className="shrink-0 cursor-pointer overflow-hidden rounded-sm border border-outline-variant/30 transition-opacity hover:opacity-80"
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
                      onChange={(event) => setEmailCode(event.target.value)}
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
                      className="shrink-0 whitespace-nowrap rounded-sm border border-primary-container/50 px-3 py-2.5 text-sm text-primary-container transition-colors hover:bg-primary-container/10 disabled:cursor-not-allowed disabled:opacity-50"
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
                    onChange={(event) => setPassword(event.target.value)}
                    className="pr-10"
                    error={Boolean(errors.password)}
                    fieldSize="lg"
                    placeholder="至少8位"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors hover:text-on-surface"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
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
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className="pr-10"
                      error={Boolean(errors.confirmPassword)}
                      fieldSize="lg"
                      placeholder="再次输入密码"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors hover:text-on-surface"
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    >
                      <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
                    </button>
                  </div>
                  {errors.confirmPassword && <span className={APP_FIELD_ERROR_CLASS}>{errors.confirmPassword}</span>}
                </div>
              )}

              {mode === 'login' && (
                <label className="flex cursor-pointer select-none items-center gap-2">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                    className="h-4 w-4 rounded border-outline-variant/30 text-primary-container accent-primary-container"
                  />
                  <span className="text-sm text-on-surface-variant">记住登录</span>
                </label>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-sm bg-primary-container py-3 text-sm font-bold uppercase tracking-wider text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
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

            {allowRegister && (
              <div className="auth-modal-switch px-7 pb-4 text-center sm:px-8">
                <button
                  type="button"
                  onClick={() => resetTransient(mode === 'login' ? 'register' : 'login')}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  {mode === 'login' ? '没有账户？立即注册' : '已有账户？立即登录'}
                </button>
              </div>
            )}

            <div className="auth-modal-legal px-8 pb-8 pt-1 text-center sm:px-8">
              <div className="flex items-center justify-center gap-3 text-xs text-on-surface-variant/60">
                <a
                  href="/legal/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-on-surface-variant"
                >
                  用户协议
                </a>
                <span>·</span>
                <a
                  href="/legal/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-on-surface-variant"
                >
                  隐私声明
                </a>
              </div>
            </div>
          </AuthDialog>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
