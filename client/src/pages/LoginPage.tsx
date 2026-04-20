import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuthStore } from "../stores/useAuthStore";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { getSiteTitle, getSiteLogo } from "../lib/publicSettings";
import Icon from "../components/shared/Icon";
import { getPublicSettings } from "../api/settings";
import client from "../api/client";

type AuthMode = "login" | "register";

interface FormErrors {
  email?: string;
  password?: string;
  username?: string;
  confirmPassword?: string;
  captchaText?: string;
  emailCode?: string;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function LoginPage() {
  useDocumentTitle("登录");
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [allowRegister, setAllowRegister] = useState(true);

  // Captcha state
  const [captchaSvg, setCaptchaSvg] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaText, setCaptchaText] = useState("");

  // Email code state
  const [emailCode, setEmailCode] = useState("");
  const [emailCountdown, setEmailCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);

  useEffect(() => {
    getPublicSettings().then(s => setAllowRegister(s.allow_register ?? true)).catch(() => {});
  }, []);

  // Fetch captcha on mount and when switching to register
  const refreshCaptcha = useCallback(async () => {
    try {
      const { data: resp } = await client.get("/auth/captcha");
      const d = resp?.data ?? resp;
      setCaptchaSvg(d.captchaSvg);
      setCaptchaId(d.captchaId);
      setCaptchaText("");
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    if (mode === "register") refreshCaptcha();
  }, [mode, refreshCaptcha]);

  // Countdown timer
  useEffect(() => {
    if (emailCountdown <= 0) return;
    const timer = setTimeout(() => setEmailCountdown(emailCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [emailCountdown]);

  const handleSendEmailCode = async () => {
    if (!email || !validateEmail(email)) {
      setErrors(prev => ({ ...prev, email: "请输入正确的邮箱" }));
      return;
    }
    if (!captchaText) {
      setErrors(prev => ({ ...prev, captchaText: "请输入图形验证码" }));
      return;
    }
    setSendingCode(true);
    setApiError("");
    try {
      await client.post("/auth/email-code", { email, captchaId, captchaText });
      setEmailCountdown(60);
      setErrors(prev => ({ ...prev, captchaText: undefined }));
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.detail || "发送失败";
      setApiError(msg);
      refreshCaptcha();
    } finally {
      setSendingCode(false);
    }
  };

  const validate = (): boolean => {
    const errs: FormErrors = {};
    if (!email) errs.email = "请输入邮箱";
    else if (!validateEmail(email)) errs.email = "邮箱格式不正确";
    if (!password) errs.password = "请输入密码";
    else if (password.length < 8) errs.password = "密码至少8位";
    if (mode === "register") {
      if (!username) errs.username = "请输入用户名";
      if (password !== confirmPassword) errs.confirmPassword = "两次密码不一致";
      if (!captchaText) errs.captchaText = "请输入图形验证码";
      if (!emailCode) errs.emailCode = "请输入邮箱验证码";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setApiError("");

    try {
      const { authApi } = await import("../api");
      if (mode === "login") {
        const result = await authApi.login({ email, password });
        login(result.user, result.tokens);
        navigate("/");
      } else {
        const result = await authApi.register({ username, email, password, emailCode });
        login(result.user, result.tokens);
        navigate("/");
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.detail || (mode === "login" ? "邮箱或密码错误" : "注册失败，请重试");
      setApiError(msg);
      if (mode === "register") refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode);
    setErrors({});
    setApiError("");
    setEmailCode("");
    setCaptchaText("");
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        <div className="bg-surface-container-low rounded-lg border border-outline-variant/20 overflow-hidden">
          <div className="p-8 border-b border-outline-variant/10 text-center">
            {getSiteLogo() ? (
              <img src={getSiteLogo()} alt="" className="w-12 h-12 mx-auto mb-3 object-contain" />
            ) : (
              <Icon name="precision_manufacturing" size={48} className="text-primary mb-3 block" />
            )}
            <h1 className="text-2xl font-headline font-bold text-on-surface tracking-tight">
              {mode === "login" ? `登录${getSiteTitle()}` : "创建账户"}
            </h1>
            <p className="text-sm text-on-surface-variant mt-2">
              {mode === "login" ? "访问您的3D模型库与工程数据" : "注册以开始使用平台"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-5">
            {apiError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="bg-error-container/20 border border-error/30 rounded-sm px-4 py-3 text-sm text-error flex items-center gap-2"
              >
                <Icon name="error" size={20} />
                {apiError}
              </motion.div>
            )}

            {mode === "register" && (
              <div>
                <label className="block text-xs text-on-surface-variant uppercase tracking-wider mb-1.5">用户名</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={`w-full bg-surface-container-lowest text-on-surface rounded-sm px-4 py-2.5 border outline-none transition-colors ${
                    errors.username ? "border-error" : "border-outline-variant/30 focus:border-primary-container"
                  }`}
                  placeholder="请输入用户名"
                />
                {errors.username && <span className="text-xs text-error mt-1 block">{errors.username}</span>}
              </div>
            )}

            <div>
              <label className="block text-xs text-on-surface-variant uppercase tracking-wider mb-1.5">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full bg-surface-container-lowest text-on-surface rounded-sm px-4 py-2.5 border outline-none transition-colors ${
                  errors.email ? "border-error" : "border-outline-variant/30 focus:border-primary-container"
                }`}
                placeholder="例如 name@company.com"
              />
              {errors.email && <span className="text-xs text-error mt-1 block">{errors.email}</span>}
            </div>

            {mode === "register" && (
              <div>
                <label className="block text-xs text-on-surface-variant uppercase tracking-wider mb-1.5">图形验证码</label>
                <div className="flex gap-3 items-center">
                  <input
                    type="text"
                    value={captchaText}
                    onChange={(e) => setCaptchaText(e.target.value)}
                    className={`flex-1 bg-surface-container-lowest text-on-surface rounded-sm px-4 py-2.5 border outline-none transition-colors ${
                      errors.captchaText ? "border-error" : "border-outline-variant/30 focus:border-primary-container"
                    }`}
                    placeholder="输入右侧验证码"
                    maxLength={4}
                  />
                  {captchaSvg && (
                    <button
                      type="button"
                      onClick={refreshCaptcha}
                      className="shrink-0 cursor-pointer rounded-sm overflow-hidden border border-outline-variant/30 hover:opacity-80 transition-opacity"
                      title="点击刷新验证码"
                      dangerouslySetInnerHTML={{ __html: captchaSvg }}
                      style={{ width: 120, height: 40 }}
                    />
                  )}
                </div>
                {errors.captchaText && <span className="text-xs text-error mt-1 block">{errors.captchaText}</span>}
              </div>
            )}

            {mode === "register" && (
              <div>
                <label className="block text-xs text-on-surface-variant uppercase tracking-wider mb-1.5">邮箱验证码</label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value)}
                    className={`flex-1 bg-surface-container-lowest text-on-surface rounded-sm px-4 py-2.5 border outline-none transition-colors ${
                      errors.emailCode ? "border-error" : "border-outline-variant/30 focus:border-primary-container"
                    }`}
                    placeholder="6位验证码"
                    maxLength={6}
                  />
                  <button
                    type="button"
                    onClick={handleSendEmailCode}
                    disabled={emailCountdown > 0 || sendingCode}
                    className="shrink-0 px-4 py-2.5 text-sm rounded-sm border border-primary-container/50 text-primary-container hover:bg-primary-container/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {sendingCode ? "发送中..." : emailCountdown > 0 ? `${emailCountdown}s` : "发送验证码"}
                  </button>
                </div>
                {errors.emailCode && <span className="text-xs text-error mt-1 block">{errors.emailCode}</span>}
              </div>
            )}

            <div>
              <label className="block text-xs text-on-surface-variant uppercase tracking-wider mb-1.5">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full bg-surface-container-lowest text-on-surface rounded-sm px-4 py-2.5 border outline-none transition-colors ${
                  errors.password ? "border-error" : "border-outline-variant/30 focus:border-primary-container"
                }`}
                placeholder="至少8位"
              />
              {errors.password && <span className="text-xs text-error mt-1 block">{errors.password}</span>}
            </div>

            {mode === "register" && (
              <div>
                <label className="block text-xs text-on-surface-variant uppercase tracking-wider mb-1.5">确认密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`w-full bg-surface-container-lowest text-on-surface rounded-sm px-4 py-2.5 border outline-none transition-colors ${
                    errors.confirmPassword ? "border-error" : "border-outline-variant/30 focus:border-primary-container"
                  }`}
                  placeholder="再次输入密码"
                />
                {errors.confirmPassword && <span className="text-xs text-error mt-1 block">{errors.confirmPassword}</span>}
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
                  处理中...
                </span>
              ) : mode === "login" ? "登录" : "注册"}
            </button>
          </form>

          {allowRegister && (
          <div className="px-8 pb-8 text-center">
            <button
              onClick={() => switchMode(mode === "login" ? "register" : "login")}
              className="text-sm text-primary hover:underline underline-offset-4"
            >
              {mode === "login" ? "没有账户？立即注册" : "已有账户？立即登录"}
            </button>
          </div>
          )}
        </div>

        <p className="text-center text-xs text-on-surface-variant mt-6">
          <Link to="/" className="hover:text-primary transition-colors">← 返回首页</Link>
        </p>
      </motion.div>
    </div>
  );
}
