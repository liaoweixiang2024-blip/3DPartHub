import type { TFunction } from 'i18next';
import {
  useCallback,
  useEffect,
  useMemo,
  memo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { tempPreviewApi, type TempPreviewResult } from '../api/tempPreview';
import CadViewerPanel from '../components/3d/CadViewerPanel';
import type { CameraPreset, ViewMode } from '../components/3d/ModelViewer';
import type { MaterialPresetKey } from '../components/3d/viewerControls';
import { DEFAULT_VIEWER_TUNING, viewerTuningFromSettings, type ViewerTuning } from '../components/3d/viewerTuning';
import {
  DEFAULT_VIEWER_DISPLAY_PREFS,
  formatFileSize,
  getViewerDisplayPrefs,
  saveViewerDisplayPrefs,
} from '../components/model-detail/modelDetailUtils';
import Icon from '../components/shared/Icon';
import {
  getModelDetailMobilePeekHeight,
  getModelDetailMobilePeekVariant,
  MODEL_DETAIL_MOBILE_BOTTOM_NAV_OFFSET,
  MODEL_DETAIL_ASIDE_CLASS,
  MODEL_DETAIL_VIEWER_CLASS,
  ModelDetailDesktopFrame,
} from '../components/shared/ModelDetailFrame';
import { PublicPageShell } from '../components/shared/PublicPageShell';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getErrorMessage } from '../lib/errorNotifications';
import { getCachedPublicSettings } from '../lib/publicSettings';

const TEMP_MODEL_FORMATS = new Set(['step', 'stp']);
const TEMP_PREVIEW_LEGACY_SESSION_KEY = 'temp-viewer:last-preview:v1';
const TEMP_PREVIEW_HISTORY_KEY = 'temp-viewer:history:v1';
const TEMP_PREVIEW_HISTORY_LIMIT = 5;
const TEMP_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;
const TEMP_PREVIEW_MAX_SIZE_LABEL = '50MB';
const noop = () => {};
const MemoCadViewerPanel = memo(CadViewerPanel);

type UploadProgressStage = 'uploading' | 'converting' | 'opening';

type UploadProgressState = {
  stage: UploadProgressStage;
  percent: number;
  detail: string;
};

function tempModelExt(file: File) {
  return file.name.split('.').pop()?.toLowerCase() || '';
}

function isTempModelFile(file: File) {
  return TEMP_MODEL_FORMATS.has(tempModelExt(file));
}

function formatExpireTime(value?: string, locale = 'zh-CN') {
  if (!value) return '-';
  return new Date(value).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRemainingTimeLabel(ms: number, t: TFunction) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return t('tempViewer.time.approxSeconds', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return restSeconds
    ? t('tempViewer.time.approxMinutesSeconds', { minutes, seconds: restSeconds })
    : t('tempViewer.time.approxMinutes', { minutes });
}

function formatElapsedTimeLabel(ms: number, t: TFunction) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return t('tempViewer.time.seconds', { count: seconds });
  return t('tempViewer.time.minutesSeconds', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
}

function formatUploadSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
  return `${formatFileSize(bytesPerSecond)}/s`;
}

function estimateTempPreviewConversionMs(fileSize: number) {
  const mb = fileSize / (1024 * 1024);
  return Math.max(12_000, Math.min(120_000, 8_000 + mb * 1_600));
}

function readStorageItem(key: string) {
  if (typeof window === 'undefined') return null;
  const stores = [window.localStorage, window.sessionStorage];
  for (const store of stores) {
    try {
      const value = store.getItem(key);
      if (value) return value;
    } catch {
      // Storage can be blocked in private browsing.
    }
  }
  return null;
}

function writeStorageItem(key: string, value: string) {
  if (typeof window === 'undefined') return;
  const stores = [window.localStorage, window.sessionStorage];
  for (const store of stores) {
    try {
      store.setItem(key, value);
      return;
    } catch {
      // Try the next available storage.
    }
  }
}

function removeStorageItem(key: string) {
  if (typeof window === 'undefined') return;
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      store.removeItem(key);
    } catch {
      // Best effort only.
    }
  }
}

function parseStoredJson(key: string) {
  const raw = readStorageItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    removeStorageItem(key);
    return null;
  }
}

function normalizeTempPreview(value: unknown): TempPreviewResult | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<TempPreviewResult>;
  const expiresAt = typeof item.expires_at === 'string' ? item.expires_at : '';
  const expiresTime = Date.parse(expiresAt);
  if (!Number.isFinite(expiresTime) || expiresTime <= Date.now()) return null;
  if (typeof item.id !== 'string' || typeof item.gltf_url !== 'string') return null;
  const originalName = typeof item.original_name === 'string' ? item.original_name : item.name || 'Temporary model';

  return {
    id: item.id,
    name: typeof item.name === 'string' ? item.name : originalName.replace(/\.[^.]+$/, ''),
    original_name: originalName,
    format: typeof item.format === 'string' ? item.format : '-',
    original_size: typeof item.original_size === 'number' ? item.original_size : 0,
    gltf_url: item.gltf_url,
    gltf_size: typeof item.gltf_size === 'number' ? item.gltf_size : 0,
    expires_at: expiresAt,
    preview_meta: item.preview_meta ?? null,
  };
}

function normalizeTempPreviewHistory(value: unknown): TempPreviewResult[] {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const history: TempPreviewResult[] = [];
  for (const rawItem of values) {
    const item = normalizeTempPreview(rawItem);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    history.push(item);
  }
  return history
    .sort((left, right) => Date.parse(right.expires_at) - Date.parse(left.expires_at))
    .slice(0, TEMP_PREVIEW_HISTORY_LIMIT);
}

function areSameTempPreviewHistory(left: TempPreviewResult[], right: TempPreviewResult[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return other?.id === item.id && other.expires_at === item.expires_at && other.gltf_url === item.gltf_url;
  });
}

function clearStoredTempPreview() {
  removeStorageItem(TEMP_PREVIEW_LEGACY_SESSION_KEY);
}

function readStoredTempPreview(): TempPreviewResult | null {
  const preview = normalizeTempPreview(parseStoredJson(TEMP_PREVIEW_LEGACY_SESSION_KEY));
  if (!preview) {
    clearStoredTempPreview();
  }
  return preview;
}

function storeTempPreview(preview: TempPreviewResult | null) {
  if (!preview) {
    clearStoredTempPreview();
    return;
  }
  try {
    writeStorageItem(TEMP_PREVIEW_LEGACY_SESSION_KEY, JSON.stringify(preview));
  } catch {
    // Best-effort only; server-side TTL still protects temporary files.
  }
}

function readStoredTempPreviewHistory() {
  const history = normalizeTempPreviewHistory(parseStoredJson(TEMP_PREVIEW_HISTORY_KEY));
  const legacyPreview = readStoredTempPreview();
  if (!legacyPreview) return history;
  return normalizeTempPreviewHistory([legacyPreview, ...history]);
}

function storeTempPreviewHistory(history: TempPreviewResult[]) {
  const normalized = normalizeTempPreviewHistory(history);
  if (!normalized.length) {
    removeStorageItem(TEMP_PREVIEW_HISTORY_KEY);
    return;
  }
  writeStorageItem(TEMP_PREVIEW_HISTORY_KEY, JSON.stringify(normalized));
}

function upsertTempPreviewHistory(history: TempPreviewResult[], preview: TempPreviewResult) {
  return normalizeTempPreviewHistory([preview, ...history]);
}

export default function TempViewerPage() {
  const { i18n, t } = useTranslation();
  useDocumentTitle(t('tempViewer.title'));
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const navigate = useNavigate();
  const initialViewerPrefs = useMemo(() => getViewerDisplayPrefs(), []);
  const initialPreviewState = useMemo(() => {
    const history = readStoredTempPreviewHistory();
    return { history, preview: history[0] ?? null };
  }, []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<TempPreviewResult | null>(initialPreviewState.preview);
  const previewHistoryRef = useRef<TempPreviewResult[]>(initialPreviewState.history);
  const dragDepthRef = useRef(0);
  const progressTimeoutRef = useRef<number | null>(null);
  const conversionProgressTimerRef = useRef<number | null>(null);
  const lastProgressRef = useRef({ time: 0, value: -1 });
  const uploadSeqRef = useRef(0);
  const { toast } = useToast();
  const historyFullMessage = t('tempViewer.historyFull', { limit: TEMP_PREVIEW_HISTORY_LIMIT });
  const formatTempExpireTime = useCallback((value?: string) => formatExpireTime(value, i18n.language), [i18n.language]);

  const [preview, setPreview] = useState<TempPreviewResult | null>(() => initialPreviewState.preview);
  const [previewHistory, setPreviewHistory] = useState<TempPreviewResult[]>(() => initialPreviewState.history);
  const visiblePreviewHistory = useMemo(() => normalizeTempPreviewHistory(previewHistory), [previewHistory]);
  const [activeView, setActiveView] = useState<ViewMode>(initialViewerPrefs.activeView);
  const [activeCamera, setActiveCamera] = useState<CameraPreset>(initialViewerPrefs.activeCamera);
  const [showDimensions, setShowDimensions] = useState(initialViewerPrefs.showDimensions);
  const [materialPreset, setMaterialPreset] = useState<MaterialPresetKey>(initialViewerPrefs.materialPreset);
  const [showEdges, setShowEdges] = useState(initialViewerPrefs.showEdges);
  const [showAxis, setShowAxis] = useState(initialViewerPrefs.showAxis);
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipPosition, setClipPosition] = useState(0);
  const [clipDirection, setClipDirection] = useState<'x' | 'y' | 'z'>('x');
  const [clipInverted, setClipInverted] = useState(false);
  const [viewerTuning, setViewerTuning] = useState<ViewerTuning>(DEFAULT_VIEWER_TUNING);
  const [dragActive, setDragActive] = useState(false);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [error, setError] = useState('');
  const [mobileSheetExpanded, setMobileSheetExpanded] = useState(false);

  useEffect(() => {
    previewRef.current = preview;
    storeTempPreview(preview);
  }, [preview]);

  useEffect(() => {
    const normalized = normalizeTempPreviewHistory(previewHistory);
    previewHistoryRef.current = normalized;
    storeTempPreviewHistory(normalized);
    if (!areSameTempPreviewHistory(previewHistory, normalized)) {
      setPreviewHistory(normalized);
    }
  }, [previewHistory]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextHistory = normalizeTempPreviewHistory(previewHistoryRef.current);
      if (!areSameTempPreviewHistory(previewHistoryRef.current, nextHistory)) {
        previewHistoryRef.current = nextHistory;
        setPreviewHistory(nextHistory);
      }

      const currentPreview = previewRef.current;
      if (currentPreview && !normalizeTempPreview(currentPreview)) {
        const fallback = nextHistory[0] ?? null;
        previewRef.current = fallback;
        setPreview(fallback);
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    getCachedPublicSettings()
      .then((settings) => setViewerTuning(viewerTuningFromSettings(settings as Partial<ViewerTuning>)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    saveViewerDisplayPrefs({
      activeView,
      activeCamera,
      showDimensions,
      materialPreset,
      showEdges,
      showAxis,
    });
  }, [activeCamera, activeView, materialPreset, showAxis, showDimensions, showEdges]);

  useEffect(
    () => () => {
      if (progressTimeoutRef.current) window.clearTimeout(progressTimeoutRef.current);
      if (conversionProgressTimerRef.current) window.clearInterval(conversionProgressTimerRef.current);
    },
    [],
  );

  const releasePreview = useCallback((target: TempPreviewResult | null) => {
    if (target) void tempPreviewApi.remove(target.id).catch(() => {});
  }, []);

  const clearConversionProgressTimer = useCallback(() => {
    if (!conversionProgressTimerRef.current) return;
    window.clearInterval(conversionProgressTimerRef.current);
    conversionProgressTimerRef.current = null;
  }, []);

  const updateUploadProgress = useCallback(
    (stage: UploadProgressStage, next: number, detail: string, force = false) => {
      const normalized = Math.max(0, Math.min(100, Math.round(next)));
      const now = performance.now();
      const last = lastProgressRef.current;
      if (!force && normalized < 100 && normalized - last.value < 3 && now - last.time < 220) return;
      lastProgressRef.current = { time: now, value: normalized };
      setProgress(normalized);
      setUploadProgress({ stage, percent: normalized, detail });
    },
    [],
  );

  const handleToggleDimensions = useCallback(() => setShowDimensions((value) => !value), []);
  const handleToggleEdges = useCallback(() => setShowEdges((value) => !value), []);
  const handleToggleClip = useCallback(() => setClipEnabled((value) => !value), []);
  const handleToggleClipInverted = useCallback(() => setClipInverted((value) => !value), []);
  const handleResetClip = useCallback(() => setClipPosition(0), []);
  const handleToggleAxis = useCallback(() => setShowAxis((value) => !value), []);
  const handleResetViewerTuning = useCallback(() => setViewerTuning(DEFAULT_VIEWER_TUNING), []);

  const resetDisplay = useCallback(() => {
    setActiveView(DEFAULT_VIEWER_DISPLAY_PREFS.activeView);
    setActiveCamera(DEFAULT_VIEWER_DISPLAY_PREFS.activeCamera);
    setShowDimensions(DEFAULT_VIEWER_DISPLAY_PREFS.showDimensions);
    setMaterialPreset(DEFAULT_VIEWER_DISPLAY_PREFS.materialPreset);
    setShowEdges(DEFAULT_VIEWER_DISPLAY_PREFS.showEdges);
    setShowAxis(DEFAULT_VIEWER_DISPLAY_PREFS.showAxis);
    setClipEnabled(false);
    setClipDirection('x');
    setClipPosition(0);
    setClipInverted(false);
  }, []);

  const handleFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      if (working) return;
      if (!isTempModelFile(file)) {
        toast(t('tempViewer.unsupportedFile'), 'error');
        return;
      }
      if (file.size > TEMP_PREVIEW_MAX_BYTES) {
        const message = t('tempViewer.maxSize', { size: TEMP_PREVIEW_MAX_SIZE_LABEL });
        setError(message);
        toast(message, 'error');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      const currentHistory = normalizeTempPreviewHistory(previewHistoryRef.current);
      if (currentHistory.length >= TEMP_PREVIEW_HISTORY_LIMIT) {
        setError(historyFullMessage);
        toast(historyFullMessage, 'error');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      const uploadSeq = uploadSeqRef.current + 1;
      uploadSeqRef.current = uploadSeq;
      setError('');
      setWorking(true);
      lastProgressRef.current = { time: 0, value: -1 };
      clearConversionProgressTimer();
      if (progressTimeoutRef.current) {
        window.clearTimeout(progressTimeoutRef.current);
        progressTimeoutRef.current = null;
      }
      setUploadProgress(null);
      const uploadStartedAt = performance.now();
      const conversionEstimateMs = estimateTempPreviewConversionMs(file.size);
      let conversionStarted = false;
      const startConversionProgress = () => {
        if (conversionStarted) return;
        conversionStarted = true;
        const conversionStartedAt = performance.now();
        updateUploadProgress(
          'converting',
          66,
          t('tempViewer.convertingInitial', { remaining: formatRemainingTimeLabel(conversionEstimateMs, t) }),
          true,
        );
        conversionProgressTimerRef.current = window.setInterval(() => {
          const elapsed = performance.now() - conversionStartedAt;
          const remaining = Math.max(0, conversionEstimateMs - elapsed);
          const percent = 66 + Math.min(30, (elapsed / conversionEstimateMs) * 30);
          const detail = remaining
            ? t('tempViewer.convertingDetail', {
                remaining: formatRemainingTimeLabel(remaining, t),
                elapsed: formatElapsedTimeLabel(elapsed, t),
              })
            : t('tempViewer.convertingElapsed', { elapsed: formatElapsedTimeLabel(elapsed, t) });
          updateUploadProgress('converting', percent, detail, true);
        }, 1_000);
      };
      updateUploadProgress('uploading', 0, t('tempViewer.preparingUpload', { size: formatFileSize(file.size) }), true);

      try {
        const next = await tempPreviewApi.upload(file, (event) => {
          const total = event.total || file.size;
          if (!total) return;
          const loaded = Math.max(0, Math.min(total, event.loaded));
          const uploadRatio = Math.max(0, Math.min(1, loaded / total));
          if (uploadRatio >= 0.995) {
            startConversionProgress();
            return;
          }
          const elapsedSeconds = Math.max(0.1, (performance.now() - uploadStartedAt) / 1000);
          const speed = loaded / elapsedSeconds;
          const speedLabel = formatUploadSpeed(speed);
          const remainingMs = speed > 0 ? ((total - loaded) / speed) * 1000 : 0;
          const detailParts = [
            t('tempViewer.uploadingPercent', { percent: Math.round(uploadRatio * 100) }),
            speedLabel,
            remainingMs > 0 ? t('tempViewer.remaining', { time: formatRemainingTimeLabel(remainingMs, t) }) : '',
          ].filter(Boolean);
          updateUploadProgress('uploading', uploadRatio * 65, detailParts.join(' · '));
        });
        clearConversionProgressTimer();
        if (uploadSeqRef.current !== uploadSeq) {
          releasePreview(next);
          return;
        }
        previewRef.current = next;
        setPreview(next);
        setPreviewHistory((items) => upsertTempPreviewHistory(items, next));
        updateUploadProgress('opening', 100, t('tempViewer.modelOpened'), true);
        toast(t('tempViewer.modelOpened'), 'success');
      } catch (err) {
        if (uploadSeqRef.current !== uploadSeq) return;
        clearConversionProgressTimer();
        const message = getErrorMessage(err, t('tempViewer.uploadFailure'));
        setError(message);
        toast(message, 'error');
      } finally {
        if (uploadSeqRef.current === uploadSeq) {
          setWorking(false);
          progressTimeoutRef.current = window.setTimeout(() => {
            setProgress(null);
            setUploadProgress(null);
            progressTimeoutRef.current = null;
          }, 700);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }
    },
    [clearConversionProgressTimer, historyFullMessage, releasePreview, t, toast, updateUploadProgress, working],
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      void handleFile(event.target.files?.[0]);
    },
    [handleFile],
  );

  const clearPreview = useCallback(() => {
    previewRef.current = null;
    setPreview(null);
  }, []);

  const selectPreviewRecord = useCallback(
    (target: TempPreviewResult) => {
      const normalized = normalizeTempPreview(target);
      if (!normalized) {
        setPreviewHistory((items) => items.filter((item) => item.id !== target.id));
        if (previewRef.current?.id === target.id) {
          previewRef.current = null;
          setPreview(null);
        }
        toast(t('tempViewer.expiredRecord'), 'error');
        return;
      }
      previewRef.current = normalized;
      setPreview(normalized);
      setPreviewHistory((items) => upsertTempPreviewHistory(items, normalized));
    },
    [t, toast],
  );

  const removePreviewRecord = useCallback(
    (target: TempPreviewResult) => {
      const nextHistory = normalizeTempPreviewHistory(
        previewHistoryRef.current.filter((item) => item.id !== target.id),
      );
      previewHistoryRef.current = nextHistory;
      setPreviewHistory(nextHistory);
      if (previewRef.current?.id === target.id) {
        previewRef.current = null;
        setPreview(null);
      }
      setError('');
      releasePreview(target);
    },
    [releasePreview],
  );

  const handleBack = useCallback(() => {
    const historyIndex = typeof window !== 'undefined' ? window.history.state?.idx : 0;
    if (typeof historyIndex === 'number' && historyIndex > 0) {
      navigate(-1);
      return;
    }
    navigate('/');
  }, [navigate]);

  const hasDraggedFiles = useCallback((event: DragEvent<HTMLDivElement>) => {
    return Array.from(event.dataTransfer.types || []).includes('Files');
  }, []);

  const handlePageDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    },
    [hasDraggedFiles],
  );

  const handlePageDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = working ? 'none' : 'copy';
      setDragActive(true);
    },
    [hasDraggedFiles, working],
  );

  const handlePageDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    },
    [hasDraggedFiles],
  );

  const handlePageDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      if (working) return;
      void handleFile(event.dataTransfer.files?.[0]);
    },
    [handleFile, hasDraggedFiles, working],
  );

  const fileSize = preview ? formatFileSize(preview.original_size) : '-';
  const glbSize = preview ? formatFileSize(preview.gltf_size) : '-';
  const uploadStateLabel = working
    ? uploadProgress?.stage === 'converting'
      ? t('tempViewer.converting')
      : uploadProgress?.stage === 'opening'
        ? t('tempViewer.opening')
        : t('tempViewer.uploading')
    : t('tempViewer.uploadStateReady');
  const pageDescription = t('tempViewer.pageDescription');
  const mobilePeekVariant = getModelDetailMobilePeekVariant(preview?.name || t('tempViewer.fallbackName'), {
    fallback: 'compact',
  });
  const peekHeight = getModelDetailMobilePeekHeight(mobilePeekVariant);
  const mobileSheetHeight = mobileSheetExpanded ? '94%' : peekHeight;
  const mobileViewerStyle = useMemo<CSSProperties>(() => ({ bottom: peekHeight }), [peekHeight]);
  const mobileTitleClassName =
    mobilePeekVariant === 'tall' ? 'line-clamp-2 min-h-[2.3rem]' : 'line-clamp-1 min-h-[1.15rem]';
  const previewHistoryCountLabel = visiblePreviewHistory.length
    ? `${visiblePreviewHistory.length}/${TEMP_PREVIEW_HISTORY_LIMIT}`
    : t('tempViewer.recordCountEmpty');
  const fileInfoStats = [
    { label: t('tempViewer.format'), value: preview?.format || '-' },
    { label: t('tempViewer.sourceFile'), value: preview ? fileSize : '-' },
    { label: t('tempViewer.preview'), value: preview ? glbSize : '-' },
  ];
  const uploadHintMessage =
    error ||
    (working
      ? uploadProgress?.stage === 'converting'
        ? t('tempViewer.conversionInProgress')
        : t('tempViewer.uploadInProgress')
      : isDesktop
        ? t('tempViewer.uploadHintDesktop')
        : t('tempViewer.uploadHintMobile'));
  const uploadProgressDetail = uploadProgress?.detail || t('tempViewer.uploadStateReady');
  const uploadProgressPercent = Math.max(0, Math.min(100, Math.round(uploadProgress?.percent ?? progress ?? 0)));

  const renderViewer = (style?: CSSProperties, className = '', showBackButton = true) =>
    preview ? (
      <MemoCadViewerPanel
        variant={isDesktop ? 'desktop' : 'mobile'}
        modelId={preview.id}
        modelName={preview.name}
        modelFormat={preview.format}
        modelFileSize={fileSize}
        modelCreatedAt={formatTempExpireTime(preview.expires_at)}
        isAdmin={false}
        modelUrl={preview.gltf_url}
        activeView={activeView}
        onViewChange={setActiveView}
        activeCamera={activeCamera}
        onCameraChange={setActiveCamera}
        showDimensions={showDimensions}
        onToggleDimensions={handleToggleDimensions}
        materialPreset={materialPreset}
        onMaterialChange={setMaterialPreset}
        showEdges={showEdges}
        onToggleEdges={handleToggleEdges}
        clipEnabled={clipEnabled}
        onToggleClip={handleToggleClip}
        clipPosition={clipPosition}
        onClipPositionChange={setClipPosition}
        clipDirection={clipDirection}
        onClipDirectionChange={setClipDirection}
        clipInverted={clipInverted}
        onToggleClipInverted={handleToggleClipInverted}
        onResetClip={handleResetClip}
        showAxis={showAxis}
        onToggleAxis={handleToggleAxis}
        onResetDisplay={resetDisplay}
        tuningOpen={false}
        onToggleTuning={noop}
        viewerTuning={viewerTuning}
        onViewerTuningChange={setViewerTuning}
        onApplyViewerPreset={setViewerTuning}
        onResetViewerTuning={handleResetViewerTuning}
        onSaveViewerTuning={noop}
        viewerTuningSaving={false}
        previewMeta={preview.preview_meta}
        showBackButton={showBackButton}
        onBack={handleBack}
        className={className}
        style={style}
      />
    ) : (
      <div
        className={`${isDesktop ? MODEL_DETAIL_VIEWER_CLASS : 'absolute inset-0 overflow-hidden rounded-b-2xl bg-surface-container'} flex flex-col items-center justify-center px-6 text-center ${className}`}
        style={style}
      >
        <Icon name="view_in_ar" size={68} className="text-on-surface-variant/20" />
        <div className="mt-4 text-sm font-semibold text-on-surface">{t('tempViewer.emptyTitle')}</div>
        <div className="mt-1 text-xs text-on-surface-variant">
          {isDesktop ? t('tempViewer.emptyDescriptionDesktop') : t('tempViewer.emptyDescriptionMobile')}
        </div>
      </div>
    );

  const dragOverlay =
    isDesktop && dragActive ? (
      <div className="pointer-events-none absolute inset-0 z-[10050] flex items-center justify-center bg-surface/55 px-6 backdrop-blur-sm">
        <div className="rounded-xl border border-primary/35 bg-surface-container-high px-6 py-5 text-center shadow-2xl">
          <Icon name="upload_file" size={34} className="mx-auto text-primary" />
          <div className="mt-2 text-sm font-bold text-on-surface">{t('tempViewer.dragDropTitle')}</div>
          <div className="mt-1 text-xs text-on-surface-variant">{t('tempViewer.dragDropDescription')}</div>
        </div>
      </div>
    ) : null;

  const uploadDropHint = (
    <div
      className={`flex min-h-[84px] items-center gap-2 rounded-md border border-dashed px-3 py-2 transition-colors ${
        dragActive
          ? 'border-primary bg-primary-container/10 text-primary'
          : 'border-outline-variant/25 bg-surface-container text-on-surface-variant'
      }`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-outline-variant/15 bg-surface-container-high text-primary shadow-sm">
        <Icon
          name={working ? 'progress_activity' : 'view_in_ar'}
          size={24}
          className={working || dragActive ? 'animate-spin' : ''}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-on-surface">{t('tempViewer.uploadModel')}</div>
        <div
          className={`mt-0.5 line-clamp-1 text-[11px] leading-4 ${
            error ? 'font-medium text-error' : 'text-on-surface-variant'
          }`}
          role={error ? 'alert' : undefined}
          title={uploadHintMessage}
        >
          {uploadHintMessage}
        </div>
        <div className="mt-1 flex h-3.5 items-center justify-between gap-2 text-[10px] leading-none">
          <span
            className={`min-w-0 truncate text-on-surface-variant ${working ? '' : 'opacity-0'}`}
            aria-hidden={!working}
            title={working ? uploadProgressDetail : undefined}
          >
            {uploadProgressDetail}
          </span>
          <span
            className={`shrink-0 font-medium tabular-nums text-primary ${working ? '' : 'opacity-0'}`}
            aria-hidden={!working}
          >
            {uploadProgressPercent}%
          </span>
        </div>
        <div
          className={`mt-1 h-1 overflow-hidden rounded-full bg-surface-container-highest ${working ? '' : 'opacity-0'}`}
        >
          <div
            className="h-full rounded-full bg-primary-container transition-all"
            style={{ width: `${working && progress !== null ? Math.max(uploadProgressPercent, 8) : 0}%` }}
          />
        </div>
      </div>
    </div>
  );

  const fileInfoPanel = (
    <div className="rounded-lg border border-outline-variant/15 bg-surface-container p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
          <Icon name={preview ? 'check_circle' : 'info'} size={17} />
          {t('tempViewer.fileInfo')}
        </div>
        <span className="rounded-sm bg-surface-container-high px-2 py-1 text-[11px] text-on-surface-variant">
          {preview ? t('tempViewer.statusOpened') : t('tempViewer.statusWaiting')}
        </span>
      </div>
      <div className="mt-2.5">
        <div className="grid grid-cols-3 gap-2">
          {fileInfoStats.map((item) => (
            <div
              key={item.label}
              className="rounded-sm border border-outline-variant/10 bg-surface-container-low p-1.5"
            >
              <div className="text-[10px] text-on-surface-variant">{item.label}</div>
              <div
                className={`mt-0.5 truncate text-xs font-semibold ${preview ? 'text-on-surface' : 'text-on-surface-variant'}`}
                title={item.value}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const uploadRecordPanel = (
    <div className="rounded-lg border border-outline-variant/15 bg-surface-container p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
          <Icon name="receipt_long" size={17} />
          {t('tempViewer.uploadRecords')}
        </div>
        <span className="rounded-sm bg-surface-container-high px-2 py-1 text-[11px] text-on-surface-variant">
          {previewHistoryCountLabel}
        </span>
      </div>

      {visiblePreviewHistory.length ? (
        <div className="mt-2 space-y-1.5">
          {visiblePreviewHistory.map((item) => {
            const isActive = preview?.id === item.id;
            return (
              <div
                key={item.id}
                className={`relative flex min-w-0 items-center gap-2 overflow-hidden rounded-sm border px-2.5 py-1.5 transition-colors ${
                  isActive
                    ? 'border-primary/25 bg-primary-container/10'
                    : 'border-outline-variant/10 bg-surface-container-low hover:border-outline-variant/25 hover:bg-surface-container-high'
                }`}
              >
                <span
                  className={`absolute bottom-2 left-0 top-2 w-0.5 rounded-r-full transition-opacity ${
                    isActive ? 'bg-primary opacity-100' : 'bg-transparent opacity-0'
                  }`}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  onClick={() => selectPreviewRecord(item)}
                  className="min-w-0 flex-1 py-0.5 pl-1 text-left"
                  title={item.original_name}
                >
                  <div className="truncate text-xs font-semibold leading-4 text-on-surface">{item.original_name}</div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-on-surface-variant">
                    <span className="shrink-0 rounded-[3px] bg-surface-container-high px-1.5 py-0.5 font-medium">
                      {item.format}
                    </span>
                    <span className="truncate">
                      {t('tempViewer.expirePrefix', { time: formatTempExpireTime(item.expires_at) })}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => removePreviewRecord(item)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-error-container/15 hover:text-error"
                  aria-label={t('tempViewer.deleteRecordAria', { name: item.original_name })}
                  title={t('tempViewer.deleteRecordTitle')}
                >
                  <Icon name="delete" size={15} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 rounded-sm border border-dashed border-outline-variant/25 bg-surface-container-low px-3 py-4 text-center text-xs text-on-surface-variant">
          {t('tempViewer.historyEmpty', { limit: TEMP_PREVIEW_HISTORY_LIMIT })}
        </div>
      )}
    </div>
  );

  if (!isDesktop) {
    return (
      <PublicPageShell mobileClassName="flex flex-col h-dvh bg-surface" keepMobileDrawerMounted>
        <div
          className="relative min-h-0 flex-1 overflow-hidden bg-surface"
          style={{ marginBottom: MODEL_DETAIL_MOBILE_BOTTOM_NAV_OFFSET }}
          onDragEnter={handlePageDragEnter}
          onDragOver={handlePageDragOver}
          onDragLeave={handlePageDragLeave}
          onDrop={handlePageDrop}
        >
          <input ref={fileInputRef} type="file" accept=".step,.stp" className="hidden" onChange={handleInputChange} />
          {dragOverlay}
          {renderViewer(mobileViewerStyle, '', !mobileSheetExpanded)}

          <div
            className="absolute bottom-0 left-0 right-0 z-30 flex flex-col overflow-hidden rounded-t-2xl border-t border-outline-variant/10 bg-surface-container-low shadow-bottom-panel"
            style={{
              height: mobileSheetHeight,
              transition: 'height 0.32s cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <div className="flex shrink-0 items-center gap-2 px-3 pb-1.5 pt-2.5">
              {mobileSheetExpanded ? (
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-all hover:bg-surface-container-high hover:text-on-surface active:scale-90"
                  aria-label={t('tempViewer.back')}
                >
                  <Icon name="arrow_back" size={18} />
                </button>
              ) : null}
              <button
                type="button"
                aria-label={mobileSheetExpanded ? t('tempViewer.collapseDetails') : t('tempViewer.expandDetails')}
                onClick={() => setMobileSheetExpanded((value) => !value)}
                className="flex flex-1 justify-center"
              >
                <span className="h-1 w-9 rounded-full bg-on-surface-variant/25" />
              </button>
              {mobileSheetExpanded ? <div className="w-7 shrink-0" /> : null}
            </div>

            <div className="shrink-0 px-4 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <h2
                    className={`break-words text-sm font-bold leading-[1.15rem] text-on-surface ${mobileTitleClassName}`}
                  >
                    {preview?.name || t('tempViewer.fallbackName')}
                  </h2>
                  <p className="truncate text-[11px] text-on-surface-variant">
                    {preview?.original_name || pageDescription}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {preview ? (
                    <button
                      type="button"
                      onClick={clearPreview}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:text-primary"
                      aria-label={t('tempViewer.closeCurrent')}
                    >
                      <Icon name="close" size={18} />
                    </button>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={working}
                className="mt-2.5 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary-container text-sm font-medium text-on-primary transition-transform disabled:opacity-60 active:scale-[0.98]"
              >
                <Icon name="upload_file" size={18} className={working ? 'animate-pulse' : ''} />
                {working ? uploadStateLabel : preview ? t('tempViewer.changeFile') : uploadStateLabel}
              </button>
            </div>

            <div
              className={`min-h-0 flex-1 overflow-y-auto scrollbar-hidden ${!mobileSheetExpanded ? 'hidden' : ''}`}
              aria-hidden={!mobileSheetExpanded}
            >
              <div className="space-y-4 px-4 pb-8">
                {uploadDropHint}
                {fileInfoPanel}
                {uploadRecordPanel}
              </div>
            </div>
          </div>
        </div>
      </PublicPageShell>
    );
  }

  const viewer = renderViewer();

  return (
    <ModelDetailDesktopFrame layout="ready">
      <div
        className="contents"
        onDragEnter={handlePageDragEnter}
        onDragOver={handlePageDragOver}
        onDragLeave={handlePageDragLeave}
        onDrop={handlePageDrop}
      >
        <input ref={fileInputRef} type="file" accept=".step,.stp" className="hidden" onChange={handleInputChange} />
        {dragOverlay}
        {viewer}

        <aside className={`${MODEL_DETAIL_ASIDE_CLASS} justify-between`} data-model-detail-sidebar>
          <div className="border-b border-outline-variant/10 px-5 py-4 lg:px-6">
            <div className="mb-2 flex items-start justify-between">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.05em] text-on-surface-variant">
                  <Link to="/" className="transition-colors hover:text-primary">
                    {t('tempViewer.modelLibrary')}
                  </Link>
                  <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
                  <span className="text-primary">{t('tempViewer.title')}</span>
                </div>
                <h1 className="font-headline mb-1 line-clamp-1 break-words text-xl font-bold tracking-tight text-on-surface">
                  {preview?.name || t('tempViewer.fallbackName')}
                </h1>
                <p className="line-clamp-1 text-[11px] leading-4 text-on-surface-variant">{pageDescription}</p>
              </div>
              {preview ? (
                <button
                  type="button"
                  onClick={clearPreview}
                  className="shrink-0 rounded-sm border border-outline-variant/20 p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                  aria-label={t('tempViewer.closeCurrent')}
                >
                  <Icon name="close" size={17} />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={working}
              className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-sm bg-primary-container px-4 text-sm font-medium text-on-primary transition-all hover:bg-primary disabled:opacity-60 active:scale-95"
            >
              <Icon name="upload_file" size={18} className={working ? 'animate-pulse' : ''} />
              {working ? uploadStateLabel : preview ? t('tempViewer.changeFile') : uploadStateLabel}
            </button>
          </div>

          <div className="border-b border-outline-variant/10 px-5 py-2.5 lg:px-6">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.05em] text-on-surface-variant">
                {t('tempViewer.fileInfo')}
              </h3>
              <span
                className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] font-medium ${
                  preview ? 'bg-primary-container/10 text-primary' : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                <Icon name={preview ? 'check_circle' : 'info'} size={13} />
                {preview ? t('tempViewer.statusOpened') : t('tempViewer.statusWaiting')}
              </span>
            </div>

            <div>
              <div className="grid grid-cols-3 gap-2">
                {fileInfoStats.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-sm border border-outline-variant/10 bg-surface-container p-1.5"
                  >
                    <div className="text-[10px] text-on-surface-variant">{item.label}</div>
                    <div
                      className={`mt-0.5 truncate text-xs font-semibold ${
                        preview ? 'text-on-surface' : 'text-on-surface-variant'
                      }`}
                      title={item.value}
                    >
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2 px-5 py-3 lg:px-6">
            {uploadDropHint}
            {uploadRecordPanel}
          </div>

          <div className="mt-auto border-t border-outline-variant/20 bg-surface-container px-5 py-3 lg:px-6">
            <div className="flex items-start gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-container/15">
                <Icon name="auto_delete" size={14} className="text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-on-surface">{t('tempViewer.footerTitle')}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-on-surface-variant">
                  {t('tempViewer.footerDescription')}
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </ModelDetailDesktopFrame>
  );
}
