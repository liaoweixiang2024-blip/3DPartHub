import { createCanvas } from "canvas";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { readGltfAsset } from "./gltfAsset.js";

interface Vec3 { x: number; y: number; z: number }
interface Tri { v0: Vec3; v1: Vec3; v2: Vec3; nx: number; ny: number; nz: number }
type Mat4 = number[];
type Projection = { x: number; y: number; depth: number };

// Keep enough faces for complex CAD assemblies. Too aggressive sampling makes
// thumbnails look like transparent wireframes.
const MAX_RENDER_TRIANGLES = 2500000;
const HIGH_QUALITY_SUPERSAMPLE_LIMIT = 800000;
const THUMBNAIL_FOV = 45 * Math.PI / 180;
const THUMBNAIL_VIEW_DIRECTION: Vec3 = { x: 0.62, y: 0.42, z: 0.62 };
const THUMBNAIL_KEY_LIGHT: Vec3 = { x: 0.35, y: 0.72, z: 0.52 };
const THUMBNAIL_FILL_LIGHT: Vec3 = { x: -0.5, y: 0.28, z: -0.25 };
const THUMBNAIL_BASE_COLOR = { r: 174, g: 177, b: 181 };

function computeBounds(triangles: Tri[]) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const tri of triangles) {
    for (const v of [tri.v0, tri.v1, tri.v2]) {
      minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); minZ = Math.min(minZ, v.z);
      maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y); maxZ = Math.max(maxZ, v.z);
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function vecSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vecScale(v: Vec3, scalar: number): Vec3 {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

function vecDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vecCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function vecNormalize(v: Vec3): Vec3 {
  const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function edgeFunction(a: Projection, b: Projection, x: number, y: number): number {
  return (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
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

function transformPoint(v: Vec3, m: Mat4): Vec3 {
  return {
    x: m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12],
    y: m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13],
    z: m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14],
  };
}

function transformNormal(v: Vec3, m: Mat4): Vec3 {
  const x = m[0] * v.x + m[4] * v.y + m[8] * v.z;
  const y = m[1] * v.x + m[5] * v.y + m[9] * v.z;
  const z = m[2] * v.x + m[6] * v.y + m[10] * v.z;
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  return { x: x / len, y: y / len, z: z / len };
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

function readVec3Accessor(accessor: any, bufferView: any, binData: Buffer): Vec3[] {
  if (!accessor || !bufferView || accessor.type !== "VEC3") return [];
  const size = componentSize(accessor.componentType);
  const stride = bufferView.byteStride || size * 3;
  const offset = accessorOffset(accessor, bufferView);
  if (offset >= binData.byteLength) return [];
  const view = new DataView(binData.buffer, binData.byteOffset + offset, Math.max(0, binData.byteLength - offset));
  const out: Vec3[] = [];

  for (let i = 0; i < accessor.count; i++) {
    const offset = i * stride;
    if (offset + size * 3 > view.byteLength) break;
    out.push({
      x: readScalar(view, offset, accessor.componentType),
      y: readScalar(view, offset + size, accessor.componentType),
      z: readScalar(view, offset + size * 2, accessor.componentType),
    });
  }
  return out;
}

function readIndexAccessor(accessor: any, bufferView: any, binData: Buffer): number[] {
  if (!accessor || !bufferView) return [];
  const size = componentSize(accessor.componentType);
  const stride = bufferView.byteStride || size;
  const offset = accessorOffset(accessor, bufferView);
  if (offset >= binData.byteLength) return [];
  const view = new DataView(binData.buffer, binData.byteOffset + offset, Math.max(0, binData.byteLength - offset));
  const out: number[] = [];

  for (let i = 0; i < accessor.count; i++) {
    const itemOffset = i * stride;
    if (itemOffset + size > view.byteLength) break;
    out.push(readScalar(view, itemOffset, accessor.componentType));
  }
  return out;
}

export function generateThumbnail(
  gltfPath: string,
  outputDir: string,
  modelId: string,
  width = 512,
  height = 512
): { thumbnailPath: string; thumbnailUrl: string } {
  width = Math.min(width || 512, 1024); height = Math.min(height || 512, 1024);
  mkdirSync(outputDir, { recursive: true });
  const pngPath = join(outputDir, `${modelId}.png`);

  try {
    const { json: gltf, binData } = readGltfAsset(gltfPath);

    const allTriangles = extractTriangles(gltf, binData);
    let triangles = allTriangles;
    if (triangles.length === 0) {
      return generatePlaceholder(outputDir, modelId, width, height);
    }

    const bounds = computeBounds(allTriangles);

    // Subsample only for extreme assets. Lower caps create visible holes on
    // dense CAD surfaces, which users read as broken faces.
    if (triangles.length > MAX_RENDER_TRIANGLES) {
      const step = triangles.length / MAX_RENDER_TRIANGLES;
      const sampled: Tri[] = [];
      for (let i = 0; i < MAX_RENDER_TRIANGLES; i++) {
        sampled.push(triangles[Math.floor(i * step)]);
      }
      triangles = sampled;
    }

    const center = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
    };
    const sx = bounds.maxX - bounds.minX;
    const sy = bounds.maxY - bounds.minY;
    const sz = bounds.maxZ - bounds.minZ;
    const maxDim = Math.max(sx, sy, sz) || 1;
    const radius = Math.max(Math.sqrt(sx * sx + sy * sy + sz * sz) / 2, maxDim / 2, 0.001);

    const viewDir = vecNormalize(THUMBNAIL_VIEW_DIRECTION);
    const cameraDistance = (radius / Math.sin(THUMBNAIL_FOV / 2)) * 1.25;
    const camera = vecAdd(center, vecScale(viewDir, cameraDistance));
    const forward = vecNormalize(vecSub(center, camera));
    const worldUp: Vec3 = { x: 0, y: 1, z: 0 };
    const right = vecNormalize(vecCross(forward, worldUp));
    const up = vecNormalize(vecCross(right, forward));
    const focal = 1 / Math.tan(THUMBNAIL_FOV / 2);
    const keyLight = vecNormalize(THUMBNAIL_KEY_LIGHT);
    const fillLight = vecNormalize(THUMBNAIL_FILL_LIGHT);

    const projectUnit = (v: Vec3): Projection => {
      const rel = vecSub(v, camera);
      const depth = Math.max(vecDot(rel, forward), cameraDistance * 0.05);
      return {
        x: (vecDot(rel, right) / depth) * focal,
        y: (vecDot(rel, up) / depth) * focal,
        depth,
      };
    };

    const unitTriangles = triangles.map((tri) => {
      const p0 = projectUnit(tri.v0);
      const p1 = projectUnit(tri.v1);
      const p2 = projectUnit(tri.v2);
      return { tri, pts: [p0, p1, p2] as [Projection, Projection, Projection], avgDepth: (p0.depth + p1.depth + p2.depth) / 3 };
    });

    let minPX = Infinity, minPY = Infinity, maxPX = -Infinity, maxPY = -Infinity;
    for (const projected of unitTriangles) {
      for (const p of projected.pts) {
        minPX = Math.min(minPX, p.x);
        minPY = Math.min(minPY, p.y);
        maxPX = Math.max(maxPX, p.x);
        maxPY = Math.max(maxPY, p.y);
      }
    }
    const projectedWidth = Math.max(maxPX - minPX, 0.001);
    const projectedHeight = Math.max(maxPY - minPY, 0.001);
    const margin = 0.60;
    const screenScale = Math.min(width * margin / projectedWidth, height * margin / projectedHeight);
    const screenCx = width / 2 - ((minPX + maxPX) / 2) * screenScale;
    const screenCy = height / 2 + ((minPY + maxPY) / 2) * screenScale;

    type Proj = { x: number; y: number; depth: number };
    const projectedTriangles: { pts: [Proj, Proj, Proj]; avgDepth: number; shade: number; rim: number }[] = [];
    for (const projected of unitTriangles) {
      const normal = vecNormalize({ x: projected.tri.nx, y: projected.tri.ny, z: projected.tri.nz });
      // Two-sided CAD render: mixed winding from STEP/IGES should never create
      // apparent missing faces in thumbnails.
      const key = Math.abs(vecDot(normal, keyLight));
      const fill = Math.abs(vecDot(normal, fillLight)) * 0.35;
      const view = Math.abs(vecDot(normal, viewDir));
      const shade = Math.min(1, 0.42 + key * 0.46 + fill);
      const rim = Math.pow(1 - view, 2) * 0.14;
      projectedTriangles.push({
        pts: [
          { x: screenCx + projected.pts[0].x * screenScale, y: screenCy - projected.pts[0].y * screenScale, depth: projected.pts[0].depth },
          { x: screenCx + projected.pts[1].x * screenScale, y: screenCy - projected.pts[1].y * screenScale, depth: projected.pts[1].depth },
          { x: screenCx + projected.pts[2].x * screenScale, y: screenCy - projected.pts[2].y * screenScale, depth: projected.pts[2].depth },
        ],
        avgDepth: projected.avgDepth,
        shade,
        rim,
      });
    }

    // Render at high resolution for smoothing. Very dense assemblies use 2x
    // to keep thumbnail jobs stable while still preserving all faces.
    const ss = triangles.length > HIGH_QUALITY_SUPERSAMPLE_LIMIT ? 2 : 4;
    const hiW = width * ss, hiH = height * ss;
    const hiCanvas = createCanvas(hiW, hiH);
    const hiCtx = hiCanvas.getContext("2d");
    const image = hiCtx.createImageData(hiW, hiH);
    const pixels = image.data;
    const zBuffer = new Float32Array(hiW * hiH);
    zBuffer.fill(Number.POSITIVE_INFINITY);

    // Background gradient. Filling the image buffer directly avoids mixing
    // Canvas painter ordering with the CAD depth pass below.
    for (let y = 0; y < hiH; y++) {
      for (let x = 0; x < hiW; x++) {
        const t = (x + y) / Math.max(1, hiW + hiH - 2);
        const offset = (y * hiW + x) * 4;
        pixels[offset] = clampByte(lerp(245, 232, t));
        pixels[offset + 1] = clampByte(lerp(246, 234, t));
        pixels[offset + 2] = clampByte(lerp(248, 239, t));
        pixels[offset + 3] = 255;
      }
    }

    // Scale projected triangles to the supersampled buffer.
    const hiTriangles: { pts: [Proj, Proj, Proj]; shade: number; rim: number }[] = [];
    for (const tri of projectedTriangles) {
      hiTriangles.push({
        pts: [
          { x: tri.pts[0].x * ss, y: tri.pts[0].y * ss, depth: tri.pts[0].depth },
          { x: tri.pts[1].x * ss, y: tri.pts[1].y * ss, depth: tri.pts[1].depth },
          { x: tri.pts[2].x * ss, y: tri.pts[2].y * ss, depth: tri.pts[2].depth },
        ],
        shade: tri.shade,
        rim: tri.rim,
      });
    }

    // Draw solid faces with a z-buffer. Average-depth sorting is fast but
    // creates broken-looking faces on CAD assemblies with intersecting or
    // nested parts. A real depth pass keeps thumbnails visually consistent
    // with the browser/WebGL preview.
    for (const { pts, shade, rim } of hiTriangles) {
      const light = Math.min(1.15, shade + rim);
      const r = clampByte(THUMBNAIL_BASE_COLOR.r * light + 12);
      const g = clampByte(THUMBNAIL_BASE_COLOR.g * light + 12);
      const b = clampByte(THUMBNAIL_BASE_COLOR.b * light + 12);
      const area = edgeFunction(pts[0], pts[1], pts[2].x, pts[2].y);
      if (Math.abs(area) < 0.0001) continue;
      const invArea = 1 / area;
      const minX = Math.max(0, Math.floor(Math.min(pts[0].x, pts[1].x, pts[2].x)));
      const maxX = Math.min(hiW - 1, Math.ceil(Math.max(pts[0].x, pts[1].x, pts[2].x)));
      const minY = Math.max(0, Math.floor(Math.min(pts[0].y, pts[1].y, pts[2].y)));
      const maxY = Math.min(hiH - 1, Math.ceil(Math.max(pts[0].y, pts[1].y, pts[2].y)));

      for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5;
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const w0 = edgeFunction(pts[1], pts[2], px, py) * invArea;
          const w1 = edgeFunction(pts[2], pts[0], px, py) * invArea;
          const w2 = 1 - w0 - w1;
          if (w0 < -0.00001 || w1 < -0.00001 || w2 < -0.00001) continue;

          const depth = w0 * pts[0].depth + w1 * pts[1].depth + w2 * pts[2].depth;
          const pixelIndex = y * hiW + x;
          if (depth >= zBuffer[pixelIndex]) continue;
          zBuffer[pixelIndex] = depth;
          const offset = pixelIndex * 4;
          pixels[offset] = r;
          pixels[offset + 1] = g;
          pixels[offset + 2] = b;
          pixels[offset + 3] = 255;
        }
      }
    }
    hiCtx.putImageData(image, 0, 0);

    // Downscale supersampled render → 1x with bilinear smoothing.
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(hiCanvas, 0, 0, hiW, hiH, 0, 0, width, height);

    writeFileSync(pngPath, canvas.toBuffer("image/png"));
    return { thumbnailPath: pngPath, thumbnailUrl: `/static/thumbnails/${modelId}.png` };
  } catch {
    return generatePlaceholder(outputDir, modelId, width, height);
  }
}

function extractTriangles(gltf: any, binData: Buffer): Tri[] {
  const triangles: Tri[] = [];
  const accessors: any[] = Array.from(gltf.accessors || []);
  const bufferViews: any[] = Array.from(gltf.bufferViews || []);
  const meshes: any[] = Array.from(gltf.meshes || []);
  const nodes: any[] = Array.from(gltf.nodes || []);

  const addMeshTriangles = (meshIndex: number, matrix: Mat4) => {
    const mesh = meshes[meshIndex];
    if (!mesh) return;
    for (const prim of mesh.primitives || []) {
      const posIdx = prim.attributes?.POSITION;
      if (posIdx === undefined) continue;
      const posAcc = accessors[posIdx];
      if (!posAcc) continue;
      const posBv = bufferViews[posAcc.bufferView];

      const positions = readVec3Accessor(posAcc, posBv, binData).map((v) => transformPoint(v, matrix));

      // Read normals if available
      let normals: Vec3[] | null = null;
      const normIdx = prim.attributes?.NORMAL;
      if (normIdx !== undefined) {
        const normAcc = accessors[normIdx];
        if (normAcc) {
          const normBv = bufferViews[normAcc.bufferView];
          normals = readVec3Accessor(normAcc, normBv, binData).map((v) => transformNormal(v, matrix));
        }
      }

      // Build triangles from indices or directly
      if (prim.indices !== undefined) {
        const idxAcc = accessors[prim.indices];
        if (!idxAcc) continue;
        const idxBv = bufferViews[idxAcc.bufferView];
        const indices = readIndexAccessor(idxAcc, idxBv, binData);
        for (let i = 0; i + 2 < indices.length; i += 3) {
          const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
          if (i0 >= positions.length || i1 >= positions.length || i2 >= positions.length) continue;

          // Use per-face normal: average vertex normals or compute from cross product
          let nx = 0, ny = 0, nz = 0;
          if (normals) {
            nx = (normals[i0].x + normals[i1].x + normals[i2].x) / 3;
            ny = (normals[i0].y + normals[i1].y + normals[i2].y) / 3;
            nz = (normals[i0].z + normals[i1].z + normals[i2].z) / 3;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= len; ny /= len; nz /= len;
          } else {
            // Compute from cross product
            const e1x = positions[i1].x - positions[i0].x, e1y = positions[i1].y - positions[i0].y, e1z = positions[i1].z - positions[i0].z;
            const e2x = positions[i2].x - positions[i0].x, e2y = positions[i2].y - positions[i0].y, e2z = positions[i2].z - positions[i0].z;
            nx = e1y * e2z - e1z * e2y;
            ny = e1z * e2x - e1x * e2z;
            nz = e1x * e2y - e1y * e2x;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= len; ny /= len; nz /= len;
          }

          triangles.push({ v0: positions[i0], v1: positions[i1], v2: positions[i2], nx, ny, nz });
        }
      } else {
        // Non-indexed: every 3 verts = 1 triangle
        for (let i = 0; i + 2 < positions.length; i += 3) {
          const e1x = positions[i + 1].x - positions[i].x, e1y = positions[i + 1].y - positions[i].y, e1z = positions[i + 1].z - positions[i].z;
          const e2x = positions[i + 2].x - positions[i].x, e2y = positions[i + 2].y - positions[i].y, e2z = positions[i + 2].z - positions[i].z;
          let nx = e1y * e2z - e1z * e2y;
          let ny = e1z * e2x - e1x * e2z;
          let nz = e1x * e2y - e1y * e2x;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= len; ny /= len; nz /= len;
          triangles.push({ v0: positions[i], v1: positions[i + 1], v2: positions[i + 2], nx, ny, nz });
        }
      }
    }
  };

  const visitNode = (nodeIndex: number, parentMatrix: Mat4) => {
    const node = nodes[nodeIndex];
    if (!node) return;
    const matrix = multiplyMat4(parentMatrix, composeNodeMatrix(node));
    if (typeof node.mesh === "number") addMeshTriangles(node.mesh, matrix);
    for (const childIndex of node.children || []) {
      visitNode(childIndex, matrix);
    }
  };

  const scene = gltf.scenes?.[typeof gltf.scene === "number" ? gltf.scene : 0];
  const rootNodes = Array.isArray(scene?.nodes) ? scene.nodes : [];
  if (rootNodes.length > 0 && nodes.length > 0) {
    for (const nodeIndex of rootNodes) visitNode(nodeIndex, identityMat4());
  } else {
    for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
      addMeshTriangles(meshIndex, identityMat4());
    }
  }

  return triangles;
}

function generatePlaceholder(
  outputDir: string,
  modelId: string,
  width: number,
  height: number
): { thumbnailPath: string; thumbnailUrl: string } {
  const pngPath = join(outputDir, `${modelId}.png`);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#e8eaed";
  ctx.fillRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2;
  const size = Math.min(width, height) / 4;

  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size, cy);
  ctx.lineTo(cx, cy + size);
  ctx.lineTo(cx - size, cy);
  ctx.closePath();
  ctx.fillStyle = "#b0b8c4";
  ctx.fill();
  ctx.strokeStyle = "#8090a0";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "rgba(80, 90, 100, 0.8)";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("3D 模型", cx, cy + size + 30);

  writeFileSync(pngPath, canvas.toBuffer("image/png"));
  return { thumbnailPath: pngPath, thumbnailUrl: `/static/thumbnails/${modelId}.png` };
}
