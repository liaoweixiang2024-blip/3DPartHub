import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type CategoryItem } from '../../api/categories';
import { openModelDrawing } from '../../api/downloads';
import { modelApi, type DrawingRef } from '../../api/models';
import { getBusinessConfig } from '../../lib/businessConfig';
import { AdminButton, AdminIconButton } from '../shared/AdminControls';
import CategorySelect from '../shared/CategorySelect';
import DialogOverlay from '../shared/DialogOverlay';
import { AppFormLabel, AppTextInput } from '../shared/FormControls';
import Icon from '../shared/Icon';
import ModelThumbnail from '../shared/ModelThumbnail';
import { useToast } from '../shared/Toast';

export function DetailEditDialog({
  open,
  modelId,
  modelName,
  thumbnailUrl: initialThumb,
  drawings: initialDrawings,
  categoryId: initialCat,
  categories,
  onClose,
  onSaved,
  onDelete,
}: {
  open: boolean;
  modelId: string;
  modelName: string;
  thumbnailUrl: string | null;
  drawings: DrawingRef[];
  categoryId?: string | null;
  categories: CategoryItem[];
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [name, setName] = useState(modelName);
  const [catId, setCatId] = useState(initialCat || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [thumbUploading, setThumbUploading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [gmshBusy, setGmshBusy] = useState(false);
  const [stdProgress, setStdProgress] = useState<{ percent: number; message: string } | null>(null);
  const [gmshProgress, setGmshProgress] = useState<{ percent: number; message: string } | null>(null);
  const [gmshAvailable, setGmshAvailable] = useState<boolean | null>(null);
  const [showGmshHelp, setShowGmshHelp] = useState(false);
  const [gmshCmdCopied, setGmshCmdCopied] = useState<string | null>(null);
  const [thumbUrl, setThumbUrl] = useState(initialThumb);
  const [drawingUploading, setDrawingUploading] = useState(false);
  const [drawings, setDrawings] = useState<DrawingRef[]>(initialDrawings);
  const { uploadPolicy } = getBusinessConfig();
  const imageMaxBytes = Math.max(1, Number(uploadPolicy.productWallImageMaxSizeMb) || 8) * 1024 * 1024;
  const drawingMaxBytes = Math.max(1, Number(uploadPolicy.modelDrawingMaxSizeMb) || 500) * 1024 * 1024;
  const [fileReplacing, setFileReplacing] = useState(false);

  useEffect(() => {
    if (open) {
      setName(modelName);
      setCatId(initialCat || '');
      setThumbUrl(initialThumb);
      setDrawings(initialDrawings);
      // 管理员打开弹窗时探测 gmsh 是否可用（非管理员静默失败保持 null）
      if (gmshAvailable === null) {
        void modelApi.gmshAvailable().then(setGmshAvailable);
      }
    }
  }, [open, modelName, initialCat, initialThumb, initialDrawings, gmshAvailable]);

  if (!open) return null;

  // 发起重转任务并轮询进度到完成；返回 done 的 result 或抛出错误
  const runReconvertJob = async (
    start: () => Promise<{ jobId: string }>,
    setProgress: (p: { percent: number; message: string } | null) => void,
  ) => {
    const { jobId } = await start();
    setProgress({ percent: 1, message: t('modelAdminPage.jobSubmitted') });
    // 服务端只在阶段边界上报（5→20→45…），长阶段（如 gmsh 网格化几十秒）数字不动。
    // 本地每秒平滑 +1（封顶到下一阶段前的 95%），收到服务端新值时向上校准——
    // 按钮呈现 1%→100% 连续增长，结束时由 done 精确归位。
    let displayed = 1;
    let serverPercent = 1;
    let finished = false;
    const ticker = window.setInterval(() => {
      if (finished) return;
      displayed = Math.min(displayed + 1, Math.max(serverPercent + 1, 95));
      setProgress({ percent: displayed, message: t('modelAdminPage.jobConverting') });
    }, 1000);
    try {
      for (let i = 0; i < 900; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const job = await modelApi.reconvertProgress(jobId);
        if (job.stage === 'done') {
          setProgress({ percent: 100, message: t('modelAdminPage.jobDone') });
          finished = true;
          return job.result;
        }
        if (job.stage === 'error') throw new Error(job.error || t('modelAdminPage.convertFailed'));
        serverPercent = job.percent;
        displayed = Math.max(displayed, job.percent);
        setProgress({ percent: Math.min(displayed, 99), message: job.message });
      }
      throw new Error(t('modelAdminPage.convertTimeout'));
    } finally {
      window.clearInterval(ticker);
    }
  };

  const copyGmshCmd = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setGmshCmdCopied(key);
      window.setTimeout(() => setGmshCmdCopied(null), 1500);
    } catch {
      setGmshCmdCopied(null);
    }
  };

  // 实测验证的安装方案：发行版 gmsh（apt/yum）动态链接 glibc，Alpine 容器跑不了；
  // 必须用 gmsh.info 官方 SDK 包 + 把依赖库一起挂载（2026-09 生产服务器验证通过）
  const GMSH_INSTALL_CMD = `# 下载官方 SDK 版（容器内可运行）
cd /tmp && curl -LO https://gmsh.info/bin/Linux/gmsh-4.13.1-Linux64-sdk.tgz
tar xzf gmsh-4.13.1-Linux64-sdk.tgz
install -m 755 gmsh-4.13.1-Linux64-sdk/bin/gmsh /usr/local/bin/gmsh.real
mkdir -p /usr/local/lib/gmsh-sdk
cp -a gmsh-4.13.1-Linux64-sdk/lib/. /usr/local/lib/gmsh-sdk/
# 依赖库（Debian/Ubuntu）
mkdir -p /usr/local/lib/gmsh-deps && cd /lib/x86_64-linux-gnu
for lib in libGLU.so.1 libGL.so.1 libGLdispatch.so.0 libGLX.so.0 libOpenGL.so.0 \
  libX11.so.6 libXau.so.6 libXdmcp.so.6 libXext.so.6 libXrender.so.1 libXcursor.so.1 \
  libXfixes.so.3 libXft.so.2 libXinerama.so.1 libfontconfig.so.1 libfreetype.so.6 \
  libexpat.so.1 libpng16.so.16 libbrotlidec.so.1 libbrotlicommon.so.1 libbsd.so.0 \
  libmd.so.0 libstdc++.so.6 libgcc_s.so.1 libz.so.1 libdl.so.2 libpthread.so.0 librt.so.1; do
  cp -L $lib /usr/local/lib/gmsh-deps/; done
# wrapper 脚本
printf '#!/bin/sh\nexport LD_LIBRARY_PATH="/usr/local/host-lib/gmsh-sdk:/usr/local/host-lib/gmsh-deps:/usr/local/host-lib:$LD_LIBRARY_PATH"\nexec /usr/local/host-bin/gmsh.real "$@"\n' > /usr/local/bin/gmsh
chmod 755 /usr/local/bin/gmsh && /usr/local/bin/gmsh.real -version`;
  const GMSH_MOUNT_STEP = `# /opt/3dparthub/docker-compose.yml → api 服务 volumes 下加：
- /usr/local/bin/gmsh:/usr/local/host-bin/gmsh:ro
- /usr/local/bin/gmsh.real:/usr/local/host-bin/gmsh.real:ro
- /lib64/ld-linux-x86-64.so.2:/lib64/ld-linux-x86-64.so.2:ro
- /lib/x86_64-linux-gnu/libc.so.6:/lib/x86_64-linux-gnu/libc.so.6:ro
- /lib/x86_64-linux-gnu/libm.so.6:/lib/x86_64-linux-gnu/libm.so.6:ro
- /lib/x86_64-linux-gnu/libgomp.so.1:/usr/local/host-lib/libgomp.so.1:ro
- /usr/local/lib/gmsh-sdk:/usr/local/host-lib/gmsh-sdk:ro
- /usr/local/lib/gmsh-deps:/usr/local/host-lib/gmsh-deps:ro
# 然后重建容器并验证：
cd /opt/3dparthub && docker-compose up -d --force-recreate api
docker exec 3dparthub-api /usr/local/host-bin/gmsh -version  # 应输出 4.13.1`;

  const handleSave = async () => {
    if (!name.trim()) {
      toast(t('modelAdminPage.nameRequired'), 'error');
      return;
    }
    setSaving(true);
    let ok = false;
    try {
      await modelApi.update(modelId, { name: name.trim(), categoryId: catId || null });
      toast(t('modelAdminPage.savedToast'), 'success');
      ok = true;
    } catch {
      toast(t('modelAdminPage.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
    if (ok) {
      onSaved();
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <DialogOverlay
          onClose={onClose}
          zIndex={120}
          backdropClassName="bg-surface-dim/70 backdrop-blur-sm"
          bottomOnMobile
          safeArea
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            data-tooltip-ignore
            className="bg-surface-container-low rounded-t-lg sm:rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-lg max-h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom,0px))] sm:max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-4 sm:px-6 border-b border-outline-variant/10 shrink-0">
              <h3 className="font-headline text-lg font-semibold text-on-surface">
                {t('modelAdminPage.editModelTitle')}
              </h3>
              <AdminIconButton icon="close" onClick={onClose} variant="ghost" aria-label={t('common.close')} />
            </div>
            <div className="px-4 py-4 sm:px-6 space-y-4 overflow-y-auto scrollbar-hidden sm:custom-scrollbar">
              <div className="flex flex-col gap-1.5">
                <AppFormLabel uppercase className="mb-0">
                  {t('modelAdminPage.previewImageLabel')}
                </AppFormLabel>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-24 h-24 rounded-sm bg-surface-container-highest shrink-0 overflow-hidden">
                    <ModelThumbnail src={thumbUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5 flex-1">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      id="detail-thumb-upload"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) {
                            toast(t('modelAdminPage.imageInvalidType'), 'error');
                            e.target.value = '';
                            return;
                          }
                          if (f.size > imageMaxBytes) {
                            toast(
                              t('modelAdminPage.imageTooLarge', { size: uploadPolicy.productWallImageMaxSizeMb }),
                              'error',
                            );
                            e.target.value = '';
                            return;
                          }
                          setThumbUploading(true);
                          let ok = false;
                          try {
                            const r = await modelApi.uploadThumbnail(modelId, f);
                            setThumbUrl(r.thumbnail_url);
                            toast(t('modelAdminPage.thumbnailUpdated'), 'success');
                            ok = true;
                          } catch {
                            toast(t('modelAdminPage.uploadFailed'), 'error');
                          } finally {
                            setThumbUploading(false);
                          }
                          if (ok) onSaved();
                          e.target.value = '';
                        }
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <AdminButton
                        onClick={() => document.getElementById('detail-thumb-upload')?.click()}
                        disabled={thumbUploading}
                        icon="upload"
                        size="sm"
                        variant="secondary"
                      >
                        {thumbUploading ? t('modelAdminPage.uploading') : t('modelAdminPage.uploadImage')}
                      </AdminButton>
                      <AdminButton
                        onClick={async () => {
                          setRegenerating(true);
                          setStdProgress(null);
                          let ok = false;
                          try {
                            const r = await runReconvertJob(() => modelApi.reconvert(modelId), setStdProgress);
                            if (r?.thumbnail_url) setThumbUrl(r.thumbnail_url);
                            toast(
                              r?.thumbnail_warning || t('modelAdminPage.stdConvertDone'),
                              r?.thumbnail_warning ? 'info' : 'success',
                            );
                            ok = true;
                          } catch (err) {
                            const message = (err as { response?: { data?: { detail?: string } } })?.response?.data
                              ?.detail;
                            toast(
                              message || (err instanceof Error ? err.message : t('modelAdminPage.stdConvertFailed')),
                              'error',
                            );
                          } finally {
                            setRegenerating(false);
                          }
                          if (ok) onSaved();
                        }}
                        disabled={regenerating}
                        icon="refresh"
                        size="sm"
                        variant="secondary"
                        className={regenerating ? 'relative overflow-hidden' : undefined}
                        iconClassName={regenerating && stdProgress ? 'relative z-10' : undefined}
                      >
                        {regenerating && stdProgress ? (
                          <>
                            <span
                              className="absolute inset-y-0 left-0 z-0 bg-primary/20"
                              style={{ width: `${stdProgress.percent}%` }}
                            />
                            <span className="relative z-10 tabular-nums">
                              {t('modelAdminPage.convertingPercent', { percent: stdProgress.percent })}
                            </span>
                          </>
                        ) : regenerating ? (
                          t('modelAdminPage.generating')
                        ) : (
                          t('modelAdminPage.stdConvert')
                        )}
                      </AdminButton>
                      <AdminButton
                        onClick={async () => {
                          setGmshBusy(true);
                          setGmshProgress(null);
                          let ok = false;
                          try {
                            const r = await runReconvertJob(() => modelApi.reconvertGmsh(modelId), setGmshProgress);
                            if (r?.thumbnail_url) setThumbUrl(r.thumbnail_url);
                            toast(t('modelAdminPage.fixConvertDone'), 'success');
                            ok = true;
                          } catch (err) {
                            const message = (err as { response?: { data?: { detail?: string } } })?.response?.data
                              ?.detail;
                            toast(
                              message || (err instanceof Error ? err.message : t('modelAdminPage.fixConvertFailed')),
                              'error',
                            );
                          } finally {
                            setGmshBusy(false);
                          }
                          if (ok) onSaved();
                        }}
                        disabled={gmshBusy || gmshAvailable === false}
                        icon="build"
                        size="sm"
                        variant="secondary"
                        className={gmshBusy ? 'relative overflow-hidden' : undefined}
                        iconClassName={gmshBusy && gmshProgress ? 'relative z-10' : undefined}
                      >
                        {gmshBusy && gmshProgress ? (
                          <>
                            <span
                              className="absolute inset-y-0 left-0 z-0 bg-primary/20"
                              style={{ width: `${gmshProgress.percent}%` }}
                            />
                            <span className="relative z-10 tabular-nums">
                              {t('modelAdminPage.convertingPercent', { percent: gmshProgress.percent })}
                            </span>
                          </>
                        ) : gmshBusy ? (
                          t('modelAdminPage.fixing')
                        ) : (
                          t('modelAdminPage.fixConvert')
                        )}
                      </AdminButton>
                      <button
                        type="button"
                        onClick={() => setShowGmshHelp(true)}
                        aria-label={t('modelAdminPage.aboutConvertEngine')}
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${
                          gmshAvailable === false
                            ? 'bg-error/15 text-error hover:bg-error/25'
                            : 'bg-primary/10 text-primary hover:bg-primary/20'
                        }`}
                      >
                        <Icon name={gmshAvailable === false ? 'priority_high' : 'info'} size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <AppFormLabel uppercase className="mb-0">
                  {t('modelAdminPage.nameLabel')}
                </AppFormLabel>
                <AppTextInput value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <AppFormLabel uppercase className="mb-0">
                  {t('modelAdminPage.categoryLabel')}
                </AppFormLabel>
                <CategorySelect
                  categories={categories}
                  value={catId}
                  onChange={setCatId}
                  placeholder={t('modelAdminPage.selectCategoryPlaceholder')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <AppFormLabel uppercase className="mb-0">
                  {t('modelAdminPage.drawingLabel')}
                </AppFormLabel>
                <div className="flex flex-col gap-2">
                  {drawings.map((drawing) => (
                    <div key={drawing.id} className="flex items-center gap-2">
                      <Icon name="description" size={20} className="text-primary shrink-0" />
                      <span className="text-sm text-on-surface truncate flex-1" title={drawing.name}>
                        {drawing.name}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void openModelDrawing(modelId, drawing.id).catch(() =>
                            toast(t('modelAdminPage.openDrawingFailed'), 'error'),
                          )
                        }
                        className="text-xs text-primary hover:underline shrink-0"
                      >
                        {t('modelAdminPage.view')}
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const r = await modelApi.deleteDrawing(modelId, drawing.id);
                            setDrawings(r.drawings);
                            toast(t('modelAdminPage.drawingDeleted'), 'success');
                            onSaved();
                          } catch {
                            toast(t('modelAdminPage.deleteFailed'), 'error');
                          }
                        }}
                        className="text-xs text-error hover:underline shrink-0"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  ))}
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    id="detail-drawing-upload"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (f.type !== 'application/pdf') {
                        toast(t('modelAdminPage.pdfOnly'), 'error');
                        e.target.value = '';
                        return;
                      }
                      if (f.size > drawingMaxBytes) {
                        toast(t('modelAdminPage.pdfTooLarge', { size: uploadPolicy.modelDrawingMaxSizeMb }), 'error');
                        e.target.value = '';
                        return;
                      }
                      setDrawingUploading(true);
                      try {
                        const r = await modelApi.uploadDrawing(modelId, f);
                        setDrawings(r.drawings);
                        toast(t('modelAdminPage.drawingUploaded'), 'success');
                        onSaved();
                      } catch {
                        toast(t('modelAdminPage.uploadFailed'), 'error');
                      } finally {
                        setDrawingUploading(false);
                      }
                      e.target.value = '';
                    }}
                  />
                  <AdminButton
                    onClick={() => document.getElementById('detail-drawing-upload')?.click()}
                    disabled={drawingUploading}
                    icon="upload_file"
                    size="sm"
                    variant="secondary"
                    className="w-full justify-center"
                  >
                    {drawingUploading
                      ? t('modelAdminPage.uploading')
                      : drawings.length > 0
                        ? t('modelAdminPage.addDrawing')
                        : t('modelAdminPage.uploadDrawing')}
                  </AdminButton>
                </div>
              </div>
              <div className="border-t border-outline-variant/20 pt-4 mt-1">
                <AppFormLabel uppercase>{t('modelAdminPage.replaceFileTitle')}</AppFormLabel>
                <p className="text-[10px] text-on-surface-variant/60 mt-1 mb-2">
                  {t('modelAdminPage.replaceFileHint')}
                </p>
                <input
                  type="file"
                  accept=".step,.stp,.iges,.igs"
                  className="hidden"
                  id="detail-replace-file"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const ext = f.name.split('.').pop()?.toLowerCase() || '';
                    if (!['step', 'stp', 'iges', 'igs'].includes(ext)) {
                      toast(t('modelAdminPage.stepOnly'), 'error');
                      return;
                    }
                    setFileReplacing(true);
                    let ok = false;
                    try {
                      await modelApi.replaceFile(modelId, f);
                      toast(t('modelAdminPage.fileUploadedConverting'), 'success');
                      ok = true;
                    } catch {
                      toast(t('modelAdminPage.replaceFileFailed'), 'error');
                    } finally {
                      setFileReplacing(false);
                    }
                    if (ok) {
                      onSaved();
                      onClose();
                    }
                    e.target.value = '';
                  }}
                />
                <AdminButton
                  onClick={() => document.getElementById('detail-replace-file')?.click()}
                  disabled={fileReplacing}
                  icon="swap_horiz"
                  size="sm"
                  variant="secondary"
                  className="w-full justify-center"
                >
                  {fileReplacing ? t('modelAdminPage.uploading') : t('modelAdminPage.chooseNewFile')}
                </AdminButton>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 border-t border-outline-variant/10 shrink-0">
              {onDelete &&
                (confirmDelete ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-error">{t('modelAdminPage.confirmDeleteQ')}</span>
                    <AdminButton
                      onClick={async () => {
                        setDeleting(true);
                        let ok = false;
                        try {
                          await onDelete();
                          toast(t('modelAdminPage.deletedToast'), 'success');
                          ok = true;
                        } catch {
                          toast(t('modelAdminPage.deleteFailed'), 'error');
                        } finally {
                          setDeleting(false);
                          setConfirmDelete(false);
                        }
                        if (ok) onClose();
                      }}
                      disabled={deleting}
                      size="sm"
                      variant="danger"
                    >
                      {deleting ? t('modelAdminPage.deleting') : t('common.confirm')}
                    </AdminButton>
                    <AdminButton onClick={() => setConfirmDelete(false)} size="sm" variant="ghost">
                      {t('common.cancel')}
                    </AdminButton>
                  </div>
                ) : (
                  <AdminButton onClick={() => setConfirmDelete(true)} icon="delete" size="sm" variant="danger">
                    {t('modelAdminPage.deleteModelBtn')}
                  </AdminButton>
                ))}
              <div className="flex gap-3 ml-auto">
                <AdminButton onClick={onClose} variant="secondary">
                  {t('common.cancel')}
                </AdminButton>
                <AdminButton onClick={handleSave} disabled={saving} variant="primary">
                  {saving ? t('modelAdminPage.saving') : t('common.save')}
                </AdminButton>
              </div>
            </div>
          </motion.div>
        </DialogOverlay>
      )}
      {showGmshHelp && (
        <DialogOverlay onClose={() => setShowGmshHelp(false)} zIndex={10000}>
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            data-tooltip-ignore
            className="bg-surface-container-low rounded-t-lg sm:rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-lg max-h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom,0px))] sm:max-h-[85vh] flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-4 sm:px-6 border-b border-outline-variant/10 shrink-0">
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full ${
                    gmshAvailable === false ? 'bg-error/15 text-error' : 'bg-primary/10 text-primary'
                  }`}
                >
                  <Icon name={gmshAvailable === false ? 'priority_high' : 'info'} size={14} />
                </span>
                <h3 className="font-headline text-lg font-semibold text-on-surface">
                  {gmshAvailable === false
                    ? t('modelAdminPage.fixNotInstalled')
                    : t('modelAdminPage.aboutConvertEngine')}
                </h3>
              </div>
              <AdminIconButton
                icon="close"
                onClick={() => setShowGmshHelp(false)}
                variant="ghost"
                aria-label={t('common.close')}
              />
            </div>
            <div className="px-4 py-4 sm:px-6 space-y-4 overflow-y-auto scrollbar-hidden sm:custom-scrollbar">
              <div>
                <div className="text-[11px] font-medium text-on-surface">{t('modelAdminPage.stdConvert')}</div>
                <p className="mt-1 text-xs text-on-surface-variant leading-relaxed">
                  {t('modelAdminPage.stdConvertDesc')}
                </p>
              </div>
              <div>
                <div className="text-[11px] font-medium text-on-surface">{t('modelAdminPage.fixConvert')}</div>
                <p className="mt-1 text-xs text-on-surface-variant leading-relaxed">
                  {t('modelAdminPage.fixConvertDesc')}
                </p>
              </div>
              {gmshAvailable === false && (
                <>
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-on-surface">
                        {t('modelAdminPage.gmshStep1Title')}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyGmshCmd(GMSH_INSTALL_CMD, 'install')}
                        className="flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-primary hover:bg-primary/10"
                      >
                        <Icon name={gmshCmdCopied === 'install' ? 'check' : 'content_copy'} size={12} />
                        {gmshCmdCopied === 'install' ? t('modelAdminPage.copied') : t('modelAdminPage.copy')}
                      </button>
                    </div>
                    <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-sm bg-surface-container-highest px-3 py-2 font-mono text-xs text-on-surface">
                      {GMSH_INSTALL_CMD}
                    </pre>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-on-surface">
                        {t('modelAdminPage.gmshStep2Title')}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyGmshCmd(GMSH_MOUNT_STEP, 'mount')}
                        className="flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-primary hover:bg-primary/10"
                      >
                        <Icon name={gmshCmdCopied === 'mount' ? 'check' : 'content_copy'} size={12} />
                        {gmshCmdCopied === 'mount' ? t('modelAdminPage.copied') : t('modelAdminPage.copy')}
                      </button>
                    </div>
                    <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-sm bg-surface-container-highest px-3 py-2 font-mono text-xs text-on-surface">
                      {GMSH_MOUNT_STEP}
                    </pre>
                  </div>
                  <p className="text-[11px] text-on-surface-variant leading-relaxed">
                    {t('modelAdminPage.gmshAfterNote')}
                  </p>
                </>
              )}
            </div>
            <div className="flex justify-end gap-3 px-4 py-3 sm:px-6 border-t border-outline-variant/10 shrink-0">
              <AdminButton onClick={() => setShowGmshHelp(false)} variant="secondary">
                {t('modelAdminPage.gotIt')}
              </AdminButton>
            </div>
          </motion.div>
        </DialogOverlay>
      )}
    </AnimatePresence>
  );
}
