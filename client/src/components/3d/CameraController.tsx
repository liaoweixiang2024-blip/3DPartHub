import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl, TrackballControls as TrackballControlsImpl } from 'three-stdlib';
import type { CameraPreset } from './ModelViewer';
import { FIT_MODEL_EVENT, MODEL_BOUNDS_EVENT, type ModelBoundsDetail } from './viewerEvents';
import { captureViewerHandover, getViewerHandover } from './viewerHandover';

// SW 模式会换装轨迹球控制器；这里只用到 target / min·maxDistance / change 事件，
// 两种实例的联合类型即可覆盖
type ViewerControls = OrbitControlsImpl | TrackballControlsImpl;

interface CamPreset {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up?: THREE.Vector3;
}

const defaultPresets: Record<CameraPreset, CamPreset> = {
  front: { position: new THREE.Vector3(0, 0, 5), target: new THREE.Vector3(0, 0, 0) },
  back: { position: new THREE.Vector3(0, 0, -5), target: new THREE.Vector3(0, 0, 0) },
  left: { position: new THREE.Vector3(-5, 0, 0), target: new THREE.Vector3(0, 0, 0) },
  right: { position: new THREE.Vector3(5, 0, 0), target: new THREE.Vector3(0, 0, 0) },
  iso: { position: new THREE.Vector3(5, 3, 5), target: new THREE.Vector3(0, 0, 0) },
  top: { position: new THREE.Vector3(0, 5, 0), target: new THREE.Vector3(0, 0, 0), up: new THREE.Vector3(0, 0, -1) },
  bottom: { position: new THREE.Vector3(0, -5, 0), target: new THREE.Vector3(0, 0, 0), up: new THREE.Vector3(0, 0, 1) },
};

export default function CameraController({
  preset,
  viewportBottom = 0,
  controlsRef,
}: {
  preset: CameraPreset;
  viewportBottom?: number;
  controlsRef?: MutableRefObject<ViewerControls | null>;
}) {
  const { camera, gl } = useThree();
  const modelDataRef = useRef<ModelBoundsDetail | null>(null);
  const presetsRef = useRef<Record<CameraPreset, CamPreset>>(defaultPresets);

  const updateCameraClipping = useCallback(
    (detail: ModelBoundsDetail, targetOverride?: THREE.Vector3) => {
      const perspective = camera as THREE.PerspectiveCamera;
      const target =
        targetOverride ||
        controlsRef?.current?.target ||
        new THREE.Vector3(detail.center.x, detail.center.y, detail.center.z);
      const radius = Math.max(detail.radius || detail.maxDim / 2, detail.maxDim / 2, 0.001);
      const cameraDistance = Math.max(perspective.position.distanceTo(target), radius * 1.05);
      const surfaceGap = Math.max(cameraDistance - radius, radius * 0.02, 0.001);
      const desiredNear = Math.max(radius / 100, cameraDistance / 500, 0.001);
      const near = Math.max(Math.min(desiredNear, surfaceGap * 0.5), 0.0001);
      const far = Math.max(cameraDistance + radius * 2.5, radius * 4, near * 100);

      if (Math.abs(perspective.near - near) > near * 0.05 || Math.abs(perspective.far - far) > far * 0.05) {
        perspective.near = near;
        perspective.far = far;
        perspective.updateProjectionMatrix();
      }
    },
    [camera, controlsRef],
  );

  const applyPreset = useCallback(
    (p: CamPreset) => {
      camera.position.copy(p.position);
      camera.up.copy(p.up || new THREE.Vector3(0, 1, 0));
      camera.lookAt(p.target);
      if (controlsRef?.current) {
        controlsRef.current.target.copy(p.target);
        controlsRef.current.update();
      }
      // 相机预设会把锚点拉回模型中心，同步刷新交接快照，
      // 保证随后开启 SW 时轨迹球瞄在当前预设中心而不是旧位置
      captureViewerHandover(
        p.target.clone(),
        controlsRef?.current?.minDistance ?? 0.01,
        controlsRef?.current?.maxDistance ?? 100000,
      );
    },
    [camera, controlsRef],
  );

  const buildPresets = useCallback((center: THREE.Vector3, distance: number) => {
    presetsRef.current = {
      front: {
        position: new THREE.Vector3(center.x, center.y, center.z + distance),
        target: center.clone(),
      },
      back: {
        position: new THREE.Vector3(center.x, center.y, center.z - distance),
        target: center.clone(),
      },
      left: {
        position: new THREE.Vector3(center.x - distance, center.y, center.z),
        target: center.clone(),
      },
      right: {
        position: new THREE.Vector3(center.x + distance, center.y, center.z),
        target: center.clone(),
      },
      iso: {
        position: new THREE.Vector3(center.x + distance * 0.62, center.y + distance * 0.42, center.z + distance * 0.62),
        target: center.clone(),
      },
      top: {
        position: new THREE.Vector3(center.x, center.y + distance, center.z),
        target: center.clone(),
        up: new THREE.Vector3(0, 0, -1),
      },
      bottom: {
        position: new THREE.Vector3(center.x, center.y - distance, center.z),
        target: center.clone(),
        up: new THREE.Vector3(0, 0, 1),
      },
    };
  }, []);

  const applyCamera = useCallback(
    (detail: ModelBoundsDetail) => {
      const center = new THREE.Vector3(detail.center.x, detail.center.y, detail.center.z);
      const perspective = camera as THREE.PerspectiveCamera;
      const verticalFov = ((perspective.fov || 45) * Math.PI) / 180;
      const aspect =
        gl.domElement.clientWidth > 0 && gl.domElement.clientHeight > 0
          ? gl.domElement.clientWidth / gl.domElement.clientHeight
          : perspective.aspect || 1;
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
      const fitFov = Math.max(0.1, Math.min(verticalFov, horizontalFov));
      const radius = Math.max(detail.radius || detail.maxDim / 2, 0.001);
      let distance = (radius / Math.sin(fitFov / 2)) * 1.25;

      if (viewportBottom > 0) {
        const canvasHeight = gl.domElement.clientHeight;
        if (canvasHeight > 0 && canvasHeight > viewportBottom) {
          const ratio = canvasHeight / (canvasHeight - viewportBottom);
          distance *= ratio;
          center.y += (viewportBottom / canvasHeight) * distance * Math.tan(verticalFov / 2);
        }
      }

      if (controlsRef?.current) {
        controlsRef.current.minDistance = Math.max(detail.maxDim * 0.002, 0.01);
        controlsRef.current.maxDistance = Math.max(detail.maxDim * 30, distance * 12, 100);
        controlsRef.current.target.copy(center);
        controlsRef.current.update();
        captureViewerHandover(center.clone(), controlsRef.current.minDistance, controlsRef.current.maxDistance);
      }

      buildPresets(center, distance);
      applyPreset(presetsRef.current[preset]);
      updateCameraClipping(detail, center);
    },
    [applyPreset, buildPresets, camera, controlsRef, gl, preset, updateCameraClipping, viewportBottom],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ModelBoundsDetail>).detail;
      modelDataRef.current = detail;
      applyCamera(detail);
    };
    window.addEventListener(MODEL_BOUNDS_EVENT, handler);
    return () => window.removeEventListener(MODEL_BOUNDS_EVENT, handler);
  }, [applyCamera]);

  useEffect(() => {
    const handler = () => {
      if (modelDataRef.current) applyCamera(modelDataRef.current);
    };
    window.addEventListener(FIT_MODEL_EVENT, handler);
    return () => window.removeEventListener(FIT_MODEL_EVENT, handler);
  }, [applyCamera]);

  useEffect(() => {
    if (modelDataRef.current) applyCamera(modelDataRef.current);
  }, [applyCamera]);

  useEffect(() => {
    applyPreset(presetsRef.current[preset]);
    if (modelDataRef.current) updateCameraClipping(modelDataRef.current);
  }, [applyPreset, preset, updateCameraClipping]);

  // SW 模式开启/关闭会把 controlsRef.current 换成另一种控制器实例：
  // 1) 感知实例更换后重新挂 change 监听（近端/远端裁剪面跟随相机距离）
  // 2) 新实例是全新对象（默认 target/距离限制），必须把当前相机状态
  //    （位置 + 向上轴 + 预设 + 动态距离限制）重新灌入，否则视角跳回原点
  const controlsInstanceRef = useRef<ViewerControls | null>(null);
  const [controlsTick, setControlsTick] = useState(0);
  useEffect(() => {
    let frameId = 0;
    let detach: (() => void) | undefined;
    const attach = () => {
      const controls = controlsRef?.current;
      if (!controls?.addEventListener) {
        frameId = window.requestAnimationFrame(attach);
        return;
      }
      if (controls !== controlsInstanceRef.current) {
        controlsInstanceRef.current = controls;
        // 只灌「锚点语义」的量：观察中心 + 距离限制（来自单一权威快照）。
        // 绝不在这里 applyPreset——那会把相机位置/向上轴拽回预设视角，
        // 用户再开 SW 的瞬间视角跳变、旋转手感突变（轨迹球的旋转轴由
        // camera.up 参与计算，倾斜的 up 会让拖拽方向和鼠标方向对不上）
        const handover = getViewerHandover();
        if (handover) {
          controls.target.copy(handover.target);
          controls.minDistance = handover.minDistance;
          controls.maxDistance = handover.maxDistance;
        } else if (modelDataRef.current) {
          controls.target.set(
            modelDataRef.current.center.x,
            modelDataRef.current.center.y,
            modelDataRef.current.center.z,
          );
          controls.minDistance = Math.max(modelDataRef.current.maxDim * 0.002, 0.01);
          controls.maxDistance = Math.max(modelDataRef.current.maxDim * 30, 100);
        }
        setControlsTick((tick) => tick + 1);
        return;
      }
      const handler = () => {
        if (modelDataRef.current) updateCameraClipping(modelDataRef.current);
      };
      controls.addEventListener('change', handler);
      detach = () => controls.removeEventListener?.('change', handler);
    };

    frameId = window.requestAnimationFrame(attach);
    return () => {
      window.cancelAnimationFrame(frameId);
      detach?.();
    };
    // controlsTick 变化 = 控制器实例已更换，重挂监听
  }, [controlsRef, updateCameraClipping, controlsTick]);

  return null;
}
