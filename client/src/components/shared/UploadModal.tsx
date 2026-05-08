import { motion, AnimatePresence } from 'framer-motion';
import { useState, useCallback, useMemo, useRef } from 'react';
import useSWR from 'swr';
import { mutate as swrMutate } from 'swr';
import { converterApi, modelApi, type ConversionResponse } from '../../api';
import { categoriesApi } from '../../api/categories';
import client from '../../api/client';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import { getBusinessConfig } from '../../lib/businessConfig';
import { bottomSheetMotion, dialogPanelMotion, overlayMotion } from '../../lib/motion';
import Icon from '../shared/Icon';
import CategorySelect from './CategorySelect';

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onConverted?: (result?: ConversionResponse) => void;
}

type UploadResult =
  | { type: 'single'; data: ConversionResponse }
  | { type: 'batch'; ok: number; fail: number; total: number; drawings?: number; drawingFail?: number }
  | {
      type: 'archive';
      ok: number;
      fail: number;
      total: number;
      archiveType: 'ZIP' | 'RAR';
      drawings?: number;
      drawingFail?: number;
    };

const CONCURRENCY = 3;

function uploadPairKey(fileName: string): string {
  const baseName = fileName.replace(/\.[^/.]+$/, '').trim();
  const indices = [baseName.indexOf('_'), baseName.indexOf('＿')].filter((index) => index >= 0).sort((a, b) => a - b);
  const separatorIndex = indices.find((index) => {
    const prefix = baseName.slice(0, index).trim();
    const suffix = baseName.slice(index + 1).trim();
    return prefix && suffix && /[\u3400-\u9fff\uf900-\ufaff]/.test(prefix);
  });
  return (separatorIndex === undefined ? baseName : baseName.slice(separatorIndex + 1)).trim().toLowerCase();
}

function unmatchedDrawingNames(
  files: File[],
  isArchiveFile: (file: File) => boolean,
  isDrawingFile: (file: File) => boolean,
) {
  const modelKeys = new Set(
    files.filter((file) => !isArchiveFile(file) && !isDrawingFile(file)).map((file) => uploadPairKey(file.name)),
  );
  return files
    .filter(isDrawingFile)
    .filter((file) => !modelKeys.has(uploadPairKey(file.name)))
    .map((file) => file.name);
}

function drawingMatchError(names: string[]) {
  if (names.length === 0) return null;
  const preview = names.slice(0, 3).join('、');
  const more = names.length > 3 ? ` 等 ${names.length} 个 PDF` : '';
  return `PDF 图纸未找到同名模型：${preview}${more}。请同时选择同名模型文件，或移除这些 PDF 后再上传`;
}

export default function UploadModal({ open, onClose, onConverted }: UploadModalProps) {
  const isMobile = useMediaQuery('(max-width: 639px)');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadPolicy } = getBusinessConfig();
  const modelFormats = uploadPolicy.modelFormats;
  const acceptedFormats = useMemo(
    () => [...modelFormats.map((f) => `.${f}`), '.pdf', '.zip', '.rar'].join(','),
    [modelFormats],
  );
  const chunkSize = Math.max(1, uploadPolicy.chunkSizeMb) * 1024 * 1024;
  const chunkThreshold = Math.max(1, uploadPolicy.chunkThresholdMb) * 1024 * 1024;
  const configuredArchiveMaxSizeMb = Number(uploadPolicy.batchArchiveMaxSizeMb);
  const archiveMaxSizeMb = Math.max(
    1,
    Math.floor(Number.isFinite(configuredArchiveMaxSizeMb) ? configuredArchiveMaxSizeMb : 500),
  );
  const archiveMaxBytes = archiveMaxSizeMb * 1024 * 1024;
  const formats = useMemo(() => modelFormats.map((f) => f.toLowerCase()), [modelFormats]);
  const formatLabel = useMemo(() => modelFormats.map((f) => f.toUpperCase()).join(' / '), [modelFormats]);
  const unsupportedFormatMessage = useMemo(
    () => `不支持的格式，请上传 ${modelFormats.map((f) => `.${f}`).join(' / ')}、同名 .pdf 或 .zip / .rar 文件`,
    [modelFormats],
  );

  const { data: categoryData } = useSWR(open ? '/categories' : null, () => categoriesApi.tree());

  const reset = useCallback(() => {
    setProgress(0);
    setProgressLabel('');
    setError(null);
    setResult(null);
    setUploading(false);
    setCategoryId('');
    setPendingFiles([]);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const uploadChunked = useCallback(
    async (file: File, onChunkProgress?: (ratio: number) => void) => {
      const totalChunks = Math.ceil(file.size / chunkSize);
      const reportChunkProgress = onChunkProgress || ((ratio: number) => setProgress(5 + Math.round(ratio * 60)));

      const { data: initResp } = await client.post('/upload/init', {
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
      });
      const { uploadId } = initResp?.data || initResp;

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);

        await client.put(`/upload/chunk?uploadId=${uploadId}&chunkIndex=${i}`, chunk, {
          headers: { 'Content-Type': 'application/octet-stream' },
        });

        reportChunkProgress((i + 1) / totalChunks);
      }

      const { data: completeResp } = await client.post('/upload/complete', { uploadId });
      return completeResp?.data || completeResp;
    },
    [chunkSize],
  );

  const handleSingleFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      setProgress(5);
      setProgressLabel(file.name);

      try {
        let res: ConversionResponse;

        if (file.size > chunkThreshold) {
          const uploadResult = await uploadChunked(file);
          setProgress(75);
          res = await converterApi.uploadLocal(
            uploadResult.filePath,
            uploadResult.fileName || file.name,
            categoryId || undefined,
          );
        } else {
          res = await converterApi.uploadAndConvert(file, {
            categoryId: categoryId || undefined,
            onUploadProgress: (e) => {
              if (e.total) {
                const pct = Math.round((e.loaded / e.total) * 80);
                setProgress(5 + pct);
              }
            },
          });
        }

        setProgress(100);
        const uploadRes: UploadResult = { type: 'single', data: res };
        setResult(uploadRes);
        onConverted?.(res);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '上传失败';
        setError(message);
      } finally {
        setUploading(false);
      }
    },
    [categoryId, chunkThreshold, onConverted, uploadChunked],
  );

  const isArchiveFile = useCallback((file: File) => /\.(zip|rar)$/i.test(file.name), []);
  const isDrawingFile = useCallback((file: File) => /\.pdf$/i.test(file.name), []);
  const getDrawingMatchError = useCallback(
    (files: File[]) => drawingMatchError(unmatchedDrawingNames(files, isArchiveFile, isDrawingFile)),
    [isArchiveFile, isDrawingFile],
  );
  const getArchiveSizeError = useCallback(
    (files: File[]) => {
      const oversized = files.find((file) => isArchiveFile(file) && file.size > archiveMaxBytes);
      return oversized ? `${oversized.name} 超过 ZIP/RAR 上限 ${archiveMaxSizeMb}MB` : null;
    },
    [archiveMaxBytes, archiveMaxSizeMb, isArchiveFile],
  );

  const uploadQueuedModelFile = useCallback(
    async (file: File) => {
      if (file.size > chunkThreshold) {
        const uploadResult = await uploadChunked(file, () => {});
        return converterApi.uploadLocal(
          uploadResult.filePath,
          uploadResult.fileName || file.name,
          categoryId || undefined,
        );
      }
      return modelApi.upload(file, { categoryId: categoryId || undefined });
    },
    [categoryId, chunkThreshold, uploadChunked],
  );

  const uploadMatchedDrawing = useCallback(async (modelId: string, drawing?: File) => {
    if (!drawing) return false;
    await modelApi.uploadDrawing(modelId, drawing);
    return true;
  }, []);

  const handleMultiFile = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setError(null);
      let ok = 0;
      let fail = 0;
      let total = 0;
      let drawings = 0;
      let drawingFail = 0;
      const modelFiles = files.filter((file) => !isArchiveFile(file) && !isDrawingFile(file));
      const archiveFiles = files.filter(isArchiveFile);
      const drawingFiles = files.filter(isDrawingFile);
      const modelKeys = new Set(modelFiles.map((file) => uploadPairKey(file.name)));
      const drawingByKey = new Map(drawingFiles.map((file) => [uploadPairKey(file.name), file]));
      drawingFail += drawingFiles.filter((file) => !modelKeys.has(uploadPairKey(file.name))).length;
      const inputTotal = Math.max(1, modelFiles.length + archiveFiles.length);
      let doneInputs = 0;

      const markInputDone = () => {
        doneInputs += 1;
        setProgress(Math.round((doneInputs / inputTotal) * 100));
        setProgressLabel(`上传中 ${doneInputs}/${inputTotal}`);
      };

      for (let i = 0; i < modelFiles.length; i += CONCURRENCY) {
        const batch = modelFiles.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (f) => {
            try {
              const uploadResult = await uploadQueuedModelFile(f);
              const drawing = drawingByKey.get(uploadPairKey(f.name));
              try {
                if (await uploadMatchedDrawing(uploadResult.model_id, drawing)) drawings += 1;
              } catch {
                drawingFail += 1;
              }
              return uploadResult;
            } finally {
              markInputDone();
            }
          }),
        );
        total += batch.length;
        for (const r of results) {
          if (r.status === 'fulfilled') ok++;
          else fail++;
        }
      }

      for (const archive of archiveFiles) {
        setProgressLabel(`正在处理 ${archive.name}...`);
        try {
          const resp = await modelApi.batchUploadFromArchive(archive, {
            categoryId: categoryId || undefined,
            onUploadProgress: (e) => {
              if (!e.total) return;
              const base = doneInputs / inputTotal;
              const span = 1 / inputTotal;
              setProgress(Math.round((base + span * 0.5 * (e.loaded / e.total)) * 100));
              if (e.loaded >= e.total) {
                setProgressLabel(`服务器处理中 ${archive.name}...`);
              }
            },
          });
          const archiveOk = resp.results.filter((r: any) => r.status === 'queued' || r.status === 'completed').length;
          drawings += resp.results.filter((r) => r.drawing_attached).length;
          drawingFail += resp.results.filter((r) => r.drawing_error).length;
          ok += archiveOk;
          fail += resp.results.length - archiveOk;
          total += resp.total;
        } catch {
          fail += 1;
          total += 1;
        } finally {
          markInputDone();
        }
      }

      setResult({ type: 'batch', ok, fail, total, drawings, drawingFail });
      swrMutate('/models/count');
      onConverted?.();
      setUploading(false);
    },
    [categoryId, isArchiveFile, isDrawingFile, onConverted, uploadMatchedDrawing, uploadQueuedModelFile],
  );

  const handleArchiveFile = useCallback(
    async (file: File) => {
      const archiveSizeError = getArchiveSizeError([file]);
      if (archiveSizeError) {
        setError(archiveSizeError);
        return;
      }

      setUploading(true);
      setError(null);
      setProgress(5);
      setProgressLabel(`正在上传 ${file.name}...`);

      try {
        const resp = await modelApi.batchUploadFromArchive(file, {
          categoryId: categoryId || undefined,
          onUploadProgress: (e) => {
            if (e.total) {
              const pct = Math.round((e.loaded / e.total) * 50);
              setProgress(5 + pct);
              if (e.loaded >= e.total) {
                setProgressLabel('服务器处理中...');
              }
            }
          },
        });
        setProgress(55);
        setProgressLabel('解压处理中...');
        const ok = resp.results.filter((r: any) => r.status === 'queued' || r.status === 'completed').length;
        const fail = resp.results.length - ok;
        const drawings = resp.results.filter((r) => r.drawing_attached).length;
        const drawingFail = resp.results.filter((r) => r.drawing_error).length;
        setProgress(100);
        setResult({
          type: 'archive',
          archiveType: file.name.toLowerCase().endsWith('.rar') ? 'RAR' : 'ZIP',
          ok,
          fail,
          total: resp.total,
          drawings,
          drawingFail,
        });
        swrMutate('/models/count');
        onConverted?.();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '压缩包上传失败';
        setError(message);
      } finally {
        setUploading(false);
      }
    },
    [categoryId, getArchiveSizeError, onConverted],
  );

  const hasUploadableModelInput = useCallback(
    (files: File[]) => files.some((file) => !isArchiveFile(file) && !isDrawingFile(file)) || files.some(isArchiveFile),
    [isArchiveFile, isDrawingFile],
  );

  const startUpload = useCallback(() => {
    if (pendingFiles.length === 0) return;
    const unmatchedPdfError = getDrawingMatchError(pendingFiles);
    if (unmatchedPdfError) {
      setError(unmatchedPdfError);
      return;
    }
    if (!hasUploadableModelInput(pendingFiles)) {
      setError('PDF 图纸需要和同名模型文件一起上传');
      return;
    }
    const archiveSizeError = getArchiveSizeError(pendingFiles);
    if (archiveSizeError) {
      setError(archiveSizeError);
      return;
    }
    if (pendingFiles.length === 1 && !isArchiveFile(pendingFiles[0])) {
      handleSingleFile(pendingFiles[0]);
    } else if (pendingFiles.length === 1 && isArchiveFile(pendingFiles[0])) {
      handleArchiveFile(pendingFiles[0]);
    } else {
      handleMultiFile(pendingFiles);
    }
  }, [
    pendingFiles,
    getArchiveSizeError,
    getDrawingMatchError,
    handleSingleFile,
    handleMultiFile,
    handleArchiveFile,
    hasUploadableModelInput,
    isArchiveFile,
  ]);

  const filterFiles = useCallback(
    (fileList: FileList | File[]): File[] => {
      return Array.from(fileList).filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        return formats.includes(ext) || ext === 'pdf' || ext === 'zip' || ext === 'rar';
      });
    },
    [formats],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (!e.dataTransfer.files?.length) return;
      const filtered = filterFiles(e.dataTransfer.files);
      if (filtered.length === 0) {
        setError(unsupportedFormatMessage);
        return;
      }
      const unmatchedPdfError = getDrawingMatchError(filtered);
      if (unmatchedPdfError) {
        setError(unmatchedPdfError);
        return;
      }
      if (!hasUploadableModelInput(filtered)) {
        setError('PDF 图纸需要和同名模型文件一起上传');
        return;
      }
      const archiveSizeError = getArchiveSizeError(filtered);
      if (archiveSizeError) {
        setError(archiveSizeError);
        return;
      }
      setError(null);

      if (filtered.length === 1 && !isArchiveFile(filtered[0]) && !isDrawingFile(filtered[0])) {
        handleSingleFile(filtered[0]);
      } else {
        setPendingFiles(filtered);
      }
    },
    [
      filterFiles,
      getArchiveSizeError,
      getDrawingMatchError,
      handleSingleFile,
      hasUploadableModelInput,
      isArchiveFile,
      isDrawingFile,
      unsupportedFormatMessage,
    ],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;
      const filtered = filterFiles(files);
      if (filtered.length === 0) {
        setError(unsupportedFormatMessage);
        return;
      }
      const unmatchedPdfError = getDrawingMatchError(filtered);
      if (unmatchedPdfError) {
        setError(unmatchedPdfError);
        e.target.value = '';
        return;
      }
      if (!hasUploadableModelInput(filtered)) {
        setError('PDF 图纸需要和同名模型文件一起上传');
        e.target.value = '';
        return;
      }
      const archiveSizeError = getArchiveSizeError(filtered);
      if (archiveSizeError) {
        setError(archiveSizeError);
        e.target.value = '';
        return;
      }
      setError(null);

      if (filtered.length === 1 && !isArchiveFile(filtered[0]) && !isDrawingFile(filtered[0])) {
        handleSingleFile(filtered[0]);
      } else {
        setPendingFiles(filtered);
      }
      e.target.value = '';
    },
    [
      filterFiles,
      getArchiveSizeError,
      getDrawingMatchError,
      handleSingleFile,
      hasUploadableModelInput,
      isArchiveFile,
      isDrawingFile,
      unsupportedFormatMessage,
    ],
  );

  const removePendingFile = useCallback((index: number) => {
    setError(null);
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          variants={overlayMotion}
          initial="initial"
          animate="animate"
          exit="exit"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
          onClick={handleClose}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            variants={isMobile ? bottomSheetMotion : dialogPanelMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            className="bg-surface-container-low rounded-t-2xl sm:rounded-lg w-full max-w-lg shadow-2xl border border-outline-variant/20 overflow-hidden max-h-[calc(100dvh-1rem)] sm:max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-outline-variant/10 shrink-0">
              <h2 className="font-headline text-lg font-bold text-on-surface">上传模型文件</h2>
              <button
                onClick={handleClose}
                className="p-1 text-on-surface-variant hover:text-on-surface transition-colors rounded-sm"
              >
                <Icon name="close" size={28} />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto">
              {result ? (
                <div className="flex flex-col items-center gap-4 py-4">
                  <div
                    className={`w-16 h-16 rounded-full flex items-center justify-center ${result.type === 'single' ? 'bg-green-500/10' : 'bg-primary-container/20'}`}
                  >
                    <Icon
                      name="check_circle"
                      size={36}
                      className={result.type === 'single' ? 'text-green-500' : 'text-primary'}
                    />
                  </div>
                  <div className="text-center min-w-0 max-w-full">
                    {result.type === 'single' ? (
                      <>
                        <p className="text-on-surface font-medium break-all">{result.data.original_name}</p>
                        <p className="text-sm text-on-surface-variant mt-1">
                          {result.data.status === 'completed'
                            ? `已生成 GLB 预览 (${(result.data.gltf_size / 1024).toFixed(1)} KB)`
                            : '文件已上传，正在转换中'}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-on-surface font-medium">
                          {result.type === 'archive' ? `${result.archiveType} 批量上传完成` : '批量上传完成'}
                        </p>
                        <p className="text-sm text-on-surface-variant mt-1">
                          共 {result.total} 个文件：{result.ok} 成功{result.fail > 0 ? `，${result.fail} 失败` : ''}
                        </p>
                        {(result.drawings || result.drawingFail) && (
                          <p className="text-sm text-on-surface-variant mt-1">
                            PDF 图纸：{result.drawings || 0} 已绑定
                            {result.drawingFail ? `，${result.drawingFail} 未绑定` : ''}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  <button
                    onClick={handleClose}
                    className="mt-2 bg-primary-container text-on-primary rounded-sm px-6 py-2 text-sm font-medium hover:opacity-90"
                  >
                    完成
                  </button>
                </div>
              ) : pendingFiles.length > 0 ? (
                <>
                  {!uploading && categoryData?.items && categoryData.items.length > 0 && (
                    <div className="mb-4">
                      <label className="text-xs uppercase tracking-wider text-on-surface-variant mb-1.5 block">
                        分类
                      </label>
                      <CategorySelect
                        categories={categoryData.items}
                        value={categoryId}
                        onChange={setCategoryId}
                        placeholder="选择分类（可选）"
                      />
                    </div>
                  )}
                  <div className="border border-outline-variant/20 rounded-lg divide-y divide-outline-variant/10 max-h-60 overflow-y-auto mb-4">
                    {pendingFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <Icon
                          name={isArchiveFile(f) ? 'folder_zip' : 'description'}
                          size={18}
                          className="text-on-surface-variant shrink-0"
                        />
                        <span className="truncate flex-1 text-on-surface">{f.name}</span>
                        <span className="text-xs text-on-surface-variant shrink-0">
                          {(f.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        {!uploading && (
                          <button
                            onClick={() => removePendingFile(i)}
                            className="text-on-surface-variant hover:text-error shrink-0"
                          >
                            <Icon name="close" size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-4 p-3 rounded-sm bg-error/10 border border-error/20 text-sm text-error flex items-start gap-2"
                    >
                      <Icon name="error" size={20} className="mt-0.5" />
                      <span className="min-w-0 break-words">{error}</span>
                    </motion.div>
                  )}
                  {uploading ? (
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-sm text-on-surface-variant">{progressLabel || `上传中... ${progress}%`}</p>
                      <div className="w-full max-w-xs h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-primary rounded-full"
                          initial={{ width: '5%' }}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPendingFiles([])}
                        className="flex-1 border border-outline-variant/30 text-on-surface-variant rounded-sm px-4 py-2 text-sm font-medium hover:bg-surface-container-high"
                      >
                        取消
                      </button>
                      <button
                        onClick={startUpload}
                        className="flex-1 bg-primary-container text-on-primary rounded-sm px-4 py-2 text-sm font-medium hover:opacity-90"
                      >
                        开始上传 ({pendingFiles.length} 个文件)
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {!uploading && categoryData?.items && categoryData.items.length > 0 && (
                    <div className="mb-4">
                      <label className="text-xs uppercase tracking-wider text-on-surface-variant mb-1.5 block">
                        分类
                      </label>
                      <CategorySelect
                        categories={categoryData.items}
                        value={categoryId}
                        onChange={setCategoryId}
                        placeholder="选择分类（可选）"
                      />
                    </div>
                  )}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    onClick={() => inputRef.current?.click()}
                    className={`border-2 border-dashed rounded-lg p-5 sm:p-8 text-center cursor-pointer transition-all ${
                      dragActive
                        ? 'border-primary bg-primary-container/5'
                        : 'border-outline-variant/30 hover:border-primary/50 hover:bg-surface-container/50'
                    } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
                  >
                    <input
                      ref={inputRef}
                      type="file"
                      multiple
                      accept={acceptedFormats}
                      onChange={handleChange}
                      className="hidden"
                    />
                    <Icon
                      name={uploading ? 'hourglass_top' : 'cloud_upload'}
                      size={48}
                      className="text-on-surface-variant/40 mb-3 block"
                    />
                    {uploading ? (
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-sm text-on-surface-variant">
                          {progressLabel || (progress < 80 ? `上传中... ${progress}%` : '正在转换中...')}
                        </p>
                        <div className="w-full max-w-xs h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-primary rounded-full"
                            initial={{ width: '5%' }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.3 }}
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-on-surface mb-1">拖放文件到此处，或点击选择</p>
                        <p className="text-xs text-on-surface-variant">
                          支持 {formatLabel} 模型和同名 PDF，可多选或上传 ZIP/RAR 压缩包（上限 {archiveMaxSizeMb}MB）
                        </p>
                      </>
                    )}
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-4 p-3 rounded-sm bg-error/10 border border-error/20 text-sm text-error flex items-start gap-2"
                    >
                      <Icon name="error" size={20} className="mt-0.5" />
                      <span className="min-w-0 break-words">{error}</span>
                    </motion.div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
