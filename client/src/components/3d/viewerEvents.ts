import * as THREE from 'three';

export const MODEL_BOUNDS_EVENT = 'model-bounds';
export const FIT_MODEL_EVENT = 'model-fit';

export interface ModelBoundsDetail {
  center: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  maxDim: number;
  radius: number;
}

export interface ModelPartItem {
  id: string;
  name: string;
  path: string;
  vertexCount: number;
  triangleCount: number;
}

export type MeasureMode = 'distance' | 'angle' | 'diameter' | 'bounds';
export type MeasurementSnapMode = 'surface' | 'edge' | 'vertex';

export interface MeasurementPoint {
  x: number;
  y: number;
  z: number;
  snap?: MeasurementSnapMode;
}

export interface MeasurementRecord {
  id: string;
  mode: Exclude<MeasureMode, 'bounds'>;
  points: MeasurementPoint[];
  createdAt: number;
}

export function getModelBounds(object: THREE.Object3D): ModelBoundsDetail | null {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim <= 0) return null;

  return {
    center: { x: center.x, y: center.y, z: center.z },
    size: { x: size.x, y: size.y, z: size.z },
    maxDim,
    radius: Math.max(size.length() / 2, maxDim / 2, 0.001),
  };
}

export function dispatchModelBounds(detail: ModelBoundsDetail) {
  window.dispatchEvent(new CustomEvent<ModelBoundsDetail>(MODEL_BOUNDS_EVENT, { detail }));
}

export function dispatchFitModel() {
  window.dispatchEvent(new Event(FIT_MODEL_EVENT));
}

export function centeredBoxFromBounds(detail: ModelBoundsDetail): THREE.Box3 {
  const half = new THREE.Vector3(detail.size.x / 2, detail.size.y / 2, detail.size.z / 2);
  return new THREE.Box3(half.clone().multiplyScalar(-1), half);
}
