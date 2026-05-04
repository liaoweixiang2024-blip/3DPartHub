import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { get3DMaterialConfig, type ViewerSettingsOverride } from '../../lib/publicSettings';
import type { MaterialPresetKey } from './viewerControls';
import type {
  MeasureMode,
  MeasurementPoint,
  MeasurementRecord,
  MeasurementSnapMode,
  ModelPartItem,
} from './viewerEvents';

const Canvas = lazy(() => import('@react-three/fiber').then((m) => ({ default: m.Canvas })));

const Scene = lazy(() => import('./Scene'));
const CameraController = lazy(() => import('./CameraController'));
const MultiFormatLoader = lazy(() => import('./MultiFormatLoader'));
const RendererExposure = lazy(() => import('./RendererExposure'));
const OrbitControls = lazy(() => import('@react-three/drei').then((m) => ({ default: m.OrbitControls })));

export type ViewMode = 'solid' | 'wireframe' | 'transparent' | 'explode';
export type CameraPreset = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso';

interface ModelViewerProps {
  modelUrl?: string;
  viewMode: ViewMode;
  explodeAmount?: number;
  cameraPreset: CameraPreset;
  showDimensions: boolean;
  showGrid: boolean;
  clipEnabled: boolean;
  clipDirection: 'x' | 'y' | 'z';
  clipPosition: number;
  clipRange?: { min: number; max: number; step: number };
  clipInverted?: boolean;
  onClipPositionChange?: (position: number) => void;
  materialPreset: MaterialPresetKey;
  showEdges: boolean;
  showAxis?: boolean;
  viewportBottom?: number;
  viewerSettings?: ViewerSettingsOverride;
  selectedPartId?: string | null;
  hiddenPartIds?: string[];
  isolatedPartId?: string | null;
  onPartsChange?: (parts: ModelPartItem[]) => void;
  onPartSelect?: (partId: string | null) => void;
  measurementActive?: boolean;
  measureMode?: MeasureMode;
  measurementSnapMode?: MeasurementSnapMode;
  measurementPoints?: MeasurementPoint[];
  measurementRecords?: MeasurementRecord[];
  onMeasurePoint?: (point: MeasurementPoint) => void;
  onLoaded?: () => void;
  onProgress?: (progress: number) => void;
}

const suppressedWarnPatterns = ['THREE.Clock: This module has been deprecated', 'PCFSoftShadowMap has been deprecated'];

export default function ModelViewer({
  modelUrl,
  viewMode,
  explodeAmount = 1,
  cameraPreset,
  showDimensions,
  showGrid,
  clipEnabled,
  clipDirection,
  clipPosition,
  clipRange,
  clipInverted,
  onClipPositionChange,
  materialPreset,
  showEdges,
  showAxis = false,
  viewportBottom,
  viewerSettings,
  selectedPartId,
  hiddenPartIds,
  isolatedPartId,
  onPartsChange,
  onPartSelect,
  measurementActive,
  measureMode,
  measurementSnapMode,
  measurementPoints,
  measurementRecords,
  onMeasurePoint,
  onLoaded,
  onProgress,
}: ModelViewerProps) {
  const config = get3DMaterialConfig(viewerSettings).viewer;
  const controlsRef = useRef<any>(null);
  const interactionEndTimerRef = useRef<number | null>(null);
  const controlsInteractingRef = useRef(false);
  const [controlsInteracting, setControlsInteracting] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  function contextLostHandler(e: Event) {
    e.preventDefault();
    setContextLost(true);
  }
  function contextRestoredHandler() {
    setContextLost(false);
  }

  const cleanupContextListeners = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.removeEventListener('webglcontextlost', contextLostHandler);
    canvas.removeEventListener('webglcontextrestored', contextRestoredHandler);
    canvasRef.current = null;
  }, []);

  const markControlsInteracting = useCallback(() => {
    if (interactionEndTimerRef.current) {
      window.clearTimeout(interactionEndTimerRef.current);
      interactionEndTimerRef.current = null;
    }
    if (!controlsInteractingRef.current) {
      controlsInteractingRef.current = true;
      setControlsInteracting(true);
    }
    interactionEndTimerRef.current = window.setTimeout(() => {
      controlsInteractingRef.current = false;
      setControlsInteracting(false);
      interactionEndTimerRef.current = null;
    }, 360);
  }, []);

  useEffect(() => {
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      if (suppressedWarnPatterns.some((p) => msg.includes(p))) return;
      origWarn.apply(console, args);
    };
    return () => {
      console.warn = origWarn;
    };
  }, []);

  useEffect(
    () => () => {
      if (interactionEndTimerRef.current) window.clearTimeout(interactionEndTimerRef.current);
      cleanupContextListeners();
    },
    [cleanupContextListeners],
  );

  return contextLost ? (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1a1a2e',
        color: '#94a3b8',
        gap: 12,
      }}
    >
      <div style={{ fontSize: 14 }}>GPU 上下文丢失，请点击刷新</div>
      <button
        onClick={() => setContextLost(false)}
        style={{
          padding: '8px 20px',
          borderRadius: 6,
          background: '#3b82f6',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          fontSize: 14,
        }}
      >
        重新加载
      </button>
    </div>
  ) : (
    <Canvas
      gl={{
        preserveDrawingBuffer: true,
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: config.exposure,
        localClippingEnabled: true,
      }}
      camera={{ position: [5, 3, 5], fov: 45, near: 0.01, far: 100000 }}
      dpr={[1, 2]}
      style={{ background: config.bgColor }}
      onCreated={({ gl }) => {
        const canvas = gl.domElement;
        cleanupContextListeners();
        canvasRef.current = canvas;
        canvas.addEventListener('webglcontextlost', contextLostHandler);
        canvas.addEventListener('webglcontextrestored', contextRestoredHandler);
      }}
    >
      <Suspense fallback={null}>
        <RendererExposure exposure={config.exposure} />
        <Scene showGrid={showGrid} showAxis={showAxis} viewerSettings={viewerSettings} />
        <CameraController preset={cameraPreset} viewportBottom={viewportBottom} controlsRef={controlsRef} />
        <OrbitControls
          ref={controlsRef}
          onStart={markControlsInteracting}
          onChange={markControlsInteracting}
          onEnd={markControlsInteracting}
          enableDamping
          dampingFactor={0.15}
          rotateSpeed={0.8}
          zoomSpeed={1.2}
          minDistance={0.1}
          maxDistance={100000}
          enablePan
        />
        {modelUrl && (
          <MultiFormatLoader
            url={modelUrl}
            viewMode={viewMode}
            explodeAmount={explodeAmount}
            showDimensions={showDimensions}
            clipEnabled={clipEnabled}
            clipDirection={clipDirection}
            clipPosition={clipPosition}
            clipRange={clipRange}
            clipInverted={clipInverted}
            onClipPositionChange={onClipPositionChange}
            materialPreset={materialPreset}
            showEdges={showEdges && !controlsInteracting}
            viewerSettings={viewerSettings}
            selectedPartId={selectedPartId}
            hiddenPartIds={hiddenPartIds}
            isolatedPartId={isolatedPartId}
            onPartsChange={onPartsChange}
            onPartSelect={onPartSelect}
            measurementActive={measurementActive}
            measureMode={measureMode}
            measurementSnapMode={measurementSnapMode}
            measurementPoints={measurementPoints}
            measurementRecords={measurementRecords}
            onMeasurePoint={onMeasurePoint}
            onLoaded={onLoaded}
            onProgress={onProgress}
          />
        )}
      </Suspense>
    </Canvas>
  );
}
