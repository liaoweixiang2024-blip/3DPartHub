import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToast } from './Toast';

/**
 * Global overlay that forces default/admin accounts to change their password.
 * Shown only for admins with user.mustChangePassword === true.
 */
export default function ForceChangePassword() {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user?.role !== 'ADMIN' || !user.mustChangePassword) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('新密码长度至少8位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      await authApi.setInitialPassword(newPassword);
      toast('密码修改成功，请重新登录', 'success');
      setTimeout(() => {
        useAuthStore.getState().logout();
        window.location.replace('/login');
      }, 800);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.response?.data?.detail || '密码修改失败，请重试';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
      >
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
            <h2 className="text-xl font-bold text-on-surface">首次登录，请修改密码</h2>
            <p className="text-sm text-on-surface-variant mt-2 text-center">为保障账户安全，请先设置一个新的登录密码</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-wider text-on-surface-variant">新密码</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError('');
                }}
                required
                minLength={8}
                className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none"
                placeholder="至少8位"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-wider text-on-surface-variant">确认新密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError('');
                }}
                required
                minLength={8}
                className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none"
                placeholder="再次输入新密码"
              />
            </div>
            {error && <p className="text-red-400 text-xs break-words">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-primary-container text-on-primary rounded-sm text-sm font-medium hover:bg-primary transition-colors disabled:opacity-50 mt-2"
            >
              {loading ? '提交中...' : '确认修改'}
            </button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
