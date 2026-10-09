import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { TrackballControls as TrackballControlsImpl } from 'three-stdlib';
import { captureViewerHandover, getViewerHandover } from './viewerHandover';

/**
 * SW 看图模式的轨迹球控制器。
 *
 * OrbitControls 基于固定世界向上轴的球面坐标，spherical.makeSafe() 会把俯仰
 * 角钳制在极点前——从上往下转到一定程度必然卡住。轨迹球绕屏幕空间任意轴
 * 旋转、无极点限制，配合 cursorZoom（缩放朝光标收敛）即为 SolidWorks 式
 * 自由看图。默认模式仍用 OrbitControls，本组件仅在 SW 模式开启时挂载。
 */
export default function SwTrackballControls({
  controlsRef,
  onActiveChange,
}: {
  controlsRef?: React.RefObject<TrackballControlsImpl | null>;
  onActiveChange?: (active: boolean) => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const controls = useMemo(() => new TrackballControlsImpl(camera), [camera]);

  useEffect(() => {
    // cleanup 里会把 enabled 置 false（断掉 keyup 挂回 keydown 的路径）。
    // StrictMode（开发模式）会立即跑一遍 mount→cleanup→mount，第二遍
    // mount 时实例是同一个、enabled 仍是 false，而轨迹球所有事件处理器
    // 第一行都是 enabled 早退——不显式恢复会导致「开启 SW 后完全不能操作」
    controls.enabled = true;
    controls.connect(gl.domElement);
    // 交接快照由本组件卸载时和 CameraController（fit/预设）共同刷新，
    // 是「当前观察锚点」的单一权威来源，不会出现过期值
    const handover = getViewerHandover();
    if (handover) {
      controls.target.copy(handover.target);
      controls.minDistance = handover.minDistance;
      controls.maxDistance = handover.maxDistance;
    } else {
      // 首次开启且无任何快照：以当前视线前方一点为锚
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      controls.target.copy(camera.position).addScaledVector(forward, 5);
    }
    if (controlsRef) controlsRef.current = controls;
    onActiveChange?.(true);
    return () => {
      captureViewerHandover(controls.target, controls.minDistance, controls.maxDistance);
      if (controlsRef?.current === controls) controlsRef.current = null;
      onActiveChange?.(false);
      // 先断气再 dispose：enabled=false 让 keyup 挂回 keydown 的路径失效
      // （keydown 处理器会自移除、keyup 再挂回 window；若 dispose 时监听处于
      // 中间态，死实例会在用户下一次松键时把自己重新挂回 window，此后按
      // A/S/D 会与新控制器叠加干扰，表现为「关闭 SW 后默认模式不生效」）
      controls.enabled = false;
      controls.dispose();
    };
  }, [camera, controls, controlsRef, gl, onActiveChange]);

  useEffect(() => {
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.45;
    controls.noPan = false;
    controls.noRotate = false;
    controls.noZoom = false;
    controls.staticMoving = false;
    controls.dynamicDampingFactor = 0.15;
    controls.cursorZoom = true;

    // 修复 three-stdlib cursorZoom 的缩小「消失」bug：
    // 库内实现 this.target.lerpVectors(worldPos, this.target, factor)——缩小（factor>1）时
    // alpha 超过 1 属于外插，每格滚轮把观察锚点 target 往光标反侧外推 10% 并逐格复利发散，
    // 相机盯着越漂越远的锚点，模型滑出视锥后完全消失。这里包一层 zoomCamera：
    // 缩小时把 target 恢复为缩放前位置（等价 alpha=1，缩小不带动锚点，纯视距拉远）；
    // 放大（factor<1）时 lerp 合法，保留「朝光标收敛」的缩放体验。
    const patched = controls as unknown as {
      __origZoomCamera?: () => void;
      _zoomStart: THREE.Vector2;
      _zoomEnd: THREE.Vector2;
      _state: number;
      STATE: { TOUCH_ZOOM_PAN: number };
      _touchZoomDistanceStart: number;
      _touchZoomDistanceEnd: number;
      EPS: number;
      zoomCamera: () => void;
    };
    const original = (patched.__origZoomCamera ??= patched.zoomCamera);
    patched.zoomCamera = () => {
      // 与库内两个分支同源的缩放因子：滚轮（阻尼残差）/ 触屏捏合（起止指距比）
      const factor =
        patched._state === patched.STATE.TOUCH_ZOOM_PAN
          ? patched._touchZoomDistanceStart / patched._touchZoomDistanceEnd
          : 1 + (patched._zoomEnd.y - patched._zoomStart.y) * controls.zoomSpeed;
      const targetBefore = controls.target.clone();
      original();
      // 缩小（factor>1）或出现非有限值时把锚点拉回缩放前位置：
      // lerp 的 alpha 超 1 是外插，target 会指数漂移直到模型滑出视锥「消失」
      if (controls.cursorZoom && (!Number.isFinite(factor) || factor > 1)) {
        controls.target.copy(targetBefore);
      }
    };
  }, [controls]);

  // 修复旋转增量「按事件对消费」的丢位移——SW 模式旋转比普通模式慢的直接原因：
  // 库的 onMouseMove/touchmove 在每个指针事件里都先把 _movePrev 推进到 _moveCurr，
  // 而 update() 每帧只消费 curr−prev。两帧之间到达的 N 个指针事件里只有最后一对
  // 的位移被旋转应用，其余全部丢弃；指针事件率高于渲染帧率时（高轮询鼠标/触控板/
  // 大模型掉帧）旋转速度按比例变慢（Node 仿真实测：2 事件/帧 = 半速，4 事件/帧 =
  // 1/4 速）。默认模式的 OrbitControls 里 sphericalDelta 跨事件累加，没有此问题。
  // 修复 = 旋转态只推进 curr，prev 交给 rotateCamera 消费完当帧增量后自行推进；
  // 平移/缩放走「Start 每帧收敛 15% 残差」的累积语义，实测不丢增量，保持库原路径。
  useEffect(() => {
    const patched = controls as unknown as {
      __origOnMouseMove?: (event: { pageX: number; pageY: number }) => void;
      __origTouchMove?: (event: TouchEvent) => void;
      _keyState: number;
      _state: number;
      STATE: { NONE: number; ROTATE: number };
      _moveCurr: THREE.Vector2;
      getMouseOnCircle: (pageX: number, pageY: number) => THREE.Vector2;
      onMouseMove: (event: { pageX: number; pageY: number }) => void;
      touchmove: (event: TouchEvent) => void;
    };
    const isRotateActive = () =>
      (patched._keyState !== patched.STATE.NONE ? patched._keyState : patched._state) === patched.STATE.ROTATE;

    // 鼠标路径：pointermove 监听在 onPointerMove 里动态查 this.onMouseMove，覆盖属性即生效
    const origMouseMove = (patched.__origOnMouseMove ??= patched.onMouseMove);
    patched.onMouseMove = (event) => {
      if (!controls.enabled) return;
      if (isRotateActive() && !controls.noRotate) {
        patched._moveCurr.copy(patched.getMouseOnCircle(event.pageX, event.pageY));
        return;
      }
      origMouseMove(event);
    };

    // 触屏路径：touchmove 监听在 connect() 时按函数引用注册，覆盖属性后必须重绑。
    // dispose() 移除的是当前属性值（即包装器），卸载清理路径不受影响
    const origTouchMove = (patched.__origTouchMove ??= patched.touchmove);
    patched.touchmove = (event) => {
      if (!controls.enabled) return;
      if (event.touches.length === 1 && isRotateActive() && !controls.noRotate) {
        patched._moveCurr.copy(patched.getMouseOnCircle(event.touches[0].pageX, event.touches[0].pageY));
        return;
      }
      origTouchMove(event);
    };
    gl.domElement.removeEventListener('touchmove', origTouchMove);
    gl.domElement.addEventListener('touchmove', patched.touchmove);
    return () => {
      gl.domElement.removeEventListener('touchmove', patched.touchmove);
      gl.domElement.addEventListener('touchmove', origTouchMove);
    };
  }, [controls, gl]);

  // 旋转灵敏度对齐默认模式（OrbitControls）：
  //   Orbit: 每像素弧度 = rotateSpeed(0.8) × 2π / canvasHeight
  //   轨迹球: 每像素弧度 = rotateSpeed / (canvasWidth / 2)
  // 两者相等 → 轨迹球 rotateSpeed = 0.8 × 2π × (width/2) / height。
  // 轨迹球的位移量纲是归一化圆坐标（除以 screen.width/2），与像素和画布宽高
  // 相关，写死常数会导致横竖屏/窗口缩放后灵敏度漂移，故随尺寸重算。
  const ORBIT_ROTATE_SPEED = 0.8; // 与 ModelViewer 里 OrbitControls 的 rotateSpeed 保持一致
  useEffect(() => {
    const syncSensitivity = () => {
      const height = gl.domElement.clientHeight || 1;
      const halfWidth = gl.domElement.clientWidth / 2 || height;
      controls.rotateSpeed = ORBIT_ROTATE_SPEED * Math.PI * 2 * (halfWidth / height);
    };
    syncSensitivity();
    const canvas = gl.domElement;
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(syncSensitivity);
      observer.observe(canvas);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', syncSensitivity);
    return () => window.removeEventListener('resize', syncSensitivity);
  }, [controls, gl]);

  // OrbitControls 不需要手动 resize（读 getBoundingClientRect），TrackballControls
  // 依赖 screen 尺寸换算鼠标坐标，canvas 尺寸变化（容器伸缩/进入全屏）必须重算
  useEffect(() => {
    const refresh = () => controls.handleResize();
    refresh();
    const canvas = gl.domElement;
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(refresh);
      observer.observe(canvas);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', refresh);
    return () => window.removeEventListener('resize', refresh);
  }, [controls, gl]);

  useFrame(() => {
    if (controls.enabled) controls.update();
  }, -1);

  return null;
}
