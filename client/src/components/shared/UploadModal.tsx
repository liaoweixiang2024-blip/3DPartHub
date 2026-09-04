import { motion, AnimatePresence } from 'framer-motion';
import JSZip from 'jszip';
import { useState, useCallback, useEffect, useId, useMemo, useRef } from 'react';
import useSWR from 'swr';
import { mutate as swrMutate } from 'swr';
import { converterApi, modelApi, type ConversionResponse } from '../../api';
import { categoriesApi, type CategoryItem } from '../../api/categories';
import client from '../../api/client';
import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import { getBusinessConfig } from '../../lib/businessConfig';
import { bottomSheetMotion, dialogPanelMotion } from '../../lib/motion';
import {
  collectFilesWithPathFromDataTransfer,
  type DataTransferItemWithEntry,
  type FileWithPath,
  type WebkitFileSystemEntry,
} from '../product-wall-admin/productWallAdminUtils';
import Icon from '../shared/Icon';
import CategorySelect from './CategorySelect';
import DialogOverlay from './DialogOverlay';

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onConverted?: (result?: ConversionResponse) => void;
}

type UploadResult =
  | { type: 'single'; data: ConversionResponse }
  | {
      type: 'batch';
      ok: number;
      fail: number;
      total: number;
      drawings?: number;
      drawingFail?: number;
      skipped?: number;
    }
  | {
      type: 'archive';
      ok: number;
      fail: number;
      total: number;
      archiveType: 'ZIP' | 'RAR';
      drawings?: number;
      drawingFail?: number;
      skipped?: number;
    };

const CONCURRENCY = 3;
const UPLOAD_PROGRESS_PAINT_INTERVAL_MS = 180;
const UPLOAD_STATS_PAINT_INTERVAL_MS = 220;
// 上传分类记忆：只在本机记分类 id，刷新/重开弹窗沿用上次选择；分类被删后由弹窗内校验回退为空
const LAST_CATEGORY_KEY = 'upload.category.lastId';
let activeUploadOwner: string | null = null;
let uploadRunCounter = 0;

function loadLastCategoryId(): string {
  try {
    const value = localStorage.getItem(LAST_CATEGORY_KEY);
    return value && /^[0-9a-f-]{8,80}$/i.test(value) ? value : '';
  } catch {
    return '';
  }
}

function saveLastCategoryId(id: string) {
  try {
    if (id) localStorage.setItem(LAST_CATEGORY_KEY, id);
    else localStorage.removeItem(LAST_CATEGORY_KEY);
  } catch {
    /* 隐私模式等存储不可用时静默跳过 */
  }
}

type UploadStats = {
  loaded: number;
  total: number;
  speedBps: number;
};

function formatUploadBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatUploadSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '计算中';
  return `${formatUploadBytes(bytesPerSecond)}/s`;
}

function progressLoadedFromEvent(loaded: number, total: number | undefined, fileSize: number) {
  if (total && total > 0) return Math.min(fileSize, Math.round((loaded / total) * fileSize));
  return Math.min(fileSize, loaded);
}

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
  const [uploadStats, setUploadStats] = useState<UploadStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [categoryId, setCategoryId] = useState(() => loadLastCategoryId());
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // 拖入的文件夹分组：每组一次拖入展开后的文件集合，上传时各自打成独立 ZIP
  // （服务端按 ZIP 内路径解析文件夹名做标题，多组合一个包会混淆层级结构）
  const [pendingFolderGroups, setPendingFolderGroups] = useState<FileWithPath[][]>([]);
  const [expandingFolders, setExpandingFolders] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addMoreInputRef = useRef<HTMLInputElement>(null);
  const ownerId = useId();
  const uploadInFlightRef = useRef(false);
  const activeRunRef = useRef(0);
  const resultCloseLockedRef = useRef(false);
  const uploadSpeedRef = useRef({ loaded: 0, at: 0, speedBps: 0, total: 0 });
  const uploadStatsPaintRef = useRef(0);
  const progressPaintRef = useRef(0);
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
  const modelMaxSizeMb = Math.max(1, Math.floor(Number(uploadPolicy.modelMaxSizeMb) || 500));
  const modelMaxBytes = modelMaxSizeMb * 1024 * 1024;
  const drawingMaxSizeMb = Math.max(1, Math.floor(Number(uploadPolicy.modelDrawingMaxSizeMb) || 500));
  const drawingMaxBytes = drawingMaxSizeMb * 1024 * 1024;
  const formats = useMemo(() => modelFormats.map((f) => f.toLowerCase()), [modelFormats]);
  const formatLabel = useMemo(() => modelFormats.map((f) => f.toUpperCase()).join(' / '), [modelFormats]);
  const unsupportedFormatMessage = useMemo(
    () => `不支持的格式，请上传 ${modelFormats.map((f) => `.${f}`).join(' / ')}、同名 .pdf 或 .zip / .rar 文件`,
    [modelFormats],
  );

  const { data: categoryData } = useSWR(open ? '/categories' : null, () => categoriesApi.tree());

  const paintProgress = useCallback((value: number, force = false) => {
    const nextProgress = Math.max(0, Math.min(100, Math.round(value)));
    const now = Date.now();
    if (force || nextProgress >= 100 || now - progressPaintRef.current >= UPLOAD_PROGRESS_PAINT_INTERVAL_MS) {
      progressPaintRef.current = now;
      setProgress(nextProgress);
    }
  }, []);

  const beginUploadStats = useCallback((total: number) => {
    const safeTotal = Math.max(0, total);
    uploadSpeedRef.current = { loaded: 0, at: Date.now(), speedBps: 0, total: safeTotal };
    uploadStatsPaintRef.current = Date.now();
    setUploadStats(safeTotal > 0 ? { loaded: 0, total: safeTotal, speedBps: 0 } : null);
  }, []);

  const reportUploadStats = useCallback((loaded: number, total?: number) => {
    const prev = uploadSpeedRef.current;
    const safeTotal = Math.max(prev.total, total || 0, loaded);
    const safeLoaded = Math.max(0, Math.min(loaded, safeTotal || loaded));
    const now = Date.now();
    const elapsed = now - prev.at;
    let speedBps = prev.speedBps;

    if (elapsed >= 180 && safeLoaded >= prev.loaded) {
      const instantSpeed = ((safeLoaded - prev.loaded) * 1000) / elapsed;
      speedBps = prev.speedBps > 0 ? prev.speedBps * 0.65 + instantSpeed * 0.35 : instantSpeed;
      uploadSpeedRef.current = { loaded: safeLoaded, at: now, speedBps, total: safeTotal };
    } else {
      uploadSpeedRef.current = { ...prev, total: safeTotal };
    }

    const isComplete = safeTotal > 0 && safeLoaded >= safeTotal;
    if (safeTotal > 0 && (isComplete || now - uploadStatsPaintRef.current >= UPLOAD_STATS_PAINT_INTERVAL_MS)) {
      uploadStatsPaintRef.current = now;
      setUploadStats({ loaded: safeLoaded, total: safeTotal, speedBps });
    }
  }, []);

  const finishUploadStats = useCallback(() => {
    const { total, speedBps } = uploadSpeedRef.current;
    uploadStatsPaintRef.current = Date.now();
    if (total > 0) setUploadStats({ loaded: total, total, speedBps });
  }, []);

  const uploadStatsLine = useMemo(() => {
    if (!uploadStats || uploadStats.total <= 0) return null;
    return `已上传 ${formatUploadBytes(uploadStats.loaded)} / ${formatUploadBytes(uploadStats.total)} · 速度 ${formatUploadSpeed(uploadStats.speedBps)}`;
  }, [uploadStats]);

  useEffect(() => {
    return () => {
      if (activeUploadOwner === ownerId) {
        activeUploadOwner = null;
      }
    };
  }, [ownerId]);

  const reset = useCallback(() => {
    if (activeUploadOwner === ownerId) {
      activeUploadOwner = null;
    }
    activeRunRef.current = 0;
    uploadInFlightRef.current = false;
    resultCloseLockedRef.current = false;
    setProgress(0);
    setProgressLabel('');
    setUploadStats(null);
    uploadSpeedRef.current = { loaded: 0, at: 0, speedBps: 0, total: 0 };
    uploadStatsPaintRef.current = 0;
    progressPaintRef.current = 0;
    setError(null);
    setResult(null);
    setUploading(false);
    setPendingFiles([]);
    setPendingFolderGroups([]);
  }, [ownerId]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // 分类记忆：切换即保存；分类树加载后校验上次记的 id 是否还存在（分类可能已被删），不存在回退为空
  const changeCategory = useCallback((id: string) => {
    setCategoryId(id);
    saveLastCategoryId(id);
  }, []);

  useEffect(() => {
    if (!categoryId || !categoryData?.items) return;
    const exists = (nodes: CategoryItem[]): boolean =>
      nodes.some((node) => node.id === categoryId || (node.children?.length ? exists(node.children) : false));
    if (!exists(categoryData.items)) {
      setCategoryId('');
      saveLastCategoryId('');
    }
  }, [categoryData, categoryId]);

  const beginUploadRun = useCallback(() => {
    if (uploadInFlightRef.current || (activeUploadOwner && activeUploadOwner !== ownerId)) return 0;
    activeUploadOwner = ownerId;
    const runId = ++uploadRunCounter;
    activeRunRef.current = runId;
    resultCloseLockedRef.current = false;
    uploadInFlightRef.current = true;
    setUploading(true);
    return runId;
  }, [ownerId]);

  const isCurrentUploadRun = useCallback(
    (runId: number) => {
      return activeRunRef.current === runId && activeUploadOwner === ownerId;
    },
    [ownerId],
  );

  const finishUploadRun = useCallback(
    (runId: number) => {
      if (!isCurrentUploadRun(runId)) return;
      if (activeUploadOwner === ownerId) {
        activeUploadOwner = null;
      }
      uploadInFlightRef.current = false;
      setUploading(false);
    },
    [isCurrentUploadRun, ownerId],
  );

  const handleResultClose = useCallback(() => {
    if (resultCloseLockedRef.current) return;
    resultCloseLockedRef.current = true;
    handleClose();
  }, [handleClose]);

  const uploadChunked = useCallback(
    async (
      file: File,
      options?: {
        onChunkProgress?: (ratio: number) => void;
        onUploadProgress?: (loaded: number, total: number) => void;
      },
    ) => {
      const totalChunks = Math.ceil(file.size / chunkSize);
      const reportChunkProgress =
        options?.onChunkProgress || ((ratio: number) => paintProgress(5 + Math.round(ratio * 60)));
      let uploadedBytes = 0;

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
          onUploadProgress: (e) => {
            const currentChunkLoaded = progressLoadedFromEvent(e.loaded, e.total, chunk.size);
            options?.onUploadProgress?.(uploadedBytes + currentChunkLoaded, file.size);
          },
        });

        uploadedBytes = end;
        options?.onUploadProgress?.(uploadedBytes, file.size);
        reportChunkProgress((i + 1) / totalChunks);
      }

      const { data: completeResp } = await client.post('/upload/complete', { uploadId });
      return completeResp?.data || completeResp;
    },
    [chunkSize, paintProgress],
  );

  const handleSingleFile = useCallback(
    async (file: File) => {
      const runId = beginUploadRun();
      if (!runId) return;
      setError(null);
      setProgress(5);
      setProgressLabel(file.name);
      beginUploadStats(file.size);

      try {
        let res: ConversionResponse;

        if (file.size > chunkThreshold) {
          const uploadResult = await uploadChunked(file, {
            onUploadProgress: reportUploadStats,
          });
          setProgress(75);
          finishUploadStats();
          setProgressLabel('上传完成，正在转换中...');
          res = await converterApi.uploadLocal(
            uploadResult.filePath,
            uploadResult.fileName || file.name,
            categoryId || undefined,
          );
        } else {
          res = await converterApi.uploadAndConvert(file, {
            categoryId: categoryId || undefined,
            onUploadProgress: (e) => {
              const loaded = progressLoadedFromEvent(e.loaded, e.total, file.size);
              reportUploadStats(loaded, file.size);
              const pct = Math.round((loaded / Math.max(1, file.size)) * 80);
              paintProgress(5 + pct);
              if (loaded >= file.size) setProgressLabel('上传完成，正在转换中...');
            },
          });
        }

        if (!isCurrentUploadRun(runId)) return;
        paintProgress(100, true);
        finishUploadStats();
        setPendingFiles([]);
        setPendingFolderGroups([]);
        const uploadRes: UploadResult = { type: 'single', data: res };
        setResult(uploadRes);
        onConverted?.(res);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '上传失败';
        if (isCurrentUploadRun(runId)) setError(message);
      } finally {
        finishUploadRun(runId);
      }
    },
    [
      beginUploadStats,
      beginUploadRun,
      categoryId,
      chunkThreshold,
      finishUploadStats,
      finishUploadRun,
      isCurrentUploadRun,
      onConverted,
      paintProgress,
      reportUploadStats,
      uploadChunked,
    ],
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
  const getFileSizeError = useCallback(
    (files: File[]) => {
      const oversizedModel = files.find(
        (file) => !isArchiveFile(file) && !isDrawingFile(file) && file.size > modelMaxBytes,
      );
      if (oversizedModel) return `${oversizedModel.name} 超过模型上限 ${modelMaxSizeMb}MB`;

      const oversizedDrawing = files.find((file) => isDrawingFile(file) && file.size > drawingMaxBytes);
      if (oversizedDrawing) return `${oversizedDrawing.name} 超过 PDF 图纸上限 ${drawingMaxSizeMb}MB`;

      return null;
    },
    [drawingMaxBytes, drawingMaxSizeMb, isArchiveFile, isDrawingFile, modelMaxBytes, modelMaxSizeMb],
  );

  const uploadQueuedModelFile = useCallback(
    async (file: File, onUploadProgress?: (loaded: number, total: number) => void) => {
      if (file.size > chunkThreshold) {
        const uploadResult = await uploadChunked(file, {
          onChunkProgress: () => {},
          onUploadProgress,
        });
        return converterApi.uploadLocal(
          uploadResult.filePath,
          uploadResult.fileName || file.name,
          categoryId || undefined,
        );
      }
      return modelApi.upload(file, {
        categoryId: categoryId || undefined,
        onUploadProgress: (e) => {
          onUploadProgress?.(progressLoadedFromEvent(e.loaded, e.total, file.size), file.size);
        },
      });
    },
    [categoryId, chunkThreshold, uploadChunked],
  );

  const uploadMatchedDrawing = useCallback(
    async (modelId: string, drawing?: File, onUploadProgress?: (loaded: number, total: number) => void) => {
      if (!drawing) return false;
      await modelApi.uploadDrawing(modelId, drawing, {
        onUploadProgress: (e) => {
          onUploadProgress?.(progressLoadedFromEvent(e.loaded, e.total, drawing.size), drawing.size);
        },
      });
      return true;
    },
    [],
  );

  const handleMultiFile = useCallback(
    async (files: File[]) => {
      const runId = beginUploadRun();
      if (!runId) return;
      setError(null);
      let ok = 0;
      let fail = 0;
      let total = 0;
      let drawings = 0;
      let drawingFail = 0;
      let skipped = 0;
      const modelFiles = files.filter((file) => !isArchiveFile(file) && !isDrawingFile(file));
      const archiveFiles = files.filter(isArchiveFile);
      const drawingFiles = files.filter(isDrawingFile);
      const modelKeys = new Set(modelFiles.map((file) => uploadPairKey(file.name)));
      // 同名多 PDF：一对多映射，逐份上传追加（服务端已支持多图纸）
      const drawingByKey = new Map<string, File[]>();
      for (const file of drawingFiles) {
        const key = uploadPairKey(file.name);
        const list = drawingByKey.get(key) || [];
        list.push(file);
        drawingByKey.set(key, list);
      }
      drawingFail += drawingFiles.filter((file) => !modelKeys.has(uploadPairKey(file.name))).length;
      const inputTotal = Math.max(1, modelFiles.length + archiveFiles.length);
      const totalUploadBytes = Math.max(
        1,
        files.reduce((sum, file) => sum + file.size, 0),
      );
      const fileIndexes = new Map(files.map((file, index) => [file, index]));
      const uploadedBytesByFile = new Map<string, number>();
      let doneInputs = 0;

      beginUploadStats(totalUploadBytes);

      const fileProgressKey = (file: File) => `${fileIndexes.get(file) ?? 0}:${file.name}:${file.size}`;
      const reportFileUpload = (file: File, loaded: number) => {
        uploadedBytesByFile.set(fileProgressKey(file), Math.min(file.size, Math.max(0, loaded)));
        const loadedBytes = Array.from(uploadedBytesByFile.values()).reduce((sum, item) => sum + item, 0);
        reportUploadStats(loadedBytes, totalUploadBytes);
      };
      const completeFileUpload = (file: File | undefined) => {
        if (file) reportFileUpload(file, file.size);
      };

      const markInputDone = () => {
        doneInputs += 1;
        paintProgress(Math.round((doneInputs / inputTotal) * 100), true);
        setProgressLabel(`上传中 ${doneInputs}/${inputTotal}`);
      };

      for (let i = 0; i < modelFiles.length; i += CONCURRENCY) {
        const batch = modelFiles.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (f) => {
            try {
              const uploadResult = await uploadQueuedModelFile(f, (loaded) => reportFileUpload(f, loaded));
              completeFileUpload(f);
              const matchedDrawings = drawingByKey.get(uploadPairKey(f.name)) || [];
              for (const drawing of matchedDrawings) {
                try {
                  if (
                    await uploadMatchedDrawing(uploadResult.model_id, drawing, (loaded) =>
                      reportFileUpload(drawing, loaded),
                    )
                  ) {
                    drawings += 1;
                    completeFileUpload(drawing);
                  }
                } catch {
                  drawingFail += 1;
                }
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
              const loaded = progressLoadedFromEvent(e.loaded, e.total, archive.size);
              reportFileUpload(archive, loaded);
              const base = doneInputs / inputTotal;
              const span = 1 / inputTotal;
              const uploadRatio = loaded / Math.max(1, archive.size);
              paintProgress(Math.round((base + span * 0.5 * uploadRatio) * 100));
              if (loaded >= archive.size) {
                setProgressLabel(`服务器处理中 ${archive.name}...`);
              }
            },
            onProcessingProgress: (serverProgress) => {
              if (!isCurrentUploadRun(runId)) return;
              const base = doneInputs / inputTotal;
              const span = 1 / inputTotal;
              const processingRatio = Math.max(0, Math.min(100, serverProgress.percent)) / 100;
              paintProgress(Math.round((base + span * (0.5 + 0.48 * processingRatio)) * 100));
              setProgressLabel(serverProgress.message || `服务器处理中 ${archive.name}...`);
            },
          });
          const archiveOk = resp.results.filter((r) => r.status === 'queued' || r.status === 'completed').length;
          const archiveSkipped = resp.results.filter((r) => r.status === 'skipped').length;
          drawings += resp.results.filter((r) => r.drawing_attached).length;
          drawingFail += resp.results.filter((r) => r.drawing_error).length;
          ok += archiveOk;
          skipped += archiveSkipped;
          fail += resp.results.length - archiveOk - archiveSkipped;
          total += resp.total;
        } catch {
          fail += 1;
          total += 1;
        } finally {
          completeFileUpload(archive);
          markInputDone();
        }
      }

      if (!isCurrentUploadRun(runId)) return;
      paintProgress(100, true);
      finishUploadStats();
      setPendingFiles([]);
      setPendingFolderGroups([]);
      setResult({ type: 'batch', ok, fail, total, drawings, drawingFail, skipped });
      swrMutate('/models/count');
      onConverted?.();
      finishUploadRun(runId);
    },
    [
      beginUploadStats,
      beginUploadRun,
      categoryId,
      finishUploadStats,
      finishUploadRun,
      isCurrentUploadRun,
      isArchiveFile,
      isDrawingFile,
      onConverted,
      paintProgress,
      reportUploadStats,
      uploadMatchedDrawing,
      uploadQueuedModelFile,
    ],
  );

  const handleArchiveFile = useCallback(
    async (
      file: File,
      options?: {
        keepQueue?: boolean;
        keepUploading?: boolean;
        /** 跨组累计统计（多文件夹队列）：每组完成时回调本组结果，供调用方汇总后统一展示 */
        onAccumulate?: (stats: {
          ok: number;
          fail: number;
          total: number;
          drawings: number;
          drawingFail: number;
          skipped: number;
        }) => void;
      },
    ) => {
      const archiveSizeError = getArchiveSizeError([file]);
      if (archiveSizeError) {
        setError(archiveSizeError);
        return false;
      }

      const runId = beginUploadRun();
      if (!runId) return false;
      setError(null);
      // 多文件夹队列场景：清掉上一组的结果面板，切换回进度视图
      setResult(null);
      setProgress(5);
      setProgressLabel(`正在上传 ${file.name}...`);
      beginUploadStats(file.size);
      let processingProgress = 55;
      let processingTimer: ReturnType<typeof setInterval> | null = null;
      const startProcessingFeedback = () => {
        if (processingTimer) return;
        setProgressLabel('服务器处理中...');
        processingTimer = setInterval(() => {
          if (!isCurrentUploadRun(runId)) return;
          processingProgress = Math.min(92, processingProgress + (processingProgress < 75 ? 1.4 : 0.5));
          paintProgress(processingProgress);
          if (processingProgress > 84) {
            setProgressLabel('正在绑定分类和图纸...');
          } else if (processingProgress > 68) {
            setProgressLabel('正在解压并识别模型...');
          }
        }, 900);
      };

      try {
        const resp = await modelApi.batchUploadFromArchive(file, {
          categoryId: categoryId || undefined,
          onUploadProgress: (e) => {
            const loaded = progressLoadedFromEvent(e.loaded, e.total, file.size);
            reportUploadStats(loaded, file.size);
            if (file.size > 0) {
              const pct = Math.round((loaded / file.size) * 50);
              paintProgress(5 + pct);
              if (loaded >= file.size) {
                startProcessingFeedback();
              }
            }
          },
          onProcessingProgress: (serverProgress) => {
            if (!isCurrentUploadRun(runId)) return;
            if (processingTimer) {
              clearInterval(processingTimer);
              processingTimer = null;
            }
            const mappedProgress = 55 + (Math.max(0, Math.min(100, serverProgress.percent)) / 100) * 42;
            paintProgress(mappedProgress, serverProgress.stage === 'done' || serverProgress.stage === 'error');
            setProgressLabel(serverProgress.message || '服务器处理中...');
          },
        });
        if (processingTimer) {
          clearInterval(processingTimer);
          processingTimer = null;
        }
        finishUploadStats();
        paintProgress(Math.max(processingProgress, 94), true);
        setProgressLabel('正在整理结果...');
        const ok = resp.results.filter((r) => r.status === 'queued' || r.status === 'completed').length;
        // 子文件夹变体（零件目录已有直接模型文件）被服务端跳过，不计入失败
        const skipped = resp.results.filter((r) => r.status === 'skipped').length;
        const fail = resp.results.length - ok - skipped;
        const drawings = resp.results.filter((r) => r.drawing_attached).length;
        const drawingFail = resp.results.filter((r) => r.drawing_error).length;
        if (!isCurrentUploadRun(runId)) return false;
        paintProgress(100, true);
        if (!options?.keepQueue) {
          setPendingFiles([]);
          setPendingFolderGroups([]);
        }
        // 跨组累计：无论是否最后一组都先把本组统计交给调用方
        options?.onAccumulate?.({ ok, fail, total: resp.total, drawings, drawingFail, skipped });
        // keepUploading（多文件夹队列非最后一组）：不出结果面板，直接交给下一组
        if (options?.keepUploading) return true;
        setResult({
          type: 'archive',
          archiveType: file.name.toLowerCase().endsWith('.rar') ? 'RAR' : 'ZIP',
          ok,
          fail,
          total: resp.total,
          drawings,
          drawingFail,
          skipped,
        });
        swrMutate('/models/count');
        onConverted?.();
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '压缩包上传失败';
        if (isCurrentUploadRun(runId)) setError(message);
        return false;
      } finally {
        if (processingTimer) clearInterval(processingTimer);
        finishUploadRun(runId);
        if (options?.keepUploading) {
          // 队列还有下一组：保持上传态，进度条不闪断
          setUploading(true);
        }
      }
    },
    [
      beginUploadStats,
      beginUploadRun,
      categoryId,
      finishUploadStats,
      finishUploadRun,
      getArchiveSizeError,
      isCurrentUploadRun,
      onConverted,
      paintProgress,
      reportUploadStats,
    ],
  );

  const hasUploadableModelInput = useCallback(
    (files: File[]) => files.some((file) => !isArchiveFile(file) && !isDrawingFile(file)) || files.some(isArchiveFile),
    [isArchiveFile, isDrawingFile],
  );

  // 拖入文件夹的入列过滤：忽略 GPUCache / 隐藏文件；只收模型格式与 PDF（SLDPRT 等源文件不上传）。
  // 拖入瞬间只做轻量校验（有没有模型、总大小），不打 ZIP；真正打包在点「开始上传」后进行。
  const filterFolderEntries = useCallback(
    (collected: FileWithPath[]): FileWithPath[] =>
      collected.filter(({ file, relativePath }) => {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        if (!formats.includes(ext) && ext !== 'pdf') return false;
        const segments = relativePath.split('/');
        return !segments.some((segment) => segment === 'GPUCache' || segment.startsWith('.'));
      }),
    [formats],
  );

  // 文件夹打 ZIP：内存打包走批量上传通道（服务端按 ZIP 内路径解析文件夹名做标题/变体跳过/PDF 配对）。
  // 纯函数：返回打包结果或拒绝原因，不直接设置错误（由调用方决定提示方式）。
  const buildFolderUploadZip = useCallback(
    async (collected: FileWithPath[]): Promise<{ file: File } | { error: string } | { empty: true }> => {
      const accepted = filterFolderEntries(collected);
      const hasModel = accepted.some(({ file }) => {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        return formats.includes(ext);
      });
      if (!hasModel) return { empty: true };

      const zip = new JSZip();
      for (const { file, relativePath } of accepted) zip.file(relativePath, file);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      if (blob.size > archiveMaxBytes) {
        return {
          error: `文件夹打包后 ${Math.round(blob.size / 1024 / 1024)}MB，超过 ZIP/RAR 上限 ${archiveMaxSizeMb}MB，请分批拖入`,
        };
      }
      return { file: new File([blob], 'folder-upload.zip', { type: 'application/zip' }) };
    },
    [archiveMaxBytes, archiveMaxSizeMb, filterFolderEntries, formats],
  );

  const startUpload = useCallback(() => {
    if (pendingFiles.length === 0 && pendingFolderGroups.length === 0) return;
    setError(null);

    // 纯文件夹上传：逐组打包走压缩包通道（每组独立 ZIP，服务端按组内路径解析），
    // 各组统计累加，最后一组完成时统一清队列并展示汇总结果
    if (pendingFiles.length === 0 && pendingFolderGroups.length > 0) {
      const groups = pendingFolderGroups;
      void (async () => {
        // 打包阶段先点亮进度条（不占上传运行锁，首组交给 handleArchiveFile 时由它接管）
        setResult(null);
        setUploading(true);
        setProgress(3);
        setProgressLabel('正在打包文件夹...');
        const acc = { ok: 0, fail: 0, total: 0, drawings: 0, drawingFail: 0, skipped: 0 };
        for (let i = 0; i < groups.length; i++) {
          const isLast = i === groups.length - 1;
          setProgressLabel(`正在打包第 ${i + 1}/${groups.length} 个文件夹...`);
          const result = await buildFolderUploadZip(groups[i]);
          if ('empty' in result || 'error' in result) {
            setError('empty' in result ? '文件夹为空或没有可上传的模型文件' : result.error);
            setUploading(false);
            setProgress(0);
            setProgressLabel('');
            return;
          }
          const ok = await handleArchiveFile(result.file, {
            keepQueue: !isLast,
            keepUploading: !isLast,
            onAccumulate: (stats) => {
              acc.ok += stats.ok;
              acc.fail += stats.fail;
              acc.total += stats.total;
              acc.drawings += stats.drawings;
              acc.drawingFail += stats.drawingFail;
              acc.skipped += stats.skipped;
            },
          });
          if (!ok) return; // handleArchiveFile 已设错误并中止，保留剩余组在队列里
          // 最后一组：以汇总统计展示结果面板（handleArchiveFile 内部那份只含末组）
          if (isLast && groups.length > 1) {
            setResult({ type: 'archive', archiveType: 'ZIP', ...acc });
          }
        }
      })();
      return;
    }

    // 文件 + 文件夹混合：文件夹组打成虚拟 ZIP 与文件一起走多文件流程（进度/结果统一）
    if (pendingFolderGroups.length > 0) {
      void (async () => {
        const zipEntries: File[] = [];
        for (let i = 0; i < pendingFolderGroups.length; i++) {
          const result = await buildFolderUploadZip(pendingFolderGroups[i]);
          if ('empty' in result || 'error' in result) {
            setError('empty' in result ? '文件夹为空或没有可上传的模型文件' : result.error);
            return;
          }
          zipEntries.push(result.file);
        }
        handleMultiFile([...pendingFiles, ...zipEntries]);
      })();
      return;
    }

    const unmatchedPdfError = getDrawingMatchError(pendingFiles);
    if (unmatchedPdfError) {
      setError(unmatchedPdfError);
      return;
    }
    if (!hasUploadableModelInput(pendingFiles)) {
      setError('PDF 图纸需要和同名模型文件一起上传');
      return;
    }
    const fileSizeError = getFileSizeError(pendingFiles);
    if (fileSizeError) {
      setError(fileSizeError);
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
      void handleArchiveFile(pendingFiles[0]);
    } else {
      handleMultiFile(pendingFiles);
    }
  }, [
    pendingFiles,
    pendingFolderGroups,
    buildFolderUploadZip,
    getArchiveSizeError,
    getDrawingMatchError,
    getFileSizeError,
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

      // webkitGetAsEntry 必须在事件同步阶段调用（dataTransfer.items 异步访问会被浏览器清空）
      const items = Array.from(e.dataTransfer.items || []) as DataTransferItemWithEntry[];
      const entries: WebkitFileSystemEntry[] = [];
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      const hasDirectory = entries.some((entry) => entry.isDirectory);
      if (hasDirectory) {
        // 文件夹拖入：异步展开（entry 可异步遍历）→ 按根文件夹拆组 → 轻量校验后追加进待传列表。
        // 每个根文件夹一组、上传时打独立 ZIP——服务端「单零件文件夹」识别要求包内只有一个根目录，
        // 多文件夹合包会被当成「分类/文件」树解析，标题就退化成文件名而不是文件夹名。
        void (async () => {
          setError(null);
          setExpandingFolders(true);
          try {
            const collected = await collectFilesWithPathFromDataTransfer(entries, []);
            const accepted = filterFolderEntries(collected);
            const hasModel = accepted.some(({ file }) => {
              const ext = file.name.split('.').pop()?.toLowerCase() || '';
              return formats.includes(ext);
            });
            if (!hasModel) {
              setError('文件夹为空或没有可上传的模型文件');
              return;
            }
            const byRoot = new Map<string, FileWithPath[]>();
            for (const item of accepted) {
              const root = item.relativePath.split('/')[0] || item.file.name;
              const list = byRoot.get(root) || [];
              list.push(item);
              byRoot.set(root, list);
            }
            const oversizedRoot = [...byRoot.entries()].find(
              ([, list]) => list.reduce((sum, { file }) => sum + file.size, 0) > archiveMaxBytes,
            );
            if (oversizedRoot) {
              setError(`文件夹「${oversizedRoot[0]}」内容超过 ZIP/RAR 上限 ${archiveMaxSizeMb}MB，请单独压缩后上传`);
              return;
            }
            // 每个根文件夹一组；纯散文件（无目录层级）合为一组
            const groups: FileWithPath[][] = [];
            let looseFiles: FileWithPath[] | null = null;
            for (const [, list] of byRoot) {
              const isLoose = list.every(({ relativePath }) => !relativePath.includes('/'));
              if (isLoose && byRoot.size === 1) {
                groups.push(list);
              } else if (isLoose) {
                looseFiles = looseFiles ? [...looseFiles, ...list] : list;
              } else {
                groups.push(list);
              }
            }
            if (looseFiles) groups.push(looseFiles);
            setPendingFolderGroups((prev) => [...prev, ...groups]);
          } catch (err) {
            setError(err instanceof Error ? err.message : '文件夹上传失败，请重试');
          } finally {
            setExpandingFolders(false);
          }
        })();
        return;
      }

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
      const fileSizeError = getFileSizeError(filtered);
      if (fileSizeError) {
        setError(fileSizeError);
        return;
      }
      const archiveSizeError = getArchiveSizeError(filtered);
      if (archiveSizeError) {
        setError(archiveSizeError);
        return;
      }
      setError(null);

      // 单个散文件（非压缩包非 PDF）保持原行为：直接单模型上传
      if (filtered.length === 1 && !isArchiveFile(filtered[0]) && !isDrawingFile(filtered[0])) {
        handleSingleFile(filtered[0]);
      } else {
        // 追加而非替换：可连续拖入多批文件/压缩包
        setPendingFiles((prev) => [...prev, ...filtered]);
      }
    },
    [
      archiveMaxBytes,
      archiveMaxSizeMb,
      filterFiles,
      filterFolderEntries,
      formats,
      getArchiveSizeError,
      getDrawingMatchError,
      getFileSizeError,
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
      const fileSizeError = getFileSizeError(filtered);
      if (fileSizeError) {
        setError(fileSizeError);
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
        // 追加而非替换：可连续选择多批文件/压缩包
        setPendingFiles((prev) => [...prev, ...filtered]);
      }
      e.target.value = '';
    },
    [
      filterFiles,
      getArchiveSizeError,
      getDrawingMatchError,
      getFileSizeError,
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

  const clearPendingQueue = useCallback(() => {
    setError(null);
    setPendingFiles([]);
    setPendingFolderGroups([]);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <DialogOverlay
          onClose={handleClose}
          zIndex={50}
          backdropClassName="bg-black/60 backdrop-blur-sm"
          bottomOnMobile
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
                type="button"
                onClick={handleClose}
                className="p-1 text-on-surface-variant hover:text-on-surface transition-colors rounded-sm"
              >
                <Icon name="close" size={28} />
              </button>
            </div>

            <div className="overflow-y-auto p-4 [overflow-anchor:none] sm:p-6">
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
                          共 {result.total} 个文件：{result.ok} 成功
                          {result.fail > 0 ? `，${result.fail} 失败` : ''}
                          {result.skipped ? `，${result.skipped} 跳过（零件目录已有直接模型文件）` : ''}
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
                    type="button"
                    onClick={handleResultClose}
                    className="mt-2 bg-primary-container text-on-primary rounded-sm px-6 py-2 text-sm font-medium hover:opacity-90"
                  >
                    完成
                  </button>
                </div>
              ) : pendingFiles.length > 0 || pendingFolderGroups.length > 0 || expandingFolders ? (
                <>
                  {!uploading && categoryData?.items && categoryData.items.length > 0 && (
                    <div className="mb-4">
                      <label className="text-xs uppercase tracking-wider text-on-surface-variant mb-1.5 block">
                        分类
                      </label>
                      <CategorySelect
                        categories={categoryData.items}
                        value={categoryId}
                        onChange={changeCategory}
                        placeholder="选择分类（可选）"
                        autoFocusSearch={false}
                        portalDropdown
                      />
                    </div>
                  )}
                  <div className="border border-outline-variant/20 rounded-lg divide-y divide-outline-variant/10 max-h-60 overflow-y-auto mb-4">
                    {expandingFolders && (
                      <div className="flex items-center gap-2 px-3 py-2 text-sm text-on-surface-variant">
                        <Icon name="hourglass_top" size={18} className="shrink-0 animate-spin" />
                        <span className="flex-1">正在展开拖入的文件夹...</span>
                      </div>
                    )}
                    {pendingFolderGroups.map((group, i) => {
                      const rootNames = new Set(group.map(({ relativePath }) => relativePath.split('/')[0]));
                      const totalMb = group.reduce((sum, { file }) => sum + file.size, 0) / 1024 / 1024;
                      const label =
                        rootNames.size === 1
                          ? `${[...rootNames][0]}（${group.length} 个文件）`
                          : `${rootNames.size} 个文件夹 / ${group.length} 个文件`;
                      return (
                        <div key={`folder-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                          <Icon name="folder" size={18} className="text-on-surface-variant shrink-0" />
                          <span className="truncate flex-1 text-on-surface">{label}</span>
                          <span className="text-xs text-on-surface-variant shrink-0">{totalMb.toFixed(1)} MB</span>
                          {!uploading && (
                            <button
                              type="button"
                              onClick={() => setPendingFolderGroups((prev) => prev.filter((_, gi) => gi !== i))}
                              className="text-on-surface-variant hover:text-error shrink-0"
                            >
                              <Icon name="close" size={16} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {pendingFiles.map((f, i) => (
                      <div key={`file-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
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
                            type="button"
                            onClick={() => removePendingFile(i)}
                            className="text-on-surface-variant hover:text-error shrink-0"
                          >
                            <Icon name="close" size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {!uploading && (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragActive(true);
                      }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={handleDrop}
                      onClick={() => addMoreInputRef.current?.click()}
                      className={`mb-4 flex items-center justify-center gap-2 border-2 border-dashed rounded-lg py-3 cursor-pointer text-sm transition-colors ${
                        dragActive
                          ? 'border-primary bg-primary-container/5 text-primary'
                          : 'border-outline-variant/30 text-on-surface-variant hover:border-primary/50 hover:bg-surface-container/50'
                      }`}
                    >
                      <input
                        ref={addMoreInputRef}
                        type="file"
                        multiple
                        accept={acceptedFormats}
                        onChange={handleChange}
                        className="hidden"
                      />
                      <Icon name="add" size={18} />
                      <span>继续拖入或点击添加（文件夹 / 压缩包 / 文件）</span>
                    </div>
                  )}
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
                      {uploadStatsLine && (
                        <p className="text-xs tabular-nums text-on-surface-variant/80">{uploadStatsLine}</p>
                      )}
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
                        type="button"
                        onClick={clearPendingQueue}
                        className="flex-1 border border-outline-variant/30 text-on-surface-variant rounded-sm px-4 py-2 text-sm font-medium hover:bg-surface-container-high"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={startUpload}
                        disabled={expandingFolders || (pendingFiles.length === 0 && pendingFolderGroups.length === 0)}
                        className="flex-1 bg-primary-container text-on-primary rounded-sm px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                      >
                        开始上传 (
                        {[
                          pendingFolderGroups.length > 0 ? `${pendingFolderGroups.length} 个文件夹` : '',
                          pendingFiles.length > 0 ? `${pendingFiles.length} 个文件` : '',
                        ]
                          .filter(Boolean)
                          .join(' + ')}
                        )
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
                        onChange={changeCategory}
                        placeholder="选择分类（可选）"
                        autoFocusSearch={false}
                        portalDropdown
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
                    className={`border-2 border-dashed rounded-lg p-5 sm:p-8 text-center cursor-pointer transition-colors ${
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
                        {uploadStatsLine && (
                          <p className="text-xs tabular-nums text-on-surface-variant/80">{uploadStatsLine}</p>
                        )}
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
                        <p className="text-sm text-on-surface mb-1">拖放文件或文件夹到此处，或点击选择</p>
                        <p className="text-xs text-on-surface-variant">
                          支持 {formatLabel} 模型和同名 PDF，可多选或上传 ZIP/RAR 压缩包（上限 {archiveMaxSizeMb}MB）
                        </p>
                        <p className="mt-1 text-[11px] text-on-surface-variant/80">
                          可连续拖入多个文件夹/压缩包，确认列表后再点「开始上传」
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
        </DialogOverlay>
      )}
    </AnimatePresence>
  );
}
