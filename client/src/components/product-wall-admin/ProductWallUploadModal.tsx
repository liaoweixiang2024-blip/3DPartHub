import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadProductWallImages } from '../../api/productWall';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import { getBusinessConfig } from '../../lib/businessConfig';
import { bottomSheetMotion, dialogPanelMotion } from '../../lib/motion';
import DialogOverlay from '../shared/DialogOverlay';
import Icon from '../shared/Icon';
import {
  errorMessage,
  formatFileSize,
  isImageFile,
  isSupportedUploadFile,
  PRODUCT_WALL_DEFAULT_KIND_KEY,
  PRODUCT_WALL_UPLOAD_BATCH_SIZE,
} from './productWallAdminUtils';

const UPLOAD_STATS_PAINT_INTERVAL_MS = 220;
const ACCEPTED_UPLOAD = 'image/*,.zip,.rar,application/zip,application/vnd.rar';

type UploadSummary = {
  uploaded: number;
  skipped: number;
  failedMessages: string[];
  kind: string;
  admin: boolean;
};

function formatSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = bytesPerSecond;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * 图库上传弹窗（交互对齐模型上传 UploadModal）：
 * 拖放/选择 → 待传列表（可增删）→ 分类/标题描述 → 开始上传 → 进度+速度 → 结果面板。
 * 拖拽/粘贴/文件夹带入的文件先进入列表确认，不会直接上传。
 */
export function ProductWallUploadModal({
  open,
  isAdmin,
  categories,
  defaultKind,
  initialFiles,
  onClose,
  onCompleted,
}: {
  open: boolean;
  isAdmin: boolean;
  categories: string[];
  defaultKind: string;
  /** 从拖拽/粘贴/文件夹入口带入的文件（每次打开只消费一次） */
  initialFiles: File[] | null;
  onClose: () => void;
  /** 上传完成（至少一张成功）后回调，页面据此刷新列表与计数 */
  onCompleted: () => void;
}) {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 639px)');
  const { uploadPolicy } = getBusinessConfig();
  const maxImageBytes = Math.max(1, uploadPolicy.productWallImageMaxSizeMb) * 1024 * 1024;
  const batchSize = Math.max(
    1,
    Math.min(50, Number(uploadPolicy.productWallUploadMaxFiles) || PRODUCT_WALL_UPLOAD_BATCH_SIZE),
  );

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [kind, setKind] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [statsLine, setStatsLine] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadSummary | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const addMoreInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const node = folderInputRef.current;
    if (!node) return;
    node.setAttribute('webkitdirectory', '');
    node.setAttribute('directory', '');
  }, [open]);
  const consumedInitialRef = useRef<File[] | null>(null);
  const speedRef = useRef({ loaded: 0, at: 0, speedBps: 0 });
  const statsPaintRef = useRef(0);

  const resolvedKind = categories.includes(kind)
    ? kind
    : categories.includes(defaultKind)
      ? defaultKind
      : categories[0] || '';

  // 打开时消费外部带入的文件（拖拽/粘贴/文件夹），并清掉上次的结果状态
  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setProgress(0);
    setProgressLabel('');
    setStatsLine('');
    setUploading(false);
    if (initialFiles && initialFiles.length && consumedInitialRef.current !== initialFiles) {
      consumedInitialRef.current = initialFiles;
      setPendingFiles((prev) => [...prev, ...initialFiles]);
    }
  }, [open, initialFiles]);

  // 打开且还没有分类选择时沿用记忆
  useEffect(() => {
    if (open && !kind) setKind(resolvedKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const appendFiles = useCallback(
    (fileList: FileList | File[]) => {
      const accepted = Array.from(fileList).filter(isSupportedUploadFile);
      if (!accepted.length) {
        setError(t('productWall.uploadModal.unsupported'));
        return;
      }
      setError(null);
      setPendingFiles((prev) => [...prev, ...accepted]);
    },
    [t],
  );

  const removePendingFile = useCallback((index: number) => {
    setError(null);
    setRenamingIndex(null);
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // 待传列表内重命名：保留原扩展名（服务端标题与类型识别都依赖文件名），内容不变
  const startRename = useCallback((index: number, name: string) => {
    setRenamingIndex(index);
    setRenameDraft(name.replace(/\.[^.]+$/, '') || name);
  }, []);
  const commitRename = useCallback(() => {
    if (renamingIndex == null) return;
    const index = renamingIndex;
    const base = renameDraft.trim().replace(/\.[^.]+$/, '');
    if (base) {
      setPendingFiles((prev) =>
        prev.map((file, i) => {
          if (i !== index) return file;
          const ext = (file.name.match(/\.[^.]+$/) || [''])[0];
          const nextName = ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? base + ext : base;
          return new File([file], nextName, { type: file.type, lastModified: file.lastModified });
        }),
      );
    }
    setRenamingIndex(null);
  }, [renamingIndex, renameDraft]);

  const reset = useCallback(() => {
    setPendingFiles([]);
    setTitle('');
    setDescription('');
    setUploading(false);
    setProgress(0);
    setProgressLabel('');
    setStatsLine('');
    setError(null);
    setResult(null);
    consumedInitialRef.current = null;
    setRenamingIndex(null);
    setRenameDraft('');
  }, []);

  const handleClose = useCallback(() => {
    if (uploading) return;
    reset();
    onClose();
  }, [uploading, reset, onClose]);

  const reportProgress = useCallback(
    (loadedBytes: number, totalBytes: number, label: string, ratioOverride?: number) => {
      const now = Date.now();
      const prev = speedRef.current;
      let speedBps = prev.speedBps;
      if (now - prev.at >= 180 && loadedBytes >= prev.loaded) {
        const instant = ((loadedBytes - prev.loaded) * 1000) / (now - prev.at);
        speedBps = prev.speedBps > 0 ? prev.speedBps * 0.65 + instant * 0.35 : instant;
        speedRef.current = { loaded: loadedBytes, at: now, speedBps };
      }
      const ratio = ratioOverride ?? (totalBytes > 0 ? loadedBytes / totalBytes : 0);
      setProgress(Math.max(2, Math.min(100, Math.round(ratio * 100))));
      setProgressLabel(label);
      if (now - statsPaintRef.current >= UPLOAD_STATS_PAINT_INTERVAL_MS && totalBytes > 0) {
        statsPaintRef.current = now;
        const speed = formatSpeed(speedBps);
        setStatsLine(`${formatFileSize(loadedBytes)} / ${formatFileSize(totalBytes)}${speed ? ` · ${speed}` : ''}`);
      }
    },
    [],
  );

  const startUpload = useCallback(async () => {
    if (!pendingFiles.length || uploading) return;
    if (!resolvedKind) {
      setError(t('productWall.uploadModal.kindRequired'));
      return;
    }
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (!isAdmin && (!trimmedTitle || !trimmedDescription)) {
      setError(t('productWall.uploadModal.metaRequired'));
      return;
    }
    // 记住本次分类，下次打开默认选中
    try {
      window.localStorage.setItem(PRODUCT_WALL_DEFAULT_KIND_KEY, resolvedKind);
    } catch {
      /* 存储不可用时静默跳过 */
    }

    const supported = pendingFiles.filter(isSupportedUploadFile);
    const oversized = supported.filter((file) => isImageFile(file) && file.size > maxImageBytes);
    const files = supported.filter((file) => !oversized.includes(file));
    if (!files.length) {
      setError(
        oversized.length
          ? t('productWall.uploadModal.allOversized', {
              count: oversized.length,
              size: uploadPolicy.productWallImageMaxSizeMb,
            })
          : t('productWall.uploadModal.unsupported'),
      );
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);
    speedRef.current = { loaded: 0, at: Date.now(), speedBps: 0 };
    statsPaintRef.current = 0;

    let uploaded = 0;
    const failedMessages: string[] = [];
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const totalBatches = Math.ceil(files.length / batchSize);
    let batchBaseBytes = 0;

    try {
      for (let index = 0; index < files.length; index += batchSize) {
        const batch = files.slice(index, index + batchSize);
        const batchIndex = Math.floor(index / batchSize);
        const batchBytes = batch.reduce((sum, file) => sum + file.size, 0);
        try {
          const firstTitle = batch[0]?.name.replace(/\.[^.]+$/, '') || undefined;
          await uploadProductWallImages(batch, {
            admin: isAdmin,
            kind: resolvedKind,
            title: isAdmin ? (files.length === 1 ? firstTitle : undefined) : trimmedTitle,
            description: isAdmin ? undefined : trimmedDescription,
            onUploadProgress: (event) => {
              const batchLoaded = Math.min(batchBytes, event.loaded || 0);
              reportProgress(
                batchBaseBytes + batchLoaded,
                totalBytes,
                t('productWall.uploadModal.uploadingBatch', {
                  current: batchIndex + 1,
                  total: totalBatches,
                }),
              );
            },
          });
          uploaded += batch.length;
        } catch (err) {
          failedMessages.push(errorMessage(err, t('productWall.toasts.uploadFailed')));
        }
        batchBaseBytes += batchBytes;
        reportProgress(
          batchBaseBytes,
          totalBytes,
          t('productWall.uploadModal.uploadingBatch', { current: batchIndex + 1, total: totalBatches }),
        );
      }
      reportProgress(totalBytes, totalBytes, t('productWall.uploadModal.finishing'), 100);
      if (uploaded > 0) onCompleted();
      setResult({ uploaded, skipped: oversized.length, failedMessages, kind: resolvedKind, admin: isAdmin });
      setPendingFiles([]);
    } finally {
      setUploading(false);
    }
  }, [
    batchSize,
    isAdmin,
    maxImageBytes,
    onCompleted,
    pendingFiles,
    reportProgress,
    resolvedKind,
    t,
    title,
    description,
    uploadPolicy.productWallImageMaxSizeMb,
    uploading,
  ]);

  const totalPendingBytes = useMemo(() => pendingFiles.reduce((sum, file) => sum + file.size, 0), [pendingFiles]);

  const errorBlock = error ? (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 flex items-start gap-2 rounded-sm border border-error/20 bg-error/10 p-3 text-sm text-error"
    >
      <Icon name="error" size={20} className="mt-0.5" />
      <span className="min-w-0 break-words">{error}</span>
    </motion.div>
  ) : null;

  const categorySelect = (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-xs uppercase tracking-wider text-on-surface-variant">
        {t('productWall.uploadModal.kindLabel')}
      </span>
      <select
        name="resolved-kind"
        value={resolvedKind}
        onChange={(event) => setKind(event.target.value)}
        disabled={uploading}
        className="h-10 w-full rounded-md border border-outline-variant/24 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
      >
        {categories.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );

  const metaFields = !isAdmin ? (
    <div className="mb-4 space-y-3">
      <label className="block">
        <span className="text-xs font-medium text-on-surface-variant">
          {t('productWall.uploadDialog.titleLabel')} <span className="text-red-500">*</span>
        </span>
        <input
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={uploading}
          className="mt-1 h-10 w-full border-b border-outline-variant/35 bg-transparent text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
          placeholder={t('productWall.uploadDialog.titlePlaceholder')}
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-on-surface-variant">
          {t('productWall.uploadDialog.descriptionLabel')} <span className="text-red-500">*</span>
        </span>
        <textarea
          name="description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          disabled={uploading}
          className="mt-1 w-full resize-none rounded-md border border-outline-variant/24 bg-surface-container-lowest px-3 py-2 text-sm leading-6 text-on-surface outline-none transition-colors focus:border-primary-container"
          placeholder={t('productWall.uploadDialog.descriptionPlaceholder')}
        />
      </label>
    </div>
  ) : null;

  return (
    <DialogOverlay onClose={handleClose} zIndex={10000} backdropClassName="bg-black/60 backdrop-blur-sm" bottomOnMobile>
      <motion.div
        variants={isMobile ? bottomSheetMotion : dialogPanelMotion}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-outline-variant/20 bg-surface-container-low shadow-2xl sm:max-h-[90vh] sm:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-outline-variant/10 px-4 py-4 sm:px-6">
          <h2 className="font-headline text-lg font-bold text-on-surface">{t('productWall.uploadModal.title')}</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={uploading}
            className="rounded-sm p-1 text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
            aria-label={t('common.close')}
            data-tooltip-ignore
          >
            <Icon name="close" size={28} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 [overflow-anchor:none] sm:p-6">
          {result ? (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-container/20">
                <Icon name="check_circle" size={36} className="text-primary" />
              </div>
              <div className="min-w-0 max-w-full text-center">
                <p className="font-medium text-on-surface">
                  {result.admin
                    ? t('productWall.uploadModal.resultAdmin', { count: result.uploaded, kind: result.kind })
                    : t('productWall.uploadModal.resultSubmitted', { count: result.uploaded })}
                </p>
                {result.skipped > 0 && (
                  <p className="mt-1 text-sm text-on-surface-variant">
                    {t('productWall.uploadModal.resultSkipped', {
                      count: result.skipped,
                      size: uploadPolicy.productWallImageMaxSizeMb,
                    })}
                  </p>
                )}
                {result.failedMessages.length > 0 && (
                  <p className="mt-1 text-sm text-error">
                    {t('productWall.uploadModal.resultFailed', {
                      message: Array.from(new Set(result.failedMessages)).slice(0, 2).join('；'),
                    })}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="mt-2 rounded-sm bg-primary-container px-6 py-2 text-sm font-medium text-on-primary hover:opacity-90"
              >
                {t('productWall.uploadModal.done')}
              </button>
            </div>
          ) : pendingFiles.length > 0 ? (
            <>
              {categorySelect}
              {metaFields}
              <div className="mb-4 max-h-60 divide-y divide-outline-variant/10 overflow-y-auto rounded-lg border border-outline-variant/20">
                {pendingFiles.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <Icon
                      name={/\.(zip|rar)$/i.test(file.name) ? 'folder_zip' : 'image'}
                      size={18}
                      className="shrink-0 text-on-surface-variant"
                    />
                    {renamingIndex === index ? (
                      <input
                        name="rename-draft"
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onBlur={() => commitRename()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRename();
                          if (event.key === 'Escape') setRenamingIndex(null);
                        }}
                        autoFocus
                        className="h-7 min-w-0 flex-1 rounded border border-primary-container/50 bg-surface-container-lowest px-2 text-sm text-on-surface outline-none"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-on-surface" title={file.name}>
                        {file.name}
                      </span>
                    )}
                    {isImageFile(file) && file.size > maxImageBytes && (
                      <span className="shrink-0 text-xs text-error">{t('productWall.uploadModal.oversized')}</span>
                    )}
                    <span className="shrink-0 text-xs text-on-surface-variant">{formatFileSize(file.size)}</span>
                    {!uploading && renamingIndex !== index && (
                      <button
                        type="button"
                        onClick={() => startRename(index, file.name)}
                        className="shrink-0 text-on-surface-variant transition-colors hover:text-primary-container"
                        aria-label={t('productWall.uploadModal.rename')}
                        title={t('productWall.uploadModal.rename')}
                        data-tooltip-ignore
                      >
                        <Icon name="edit" size={15} />
                      </button>
                    )}
                    {!uploading && (
                      <button
                        type="button"
                        onClick={() => removePendingFile(index)}
                        className="shrink-0 text-on-surface-variant transition-colors hover:text-error"
                        aria-label={t('common.delete')}
                        data-tooltip-ignore
                      >
                        <Icon name="close" size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {!uploading && (
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                    appendFiles(event.dataTransfer.files);
                  }}
                  onClick={() => addMoreInputRef.current?.click()}
                  className={`mb-4 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed py-3 text-sm transition-colors ${
                    dragActive
                      ? 'border-primary bg-primary-container/5 text-primary'
                      : 'border-outline-variant/30 text-on-surface-variant hover:border-primary/50 hover:bg-surface-container/50'
                  }`}
                >
                  <input
                    name="file"
                    ref={addMoreInputRef}
                    type="file"
                    multiple
                    accept={ACCEPTED_UPLOAD}
                    onChange={(event) => {
                      if (event.target.files?.length) appendFiles(event.target.files);
                      event.target.value = '';
                    }}
                    className="hidden"
                  />
                  <Icon name="add" size={18} />
                  <span>{t('productWall.uploadModal.addMore')}</span>
                </div>
              )}
              {!uploading && (
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="mb-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-outline-variant/24 px-3 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                >
                  <Icon name="folder" size={16} />
                  {t('productWall.uploadModal.selectFolder')}
                </button>
              )}
              {errorBlock}
              {uploading ? (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-sm text-on-surface-variant">{progressLabel || `上传中... ${progress}%`}</p>
                  {statsLine && <p className="text-xs tabular-nums text-on-surface-variant/80">{statsLine}</p>}
                  <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-container-high">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      initial={{ width: '5%' }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={reset}
                    className="flex-1 rounded-sm border border-outline-variant/30 px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container-high"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void startUpload()}
                    className="flex-1 rounded-sm bg-primary-container px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90"
                  >
                    {t('productWall.uploadModal.start', { count: pendingFiles.length })}（
                    {formatFileSize(totalPendingBytes)}）
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {categorySelect}
              {metaFields}
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  appendFiles(event.dataTransfer.files);
                }}
                onClick={() => inputRef.current?.click()}
                className={`cursor-pointer rounded-lg border-2 border-dashed p-5 text-center transition-colors sm:p-8 ${
                  dragActive
                    ? 'border-primary bg-primary-container/5'
                    : 'border-outline-variant/30 hover:border-primary/50 hover:bg-surface-container/50'
                } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
              >
                <input
                  name="file"
                  ref={inputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_UPLOAD}
                  onChange={(event) => {
                    if (event.target.files?.length) appendFiles(event.target.files);
                    event.target.value = '';
                  }}
                  className="hidden"
                />
                <Icon
                  name={uploading ? 'hourglass_top' : 'cloud_upload'}
                  size={48}
                  className={`mb-3 block text-on-surface-variant/40 ${uploading ? 'animate-spin' : ''}`}
                />
                <p className="mb-1 text-sm text-on-surface">{t('productWall.uploadModal.dropzoneTitle')}</p>
                <p className="text-xs text-on-surface-variant">
                  {t('productWall.uploadModal.dropzoneHint', {
                    size: uploadPolicy.productWallImageMaxSizeMb,
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-outline-variant/24 px-3 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <Icon name="folder" size={16} />
                {t('productWall.uploadModal.selectFolder')}
              </button>
              <input
                name="file"
                ref={folderInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files?.length) appendFiles(event.target.files);
                  event.target.value = '';
                }}
              />
              {errorBlock}
            </>
          )}
        </div>
      </motion.div>
    </DialogOverlay>
  );
}
