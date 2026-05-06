import { AnimatePresence, motion } from 'framer-motion';
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import { modelApi, type ModelPreviewMeta } from '../../api/models';
import { getCachedPublicSettings } from '../../lib/publicSettings';
import Icon from '../shared/Icon';
import SafeImage from '../shared/SafeImage';
import { useToast } from '../shared/Toast';
import CadViewerToolbar from './CadViewerToolbar';
import LoadingOverlay from './LoadingOverlay';
import MeasurementPanel from './MeasurementPanel';
import ModelPropertiesPanel from './ModelPropertiesPanel';
import ModelStructurePanel from './ModelStructurePanel';
import ModelViewer, { type CameraPreset, type ViewMode } from './ModelViewer';
import PreviewDiagnosticsDialog from './PreviewDiagnosticsDialog';
import ViewCube from './ViewCube';
import type { MaterialPresetKey } from './viewerControls';
import {
  MODEL_BOUNDS_EVENT,
  type MeasureMode,
  type MeasurementPoint,
  type MeasurementRecord,
  type MeasurementSnapMode,
  type ModelBoundsDetail,
  type ModelPartItem,
} from './viewerEvents';
import type { ViewerTuning } from './viewerTuning';
import ViewerTuningPanel from './ViewerTuningPanel';

interface CadViewerPanelProps {
  variant: 'desktop' | 'mobile';
  modelId?: string;
  modelName?: string;
  modelFormat?: string;
  modelFileSize?: string;
  modelCreatedAt?: string;
  isAdmin?: boolean;
  modelUrl?: string;
  activeView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  activeCamera: CameraPreset;
  onCameraChange: (camera: CameraPreset) => void;
  showDimensions: boolean;
  onToggleDimensions: () => void;
  materialPreset: MaterialPresetKey;
  onMaterialChange: (preset: MaterialPresetKey) => void;
  showEdges: boolean;
  onToggleEdges: () => void;
  clipEnabled: boolean;
  onToggleClip: () => void;
  clipPosition: number;
  onClipPositionChange: (position: number) => void;
  clipDirection: 'x' | 'y' | 'z';
  onClipDirectionChange: (direction: 'x' | 'y' | 'z') => void;
  clipInverted?: boolean;
  onToggleClipInverted?: () => void;
  onResetClip?: () => void;
  showAxis: boolean;
  onToggleAxis: () => void;
  onResetDisplay: () => void;
  tuningOpen: boolean;
  onToggleTuning: () => void;
  viewerTuning: ViewerTuning;
  onViewerTuningChange: (next: ViewerTuning) => void;
  onApplyViewerPreset: (next: ViewerTuning) => void;
  onResetViewerTuning: () => void;
  onSaveViewerTuning: () => void;
  viewerTuningSaving: boolean;
  previewMeta?: ModelPreviewMeta | null;
  onThumbnailUpdated?: () => void;
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLDivElement>;
  showBackButton?: boolean;
  onBack?: () => void;
  onPseudoFullscreenChange?: (active: boolean) => void;
}

function friendlyViewerError(error: Error | null) {
  const message = error?.message || '';
  if (message.includes('401') || message.includes('Unauthorized')) {
    return '预览文件需要访问权限，请刷新页面或重新登录后再试。';
  }
  if (message.includes('404') || message.toLowerCase().includes('not found')) {
    return '预览文件不存在，可能需要重新生成模型预览。';
  }
  if (message.includes('Failed to fetch') || message.includes('Could not load') || message.includes('fetch for')) {
    return '模型预览加载失败，请检查网络或稍后重试。';
  }
  return '模型预览暂时无法加载，请稍后重试。';
}

class ViewerErrorBoundary extends Component<
  { children: ReactNode; isMobile: boolean; onRetry: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (import.meta.env.DEV) console.error('[viewer] Model preview failed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full w-full items-center justify-center px-5">
        <div className="max-w-sm rounded-lg border border-outline-variant/15 bg-surface-container-low/95 p-5 text-center shadow-xl backdrop-blur">
          <Icon name="error" size={this.props.isMobile ? 36 : 44} className="mx-auto text-error/70" />
          <h3 className="mt-3 text-sm font-semibold text-on-surface">模型预览加载失败</h3>
          <p className="mt-2 text-xs leading-5 text-on-surface-variant">{friendlyViewerError(this.state.error)}</p>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null });
              this.props.onRetry();
            }}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary-container px-3 py-2 text-xs font-medium text-on-primary-container transition-opacity hover:opacity-90"
          >
            <Icon name="refresh" size={14} />
            重新加载
          </button>
        </div>
      </div>
    );
  }
}

export default function CadViewerPanel({
  variant,
  modelId,
  modelName,
  modelFormat,
  modelFileSize,
  modelCreatedAt,
  isAdmin,
  modelUrl,
  activeView,
  onViewChange,
  activeCamera,
  onCameraChange,
  showDimensions,
  onToggleDimensions,
  materialPreset,
  onMaterialChange,
  showEdges,
  onToggleEdges,
  clipEnabled,
  onToggleClip,
  clipPosition,
  onClipPositionChange,
  clipDirection,
  onClipDirectionChange,
  clipInverted,
  onToggleClipInverted,
  onResetClip,
  showAxis,
  onToggleAxis,
  onResetDisplay,
  tuningOpen,
  onToggleTuning,
  viewerTuning,
  onViewerTuningChange,
  onApplyViewerPreset,
  onResetViewerTuning,
  onSaveViewerTuning,
  viewerTuningSaving,
  previewMeta,
  onThumbnailUpdated,
  className = '',
  style,
  onClick,
  showBackButton = false,
  onBack,
  onPseudoFullscreenChange,
}: CadViewerPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [settingThumb, setSettingThumb] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [regeneratingPreview, setRegeneratingPreview] = useState(false);
  const [viewerRetryKey, setViewerRetryKey] = useState(0);
  const [currentPreviewMeta, setCurrentPreviewMeta] = useState<ModelPreviewMeta | null | undefined>(previewMeta);
  const [modelBounds, setModelBounds] = useState<ModelBoundsDetail | null>(null);
  const [parts, setParts] = useState<ModelPartItem[]>([]);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [hiddenPartIds, setHiddenPartIds] = useState<string[]>([]);
  const [isolatedPartId, setIsolatedPartId] = useState<string | null>(null);
  const [structureOpen, setStructureOpen] = useState(false);
  const [measurementOpen, setMeasurementOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [explodeAmount, setExplodeAmount] = useState(1);
  const [measureMode, setMeasureMode] = useState<MeasureMode>('distance');
  const [measurementSnapMode, setMeasurementSnapMode] = useState<MeasurementSnapMode>('surface');
  const [measurementPoints, setMeasurementPoints] = useState<MeasurementPoint[]>([]);
  const [measurementRecords, setMeasurementRecords] = useState<MeasurementRecord[]>([]);
  const [measurementConfig, setMeasurementConfig] = useState({ defaultUnit: 'auto', recordLimit: 12 });
  const [watermark, setWatermark] = useState<{ show: boolean; image: string; text: string }>({
    show: false,
    image: '',
    text: '',
  });
  const { toast } = useToast();

  useEffect(() => {
    setCurrentPreviewMeta(previewMeta);
  }, [previewMeta]);

  useEffect(() => {
    setLoaded(false);
    setLoadProgress(modelUrl ? 0 : null);
    setParts([]);
    setSelectedPartId(null);
    setHiddenPartIds([]);
    setIsolatedPartId(null);
    setMeasurementPoints([]);
    setMeasurementRecords([]);
    setPropertiesOpen(false);
    setExplodeAmount(1);
  }, [modelUrl]);

  useEffect(() => {
    const handleBounds = (event: Event) => {
      setModelBounds((event as CustomEvent<ModelBoundsDetail>).detail);
    };
    window.addEventListener(MODEL_BOUNDS_EVENT, handleBounds);
    return () => window.removeEventListener(MODEL_BOUNDS_EVENT, handleBounds);
  }, []);

  const clipRange = useMemo(() => {
    const fallback = { min: -2, max: 2, step: 0.01 };
    if (!modelBounds) return fallback;

    const axisSize =
      clipDirection === 'x' ? modelBounds.size.x : clipDirection === 'y' ? modelBounds.size.y : modelBounds.size.z;
    const limit = Math.max(axisSize * 0.55, modelBounds.maxDim * 0.05, 0.01);
    const step = Math.max(limit / 240, 0.001);
    return { min: -limit, max: limit, step };
  }, [clipDirection, modelBounds]);

  useEffect(() => {
    if (clipPosition < clipRange.min) onClipPositionChange(clipRange.min);
    if (clipPosition > clipRange.max) onClipPositionChange(clipRange.max);
  }, [clipPosition, clipRange, onClipPositionChange]);

  useEffect(() => {
    getCachedPublicSettings()
      .then((settings) => {
        setWatermark({
          show: !!settings.show_watermark,
          image: settings.watermark_image || '',
          text: settings.watermark_text?.trim() || '',
        });
        setMeasurementConfig({
          defaultUnit:
            typeof settings.viewer_measure_default_unit === 'string' ? settings.viewer_measure_default_unit : 'auto',
          recordLimit: Math.max(1, Math.floor(Number(settings.viewer_measure_record_limit) || 12)),
        });
      })
      .catch(() => {});
  }, []);

  const handleScreenshot = useCallback(() => {
    const canvas = containerRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'model-screenshot.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  const handleSetThumbnail = useCallback(async () => {
    if (!modelId) return;
    const canvas = containerRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    setSettingThumb(true);
    let ok = false;
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('toBlob failed'))), 'image/png');
      });
      const file = new File([blob], 'thumbnail.png', { type: 'image/png' });
      await modelApi.uploadThumbnail(modelId, file);
      toast('预览图已更新', 'success');
      ok = true;
    } catch {
      toast('设置预览图失败', 'error');
    } finally {
      setSettingThumb(false);
    }
    if (ok) onThumbnailUpdated?.();
  }, [modelId, onThumbnailUpdated, toast]);

  const handleRegeneratePreview = useCallback(async () => {
    if (!modelId) return;
    setRegeneratingPreview(true);
    let ok = false;
    try {
      const result = await modelApi.reconvert(modelId);
      setCurrentPreviewMeta(result.preview_meta || null);
      toast('GLB 与缩略图已重新生成', 'success');
      ok = true;
    } catch {
      toast('重新生成预览失败', 'error');
    } finally {
      setRegeneratingPreview(false);
    }
    if (ok) onThumbnailUpdated?.();
  }, [modelId, onThumbnailUpdated, toast]);

  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);

  const handleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (pseudoFullscreen) {
      setPseudoFullscreen(false);
      return;
    }
    if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
      void (document.exitFullscreen || (document as any).webkitExitFullscreen).call(document).catch(() => {});
    } else {
      const fn = el.requestFullscreen || (el as any).webkitRequestFullscreen;
      if (fn) {
        void fn.call(el).catch(() => setPseudoFullscreen(true));
      } else {
        setPseudoFullscreen(true);
      }
    }
  }, [pseudoFullscreen]);

  const handleBackClick = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      event.stopPropagation();
      if (pseudoFullscreen) {
        setPseudoFullscreen(false);
        return;
      }
      if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
        void (document.exitFullscreen || (document as any).webkitExitFullscreen).call(document).catch(() => {});
        return;
      }
      onBack?.();
    },
    [onBack, pseudoFullscreen],
  );

  const handleViewerProgress = useCallback((progress: number) => {
    setLoadProgress(progress >= 100 ? null : progress);
  }, []);

  const handleViewerLoaded = useCallback(() => {
    setLoaded(true);
    setLoadProgress(null);
  }, []);

  useEffect(() => {
    const getFullscreenEl = () => document.fullscreenElement || (document as any).webkitFullscreenElement;
    const updateFullscreenState = () => {
      setIsFullscreen(Boolean(getFullscreenEl()) || pseudoFullscreen);
    };
    updateFullscreenState();
    document.addEventListener('fullscreenchange', updateFullscreenState);
    document.addEventListener('webkitfullscreenchange', updateFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreenState);
      document.removeEventListener('webkitfullscreenchange', updateFullscreenState);
    };
  }, [pseudoFullscreen]);

  useEffect(() => {
    onPseudoFullscreenChange?.(pseudoFullscreen);
  }, [pseudoFullscreen, onPseudoFullscreenChange]);

  const handlePartsChange = useCallback((nextParts: ModelPartItem[]) => {
    setParts(nextParts);
  }, []);

  useEffect(() => {
    const ids = new Set(parts.map((part) => part.id));
    setHiddenPartIds((prev) => prev.filter((id) => ids.has(id)));
    setSelectedPartId((prev) => (prev && ids.has(prev) ? prev : null));
    setIsolatedPartId((prev) => (prev && ids.has(prev) ? prev : null));
  }, [parts]);

  const handleTogglePartHidden = useCallback((partId: string) => {
    setHiddenPartIds((prev) => (prev.includes(partId) ? prev.filter((id) => id !== partId) : [...prev, partId]));
    setSelectedPartId(partId);
  }, []);

  const handleIsolatePart = useCallback((partId: string | null) => {
    setIsolatedPartId(partId);
    if (partId) {
      setSelectedPartId(partId);
      setHiddenPartIds((prev) => prev.filter((id) => id !== partId));
    }
  }, []);

  const handleShowAllParts = useCallback(() => {
    setHiddenPartIds([]);
    setIsolatedPartId(null);
  }, []);

  const handleMeasurePoint = useCallback(
    (point: MeasurementPoint) => {
      setMeasurementPoints((prev) => {
        const required = measureMode === 'angle' || measureMode === 'diameter' ? 3 : 2;
        const next = prev.length >= required ? [point] : [...prev, point];
        if (measureMode !== 'bounds' && next.length === required) {
          setMeasurementRecords((records) =>
            [
              ...records,
              {
                id: `${Date.now()}-${records.length}`,
                mode: measureMode,
                points: next,
                createdAt: Date.now(),
              },
            ].slice(-measurementConfig.recordLimit),
          );
        }
        return next;
      });
    },
    [measureMode, measurementConfig.recordLimit],
  );

  const handleMeasureModeChange = useCallback((nextMode: MeasureMode) => {
    setMeasureMode(nextMode);
    setMeasurementPoints([]);
  }, []);

  const handleToggleMeasurement = useCallback(() => {
    setMeasurementOpen((open) => {
      const next = !open;
      if (next) {
        setStructureOpen(false);
        setPropertiesOpen(false);
      } else {
        setMeasurementPoints([]);
      }
      return next;
    });
  }, []);

  const handleToggleStructure = useCallback(() => {
    setStructureOpen((open) => {
      const next = !open;
      if (next) {
        setMeasurementOpen(false);
        setPropertiesOpen(false);
      }
      return next;
    });
  }, []);

  const handleToggleProperties = useCallback(() => {
    setPropertiesOpen((open) => {
      const next = !open;
      if (next) {
        setMeasurementOpen(false);
        setStructureOpen(false);
      }
      return next;
    });
  }, []);

  const handleResetDisplay = useCallback(() => {
    setExplodeAmount(1);
    setMeasurementPoints([]);
    setMeasurementRecords([]);
    setSelectedPartId(null);
    onResetDisplay();
  }, [onResetDisplay]);

  const isMobile = variant === 'mobile';
  const baseClassName = isMobile
    ? 'absolute inset-0 bg-surface-container overflow-hidden rounded-b-2xl'
    : 'relative bg-surface-container flex-1 md:w-[60%] overflow-hidden border-r border-outline-variant/20 shrink-0';
  const panelStyle = isMobile ? style : ({ contain: 'strict', ...style } as CSSProperties);

  return (
    <div
      ref={containerRef}
      className={`${baseClassName} ${className} ${pseudoFullscreen ? (isMobile ? 'fixed top-0 right-0 left-0 z-[9999] rounded-none' : 'fixed inset-0 z-[9999] rounded-none') : ''}`}
      style={panelStyle}
      onClick={onClick}
    >
      <LoadingOverlay progress={loadProgress} />
      <div className={isMobile ? 'absolute inset-0' : 'absolute inset-0'}>
        <Suspense
          fallback={
            <div className="w-full h-full flex items-center justify-center">
              {isMobile ? (
                <Icon name="view_in_ar" size={64} className="text-on-surface-variant/15 animate-pulse" />
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Icon name="view_in_ar" size={48} className="text-on-surface-variant/30 animate-pulse" />
                  <span className="text-xs text-on-surface-variant">加载 3D 模型...</span>
                </div>
              )}
            </div>
          }
        >
          <ViewerErrorBoundary
            key={`${modelUrl || 'empty'}-${viewerRetryKey}`}
            isMobile={isMobile}
            onRetry={() => {
              setLoadProgress(modelUrl ? 0 : null);
              setViewerRetryKey((key) => key + 1);
            }}
          >
            <ModelViewer
              modelUrl={modelUrl}
              viewMode={activeView}
              explodeAmount={explodeAmount}
              cameraPreset={activeCamera}
              showDimensions={showDimensions}
              showGrid={false}
              clipEnabled={clipEnabled}
              clipDirection={clipDirection}
              clipPosition={clipPosition}
              clipRange={clipRange}
              clipInverted={clipInverted}
              onClipPositionChange={onClipPositionChange}
              materialPreset={materialPreset}
              showEdges={showEdges}
              viewerSettings={viewerTuning}
              showAxis={showAxis}
              selectedPartId={selectedPartId}
              hiddenPartIds={hiddenPartIds}
              isolatedPartId={isolatedPartId}
              onPartsChange={handlePartsChange}
              onPartSelect={setSelectedPartId}
              measurementActive={measurementOpen && measureMode !== 'bounds'}
              measureMode={measureMode}
              measurementSnapMode={measurementSnapMode}
              measurementPoints={measurementOpen && measureMode !== 'bounds' ? measurementPoints : []}
              measurementRecords={measurementOpen ? measurementRecords : []}
              onMeasurePoint={handleMeasurePoint}
              onLoaded={handleViewerLoaded}
              onProgress={handleViewerProgress}
            />
          </ViewerErrorBoundary>
        </Suspense>
      </div>

      {showBackButton && onBack && (
        <button
          onClick={handleBackClick}
          className={
            variant === 'desktop'
              ? 'absolute bottom-4 left-4 z-40 inline-flex h-10 items-center gap-2 rounded-md border border-outline-variant/20 bg-surface/90 px-3 text-sm font-medium text-on-surface-variant shadow-xl backdrop-blur-xl transition-all hover:bg-surface-container-high hover:text-on-surface active:scale-[0.98]'
              : 'absolute top-2 left-2 z-40 w-8 h-8 flex items-center justify-center rounded-full micro-glass text-on-surface-variant hover:text-on-surface active:scale-90 transition-all'
          }
          aria-label={isFullscreen ? '退出全屏' : '返回上一页'}
          data-tooltip-ignore
        >
          <Icon name="arrow_back" size={18} />
          {variant === 'desktop' && <span>{isFullscreen ? '退出全屏' : '返回'}</span>}
        </button>
      )}

      <CadViewerToolbar
        variant={variant}
        isAdmin={isAdmin}
        activeView={activeView}
        onViewChange={onViewChange}
        explodeAmount={explodeAmount}
        onExplodeAmountChange={setExplodeAmount}
        onResetExplode={() => setExplodeAmount(0)}
        activeCamera={activeCamera}
        onCameraChange={onCameraChange}
        showDimensions={showDimensions}
        onToggleDimensions={onToggleDimensions}
        materialPreset={materialPreset}
        onMaterialChange={onMaterialChange}
        showEdges={showEdges}
        onToggleEdges={onToggleEdges}
        clipEnabled={clipEnabled}
        onToggleClip={onToggleClip}
        clipPosition={clipPosition}
        onClipPositionChange={onClipPositionChange}
        clipRange={clipRange}
        clipDirection={clipDirection}
        onClipDirectionChange={onClipDirectionChange}
        clipInverted={clipInverted}
        onToggleClipInverted={onToggleClipInverted}
        onResetClip={onResetClip}
        showAxis={showAxis}
        onToggleAxis={onToggleAxis}
        measurementOpen={measurementOpen}
        onToggleMeasurement={handleToggleMeasurement}
        propertiesOpen={propertiesOpen}
        onToggleProperties={handleToggleProperties}
        structureOpen={structureOpen}
        onToggleStructure={handleToggleStructure}
        partCount={parts.length}
        onResetDisplay={handleResetDisplay}
        tuningOpen={tuningOpen}
        onToggleTuning={onToggleTuning}
        onScreenshot={handleScreenshot}
        onFullscreen={handleFullscreen}
        onSetThumbnail={isAdmin ? handleSetThumbnail : undefined}
        settingThumbnail={settingThumb}
        onOpenDiagnostics={isAdmin ? () => setDiagnosticsOpen(true) : undefined}
      />

      <AnimatePresence>
        {measurementOpen && (
          <motion.div
            key="measurement-panel"
            initial={isMobile ? { opacity: 0, y: 8 } : { opacity: 0, x: 10 }}
            animate={isMobile ? { opacity: 1, y: 0 } : { opacity: 1, x: 0 }}
            exit={isMobile ? { opacity: 0, y: 8 } : { opacity: 0, x: 10 }}
          >
            <MeasurementPanel
              variant={variant}
              mode={measureMode}
              points={measurementPoints}
              records={measurementRecords}
              snapMode={measurementSnapMode}
              bounds={modelBounds}
              active={measurementOpen && measureMode !== 'bounds'}
              defaultUnit={measurementConfig.defaultUnit}
              recordLimit={measurementConfig.recordLimit}
              onModeChange={handleMeasureModeChange}
              onSnapModeChange={setMeasurementSnapMode}
              onClear={() => setMeasurementPoints([])}
              onClearRecords={() => setMeasurementRecords([])}
              onRemoveRecord={(recordId) =>
                setMeasurementRecords((records) => records.filter((record) => record.id !== recordId))
              }
              onClose={() => setMeasurementOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {propertiesOpen && (
          <motion.div
            key="model-properties-panel"
            initial={isMobile ? { opacity: 0, y: 8 } : { opacity: 0, x: -10 }}
            animate={isMobile ? { opacity: 1, y: 0 } : { opacity: 1, x: 0 }}
            exit={isMobile ? { opacity: 0, y: 8 } : { opacity: 0, x: -10 }}
          >
            <ModelPropertiesPanel
              variant={variant}
              modelName={modelName}
              modelFormat={modelFormat}
              modelFileSize={modelFileSize}
              modelCreatedAt={modelCreatedAt}
              previewMeta={currentPreviewMeta}
              bounds={modelBounds}
              parts={parts}
              selectedPartId={selectedPartId}
              onClose={() => setPropertiesOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {structureOpen && (
          <motion.div
            key="model-structure-panel"
            initial={isMobile ? { opacity: 0, y: 8 } : { opacity: 0, x: -10 }}
            animate={isMobile ? { opacity: 1, y: 0 } : { opacity: 1, x: 0 }}
            exit={isMobile ? { opacity: 0, y: 8 } : { opacity: 0, x: -10 }}
          >
            <ModelStructurePanel
              variant={variant}
              parts={parts}
              selectedPartId={selectedPartId}
              hiddenPartIds={hiddenPartIds}
              isolatedPartId={isolatedPartId}
              onSelect={setSelectedPartId}
              onToggleHidden={handleTogglePartHidden}
              onIsolate={handleIsolatePart}
              onShowAll={handleShowAllParts}
              onClose={() => setStructureOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {showAxis && (
        <ViewCube
          activeCamera={activeCamera}
          onCameraChange={onCameraChange}
          className={
            isMobile ? 'absolute bottom-2 left-2 z-10 origin-bottom-left scale-75' : 'absolute bottom-4 right-4 z-10'
          }
        />
      )}

      <AnimatePresence>
        {isAdmin && tuningOpen && (
          <motion.div
            initial={isMobile ? { opacity: 0, y: 8 } : { opacity: 0, x: 10 }}
            animate={isMobile ? { opacity: 1, y: 0 } : { opacity: 1, x: 0 }}
            exit={isMobile ? { opacity: 0, y: 8 } : { opacity: 0, x: 10 }}
            className={isMobile ? 'absolute left-3 right-12 top-3 z-50' : 'absolute top-4 right-20 z-20'}
          >
            <ViewerTuningPanel
              value={viewerTuning}
              onChange={onViewerTuningChange}
              onPreset={onApplyViewerPreset}
              onReset={onResetViewerTuning}
              onSave={onSaveViewerTuning}
              onClose={onToggleTuning}
              saving={viewerTuningSaving}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {watermark.show && (watermark.image || watermark.text) && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center gap-4 select-none">
          {watermark.image && (
            <SafeImage
              src={watermark.image}
              alt=""
              className="opacity-[0.04] select-none"
              style={{ maxWidth: '40%', maxHeight: '40%', objectFit: 'contain' }}
              fallbackClassName="hidden"
            />
          )}
          {watermark.text && (
            <div className="max-w-[70%] break-words text-center text-3xl font-semibold tracking-normal text-on-surface opacity-[0.05] md:text-5xl">
              {watermark.text}
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <PreviewDiagnosticsDialog
          open={diagnosticsOpen}
          meta={currentPreviewMeta}
          regenerating={regeneratingPreview}
          onClose={() => setDiagnosticsOpen(false)}
          onRegenerate={handleRegeneratePreview}
        />
      )}
    </div>
  );
}
