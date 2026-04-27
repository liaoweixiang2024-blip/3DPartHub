import { lazy, Suspense } from "react";
import * as THREE from "three";
import { get3DMaterialConfig } from "../../lib/publicSettings";

const Canvas = lazy(() =>
  import("@react-three/fiber").then((m) => ({ default: m.Canvas }))
);

const Scene = lazy(() => import("./Scene"));
const CameraController = lazy(() => import("./CameraController"));
const MultiFormatLoader = lazy(() => import("./MultiFormatLoader"));
const OrbitControls = lazy(() =>
  import("@react-three/drei").then((m) => ({ default: m.OrbitControls }))
);

export type ViewMode = "solid" | "wireframe" | "transparent" | "explode";
export type CameraPreset = "front" | "side" | "iso" | "top";

interface ModelViewerProps {
  modelUrl?: string;
  viewMode: ViewMode;
  cameraPreset: CameraPreset;
  showDimensions: boolean;
  showGrid: boolean;
  clipEnabled: boolean;
  clipDirection: "x" | "y" | "z";
  clipPosition: number;
  materialPreset: "metal" | "plastic" | "glass" | "default";
  showAxis?: boolean;
  viewportBottom?: number;
  onLoaded?: () => void;
  onProgress?: (progress: number) => void;
}

// Suppress known Three.js deprecation warnings from R3F internals
const origWarn = console.warn;
const suppressedPatterns = [
  "THREE.Clock: This module has been deprecated",
  "PCFSoftShadowMap has been deprecated",
];
console.warn = (...args: any[]) => {
  const msg = typeof args[0] === "string" ? args[0] : "";
  if (suppressedPatterns.some((p) => msg.includes(p))) return;
  origWarn.apply(console, args);
};

export default function ModelViewer({
  modelUrl,
  viewMode,
  cameraPreset,
  showDimensions,
  showGrid,
  clipEnabled,
  clipDirection,
  clipPosition,
  materialPreset,
  showAxis = true,
  viewportBottom,
  onLoaded,
}: ModelViewerProps) {
  const config = get3DMaterialConfig().viewer;

  return (
    <Canvas
      gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: config.exposure, localClippingEnabled: true }}
      camera={{ position: [5, 3, 5], fov: 45, near: 0.01, far: 100000 }}
      dpr={[1, 2]}
      style={{ background: config.bgColor }}
    >
      <Suspense fallback={null}>
        <Scene showGrid={showGrid} showAxis={showAxis} />
        <CameraController preset={cameraPreset} viewportBottom={viewportBottom} />
        <OrbitControls
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
            showDimensions={showDimensions}
            clipEnabled={clipEnabled}
            clipDirection={clipDirection}
            clipPosition={clipPosition}
            materialPreset={materialPreset}
            onLoaded={onLoaded}
          />
        )}
      </Suspense>
    </Canvas>
  );
}
