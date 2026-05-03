import { prisma } from "../lib/prisma.js";
import { readGltfAsset, resolveFileUrlPath } from "./gltfAsset.js";
import { MODEL_STATUS } from "./modelStatus.js";

interface ModelStats {
  id: string;
  name: string;
  format: string;
  gltfSize: number;
  originalSize: number;
  vertexCount: number;
  faceCount: number;
  dimensions: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null;
  status: string;
}

function extractGltfStats(gltfPath: string): { vertexCount: number; faceCount: number; dimensions: any } | null {
  try {
    const { json: gltf } = readGltfAsset(gltfPath);
    let vertexCount = 0;
    let faceCount = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    const accessors: any[] = Array.from(gltf.accessors || []);
    const meshes: any[] = Array.from(gltf.meshes || []);

    for (const mesh of meshes) {
      for (const prim of (mesh.primitives || [])) {
        const posIdx = prim.attributes?.POSITION;
        let primitiveVertexCount = 0;
        if (posIdx !== undefined) {
          const acc = accessors[posIdx];
          if (acc) {
            primitiveVertexCount = acc.count || 0;
            vertexCount += primitiveVertexCount;
            // Use min/max from accessor if available
            if (acc.min) {
              minX = Math.min(minX, acc.min[0]);
              minY = Math.min(minY, acc.min[1]);
              minZ = Math.min(minZ, acc.min[2]);
            }
            if (acc.max) {
              maxX = Math.max(maxX, acc.max[0]);
              maxY = Math.max(maxY, acc.max[1]);
              maxZ = Math.max(maxZ, acc.max[2]);
            }
          }
        }
        // Count faces from indices
        if (prim.indices !== undefined) {
          const idxAcc = accessors[prim.indices];
          if (idxAcc) faceCount += Math.floor((idxAcc.count || 0) / 3);
        } else if (primitiveVertexCount > 0) {
          // Non-indexed: each primitive contributes its own vertexCount / 3.
          faceCount += Math.floor(primitiveVertexCount / 3);
        }
      }
    }

    const dimensions = (minX !== Infinity) ? { minX, minY, minZ, maxX, maxY, maxZ } : null;
    return { vertexCount, faceCount, dimensions };
  } catch {
    return null;
  }
}

export async function compareModels(id1: string, id2: string) {
  if (!prisma) throw new Error("数据库未连接");

  const [m1, m2] = await Promise.all([
    prisma.model.findUnique({ where: { id: id1 } }),
    prisma.model.findUnique({ where: { id: id2 } }),
  ]);

  if (!m1 || !m2) throw new Error("模型不存在");
  if (m1.status !== MODEL_STATUS.COMPLETED || m2.status !== MODEL_STATUS.COMPLETED) {
    throw new Error("模型不存在");
  }

  // Try to extract stats from glTF files
  let stats1: { vertexCount: number; faceCount: number; dimensions: any } | null = null;
  let stats2: { vertexCount: number; faceCount: number; dimensions: any } | null = null;

  try {
    const path1 = resolveFileUrlPath(m1.gltfUrl);
    if (path1) stats1 = extractGltfStats(path1);
  } catch { /* ignore */ }

  try {
    const path2 = resolveFileUrlPath(m2.gltfUrl);
    if (path2) stats2 = extractGltfStats(path2);
  } catch { /* ignore */ }

  const info1: ModelStats = {
    id: m1.id, name: m1.name, format: m1.format,
    gltfSize: m1.gltfSize, originalSize: m1.originalSize,
    vertexCount: stats1?.vertexCount || 0,
    faceCount: stats1?.faceCount || 0,
    dimensions: stats1?.dimensions || null,
    status: m1.status,
  };

  const info2: ModelStats = {
    id: m2.id, name: m2.name, format: m2.format,
    gltfSize: m2.gltfSize, originalSize: m2.originalSize,
    vertexCount: stats2?.vertexCount || 0,
    faceCount: stats2?.faceCount || 0,
    dimensions: stats2?.dimensions || null,
    status: m2.status,
  };

  // Compute differences
  const diff = {
    gltfSizeDiff: info2.gltfSize - info1.gltfSize,
    originalSizeDiff: info2.originalSize - info1.originalSize,
    vertexCountDiff: info2.vertexCount - info1.vertexCount,
    faceCountDiff: info2.faceCount - info1.faceCount,
    volumeDiff: computeVolumeDiff(info1.dimensions, info2.dimensions),
  };

  return { model1: info1, model2: info2, diff };
}

function computeVolumeDiff(d1: any, d2: any): number | null {
  if (!d1 || !d2) return null;
  const v1 = (d1.maxX - d1.minX) * (d1.maxY - d1.minY) * (d1.maxZ - d1.minZ);
  const v2 = (d2.maxX - d2.minX) * (d2.maxY - d2.minY) * (d2.maxZ - d2.minZ);
  return v2 - v1;
}
