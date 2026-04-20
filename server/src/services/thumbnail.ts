import { createCanvas } from "canvas";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

interface Vec3 { x: number; y: number; z: number }
interface Tri { v0: Vec3; v1: Vec3; v2: Vec3; nx: number; ny: number; nz: number }

export function generateThumbnail(
  gltfPath: string,
  outputDir: string,
  modelId: string,
  width = 512,
  height = 512
): { thumbnailPath: string; thumbnailUrl: string } {
  mkdirSync(outputDir, { recursive: true });
  const pngPath = join(outputDir, `${modelId}.png`);

  try {
    const gltfContent = readFileSync(gltfPath, "utf-8");
    const gltf = JSON.parse(gltfContent);
    const binPath = gltfPath.replace(".gltf", ".bin");
    const binData = readFileSync(binPath);

    const triangles = extractTriangles(gltf, binData);
    if (triangles.length === 0) {
      return generatePlaceholder(outputDir, modelId, width, height);
    }

    // Compute bounding box
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const tri of triangles) {
      for (const v of [tri.v0, tri.v1, tri.v2]) {
        minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); minZ = Math.min(minZ, v.z);
        maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y); maxZ = Math.max(maxZ, v.z);
      }
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;

    // Rotation angles for isometric-ish view
    const cosA = Math.cos(0.6), sinA = Math.sin(0.6);
    const cosB = Math.cos(0.4), sinB = Math.sin(0.4);

    // Project, rotate, scale
    const scale = Math.min(width, height) * 0.32 / size;
    type Proj = { x: number; y: number; z: number };
    const projectedTriangles: { pts: [Proj, Proj, Proj]; avgZ: number; shade: number }[] = [];

    // Light direction (normalized) — from upper-right-front
    const lx = 0.4, ly = 0.7, lz = 0.5;
    const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);

    for (const tri of triangles) {
      const project = (v: Vec3): Proj => {
        const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
        // Y-axis rotation
        const rx = dx * cosA - dz * sinA;
        const rz1 = dx * sinA + dz * cosA;
        // X-axis rotation
        const ry = dy * cosB - rz1 * sinB;
        const rz = dy * sinB + rz1 * cosB;
        return { x: width / 2 + rx * scale, y: height / 2 - ry * scale, z: rz };
      };

      const p0 = project(tri.v0), p1 = project(tri.v1), p2 = project(tri.v2);
      const avgZ = (p0.z + p1.z + p2.z) / 3;

      // Compute face normal in projected space for shading
      const e1x = p1.x - p0.x, e1y = p1.y - p0.y;
      const e2x = p2.x - p0.x, e2y = p2.y - p0.y;
      // Cross product z-component (for front/back face detection)
      const cross = e1x * e2y - e1y * e2x;
      if (cross > 0) continue; // back-face cull

      // Use original normal for shading
      const shade = Math.max(0, (tri.nx * lx + tri.ny * ly + tri.nz * lz) / ll);

      projectedTriangles.push({ pts: [p0, p1, p2], avgZ, shade });
    }

    // Sort back-to-front (painter's algorithm)
    projectedTriangles.sort((a, b) => a.avgZ - b.avgZ);

    // Render at 4x resolution for aggressive smoothing
    const ss = 4;
    const hiW = width * ss, hiH = height * ss;
    const hiCanvas = createCanvas(hiW, hiH);
    const hiCtx = hiCanvas.getContext("2d");

    // Background gradient
    const bgGrad = hiCtx.createLinearGradient(0, 0, hiW, hiH);
    bgGrad.addColorStop(0, "#f5f6f8");
    bgGrad.addColorStop(1, "#e8eaef");
    hiCtx.fillStyle = bgGrad;
    hiCtx.fillRect(0, 0, hiW, hiH);

    // Scale projected triangles to 4x
    const hiTriangles: { pts: [Proj, Proj, Proj]; shade: number }[] = [];
    for (const tri of projectedTriangles) {
      hiTriangles.push({
        pts: [
          { x: tri.pts[0].x * ss, y: tri.pts[0].y * ss, z: tri.pts[0].z },
          { x: tri.pts[1].x * ss, y: tri.pts[1].y * ss, z: tri.pts[1].z },
          { x: tri.pts[2].x * ss, y: tri.pts[2].y * ss, z: tri.pts[2].z },
        ],
        shade: tri.shade,
      });
    }

    // Draw solid faces with shading
    for (const { pts, shade } of hiTriangles) {
      const ambient = 0.35;
      const light = ambient + shade * (1 - ambient);
      const r = Math.round(170 * light + 40);
      const g = Math.round(180 * light + 45);
      const b = Math.round(195 * light + 35);

      hiCtx.beginPath();
      hiCtx.moveTo(pts[0].x, pts[0].y);
      hiCtx.lineTo(pts[1].x, pts[1].y);
      hiCtx.lineTo(pts[2].x, pts[2].y);
      hiCtx.closePath();
      hiCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      hiCtx.fill();
    }

    // Apply strong Gaussian blur to fully blend facets into smooth surfaces
    const blurCanvas = createCanvas(hiW, hiH);
    const blurCtx = blurCanvas.getContext("2d");
    blurCtx.filter = `blur(${ss * 2}px)`;
    blurCtx.drawImage(hiCanvas, 0, 0);
    // Use fully blurred version for smooth surface appearance
    hiCtx.drawImage(blurCanvas, 0, 0);

    // Downscale 4x → 1x with bilinear smoothing
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

  for (const mesh of meshes) {
    for (const prim of mesh.primitives || []) {
      const posIdx = prim.attributes?.POSITION;
      if (posIdx === undefined) continue;
      const posAcc = accessors[posIdx];
      if (!posAcc) continue;
      const posBv = bufferViews[posAcc.bufferView];

      // Read positions
      const posOffset = posBv.byteOffset || 0;
      const posFloat = new Float32Array(binData.buffer, binData.byteOffset + posOffset, posAcc.count * 3);
      const positions: Vec3[] = [];
      for (let i = 0; i < posAcc.count; i++) {
        positions.push({ x: posFloat[i * 3], y: posFloat[i * 3 + 1], z: posFloat[i * 3 + 2] });
      }

      // Read normals if available
      let normals: Vec3[] | null = null;
      const normIdx = prim.attributes?.NORMAL;
      if (normIdx !== undefined) {
        const normAcc = accessors[normIdx];
        if (normAcc) {
          const normBv = bufferViews[normAcc.bufferView];
          const normOffset = normBv.byteOffset || 0;
          const normFloat = new Float32Array(binData.buffer, binData.byteOffset + normOffset, normAcc.count * 3);
          normals = [];
          for (let i = 0; i < normAcc.count; i++) {
            normals.push({ x: normFloat[i * 3], y: normFloat[i * 3 + 1], z: normFloat[i * 3 + 2] });
          }
        }
      }

      // Build triangles from indices or directly
      if (prim.indices !== undefined) {
        const idxAcc = accessors[prim.indices];
        if (!idxAcc) continue;
        const idxBv = bufferViews[idxAcc.bufferView];
        const idxOffset = idxBv.byteOffset || 0;
        let indices: Uint32Array | Uint16Array;
        if (idxAcc.componentType === 5125) {
          indices = new Uint32Array(binData.buffer, binData.byteOffset + idxOffset, idxAcc.count);
        } else {
          indices = new Uint16Array(binData.buffer, binData.byteOffset + idxOffset, idxAcc.count);
        }
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
