import { useState } from 'react';
import { createShare, type CreateShareParams } from '../../api/shares';
import { copyText } from '../../lib/clipboard';
import { getErrorMessage } from '../../lib/errorNotifications';
import { getPublicSettingsSnapshot } from '../../lib/publicSettings';
import { useAuthStore } from '../../stores/useAuthStore';
import Icon from './Icon';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  modelId: string;
  modelName: string;
}

export default function ShareDialog({ open, onClose, modelId, modelName }: ShareDialogProps) {
  const policy = getPublicSettingsSnapshot();
  const role = useAuthStore((s) => s.user?.role);
  const shareEnabled = policy.share_enabled !== false;
  const canShare = shareEnabled || role === 'ADMIN';
  const canPassword = policy.share_allow_password !== false;
  const canCustomExpiry = policy.share_allow_custom_expiry !== false;
  const defaultAllowPreview = policy.share_allow_preview !== false;
  const maxExpireDays = Number(policy.share_max_expire_days) || 0;
  const maxDownloadLimit = Number(policy.share_max_download_limit) || 0;

  const [allowPreview, setAllowPreview] = useState(defaultAllowPreview);
  const [allowDownload, setAllowDownload] = useState(true);
  const [downloadLimit, setDownloadLimit] = useState(0);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [expiry, setExpiry] = useState('never');
  const [creating, setCreating] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  // Build expiry options based on policy
  const expiryOptions = (() => {
    const opts = [{ value: 'never', label: '永久' }];
    if (maxExpireDays === 0 || maxExpireDays >= 1) opts.push({ value: '1d', label: '1 天' });
    if (maxExpireDays === 0 || maxExpireDays >= 7) opts.push({ value: '7d', label: '7 天' });
    if (maxExpireDays === 0 || maxExpireDays >= 30) opts.push({ value: '30d', label: '30 天' });
    return opts;
  })();

  async function handleCreate() {
    if (usePassword && !password.trim()) {
      setError('请输入密码');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const expiresAt = expiry === 'never' ? undefined : getExpiryDate(expiry);
      const params: CreateShareParams = {
        modelId,
        allowPreview,
        allowDownload,
        downloadLimit,
        ...(usePassword && canPassword && { password }),
        ...(expiresAt && { expiresAt }),
      };
      const result = await createShare(params);
      setShareUrl(`${window.location.origin}/share/${result.token}`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '创建失败'));
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    await copyText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleReset() {
    setShareUrl('');
    setCopied(false);
    setAllowPreview(defaultAllowPreview);
    setAllowDownload(true);
    setDownloadLimit(0);
    setUsePassword(false);
    setPassword('');
    setExpiry('never');
    setError('');
  }

  function getExpiryDate(val: string): string | undefined {
    const now = new Date();
    switch (val) {
      case '1d':
        now.setDate(now.getDate() + 1);
        return now.toISOString();
      case '7d':
        now.setDate(now.getDate() + 7);
        return now.toISOString();
      case '30d':
        now.setDate(now.getDate() + 30);
        return now.toISOString();
      default:
        return undefined;
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-container-low rounded-t-xl sm:rounded-xl border border-outline-variant/20 w-full max-w-md shadow-2xl max-h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom,0px))] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10 shrink-0">
          <h3 className="text-base font-bold text-on-surface">分享模型</h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors">
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto scrollbar-hidden">
          {!canShare ? (
            <div className="text-center py-6">
              <p className="text-sm text-on-surface-variant">分享功能已关闭，请联系管理员</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-on-surface-variant break-words">分享「{modelName}」给其他人查看或下载</p>

              {shareUrl ? (
                <div className="space-y-3">
                  <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
                    <p className="text-xs text-primary font-medium mb-2">分享链接已创建</p>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={shareUrl}
                        className="w-full sm:flex-1 bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 font-mono truncate"
                      />
                      <button
                        onClick={handleCopy}
                        className="shrink-0 px-3 py-2 text-xs font-medium bg-primary-container text-on-primary rounded hover:opacity-90 transition-opacity"
                      >
                        {copied ? '已复制' : '复制'}
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleReset}
                      className="flex-1 px-4 py-2 text-sm font-medium border border-outline-variant/40 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 transition-colors"
                    >
                      继续创建
                    </button>
                    <button
                      onClick={onClose}
                      className="flex-1 px-4 py-2 text-sm font-medium bg-primary-container text-on-primary rounded-lg hover:opacity-90 transition-opacity"
                    >
                      完成
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Preview permission */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-on-surface">允许 3D 预览</p>
                      <p className="text-xs text-on-surface-variant">分享页面可以查看 3D 模型</p>
                    </div>
                    <button
                      onClick={() => setAllowPreview(!allowPreview)}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${allowPreview ? 'bg-primary-container' : 'bg-outline-variant/30'}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${allowPreview ? 'translate-x-5' : 'translate-x-0'}`}
                      />
                    </button>
                  </div>

                  {/* Download permission */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-on-surface">允许下载</p>
                      <p className="text-xs text-on-surface-variant">分享页面可以下载模型文件</p>
                    </div>
                    <button
                      onClick={() => setAllowDownload(!allowDownload)}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${allowDownload ? 'bg-primary-container' : 'bg-outline-variant/30'}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${allowDownload ? 'translate-x-5' : 'translate-x-0'}`}
                      />
                    </button>
                  </div>

                  {/* Download limit */}
                  {allowDownload && (
                    <div>
                      <label className="block text-sm text-on-surface mb-1">下载次数限制</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={maxDownloadLimit || undefined}
                          value={downloadLimit}
                          onChange={(e) => {
                            let v = Math.max(0, parseInt(e.target.value) || 0);
                            if (maxDownloadLimit > 0) v = Math.min(v, maxDownloadLimit);
                            setDownloadLimit(v);
                          }}
                          className="w-24 bg-surface-container-lowest text-on-surface text-base rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
                        />
                        <span className="text-xs text-on-surface-variant">
                          0 = 不限制{maxDownloadLimit > 0 ? `，上限 ${maxDownloadLimit}` : ''}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Password */}
                  {canPassword && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm text-on-surface">密码保护</p>
                        <button
                          onClick={() => setUsePassword(!usePassword)}
                          className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${usePassword ? 'bg-primary-container' : 'bg-outline-variant/30'}`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${usePassword ? 'translate-x-5' : 'translate-x-0'}`}
                          />
                        </button>
                      </div>
                      {usePassword && (
                        <input
                          type="text"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="输入访问密码"
                          className="w-full bg-surface-container-lowest text-on-surface text-base rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
                        />
                      )}
                    </div>
                  )}

                  {/* Expiry */}
                  {canCustomExpiry && (
                    <div>
                      <label className="block text-sm text-on-surface mb-1">
                        有效期{maxExpireDays > 0 ? `（最长 ${maxExpireDays} 天）` : ''}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {expiryOptions.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => setExpiry(opt.value)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                              expiry === opt.value
                                ? 'bg-primary-container text-on-primary'
                                : 'bg-surface-container-highest/50 text-on-surface-variant hover:bg-surface-container-highest'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {error && <p className="text-xs text-error">{error}</p>}

                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="w-full py-2.5 text-sm font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 disabled:opacity-50 active:scale-[0.98] transition-all"
                  >
                    {creating ? '创建中...' : '创建分享链接'}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
