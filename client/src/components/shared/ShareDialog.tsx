import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createShare, listModelShares, type CreateShareParams } from '../../api/shares';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import { copyText } from '../../lib/clipboard';
import { getErrorMessage } from '../../lib/errorNotifications';
import { bottomSheetMotion, dialogPanelMotion } from '../../lib/motion';
import { getPublicSettingsSnapshot } from '../../lib/publicSettings';
import { useAuthStore } from '../../stores/useAuthStore';
import DialogOverlay from './DialogOverlay';
import Icon from './Icon';
import { useToast } from './Toast';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  modelId: string;
  modelName: string;
}

export default function ShareDialog({ open, onClose, modelId, modelName }: ShareDialogProps) {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 639px)');
  const { toast } = useToast();
  const policy = getPublicSettingsSnapshot();
  const role = useAuthStore((s) => s.user?.role);
  const shareEnabled = policy.feature_shares_enabled !== false;
  // 与后端口径一致：只看分享功能总开关（管理员可绕过，便于重新开启）
  const canShare = shareEnabled || role === 'ADMIN';
  const canPassword = policy.share_allow_password !== false;
  const canCustomExpiry = policy.share_allow_custom_expiry !== false;
  const defaultAllowPreview = policy.share_allow_preview !== false;
  const maxExpireDays = Number(policy.share_max_expire_days) || 0;
  const maxDownloadLimit = Number(policy.share_max_download_limit) || 0;

  const [allowPreview, setAllowPreview] = useState(defaultAllowPreview);
  const [allowDownload, setAllowDownload] = useState(true);
  const [allowDrawing, setAllowDrawing] = useState(true);
  const [downloadLimit, setDownloadLimit] = useState(0);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [expiry, setExpiry] = useState('never');
  const [creating, setCreating] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  // 已有未过期的分享链接（后端同用户+同模型只保留一条，打开时预取直接展示）
  const [existingShare, setExistingShare] = useState<{ token: string } | null>(null);
  // 本次提交命中后端复用（更新已有链接）时置 true，用于结果视图文案
  const [reused, setReused] = useState(false);
  // 「重新配置」模式：置 true 后不再自动回填已有链接，直到弹窗重开
  const [reconfiguring, setReconfiguring] = useState(false);

  useEffect(() => {
    if (!open) return;
    setExistingShare(null);
    setReconfiguring(false);
    listModelShares(modelId)
      .then((shares) => {
        const alive = shares.find((s) => !s.expiresAt || new Date(s.expiresAt) > new Date());
        if (alive) setExistingShare({ token: alive.token });
      })
      .catch(() => {
        // 预取失败不阻塞弹窗，走正常新建/后端复用
      });
  }, [open, modelId]);

  // 打开且未在重新配置时，有已有链接直接展示（可复制）
  useEffect(() => {
    if (existingShare && !shareUrl && !reconfiguring) {
      setShareUrl(`${window.location.origin}/share/${existingShare.token}`);
    }
  }, [existingShare, shareUrl, reconfiguring]);

  useEffect(() => {
    if (open) setReused(false);
  }, [open]);

  // Build expiry options based on policy
  const expiryOptions = (() => {
    const opts = [{ value: 'never', label: t('shareDialog.expiry.never') }];
    if (maxExpireDays === 0 || maxExpireDays >= 1) opts.push({ value: '1d', label: t('shareDialog.expiry.oneDay') });
    if (maxExpireDays === 0 || maxExpireDays >= 7) opts.push({ value: '7d', label: t('shareDialog.expiry.sevenDays') });
    if (maxExpireDays === 0 || maxExpireDays >= 30)
      opts.push({ value: '30d', label: t('shareDialog.expiry.thirtyDays') });
    return opts;
  })();

  async function handleCreate() {
    if (usePassword && !password.trim()) {
      setError(t('shareDialog.errors.passwordRequired'));
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
        allowDrawing,
        downloadLimit,
        ...(usePassword && canPassword && { password }),
        ...(expiresAt && { expiresAt }),
      };
      const result = await createShare(params);
      setShareUrl(`${window.location.origin}/share/${result.token}`);
      // 后端复用了已有链接（同用户+同模型去重）时提示「已更新」而非「已创建」
      const wasReused = (result as { reused?: boolean }).reused === true;
      setReused(wasReused);
      toast(wasReused ? t('shareDialog.toasts.updated') : t('shareDialog.toasts.created'), 'success');
    } catch (err: unknown) {
      setError(getErrorMessage(err, t('shareDialog.errors.createFailed')));
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    try {
      await copyText(shareUrl);
      setCopied(true);
      toast(t('shareDialog.toasts.copied'), 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch (err: unknown) {
      toast(getErrorMessage(err, t('shareDialog.errors.copyFailed')), 'error');
    }
  }

  function handleReset() {
    // 「重新配置」：回到表单（保存时后端仍会更新同一条链接，不会产生新链接）
    setReconfiguring(true);
    setShareUrl('');
    setCopied(false);
    setReused(false);
    setAllowPreview(defaultAllowPreview);
    setAllowDownload(true);
    setAllowDrawing(true);
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
    <AnimatePresence>
      {open && (
        <DialogOverlay onClose={onClose} zIndex={120} bottomOnMobile safeArea>
          <motion.div
            variants={isMobile ? bottomSheetMotion : dialogPanelMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            className="bg-surface-container-low rounded-t-xl sm:rounded-xl border border-outline-variant/20 w-full max-w-md shadow-2xl max-h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom,0px))] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10 shrink-0">
              <h3 className="text-base font-bold text-on-surface">{t('shareDialog.title')}</h3>
              <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors">
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto scrollbar-hidden">
              {!canShare ? (
                <div className="text-center py-6">
                  <p className="text-sm text-on-surface-variant">{t('shareDialog.disabled')}</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-on-surface-variant break-words">
                    {t('shareDialog.description', { name: modelName })}
                  </p>

                  {shareUrl ? (
                    <div className="space-y-3">
                      <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
                        <p className="text-xs text-primary font-medium mb-2">
                          {existingShare || reused ? t('shareDialog.linkExisting') : t('shareDialog.linkCreated')}
                        </p>
                        {existingShare && !reused && (
                          <p className="text-[11px] text-on-surface-variant mb-2">{t('shareDialog.reusedNotice')}</p>
                        )}
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={shareUrl}
                            onFocus={(e) => e.currentTarget.select()}
                            className="w-full sm:flex-1 bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 font-mono truncate"
                          />
                          <button
                            onClick={handleCopy}
                            className="shrink-0 px-3 py-2 text-xs font-medium bg-primary-container text-on-primary rounded hover:opacity-90 transition-opacity"
                          >
                            {copied ? t('shareDialog.copied') : t('shareDialog.copy')}
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleReset}
                          className="flex-1 px-4 py-2 text-sm font-medium border border-outline-variant/40 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 transition-colors"
                        >
                          {t('shareDialog.createAnother')}
                        </button>
                        <button
                          onClick={onClose}
                          className="flex-1 px-4 py-2 text-sm font-medium bg-primary-container text-on-primary rounded-lg hover:opacity-90 transition-opacity"
                        >
                          {t('shareDialog.done')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Preview permission */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-on-surface">{t('shareDialog.allowPreview')}</p>
                          <p className="text-xs text-on-surface-variant">{t('shareDialog.allowPreviewDesc')}</p>
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
                          <p className="text-sm text-on-surface">{t('shareDialog.allowDownload')}</p>
                          <p className="text-xs text-on-surface-variant">{t('shareDialog.allowDownloadDesc')}</p>
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

                      {/* Drawing permission */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-on-surface">{t('shareDialog.allowDrawing')}</p>
                          <p className="text-xs text-on-surface-variant">{t('shareDialog.allowDrawingDesc')}</p>
                        </div>
                        <button
                          onClick={() => setAllowDrawing(!allowDrawing)}
                          className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${allowDrawing ? 'bg-primary-container' : 'bg-outline-variant/30'}`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${allowDrawing ? 'translate-x-5' : 'translate-x-0'}`}
                          />
                        </button>
                      </div>

                      {/* Download limit */}
                      {allowDownload && (
                        <div>
                          <label className="block text-sm text-on-surface mb-1">{t('shareDialog.downloadLimit')}</label>
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
                              {maxDownloadLimit > 0
                                ? t('shareDialog.downloadLimitWithMax', { max: maxDownloadLimit })
                                : t('shareDialog.downloadLimitUnlimited')}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Password */}
                      {canPassword && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-sm text-on-surface">{t('shareDialog.passwordProtect')}</p>
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
                              placeholder={t('shareDialog.passwordPlaceholder')}
                              className="w-full bg-surface-container-lowest text-on-surface text-base rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
                            />
                          )}
                        </div>
                      )}

                      {/* Expiry */}
                      {canCustomExpiry && (
                        <div>
                          <label className="block text-sm text-on-surface mb-1">
                            {maxExpireDays > 0
                              ? t('shareDialog.expiryLabelWithMax', { max: maxExpireDays })
                              : t('shareDialog.expiryLabel')}
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
                        {creating
                          ? t('shareDialog.creating')
                          : existingShare
                            ? t('shareDialog.updateSettings')
                            : t('shareDialog.createLink')}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </DialogOverlay>
      )}
    </AnimatePresence>
  );
}
