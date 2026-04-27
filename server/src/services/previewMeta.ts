import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findPreviewAssetPath, readGltfAsset } from "./gltfAsset.js";

type Vec3Tuple = [number, number, number];
type Mat4 = number[];

interface BoundsBuilder {
  min: Vec3Tuple;
  max: Vec3Tuple;
  valid: boolean;
}

interface PreviewPartMeta {
  id: string;
  name: string;
  color: string | null;
  sourceMeshIndex: number;
  vertexCount: number;
  faceCount: number;
  bounds: {
    min: Vec3Tuple;
    max: Vec3Tuple;
    size: Vec3Tuple;
    center: Vec3Tuple;
  };
}

interface PreviewMeta {
  version: 2;
  sourceName: string;
  sourceFormat: string;
  unit: "mm";
  parts: PreviewPartMeta[];
  totals: {
    partCount: number;
    vertexCount: number;
    faceCount: number;
  };
  bounds: {
    min: Vec3Tuple;
    max: Vec3Tuple;
    size: Vec3Tuple;
    center: Vec3Tuple;
  };
  tree: Array<{ id: string; name: string; children: string[] }>;
  diagnostics: {
    generatedAt: string;
    converter: "gltf-asset-inspector";
    tessellation: Record<string, never>;
    sourceMeshCount: number;
    validMeshCount: number;
    skippedMeshCount: number;
    conversionMs: number;
    warnings: string[];
  };
}

function identityMat4(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function composeNodeMatrix(node: any): Mat4 {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return node.matrix.map((value: number) => Number(value));
  }

  const [tx, ty, tz] = Array.isArray(node.translation) ? node.translation : [0, 0, 0];
  const [sx, sy, sz] = Array.isArray(node.scale) ? node.scale : [1, 1, 1];
  const [x, y, z, w] = Array.isArray(node.rotation) ? node.rotation : [0, 0, 0, 1];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(v: Vec3Tuple, m: Mat4): Vec3Tuple {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

function makeBoundsBuilder(): BoundsBuilder {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    valid: false,
  };
}

function includePoint(bounds: BoundsBuilder, point: Vec3Tuple) {
  if (!point.every((value) => Number.isFinite(value))) return;
  bounds.valid = true;
  for (let i = 0; i < 3; i++) {
    bounds.min[i] = Math.min(bounds.min[i], point[i]);
    bounds.max[i] = Math.max(bounds.max[i], point[i]);
  }
}

function includeBounds(bounds: BoundsBuilder, next: BoundsBuilder) {
  if (!next.valid) return;
  includePoint(bounds, next.min);
  includePoint(bounds, next.max);
}

function finalizeBounds(bounds: BoundsBuilder) {
  const min = bounds.valid ? bounds.min : [0, 0, 0] as Vec3Tuple;
  const max = bounds.valid ? bounds.max : [0, 0, 0] as Vec3Tuple;
  const size = [
    Math.max(0, max[0] - min[0]),
    Math.max(0, max[1] - min[1]),
    Math.max(0, max[2] - min[2]),
  ] as Vec3Tuple;
  const center = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ] as Vec3Tuple;
  return { min, max, size, center };
}

function componentSize(componentType: number): number {
  if (componentType === 5120 || componentType === 5121) return 1;
  if (componentType === 5122 || componentType === 5123) return 2;
  if (componentType === 5125 || componentType === 5126) return 4;
  throw new Error(`Unsupported accessor component type: ${componentType}`);
}

function readScalar(view: DataView, offset: number, componentType: number): number {
  if (componentType === 5120) return view.getInt8(offset);
  if (componentType === 5121) return view.getUint8(offset);
  if (componentType === 5122) return view.getInt16(offset, true);
  if (componentType === 5123) return view.getUint16(offset, true);
  if (componentType === 5125) return view.getUint32(offset, true);
  if (componentType === 5126) return view.getFloat32(offset, true);
  throw new Error(`Unsupported accessor component type: ${componentType}`);
}

function accessorOffset(accessor: any, bufferView: any): number {
  return (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
}

function forEachVec3(accessor: any, bufferView: any, binData: Buffer, visit: (point: Vec3Tuple) => void) {
  if (!accessor || !bufferView || accessor.type !== "VEC3") return;
  const size = componentSize(accessor.componentType);
  const stride = bufferView.byteStride || size * 3;
  const offset = accessorOffset(accessor, bufferView);
  if (offset >= binData.byteLength) return;
  const view = new DataView(binData.buffer, binData.byteOffset + offset, Math.max(0, binData.byteLength - offset));

  for (let i = 0; i < accessor.count; i++) {
    const base = i * stride;
    if (base + size * 3 > view.byteLength) break;
    visit([
      readScalar(view, base, accessor.componentType),
      readScalar(view, base + size, accessor.componentType),
      readScalar(view, base + size * 2, accessor.componentType),
    ]);
  }
}

function materialColor(material: any): string | null {
  const factor = material?.pbrMetallicRoughness?.baseColorFactor;
  if (!Array.isArray(factor) || factor.length < 3) return null;
  return `#${factor.slice(0, 3).map((value: number) => {
    const byte = Math.max(0, Math.min(255, Math.round(Number(value) * 255)));
    return byte.toString(16).padStart(2, "0");
  }).join("")}`;
}

function analyzePrimitive(
  primitive: any,
  gltf: any,
  binData: Buffer,
  matrix: Mat4,
  bounds: BoundsBuilder
): { vertexCount: number; faceCount: number; hasGeometry: boolean } {
  const accessors = Array.from(gltf.accessors || []) as any[];
  const bufferViews = Array.from(gltf.bufferViews || []) as any[];
  const posIdx = primitive.attributes?.POSITION;
  const posAcc = posIdx !== undefined ? accessors[posIdx] : null;
  const posBv = posAcc ? bufferViews[posAcc.bufferView] : null;
  if (!posAcc) return { vertexCount: 0, faceCount: 0, hasGeometry: false };

  if (posBv && binData.byteLength > 0) {
    forEachVec3(posAcc, posBv, binData, (point) => includePoint(bounds, transformPoint(point, matrix)));
  } else if (Array.isArray(posAcc.min) && Array.isArray(posAcc.max)) {
    for (const x of [posAcc.min[0], posAcc.max[0]]) {
      for (const y of [posAcc.min[1], posAcc.max[1]]) {
        for (const z of [posAcc.min[2], posAcc.max[2]]) {
          includePoint(bounds, transformPoint([x, y, z], matrix));
        }
      }
    }
  }

  const idxAcc = primitive.indices !== undefined ? accessors[primitive.indices] : null;
  return {
    vertexCount: posAcc.count || 0,
    faceCount: Math.floor((idxAcc?.count ?? posAcc.count ?? 0) / 3),
    hasGeometry: true,
  };
}

function createPreviewMetaFromAsset(
  modelId: string,
  sourceName: string,
  sourceFormat: string,
  gltf: any,
  binData: Buffer
): PreviewMeta {
  const started = Date.now();
  const nodes = Array.from(gltf.nodes || []) as any[];
  const meshes = Array.from(gltf.meshes || []) as any[];
  const materials = Array.from(gltf.materials || []) as any[];
  const parts: PreviewPartMeta[] = [];
  const modelBounds = makeBoundsBuilder();
  let skippedMeshCount = 0;

  const addMeshPart = (meshIndex: number, matrix: Mat4, name?: string) => {
    const mesh = meshes[meshIndex];
    if (!mesh) return;
    const partBounds = makeBoundsBuilder();
    let vertexCount = 0;
    let faceCount = 0;
    let color: string | null = null;
    let hasGeometry = false;

    for (const primitive of mesh.primitives || []) {
      const result = analyzePrimitive(primitive, gltf, binData, matrix, partBounds);
      vertexCount += result.vertexCount;
      faceCount += result.faceCount;
      hasGeometry = hasGeometry || result.hasGeometry;
      if (!color && primitive.material !== undefined) color = materialColor(materials[primitive.material]);
    }

    if (!hasGeometry || vertexCount === 0 || faceCount === 0 || !partBounds.valid) {
      skippedMeshCount++;
      return;
    }

    includeBounds(modelBounds, partBounds);
    const id = `part_${parts.length + 1}`;
    parts.push({
      id,
      name: name?.trim() || mesh.name?.trim() || `Part ${parts.length + 1}`,
      color,
      sourceMeshIndex: meshIndex,
      vertexCount,
      faceCount,
      bounds: finalizeBounds(partBounds),
    });
  };

  const visitNode = (nodeIndex: number, parentMatrix: Mat4) => {
    const node = nodes[nodeIndex];
    if (!node) return;
    const matrix = multiplyMat4(parentMatrix, composeNodeMatrix(node));
    if (typeof node.mesh === "number") addMeshPart(node.mesh, matrix, node.name);
    for (const childIndex of node.children || []) visitNode(childIndex, matrix);
  };

  const scene = gltf.scenes?.[typeof gltf.scene === "number" ? gltf.scene : 0];
  const rootNodes = Array.isArray(scene?.nodes) ? scene.nodes : [];
  if (rootNodes.length > 0 && nodes.length > 0) {
    for (const nodeIndex of rootNodes) visitNode(nodeIndex, identityMat4());
  } else {
    for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
      addMeshPart(meshIndex, identityMat4(), meshes[meshIndex]?.name);
    }
  }

  const totals = parts.reduce(
    (acc, part) => {
      acc.vertexCount += part.vertexCount;
      acc.faceCount += part.faceCount;
      return acc;
    },
    { partCount: parts.length, vertexCount: 0, faceCount: 0 }
  );

  return {
    version: 2,
    sourceName,
    sourceFormat,
    unit: "mm",
    parts,
    totals,
    bounds: finalizeBounds(modelBounds),
    tree: [{ id: "root", name: sourceName || modelId, children: parts.map((part) => part.id) }],
    diagnostics: {
      generatedAt: new Date().toISOString(),
      converter: "gltf-asset-inspector",
      tessellation: {},
      sourceMeshCount: meshes.length,
      validMeshCount: parts.length,
      skippedMeshCount,
      conversionMs: Date.now() - started,
      warnings: parts.length === 0 ? ["No valid mesh geometry was detected in the preview asset"] : [],
    },
  };
}

export function readPreviewMeta(modelDir: string, modelId: string): PreviewMeta | null {
  const metaPath = join(modelDir, `${modelId}.meta.json`);
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8")) as PreviewMeta;
  } catch {
    return null;
  }
}

export function ensurePreviewMeta(options: {
  modelDir: string;
  modelId: string;
  preferredUrl?: string | null;
  sourceName?: string | null;
  sourceFormat?: string | null;
}): PreviewMeta | null {
  const existing = readPreviewMeta(options.modelDir, options.modelId);
  if (existing) return existing;

  const previewPath = findPreviewAssetPath(options.modelDir, options.modelId, options.preferredUrl);
  if (!previewPath) return null;

  try {
    const { json, binData } = readGltfAsset(previewPath);
    const meta = createPreviewMetaFromAsset(
      options.modelId,
      options.sourceName || options.modelId,
      (options.sourceFormat || "gltf").toLowerCase(),
      json,
      binData
    );
    writeFileSync(join(options.modelDir, `${options.modelId}.meta.json`), JSON.stringify(meta, null, 2));
    return meta;
  } catch {
    return null;
  }
}
