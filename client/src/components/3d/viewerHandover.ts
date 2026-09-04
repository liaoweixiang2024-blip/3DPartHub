import * as THREE from 'three';

/**
 * 控制器交接快照（单一权威状态）。
 *
 * SW 模式切换是同一次 commit 内「卸载 OrbitControls + 挂载轨迹球」：
 * 旧实例的 ref 会在新实例 effect 运行前被 React 置空，直接读
 * controlsRef.current 拿不到旧观察锚点。这里维护一份模块级快照，
 * 由 SwTrackballControls（卸载时）与 CameraController（fit / 相机预设 /
 * 模型加载等一切会改锚点的路径）共同写入，任何一侧挂载时读取衔接。
 *
 * 快照只含「锚点语义」的三个量：观察中心 target 与 min/maxDistance。
 * 相机位置/向上轴绝不由快照恢复——那两个由 OrbitControls 的球面状态
 * 天然持有，且轨迹球旋转会连续改动 camera.up，写进快照反而会拿到
 * 旋转中间态的倾斜 up，切回时旋转手感就变了。
 */
export interface ViewerHandover {
  target: THREE.Vector3;
  minDistance: number;
  maxDistance: number;
}

let handover: ViewerHandover | null = null;

/** 写入当前锚点（值拷贝，调用后与控制器实例解耦）。 */
export function captureViewerHandover(target: THREE.Vector3, minDistance: number, maxDistance: number): void {
  handover = {
    target: target.clone(),
    minDistance,
    maxDistance,
  };
}

/** 读取最近一次锚点快照；从未写入过返回 null。 */
export function getViewerHandover(): ViewerHandover | null {
  return handover;
}
