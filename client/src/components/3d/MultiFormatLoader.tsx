import { useCallback, useMemo, useEffect, useState, useRef } from "react";
import { Html } from "@react-three/drei";
import { useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadCadFromUrl } from "./StepLoader";
import type { ViewMode } from "./ModelViewer";
import { centeredBoxFromBounds, dispatchModelBounds, getModelBounds, type MeasureMode, type MeasurementPoint, type MeasurementRecord, type MeasurementSnapMode, type ModelBoundsDetail, type ModelPartItem } from "./viewerEvents";
import type { MaterialPresetKey } from "./viewerControls";
import Icon from "../../components/shared/Icon";
import { get3DMaterialConfig, getPublicSettingsSnapshot, type MaterialPresetConfig, type ViewerSettingsOverride } from "../../lib/publicSettings";

interface MultiFormatLoaderProps {
  url: string;
  viewMode: ViewMode;
  explodeAmount?: number;
  showDimensions: boolean;
  clipEnabled: boolean;
  clipDirection: "x" | "y" | "z";
  clipPosition: number;
  clipRange?: { min: number; max: number; step: number };
  clipInverted?: boolean;
  onClipPositionChange?: (position: number) => void;
  materialPreset: MaterialPresetKey;
  showEdges: boolean;
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

// Generate a professional environment map for metallic reflections
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
let _envMap: THREE.Texture | null = null;
function getEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (_envMap) return _envMap;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const roomEnv = new RoomEnvironment();
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x888888);
  envScene.add(roomEnv);
  _envMap = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  return _envMap;
}

type RenderMaterialPresetKey = Exclude<MaterialPresetKey, "original">;
type MeshMaterial = THREE.Material | THREE.Material[];
type WireframeCapableMaterial = THREE.Material & { wireframe?: boolean };

function createMaterial(preset: RenderMaterialPresetKey, renderer?: THREE.WebGLRenderer, viewerSettings?: ViewerSettingsOverride): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  const config = get3DMaterialConfig(viewerSettings);
  const p: MaterialPresetConfig = config.presets[preset] || config.presets.default;
  const envMap = renderer ? getEnvMap(renderer) : undefined;
  if (preset === "glass") {
    const glassProps: THREE.MeshPhysicalMaterialParameters = {
      color: p.color,
      metalness: p.metalness,
      roughness: p.roughness,
      transmission: p.transmission ?? 0.95,
      thickness: p.thickness ?? 0.5,
      ior: p.ior ?? 1.5,
      envMapIntensity: p.envMapIntensity,
    };
    if (envMap) glassProps.envMap = envMap;
    return new THREE.MeshPhysicalMaterial(glassProps);
  }
  const baseProps: THREE.MeshStandardMaterialParameters = {
    color: p.color,
    metalness: p.metalness,
    roughness: p.roughness,
    envMapIntensity: p.envMapIntensity,
  };
  if (preset === "metal" && envMap) {
    baseProps.envMap = envMap;
  }
  return new THREE.MeshStandardMaterial(baseProps);
}

function cloneMeshMaterial(material: MeshMaterial): MeshMaterial {
  return Array.isArray(material)
    ? material.map((item) => item.clone())
    : material.clone();
}

function forEachMeshMaterial(material: MeshMaterial, callback: (item: THREE.Material) => void) {
  if (Array.isArray(material)) {
    material.forEach(callback);
    return;
  }
  callback(material);
}

function materialSignatureForPreset(preset: MaterialPresetKey, viewerSettings?: ViewerSettingsOverride) {
  if (preset === "original") return "original";
  return JSON.stringify(get3DMaterialConfig(viewerSettings).presets[preset]);
}

function ensureOriginalMaterial(mesh: THREE.Mesh) {
  if (!mesh.userData.originalMaterial) {
    mesh.userData.originalMaterial = cloneMeshMaterial(mesh.material as MeshMaterial);
  }
}

function rememberDisplayState(material: THREE.Material) {
  if (material.userData.cadDisplayBase) return;
  material.userData.cadDisplayBase = {
    opacity: material.opacity,
    side: material.side,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
  };
}

function applyDisplayState(material: MeshMaterial, viewMode: ViewMode, clippingPlanes: THREE.Plane[], clipEnabled: boolean) {
  forEachMeshMaterial(material, (item) => {
    rememberDisplayState(item);
    const base = item.userData.cadDisplayBase as {
      opacity: number;
      side: THREE.Side;
      transparent: boolean;
      depthWrite: boolean;
    };
    const displayMaterial = item as WireframeCapableMaterial;

    item.clippingPlanes = clippingPlanes;
    item.side = clipEnabled ? THREE.DoubleSide : base.side;

    if (viewMode === "wireframe") {
      displayMaterial.wireframe = true;
      item.transparent = base.transparent;
      item.opacity = base.opacity;
      item.depthWrite = base.depthWrite;
    } else if (viewMode === "transparent") {
      displayMaterial.wireframe = false;
      item.transparent = true;
      item.opacity = Math.min(base.opacity, 0.32);
      item.depthWrite = false;
    } else {
      displayMaterial.wireframe = false;
      item.transparent = base.transparent;
      item.opacity = base.opacity;
      item.depthWrite = base.depthWrite;
    }

    item.needsUpdate = true;
  });
}

function applyMaterialPreset(
  mesh: THREE.Mesh,
  materialPreset: MaterialPresetKey,
  materialSignature: string,
  baseMaterial: THREE.Material | null
) {
  ensureOriginalMaterial(mesh);
  if (mesh.userData._matPreset === materialPreset && mesh.userData._matSignature === materialSignature) return;

  if (materialPreset === "original") {
    mesh.material = cloneMeshMaterial(mesh.userData.originalMaterial as MeshMaterial);
  } else if (baseMaterial) {
    mesh.material = baseMaterial.clone();
  }

  mesh.userData._matPreset = materialPreset;
  mesh.userData._matSignature = materialSignature;
}

function getModelFormat(url: string): string {
  const cleanUrl = url.split(/[?#]/)[0];
  const ext = cleanUrl.split(".").pop()?.toLowerCase() || "";
  return ext;
}

const CAD_FORMATS = new Set(["step", "stp", "iges", "igs"]);
const EDGE_THRESHOLD_ANGLE = 28;
const EDGE_VERTEX_LIMIT = 700000;

function getEdgeOverlaySettings() {
  const settings = getPublicSettingsSnapshot();
  return {
    thresholdAngle: Math.max(1, Math.min(89, Number(settings.viewer_edge_threshold_angle) || EDGE_THRESHOLD_ANGLE)),
    vertexLimit: Math.max(0, Math.floor(Number(settings.viewer_edge_vertex_limit) || EDGE_VERTEX_LIMIT)),
  };
}

function centeredDetail(detail: ModelBoundsDetail): ModelBoundsDetail {
  return {
    ...detail,
    center: { x: 0, y: 0, z: 0 },
  };
}

function syncEdgeOverlay(mesh: THREE.Mesh, visible: boolean, clippingPlanes: THREE.Plane[]) {
  let overlay = mesh.userData.edgeOverlay as THREE.LineSegments | undefined;
  if (!overlay && visible) {
    const vertexCount = mesh.geometry.getAttribute("position")?.count || 0;
    const edgeSettings = getEdgeOverlaySettings();
    if (edgeSettings.vertexLimit > 0 && vertexCount > edgeSettings.vertexLimit) {
      mesh.userData.edgeOverlaySkipped = true;
      return;
    }

    const edgeGeometry = new THREE.EdgesGeometry(mesh.geometry, edgeSettings.thresholdAngle);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x26313a,
      transparent: true,
      opacity: 0.28,
      depthTest: false,
      depthWrite: false,
    });
    overlay = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    overlay.name = "__cad_feature_edges";
    overlay.renderOrder = 8;
    mesh.add(overlay);
    mesh.userData.edgeOverlay = overlay;
  }

  if (!overlay) return;
  overlay.visible = visible;
  const material = overlay.material as THREE.LineBasicMaterial;
  material.clippingPlanes = clippingPlanes;
  material.needsUpdate = true;
}

function findPartMesh(object: THREE.Object3D | null): THREE.Mesh | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current instanceof THREE.Mesh && current.userData.partId) return current;
    current = current.parent;
  }
  return null;
}

function meshPath(mesh: THREE.Mesh) {
  const names: string[] = [];
  let current: THREE.Object3D | null = mesh;
  while (current) {
    if (current.name && !current.name.startsWith("__")) names.unshift(current.name);
    current = current.parent;
  }
  return names.join(" / ");
}

function cleanPartName(value: string | undefined, index: number) {
  const clean = value?.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return clean || `零件 ${index + 1}`;
}

function partNameForMesh(mesh: THREE.Mesh, index: number) {
  if (mesh.name) return cleanPartName(mesh.name, index);
  let parent = mesh.parent;
  while (parent) {
    if (parent.name && !parent.name.startsWith("__")) return cleanPartName(parent.name, index);
    parent = parent.parent;
  }
  return cleanPartName(undefined, index);
}

function collectModelParts(root: THREE.Object3D): ModelPartItem[] {
  const parts: ModelPartItem[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const position = child.geometry?.getAttribute("position");
    if (!position?.count) return;

    if (!child.userData.partId) child.userData.partId = child.uuid;
    const index = parts.length;
    const triangleCount = child.geometry.index
      ? Math.floor(child.geometry.index.count / 3)
      : Math.floor(position.count / 3);
    const name = partNameForMesh(child, index);
    child.userData.partName = name;

    parts.push({
      id: child.userData.partId,
      name,
      path: meshPath(child) || name,
      vertexCount: position.count,
      triangleCount,
    });
  });
  return parts;
}

function syncSelectionOverlay(mesh: THREE.Mesh, _selected: boolean, clippingPlanes: THREE.Plane[]) {
  const overlay = mesh.userData.selectionOverlay as THREE.LineSegments | undefined;
  if (!overlay) return;
  overlay.visible = false;
  const material = overlay.material as THREE.LineBasicMaterial;
  material.clippingPlanes = clippingPlanes;
  material.needsUpdate = true;
}

function syncPartState(
  root: THREE.Object3D,
  hiddenPartIds: string[] | undefined,
  isolatedPartId: string | null | undefined,
  selectedPartId: string | null | undefined,
  clippingPlanes: THREE.Plane[]
) {
  const hidden = new Set(hiddenPartIds || []);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.userData.partId) return;
    const partId = child.userData.partId as string;
    const visible = (!isolatedPartId || partId === isolatedPartId) && !hidden.has(partId);
    child.visible = visible;
    syncSelectionOverlay(child, visible && selectedPartId === partId, clippingPlanes);
  });
}

function applyExplodeState(object: THREE.Object3D, boundsDetail: ModelBoundsDetail | null, viewMode: ViewMode, explodeAmount = 1) {
  if (!boundsDetail) return;
  const center = new THREE.Vector3(boundsDetail.center.x, boundsDetail.center.y, boundsDetail.center.z);
  const distance = boundsDetail.maxDim * 0.12 * Math.max(0, explodeAmount);
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (!child.userData.originalPosition) child.userData.originalPosition = child.position.clone();
    child.position.copy(child.userData.originalPosition);
    if (viewMode !== "explode" || distance <= 0) return;
    const meshBox = new THREE.Box3().setFromObject(child);
    const meshCenter = meshBox.getCenter(new THREE.Vector3());
    const direction = meshCenter.sub(center);
    if (direction.lengthSq() < 1e-8) direction.set(1, 0, 0);
    child.position.add(direction.normalize().multiplyScalar(distance));
  });
}

function pointFromVector(point: THREE.Vector3, snap: MeasurementPoint["snap"] = "surface"): MeasurementPoint {
  return { x: point.x, y: point.y, z: point.z, snap };
}

function vectorFromPoint(point: MeasurementPoint): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function getTriangleWorldPoints(mesh: THREE.Mesh, face?: { a: number; b: number; c: number } | null) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  if (!position || !face) return null;
  mesh.updateWorldMatrix(true, false);
  return [face.a, face.b, face.c].map((index) => (
    new THREE.Vector3().fromBufferAttribute(position as THREE.BufferAttribute, index).applyMatrix4(mesh.matrixWorld)
  )) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

function closestPointOnSegment(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3) {
  const segment = new THREE.Vector3().subVectors(end, start);
  const lengthSq = segment.lengthSq();
  if (lengthSq <= 1e-10) return start.clone();
  const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(point, start).dot(segment) / lengthSq, 0, 1);
  return start.clone().add(segment.multiplyScalar(t));
}

function measurementPointFromEvent(event: any, snapMode: MeasurementSnapMode = "surface"): MeasurementPoint {
  const hitPoint = event.point as THREE.Vector3 | undefined;
  if (!hitPoint || snapMode === "surface") return pointFromVector(hitPoint || new THREE.Vector3(), "surface");

  const mesh = event.object instanceof THREE.Mesh ? event.object : findPartMesh(event.object);
  const triangle = mesh ? getTriangleWorldPoints(mesh, event.face) : null;
  if (!triangle) return pointFromVector(hitPoint, "surface");

  if (snapMode === "vertex") {
    const closestVertex = triangle.reduce((best, candidate) => (
      candidate.distanceToSquared(hitPoint) < best.distanceToSquared(hitPoint) ? candidate : best
    ), triangle[0]);
    return pointFromVector(closestVertex, "vertex");
  }

  const edges: Array<[THREE.Vector3, THREE.Vector3]> = [
    [triangle[0], triangle[1]],
    [triangle[1], triangle[2]],
    [triangle[2], triangle[0]],
  ];
  const closestEdgePoint = edges
    .map(([start, end]) => closestPointOnSegment(hitPoint, start, end))
    .reduce((best, candidate) => (
      candidate.distanceToSquared(hitPoint) < best.distanceToSquared(hitPoint) ? candidate : best
    ));
  return pointFromVector(closestEdgePoint, "edge");
}

function getClipPlaneValues(direction: "x" | "y" | "z", position: number, inverted?: boolean) {
  const sign = inverted ? 1 : -1;
  return {
    normal: new THREE.Vector3(
      direction === "x" ? sign : 0,
      direction === "y" ? sign : 0,
      direction === "z" ? sign : 0
    ),
    constant: inverted ? -position : position,
  };
}

function formatMeasureDistance(value: number) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(3)} m`;
  if (Math.abs(value) >= 10) return `${value.toFixed(2)} mm`;
  return `${value.toFixed(3)} mm`;
}

function measureAngleDegrees(points: THREE.Vector3[]) {
  if (points.length < 3) return null;
  const ab = points[0].clone().sub(points[1]);
  const cb = points[2].clone().sub(points[1]);
  if (ab.lengthSq() <= 1e-10 || cb.lengthSq() <= 1e-10) return null;
  return THREE.MathUtils.radToDeg(ab.angleTo(cb));
}

function measureCircleDiameter(points: THREE.Vector3[]) {
  if (points.length < 3) return null;
  const a = points[0].distanceTo(points[1]);
  const b = points[1].distanceTo(points[2]);
  const c = points[2].distanceTo(points[0]);
  const s = (a + b + c) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
  if (area <= 1e-8) return null;
  return (a * b * c) / (2 * area);
}

function CadModel({
  url,
  viewMode,
  explodeAmount = 1,
  showDimensions,
  clipEnabled,
  clipDirection,
  clipPosition,
  clipRange,
  clipInverted,
  onClipPositionChange,
  materialPreset,
  showEdges,
  viewerSettings,
  selectedPartId,
  hiddenPartIds,
  isolatedPartId,
  onPartsChange,
  onPartSelect,
  measurementActive,
  measureMode,
  measurementSnapMode = "surface",
  measurementPoints = [],
  measurementRecords = [],
  onMeasurePoint,
  onLoaded,
  onProgress,
}: MultiFormatLoaderProps) {
  const [cadGroup, setCadGroup] = useState<THREE.Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gl = useThree((state) => state.gl);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  // Cache base material — only recreate when preset changes
  const materialSignature = useMemo(
    () => materialSignatureForPreset(materialPreset, viewerSettings),
    [materialPreset, viewerSettings]
  );
  const baseMaterial = useMemo(
    () => materialPreset === "original" ? null : createMaterial(materialPreset, gl, viewerSettings),
    [materialPreset, gl, viewerSettings]
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    onProgress?.(0);
    loadCadFromUrl(url, (progress) => {
      if (!cancelled) onProgress?.(progress);
    }, controller.signal)
      .then((group) => {
        if (!cancelled) {
          setCadGroup(group);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "模型加载失败");
      });
    return () => { cancelled = true; controller.abort(); };
  }, [onProgress, url]);

  useEffect(() => {
    if (!cadGroup) return;

    const clipPlane = new THREE.Plane(
      getClipPlaneValues(clipDirection, clipPosition, clipInverted).normal,
      getClipPlaneValues(clipDirection, clipPosition, clipInverted).constant
    );

    cadGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const clippingPlanes = clipEnabled ? [clipPlane] : [];
        applyMaterialPreset(child, materialPreset, materialSignature, baseMaterial);
        applyDisplayState(child.material as MeshMaterial, viewMode, clippingPlanes, clipEnabled);

        syncEdgeOverlay(child, showEdges && viewMode !== "wireframe", clippingPlanes);
        const partId = child.userData.partId as string | undefined;
        syncSelectionOverlay(child, !!partId && selectedPartId === partId, clippingPlanes);
      }
    });
  }, [cadGroup, viewMode, clipEnabled, clipDirection, clipPosition, clipInverted, materialPreset, materialSignature, baseMaterial, showEdges, selectedPartId]);

  const boundsDetail = useMemo(() => cadGroup ? getModelBounds(cadGroup) : null, [cadGroup]);
  const partItems = useMemo(() => cadGroup ? collectModelParts(cadGroup) : [], [cadGroup]);
  const centeredBox = useMemo(() => boundsDetail ? centeredBoxFromBounds(boundsDetail) : null, [boundsDetail]);
  const modelOffset = useMemo(
    () => boundsDetail
      ? new THREE.Vector3(-boundsDetail.center.x, -boundsDetail.center.y, -boundsDetail.center.z)
      : new THREE.Vector3(),
    [boundsDetail]
  );

  useEffect(() => {
    if (!cadGroup) return;
    onPartsChange?.(partItems);
  }, [cadGroup, onPartsChange, partItems]);

  useEffect(() => {
    if (!boundsDetail) return;
    dispatchModelBounds(centeredDetail(boundsDetail));
    onProgress?.(100);
    onLoadedRef.current?.();
  }, [boundsDetail, onProgress]);

  const handlePartClick = useCallback((event: any) => {
    if (measurementActive && measureMode !== "bounds" && event.point) {
      event.stopPropagation();
      onMeasurePoint?.(measurementPointFromEvent(event, measurementSnapMode));
      return;
    }
    const mesh = findPartMesh(event.object);
    if (!mesh) return;
    onPartSelect?.(null);
  }, [measureMode, measurementActive, measurementSnapMode, onMeasurePoint, onPartSelect]);

  useEffect(() => {
    if (!cadGroup) return;
    const values = getClipPlaneValues(clipDirection, clipPosition, clipInverted);
    const clippingPlanes = clipEnabled ? [new THREE.Plane(values.normal, values.constant)] : [];
    syncPartState(cadGroup, hiddenPartIds, isolatedPartId, selectedPartId, clippingPlanes);
  }, [cadGroup, clipDirection, clipEnabled, clipInverted, clipPosition, hiddenPartIds, isolatedPartId, selectedPartId]);

  useEffect(() => {
    if (!cadGroup) return;
    applyExplodeState(cadGroup, boundsDetail, viewMode, explodeAmount);
  }, [boundsDetail, cadGroup, explodeAmount, viewMode]);

  if (error) {
    return (
      <Html center>
        <div className="flex flex-col items-center gap-3 text-center">
          <Icon name="error" size={56} className="text-error/60" />
          <p className="text-sm text-error max-w-xs">{error}</p>
        </div>
      </Html>
    );
  }

  if (!cadGroup) {
    return (
      <Html center>
        <div className="flex flex-col items-center gap-3">
          <Icon name="view_in_ar" size={48} className="text-on-surface-variant/30 animate-pulse" />
          <span className="text-xs text-on-surface-variant">解析 CAD 模型...</span>
        </div>
      </Html>
    );
  }

  return (
    <group onClick={handlePartClick}>
      <group position={modelOffset}>
        <primitive object={cadGroup} />
      </group>
      {showDimensions && centeredBox && (
        <group>
          <DimensionLine start={new THREE.Vector3(centeredBox.min.x, centeredBox.min.y, centeredBox.min.z)} end={new THREE.Vector3(centeredBox.max.x, centeredBox.min.y, centeredBox.min.z)} label={`${(centeredBox.max.x - centeredBox.min.x).toFixed(1)} mm`} />
          <DimensionLine start={new THREE.Vector3(centeredBox.min.x, centeredBox.min.y, centeredBox.min.z)} end={new THREE.Vector3(centeredBox.min.x, centeredBox.max.y, centeredBox.min.z)} label={`${(centeredBox.max.y - centeredBox.min.y).toFixed(1)} mm`} />
          <DimensionLine start={new THREE.Vector3(centeredBox.min.x, centeredBox.min.y, centeredBox.min.z)} end={new THREE.Vector3(centeredBox.min.x, centeredBox.min.y, centeredBox.max.z)} label={`${(centeredBox.max.z - centeredBox.min.z).toFixed(1)} mm`} />
        </group>
      )}
      {clipEnabled && centeredBox && (
        <ClipPlaneOverlay
          box={centeredBox}
          direction={clipDirection}
          position={clipPosition}
          range={clipRange}
          inverted={clipInverted}
          onPositionChange={onClipPositionChange}
        />
      )}
      <MeasurementOverlay mode={measureMode || "distance"} points={measurementPoints} records={measurementRecords} maxDim={boundsDetail?.maxDim || 1} />
    </group>
  );
}

function GltfModel({
  url,
  viewMode,
  explodeAmount = 1,
  showDimensions,
  clipEnabled,
  clipDirection,
  clipPosition,
  clipRange,
  clipInverted,
  onClipPositionChange,
  materialPreset,
  showEdges,
  viewerSettings,
  selectedPartId,
  hiddenPartIds,
  isolatedPartId,
  onPartsChange,
  onPartSelect,
  measurementActive,
  measureMode,
  measurementSnapMode = "surface",
  measurementPoints = [],
  measurementRecords = [],
  onMeasurePoint,
  onLoaded,
  onProgress,
}: MultiFormatLoaderProps) {
  const gltf = useLoader(GLTFLoader, url, undefined, (event) => {
    if (event.lengthComputable && event.total > 0) {
      onProgress?.(Math.min(95, Math.round((event.loaded / event.total) * 90)));
    } else if (event.loaded > 0) {
      onProgress?.(45);
    }
  });
  const scene = gltf.scene;
  const gl = useThree((state) => state.gl);

  const clonedScene = useMemo(() => scene.clone(true), [scene]);
  const boundsDetail = useMemo(() => getModelBounds(clonedScene), [clonedScene]);
  const partItems = useMemo(() => collectModelParts(clonedScene), [clonedScene]);
  const centeredBox = useMemo(() => boundsDetail ? centeredBoxFromBounds(boundsDetail) : null, [boundsDetail]);
  const modelOffset = useMemo(
    () => boundsDetail
      ? new THREE.Vector3(-boundsDetail.center.x, -boundsDetail.center.y, -boundsDetail.center.z)
      : new THREE.Vector3(),
    [boundsDetail]
  );

  // Cache base material — only recreate when preset changes
  const materialSignature = useMemo(
    () => materialSignatureForPreset(materialPreset, viewerSettings),
    [materialPreset, viewerSettings]
  );
  const baseMaterial = useMemo(
    () => materialPreset === "original" ? null : createMaterial(materialPreset, gl, viewerSettings),
    [materialPreset, gl, viewerSettings]
  );

  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  useEffect(() => {
    if (!boundsDetail) return;
    dispatchModelBounds(centeredDetail(boundsDetail));
    onProgress?.(100);
    const t = setTimeout(() => onLoadedRef.current?.(), 0);
    return () => clearTimeout(t);
  }, [boundsDetail, onProgress]);

  useEffect(() => {
    onPartsChange?.(partItems);
  }, [onPartsChange, partItems]);

  const clipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), []);

  useEffect(() => {
    if (clipEnabled) {
      const values = getClipPlaneValues(clipDirection, clipPosition, clipInverted);
      clipPlane.set(values.normal, values.constant);
    }

    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const clippingPlanes = clipEnabled ? [clipPlane] : [];
        applyMaterialPreset(child, materialPreset, materialSignature, baseMaterial);
        applyDisplayState(child.material as MeshMaterial, viewMode, clippingPlanes, clipEnabled);
        syncEdgeOverlay(child, showEdges && viewMode !== "wireframe", clippingPlanes);
        const partId = child.userData.partId as string | undefined;
        syncSelectionOverlay(child, !!partId && selectedPartId === partId, clippingPlanes);
      }
    });
  }, [viewMode, clipEnabled, clipDirection, clipPosition, clipInverted, clipPlane, materialPreset, materialSignature, baseMaterial, clonedScene, showEdges, selectedPartId]);

  useEffect(() => {
    if (clipEnabled) {
      const values = getClipPlaneValues(clipDirection, clipPosition, clipInverted);
      clipPlane.set(values.normal, values.constant);
    }
    const clippingPlanes = clipEnabled ? [clipPlane] : [];
    syncPartState(clonedScene, hiddenPartIds, isolatedPartId, selectedPartId, clippingPlanes);
  }, [clipDirection, clipEnabled, clipInverted, clipPlane, clipPosition, clonedScene, hiddenPartIds, isolatedPartId, selectedPartId]);

  useEffect(() => {
    applyExplodeState(clonedScene, boundsDetail, viewMode, explodeAmount);
  }, [viewMode, boundsDetail, clonedScene, explodeAmount]);

  const handlePartClick = useCallback((event: any) => {
    if (measurementActive && measureMode !== "bounds" && event.point) {
      event.stopPropagation();
      onMeasurePoint?.(measurementPointFromEvent(event, measurementSnapMode));
      return;
    }
    const mesh = findPartMesh(event.object);
    if (!mesh) return;
    onPartSelect?.(null);
  }, [measureMode, measurementActive, measurementSnapMode, onMeasurePoint, onPartSelect]);

  return (
    <group onClick={handlePartClick}>
      <group position={modelOffset}>
        <primitive object={clonedScene} />
      </group>
      {showDimensions && centeredBox && (
        <group>
          <DimensionLine start={new THREE.Vector3(centeredBox.min.x, centeredBox.min.y, centeredBox.min.z)} end={new THREE.Vector3(centeredBox.max.x, centeredBox.min.y, centeredBox.min.z)} label={`${(centeredBox.max.x - centeredBox.min.x).toFixed(1)} mm`} />
          <DimensionLine start={new THREE.Vector3(centeredBox.min.x, centeredBox.min.y, centeredBox.min.z)} end={new THREE.Vector3(centeredBox.min.x, centeredBox.max.y, centeredBox.min.z)} label={`${(centeredBox.max.y - centeredBox.min.y).toFixed(1)} mm`} />
          <DimensionLine start={new THREE.Vector3(centeredBox.min.x, centeredBox.min.y, centeredBox.min.z)} end={new THREE.Vector3(centeredBox.min.x, centeredBox.min.y, centeredBox.max.z)} label={`${(centeredBox.max.z - centeredBox.min.z).toFixed(1)} mm`} />
        </group>
      )}
      {clipEnabled && centeredBox && (
        <ClipPlaneOverlay
          box={centeredBox}
          direction={clipDirection}
          position={clipPosition}
          range={clipRange}
          inverted={clipInverted}
          onPositionChange={onClipPositionChange}
        />
      )}
      <MeasurementOverlay mode={measureMode || "distance"} points={measurementPoints} records={measurementRecords} maxDim={boundsDetail?.maxDim || 1} />
    </group>
  );
}

function axisVectorForDirection(direction: "x" | "y" | "z") {
  if (direction === "x") return new THREE.Vector3(1, 0, 0);
  if (direction === "y") return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 0, 1);
}

function positionOnAxisFromRay(ray: THREE.Ray, axis: THREE.Vector3) {
  const rayDirection = ray.direction.clone().normalize();
  const axisDirection = axis.clone().normalize();
  const b = rayDirection.dot(axisDirection);
  const d = rayDirection.dot(ray.origin);
  const e = axisDirection.dot(ray.origin);
  const denom = 1 - b * b;
  if (Math.abs(denom) < 1e-5) return null;
  return (e - b * d) / denom;
}

function ClipPlaneOverlay({
  box,
  direction,
  position,
  range,
  inverted,
  onPositionChange,
}: {
  box: THREE.Box3;
  direction: "x" | "y" | "z";
  position: number;
  range?: { min: number; max: number; step: number };
  inverted?: boolean;
  onPositionChange?: (position: number) => void;
}) {
  const noopRaycast = useCallback(() => undefined, []);
  const raycaster = useThree((state) => state.raycaster);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const { size, markerPosition, labelPosition, rotation, width, height, borderPositions, normalLine, normalEndPosition, axis, dragFallbackLimit } = useMemo(() => {
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.01);
    const pad = Math.max(maxDim * 0.035, 0.01);
    const half = size.clone().multiplyScalar(0.5);
    const markerPosition = new THREE.Vector3();
    const labelPosition = new THREE.Vector3();
    const rotation = new THREE.Euler();
    const axis = axisVectorForDirection(direction);
    const dragFallbackLimit = direction === "x" ? half.x : direction === "y" ? half.y : half.z;
    const overlayWidth = direction === "x" ? Math.max(size.z, maxDim * 0.08) : Math.max(size.x, maxDim * 0.08);
    const overlayHeight = direction === "y" ? Math.max(size.z, maxDim * 0.08) : Math.max(size.y, maxDim * 0.08);

    if (direction === "x") {
      markerPosition.set(position, 0, 0);
      labelPosition.set(position, half.y + pad, half.z + pad);
      rotation.set(0, Math.PI / 2, 0);
    } else if (direction === "y") {
      markerPosition.set(0, position, 0);
      labelPosition.set(half.x + pad, position, half.z + pad);
      rotation.set(-Math.PI / 2, 0, 0);
    } else {
      markerPosition.set(0, 0, position);
      labelPosition.set(half.x + pad, half.y + pad, position);
    }

    const width = overlayWidth * 1.08;
    const height = overlayHeight * 1.08;
    const x = width / 2;
    const y = height / 2;
    const borderPositions = new Float32Array([
      -x, -y, 0, x, -y, 0,
      x, -y, 0, x, y, 0,
      x, y, 0, -x, y, 0,
      -x, y, 0, -x, -y, 0,
    ]);
    const values = getClipPlaneValues(direction, position, inverted);
    const normalLength = Math.max(maxDim * 0.08, 0.03);
    const normalEndPosition = markerPosition.clone().add(values.normal.clone().normalize().multiplyScalar(normalLength));
    const normalLine = new Float32Array([
      markerPosition.x, markerPosition.y, markerPosition.z,
      normalEndPosition.x, normalEndPosition.y, normalEndPosition.z,
    ]);

    return { size, markerPosition, labelPosition, rotation, width, height, borderPositions, normalLine, normalEndPosition, axis, dragFallbackLimit };
  }, [box, direction, inverted, position]);

  const updatePositionFromEvent = useCallback((event: any) => {
    if (!onPositionChange) return;
    const ray = event.ray || raycaster.ray;
    const nextPosition = positionOnAxisFromRay(ray, axis);
    if (nextPosition === null || !Number.isFinite(nextPosition)) return;
    const min = range?.min ?? -dragFallbackLimit;
    const max = range?.max ?? dragFallbackLimit;
    const clamped = Math.min(max, Math.max(min, nextPosition));
    const step = range?.step && range.step > 0 ? range.step : 0;
    const snapped = step ? Math.round(clamped / step) * step : clamped;
    onPositionChange(Math.min(max, Math.max(min, snapped)));
  }, [axis, dragFallbackLimit, onPositionChange, range, raycaster]);

  const handleDragStart = useCallback((event: any) => {
    if (!onPositionChange) return;
    event.stopPropagation();
    draggingRef.current = true;
    setDragging(true);
    event.target?.setPointerCapture?.(event.pointerId);
    updatePositionFromEvent(event);
  }, [onPositionChange, updatePositionFromEvent]);

  const handleDragMove = useCallback((event: any) => {
    if (!draggingRef.current) return;
    event.stopPropagation();
    updatePositionFromEvent(event);
  }, [updatePositionFromEvent]);

  const handleDragEnd = useCallback((event: any) => {
    if (!draggingRef.current) return;
    event.stopPropagation();
    draggingRef.current = false;
    setDragging(false);
    event.target?.releasePointerCapture?.(event.pointerId);
  }, []);

  const labelValue = formatMeasureDistance(position);
  const color = direction === "x" ? "#ff6b6b" : direction === "y" ? "#3ddc97" : "#4dabf7";
  const maxDim = Math.max(size.x, size.y, size.z, 0.01);
  const planeRaycast = onPositionChange ? undefined : noopRaycast;

  return (
    <group renderOrder={28}>
      <group position={markerPosition} rotation={rotation}>
        <mesh
          raycast={planeRaycast}
          renderOrder={28}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={dragging ? 0.2 : 0.11}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <lineSegments raycast={noopRaycast} renderOrder={29}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[borderPositions, 3]} count={8} />
          </bufferGeometry>
          <lineBasicMaterial color={color} transparent opacity={0.7} depthTest={false} depthWrite={false} />
        </lineSegments>
      </group>
      <lineSegments raycast={noopRaycast} renderOrder={30}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[normalLine, 3]} count={2} />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={0.75} depthTest={false} depthWrite={false} />
      </lineSegments>
      <mesh
        raycast={planeRaycast}
        position={normalEndPosition}
        renderOrder={31}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <sphereGeometry args={[Math.max(maxDim * 0.018, 0.008), 14, 14]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </mesh>
      <Html position={[labelPosition.x, labelPosition.y, labelPosition.z]} center>
        <div className="pointer-events-none select-none whitespace-nowrap rounded-sm border border-white/20 bg-black/70 px-2 py-1 text-[11px] font-mono text-white shadow-lg">
          {direction.toUpperCase()} {labelValue} · {inverted ? "反向" : "正向"} · 可拖动
        </div>
      </Html>
    </group>
  );
}

function DimensionLine({ start, end, label }: { start: THREE.Vector3; end: THREE.Vector3; label: string }) {
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const length = start.distanceTo(end);
  const dir = new THREE.Vector3().subVectors(end, start).normalize();

  // Offset the whole dimension line outward from the model
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const outward = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(length * 0.08);
  const oStart = start.clone().add(outward);
  const oEnd = end.clone().add(outward);
  const oMid = mid.clone().add(outward);

  // Connector lines from model edge to dimension line
  const connA = useMemo(() => new Float32Array([
    start.x, start.y, start.z, oStart.x, oStart.y, oStart.z
  ]), [start, oStart]);
  const connB = useMemo(() => new Float32Array([
    end.x, end.y, end.z, oEnd.x, oEnd.y, oEnd.z
  ]), [end, oEnd]);
  const mainLine = useMemo(() => new Float32Array([
    oStart.x, oStart.y, oStart.z, oEnd.x, oEnd.y, oEnd.z
  ]), [oStart, oEnd]);

  const dotR = Math.max(length * 0.006, 0.001);

  return (
    <group>
      {/* Main dimension line */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[mainLine, 3]} count={2} />
        </bufferGeometry>
        <lineBasicMaterial color="#00e5ff" linewidth={2} />
      </line>
      {/* Connector lines */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[connA, 3]} count={2} />
        </bufferGeometry>
        <lineBasicMaterial color="#00e5ff" linewidth={1} transparent opacity={0.4} />
      </line>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[connB, 3]} count={2} />
        </bufferGeometry>
        <lineBasicMaterial color="#00e5ff" linewidth={1} transparent opacity={0.4} />
      </line>
      {/* End markers */}
      <mesh position={oStart}>
        <sphereGeometry args={[dotR, 6, 6]} />
        <meshBasicMaterial color="#00e5ff" />
      </mesh>
      <mesh position={oEnd}>
        <sphereGeometry args={[dotR, 6, 6]} />
        <meshBasicMaterial color="#00e5ff" />
      </mesh>
      {/* Label — fixed screen size */}
      <Html position={[oMid.x, oMid.y, oMid.z]} center>
        <div className="bg-black/70 text-[#00e5ff] text-[11px] px-2 py-0.5 rounded font-mono whitespace-nowrap border border-[#00e5ff]/40 pointer-events-none select-none" style={{ transform: 'translateY(-8px)' }}>
          {label}
        </div>
      </Html>
    </group>
  );
}

function SingleMeasurementOverlay({
  mode,
  points,
  maxDim,
  muted = false,
  labelPrefix = "",
}: {
  mode: Exclude<MeasureMode, "bounds">;
  points: MeasurementPoint[];
  maxDim: number;
  muted?: boolean;
  labelPrefix?: string;
}) {
  const maxPoints = mode === "angle" || mode === "diameter" ? 3 : 2;
  const vectors = useMemo(() => (
    points
      .slice(0, maxPoints)
      .filter((point): point is MeasurementPoint => Boolean(point))
      .map(vectorFromPoint)
  ), [maxPoints, points]);
  const dotR = Math.max(maxDim * 0.006, 0.001);
  const distance = vectors.length >= 2 ? vectors[0].distanceTo(vectors[1]) : 0;
  const angle = mode === "angle" ? measureAngleDegrees(vectors) : null;
  const diameter = mode === "diameter" ? measureCircleDiameter(vectors) : null;
  const mid = useMemo(() => {
    if (vectors.length === 3) {
      return new THREE.Vector3()
        .add(vectors[0])
        .add(vectors[1])
        .add(vectors[2])
        .multiplyScalar(1 / 3);
    }
    if (vectors.length === 2) {
      return new THREE.Vector3().addVectors(vectors[0], vectors[1]).multiplyScalar(0.5);
    }
    return vectors.length === 1 ? vectors[0].clone() : new THREE.Vector3();
  }, [vectors]);
  const lineSegments = useMemo(() => {
    if (mode === "angle" && vectors.length >= 2) {
      const segments: Float32Array[] = [
        new Float32Array([vectors[1].x, vectors[1].y, vectors[1].z, vectors[0].x, vectors[0].y, vectors[0].z]),
      ];
      if (vectors.length >= 3) {
        segments.push(new Float32Array([vectors[1].x, vectors[1].y, vectors[1].z, vectors[2].x, vectors[2].y, vectors[2].z]));
      }
      return segments;
    }
    if (mode === "diameter" && vectors.length >= 2) {
      const segments: Float32Array[] = [
        new Float32Array([vectors[0].x, vectors[0].y, vectors[0].z, vectors[1].x, vectors[1].y, vectors[1].z]),
      ];
      if (vectors.length >= 3) {
        segments.push(
          new Float32Array([vectors[1].x, vectors[1].y, vectors[1].z, vectors[2].x, vectors[2].y, vectors[2].z]),
          new Float32Array([vectors[2].x, vectors[2].y, vectors[2].z, vectors[0].x, vectors[0].y, vectors[0].z])
        );
      }
      return segments;
    }
    return vectors.length >= 2
      ? [new Float32Array([vectors[0].x, vectors[0].y, vectors[0].z, vectors[1].x, vectors[1].y, vectors[1].z])]
      : [];
  }, [mode, vectors]);
  const label = useMemo(() => {
    if (mode === "angle") {
      if (vectors.length < 3) return `角度 ${vectors.length}/3`;
      return angle === null ? "无法计算角度" : `${labelPrefix}${angle.toFixed(2)} deg`;
    }
    if (mode === "diameter") {
      if (vectors.length < 3) return `直径 ${vectors.length}/3`;
      return diameter === null ? "三点近似共线" : `${labelPrefix}Ø ${formatMeasureDistance(diameter)}`;
    }
    return vectors.length >= 2 ? `${labelPrefix}${formatMeasureDistance(distance)}` : "起点";
  }, [angle, diameter, distance, labelPrefix, mode, vectors.length]);

  if (vectors.length === 0) return null;

  const lineColor = muted ? "#8d99a6" : "#00c8ff";
  const startColor = muted ? "#9aa4ad" : "#00c8ff";
  const endColor = muted ? "#c1a24a" : "#ffb020";
  const lineOpacity = muted ? 0.38 : 0.95;

  return (
    <group renderOrder={muted ? 18 : 20}>
      {lineSegments.map((segment, index) => (
        <lineSegments key={index} renderOrder={muted ? 18 : 20}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[segment, 3]} count={2} />
          </bufferGeometry>
          <lineBasicMaterial color={lineColor} transparent opacity={lineOpacity} depthTest={false} depthWrite={false} />
        </lineSegments>
      ))}
      {vectors.map((point, index) => (
        <mesh key={index} position={point} renderOrder={muted ? 19 : 21}>
          <sphereGeometry args={[dotR, 12, 12]} />
          <meshBasicMaterial color={index === 0 ? startColor : endColor} transparent={muted} opacity={muted ? 0.72 : 1} depthTest={false} depthWrite={false} />
        </mesh>
      ))}
      <Html position={[mid.x, mid.y, mid.z]} center>
        <div className={`pointer-events-none select-none rounded-sm border px-2 py-1 text-[11px] font-mono shadow-lg ${muted ? "border-slate-300/35 bg-black/50 text-slate-100" : "border-cyan-300/50 bg-black/75 text-cyan-100"}`}>
          {label}
        </div>
      </Html>
    </group>
  );
}

function MeasurementOverlay({
  mode,
  points,
  records,
  maxDim,
}: {
  mode: MeasureMode;
  points: MeasurementPoint[];
  records: MeasurementRecord[];
  maxDim: number;
}) {
  const activeMode: Exclude<MeasureMode, "bounds"> = mode === "bounds" ? "distance" : mode;
  const visibleRecords = records.filter((record) => {
    if (mode === "bounds" || record.mode !== activeMode || record.points.length !== points.length) return true;
    return !record.points.every((point, index) => {
      const activePoint = points[index];
      return activePoint && point.x === activePoint.x && point.y === activePoint.y && point.z === activePoint.z;
    });
  });

  return (
    <group>
      {visibleRecords.map((record, index) => (
        <SingleMeasurementOverlay
          key={record.id}
          mode={record.mode}
          points={record.points}
          maxDim={maxDim}
          muted
          labelPrefix={`${index + 1}. `}
        />
      ))}
      {mode !== "bounds" && (
        <SingleMeasurementOverlay mode={activeMode} points={points} maxDim={maxDim} />
      )}
    </group>
  );
}

function XtPendingPreview() {
  return (
    <Html center>
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg border border-outline-variant/20 bg-surface/95 px-5 py-4 text-center shadow-xl">
        <Icon name="hourglass_empty" size={48} className="text-primary-container/70" />
        <div>
          <p className="text-sm font-semibold text-on-surface">XT 文件正在等待后台预览转换</p>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">
            这里不会再调用不存在的即时转换接口。请在后台模型管理等待转换队列完成，或使用「从模型重新生成」生成 GLB 预览后再打开。
          </p>
        </div>
      </div>
    </Html>
  );
}

export default function MultiFormatLoader(props: MultiFormatLoaderProps) {
  const format = getModelFormat(props.url);

  if (format === "xt" || format === "x_t" || format === "xmt_txt") {
    return <XtPendingPreview />;
  }

  if (format === "glb" || format === "gltf") {
    return <GltfModel {...props} />;
  }

  if (CAD_FORMATS.has(format)) {
    return <CadModel {...props} />;
  }

  return <GltfModel {...props} />;
}
