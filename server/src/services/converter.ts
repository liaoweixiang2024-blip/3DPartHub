import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, basename } from 'node:path';
import { normalizeCadLabel } from '../lib/filenameEncoding.js';
import { persistFile } from '../lib/storageProvider.js';
const require = createRequire(import.meta.url);
const occtimportjs = require('occt-import-js');

interface OcctMesh {
  index?: { array: ArrayLike<number> };
  attributes: {
    position: { array: ArrayLike<number> };
    normal?: { array: ArrayLike<number> };
  };
  color?: [number, number, number];
  name?: string;
}

interface OcctResult {
  meshes: OcctMesh[];
}

interface OcctImportParams {
  linearDeflectionType: 'bounding_box_ratio';
  linearDeflection: number;
  angularDeflection: number;
}

interface BoundsMeta {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
}

export interface GltfAsset {
  modelId: string;
  gltfPath: string;
  gltfUrl: string;
  originalName: string;
  gltfSize: number;
  originalSize: number;
  previewMeta: PreviewMeta;
}

export interface ConvertStepToGltfOptions {
  urlBase?: string;
}

interface PreviewPartMeta {
  id: string;
  name: string;
  color: string | null;
  sourceMeshIndex: number;
  vertexCount: number;
  faceCount: number;
  bounds: BoundsMeta;
}

export interface PreviewMeta {
  version: 2;
  sourceName: string;
  sourceFormat: string;
  unit: 'mm';
  parts: PreviewPartMeta[];
  totals: {
    partCount: number;
    vertexCount: number;
    faceCount: number;
  };
  bounds: BoundsMeta;
  tree: Array<{ id: string; name: string; children: string[] }>;
  diagnostics: {
    generatedAt: string;
    converter: 'occt-import-js' | 'gmsh-fallback';
    tessellation: OcctImportParams;
    sourceMeshCount: number;
    validMeshCount: number;
    skippedMeshCount: number;
    conversionMs: number;
    asset?: {
      gltfSize: number;
      originalSize: number;
      compressionRatio: number | null;
      cacheVersion?: string;
    };
    optimization: {
      indexComponentTypes: {
        uint16: number;
        uint32: number;
      };
      indexBytesSaved: number;
      duplicateMaterialsMerged?: number;
    };
    performance?: {
      level: 'normal' | 'large' | 'huge';
      hints: string[];
    };
    precheck?: {
      sourceBytes: number;
      sourceLevel: 'normal' | 'large' | 'huge';
      estimatedPeakMemoryMb: number;
      hints: string[];
    };
    warnings: string[];
  };
}

type GltfIndexArray = Uint16Array | Uint32Array;

function colorToHex(color?: [number, number, number]): string | null {
  if (!color) return null;
  const [r, g, b] = color;
  const toByte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
  return `#${[toByte(r), toByte(g), toByte(b)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function safePartName(name: string | undefined, index: number): string {
  return normalizeCadLabel(name, `Part ${index + 1}`);
}

function makeBounds(min: [number, number, number], max: [number, number, number]): BoundsMeta {
  const size: [number, number, number] = [
    Math.max(0, max[0] - min[0]),
    Math.max(0, max[1] - min[1]),
    Math.max(0, max[2] - min[2]),
  ];
  return {
    min,
    max,
    size,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  };
}

function emptyBounds(): BoundsMeta {
  return makeBounds([0, 0, 0], [0, 0, 0]);
}

function expandBounds(
  bounds: { min: [number, number, number]; max: [number, number, number] },
  partMin: [number, number, number],
  partMax: [number, number, number],
) {
  for (let i = 0; i < 3; i++) {
    bounds.min[i] = Math.min(bounds.min[i], partMin[i]);
    bounds.max[i] = Math.max(bounds.max[i], partMax[i]);
  }
}

function compactIndexArray(values: Uint32Array | number[], usableCount: number, vertexCount: number): GltfIndexArray {
  const canUseUint16 = vertexCount <= 65535;
  const source =
    values instanceof Uint32Array ? (usableCount === values.length ? values : values.slice(0, usableCount)) : values;
  return canUseUint16 ? Uint16Array.from(source) : Uint32Array.from(source);
}

function getPerformanceDiagnostics(
  totals: { partCount: number; vertexCount: number; faceCount: number },
  gltfSize: number,
): PreviewMeta['diagnostics']['performance'] {
  const hints: string[] = [];
  let level: 'normal' | 'large' | 'huge' = 'normal';

  if (totals.faceCount >= 1_500_000 || totals.vertexCount >= 3_000_000 || gltfSize >= 120 * 1024 * 1024) {
    level = 'huge';
    hints.push('模型规模很大，建议控制转换并发，并优先评估不降低几何质量的压缩与缓存策略。');
  } else if (totals.faceCount >= 500_000 || totals.vertexCount >= 1_000_000 || gltfSize >= 50 * 1024 * 1024) {
    level = 'large';
    hints.push('模型规模偏大，移动端首次加载可能较慢。');
  }

  if (totals.partCount >= 1500) {
    hints.push('零件数量较多，后续可考虑合并静态小零件或启用懒加载。');
    if (level === 'normal') level = 'large';
  }

  return { level, hints };
}

function getPrecheckDiagnostics(sourceBytes: number): NonNullable<PreviewMeta['diagnostics']['precheck']> {
  const hints: string[] = [];
  let sourceLevel: 'normal' | 'large' | 'huge' = 'normal';
  const sourceMb = sourceBytes / 1024 / 1024;
  const estimatedPeakMemoryMb = Math.max(64, Math.ceil(sourceMb * 10));

  if (sourceBytes >= 80 * 1024 * 1024) {
    sourceLevel = 'huge';
    hints.push('源文件很大，转换和首次预览可能占用较高内存。');
  } else if (sourceBytes >= 40 * 1024 * 1024) {
    sourceLevel = 'large';
    hints.push('源文件偏大，建议在低峰期批量重建预览。');
  }

  if (estimatedPeakMemoryMb >= 1024) {
    hints.push('预估峰值内存超过 1GB，建议避免同时开启过高转换并发。');
  }

  return { sourceBytes, sourceLevel, estimatedPeakMemoryMb, hints };
}

function versionedAssetUrl(url: string, version: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}

function meshesToGltf(
  meshes: OcctMesh[],
  sourceName: string,
  options: {
    sourceFormat: string;
    sourceMeshCount: number;
    skippedMeshCount: number;
    tessellation: OcctImportParams;
    conversionMs: number;
  },
): { json: object; bin: Buffer; meta: PreviewMeta } {
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const materials: object[] = [];
  const gltfMeshes: object[] = [];
  const nodes: object[] = [{ name: 'converted_model', children: [], extras: { sourceName } }];
  const parts: PreviewPartMeta[] = [];
  const warnings: string[] = [];
  type GltfPrimitive = {
    attributes: Record<string, number>;
    material: number;
    mode: number;
    extras: { partId: string; name: string; vertexCount: number; faceCount: number };
    indices?: number;
  };
  const optimization = {
    indexComponentTypes: { uint16: 0, uint32: 0 },
    indexBytesSaved: 0,
    duplicateMaterialsMerged: 0,
  };
  const materialCache = new Map<string, number>();
  const modelBounds = {
    min: [Infinity, Infinity, Infinity] as [number, number, number],
    max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
  };
  let byteOffset = 0;
  let defaultMaterialIdx = -1;

  const buffers: Buffer[] = [];

  function getDefaultMaterialIdx(): number {
    if (defaultMaterialIdx !== -1) return defaultMaterialIdx;
    defaultMaterialIdx = materials.length;
    materials.push({
      pbrMetallicRoughness: {
        baseColorFactor: [0.75, 0.75, 0.78, 1],
        metallicFactor: 0.3,
        roughnessFactor: 0.5,
      },
      name: 'default',
      doubleSided: true,
    });
    return defaultMaterialIdx;
  }

  for (let mi = 0; mi < meshes.length; mi++) {
    const mesh = meshes[mi];
    let posArray = new Float32Array(mesh.attributes.position.array);
    const vertexCount = Math.floor(posArray.length / 3);
    if (vertexCount < 3) continue;
    if (posArray.length !== vertexCount * 3) {
      posArray = posArray.slice(0, vertexCount * 3);
    }

    const rawNormArray = mesh.attributes.normal ? new Float32Array(mesh.attributes.normal.array) : null;
    const normArray =
      rawNormArray && rawNormArray.length >= vertexCount * 3 ? rawNormArray.slice(0, vertexCount * 3) : null;

    let idxArray: GltfIndexArray | null = null;
    if (mesh.index?.array && mesh.index.array.length >= 3) {
      const rawIndexArray = new Uint32Array(mesh.index.array);
      const usableIndexCount = Math.floor(rawIndexArray.length / 3) * 3;
      let needsSanitize = usableIndexCount !== rawIndexArray.length;

      for (let i = 0; i + 2 < usableIndexCount; i += 3) {
        const a = rawIndexArray[i];
        const b = rawIndexArray[i + 1];
        const c = rawIndexArray[i + 2];
        if (a >= vertexCount || b >= vertexCount || c >= vertexCount || a === b || b === c || a === c) {
          needsSanitize = true;
          break;
        }
      }

      if (needsSanitize) {
        const sanitized: number[] = [];
        for (let i = 0; i + 2 < usableIndexCount; i += 3) {
          const a = rawIndexArray[i];
          const b = rawIndexArray[i + 1];
          const c = rawIndexArray[i + 2];
          if (a < vertexCount && b < vertexCount && c < vertexCount && a !== b && b !== c && a !== c) {
            sanitized.push(a, b, c);
          }
        }
        if (sanitized.length >= 3) {
          idxArray = compactIndexArray(sanitized, sanitized.length, vertexCount);
          warnings.push(`${safePartName(mesh.name, mi)}: invalid or degenerate triangle indices were removed`);
        }
      } else {
        idxArray = compactIndexArray(rawIndexArray, usableIndexCount, vertexCount);
      }

      if (idxArray) {
        if (idxArray instanceof Uint16Array) {
          optimization.indexComponentTypes.uint16++;
          optimization.indexBytesSaved += idxArray.length * 2;
        } else {
          optimization.indexComponentTypes.uint32++;
        }
      }
    }

    const posBV = { buffer: 0, byteOffset, byteLength: posArray.byteLength, target: 34962 };
    const posAcc = {
      bufferView: bufferViews.length,
      componentType: 5126,
      count: vertexCount,
      type: 'VEC3',
      max: [-Infinity, -Infinity, -Infinity] as number[],
      min: [Infinity, Infinity, Infinity] as number[],
    };
    for (let i = 0; i < vertexCount; i++) {
      for (let j = 0; j < 3; j++) {
        const v = posArray[i * 3 + j];
        if (v > posAcc.max[j]) posAcc.max[j] = v;
        if (v < posAcc.min[j]) posAcc.min[j] = v;
      }
    }
    const posAccessorIdx = accessors.length;
    bufferViews.push(posBV);
    accessors.push(posAcc);
    buffers.push(Buffer.from(posArray.buffer, posArray.byteOffset, posArray.byteLength));
    byteOffset += posArray.byteLength;

    let normalAccessorIdx = -1;
    if (normArray) {
      const normBV = { buffer: 0, byteOffset, byteLength: normArray.byteLength, target: 34962 };
      normalAccessorIdx = accessors.length;
      bufferViews.push(normBV);
      accessors.push({
        bufferView: normalAccessorIdx,
        componentType: 5126,
        count: vertexCount,
        type: 'VEC3',
      });
      buffers.push(Buffer.from(normArray.buffer, normArray.byteOffset, normArray.byteLength));
      byteOffset += normArray.byteLength;
    }

    let indexAccessorIdx = -1;
    if (idxArray) {
      const idxBV = { buffer: 0, byteOffset, byteLength: idxArray.byteLength, target: 34933 };
      indexAccessorIdx = accessors.length;
      bufferViews.push(idxBV);
      let minIndex = Infinity;
      let maxIndex = -Infinity;
      for (const index of idxArray) {
        if (index < minIndex) minIndex = index;
        if (index > maxIndex) maxIndex = index;
      }
      accessors.push({
        bufferView: indexAccessorIdx,
        componentType: idxArray instanceof Uint16Array ? 5123 : 5125,
        count: idxArray.length,
        type: 'SCALAR',
        min: [minIndex],
        max: [maxIndex],
      });
      buffers.push(Buffer.from(idxArray.buffer, idxArray.byteOffset, idxArray.byteLength));
      byteOffset += idxArray.byteLength;
    }

    const faceCount = idxArray ? Math.floor(idxArray.length / 3) : Math.floor(vertexCount / 3);
    const partId = `part_${parts.length + 1}`;
    const partName = safePartName(mesh.name, mi);
    const partMin = posAcc.min as [number, number, number];
    const partMax = posAcc.max as [number, number, number];
    expandBounds(modelBounds, partMin, partMax);

    let materialIdx = 0;
    if (mesh.color) {
      let [r, g, b] = mesh.color;
      // Boost very dark colors for better visibility in dark theme
      if (r + g + b < 1.0) {
        r = Math.max(r, 0.55);
        g = Math.max(g, 0.55);
        b = Math.max(b, 0.58);
      }
      const materialKey = `${r.toFixed(4)}:${g.toFixed(4)}:${b.toFixed(4)}`;
      const existingMaterialIdx = materialCache.get(materialKey);
      if (existingMaterialIdx !== undefined) {
        materialIdx = existingMaterialIdx;
        optimization.duplicateMaterialsMerged++;
      } else {
        materialIdx = materials.length;
        materialCache.set(materialKey, materialIdx);
        materials.push({
          pbrMetallicRoughness: {
            baseColorFactor: [r, g, b, 1],
            metallicFactor: 0.3,
            roughnessFactor: 0.5,
          },
          name: normalizeCadLabel(mesh.name, `material_${mi}`),
          doubleSided: true,
        });
      }
    } else {
      materialIdx = getDefaultMaterialIdx();
    }

    const prim: GltfPrimitive = {
      attributes: { POSITION: posAccessorIdx },
      material: materialIdx,
      mode: 4,
      extras: { partId, name: partName, vertexCount, faceCount },
    };
    if (normArray) prim.attributes.NORMAL = normalAccessorIdx;
    if (idxArray) prim.indices = indexAccessorIdx;

    const meshIdx = gltfMeshes.length;
    gltfMeshes.push({
      name: partName,
      primitives: [prim],
      extras: { partId, name: partName, vertexCount, faceCount },
    });

    const nodeIdx = nodes.length;
    (nodes[0] as { children: number[] }).children.push(nodeIdx);
    nodes.push({
      mesh: meshIdx,
      name: partName,
      extras: {
        partId,
        name: partName,
        color: colorToHex(mesh.color),
        vertexCount,
        faceCount,
      },
    });

    parts.push({
      id: partId,
      name: partName,
      color: colorToHex(mesh.color),
      sourceMeshIndex: mi,
      vertexCount,
      faceCount,
      bounds: makeBounds(partMin, partMax),
    });
  }

  const totalBuffer = Buffer.concat(buffers);
  const totals = parts.reduce(
    (acc, part) => {
      acc.vertexCount += part.vertexCount;
      acc.faceCount += part.faceCount;
      return acc;
    },
    { partCount: parts.length, vertexCount: 0, faceCount: 0 },
  );

  const bounds = parts.length > 0 ? makeBounds(modelBounds.min, modelBounds.max) : emptyBounds();
  (nodes[0] as { extras: Record<string, unknown> }).extras = {
    sourceName,
    sourceFormat: options.sourceFormat,
    unit: 'mm',
    totals,
    bounds,
  };

  const json = {
    asset: { version: '2.0', generator: 'model-converter' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: totalBuffer.length }],
    extras: {
      sourceName,
      sourceFormat: options.sourceFormat,
      unit: 'mm',
      totals,
      bounds,
    },
  };

  const meta: PreviewMeta = {
    version: 2,
    sourceName,
    sourceFormat: options.sourceFormat,
    unit: 'mm',
    parts,
    totals,
    bounds,
    tree: [{ id: 'root', name: sourceName.replace(/\.[^.]+$/, '') || 'Model', children: parts.map((part) => part.id) }],
    diagnostics: {
      generatedAt: new Date().toISOString(),
      converter: 'occt-import-js',
      tessellation: options.tessellation,
      sourceMeshCount: options.sourceMeshCount,
      validMeshCount: meshes.length,
      skippedMeshCount: options.skippedMeshCount,
      conversionMs: options.conversionMs,
      optimization,
      warnings,
    },
  };

  return { json, bin: totalBuffer, meta };
}

function paddedBuffer(data: Buffer, paddingByte = 0): Buffer {
  const padding = (4 - (data.byteLength % 4)) % 4;
  if (padding === 0) return data;
  return Buffer.concat([data, Buffer.alloc(padding, paddingByte)]);
}

function chunkHeader(length: number, type: number): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(length, 0);
  header.writeUInt32LE(type, 4);
  return header;
}

function writeGlb(gltf: object, binData: Buffer, outputDir: string, modelId: string): string {
  const glbPath = join(outputDir, `${modelId}.glb`);
  const gltfAny = JSON.parse(JSON.stringify(gltf));

  const jsonChunk = paddedBuffer(Buffer.from(JSON.stringify(gltfAny), 'utf8'), 0x20);
  const binChunk = paddedBuffer(binData);
  const totalLength = 12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  writeFileSync(
    glbPath,
    Buffer.concat([
      header,
      chunkHeader(jsonChunk.byteLength, 0x4e4f534a),
      jsonChunk,
      chunkHeader(binChunk.byteLength, 0x004e4942),
      binChunk,
    ]),
  );
  return glbPath;
}

/**
 * 修复预览：用 gmsh 兜底引擎重新网格化并覆写该模型的 GLB。
 *
 * 适用场景：主引擎（occt-import-js / OCCT 7.6 BRepMesh）静默丢面的模型——
 * 预览缺零件或缺面（实测案例：整个浮球丢失、斜管中段缺失）。gmsh 对这类
 * 几何能完整网格化。管理员在模型详情/管理页点「修复预览」触发。
 * 产物与主管线一致（同一 meshesToGltf），预览/结构树/缩略图全部兼容。
 */
export async function reconvertModelWithGmsh(
  inputPath: string,
  outputDir: string,
  modelId: string,
  originalName: string,
  options: ConvertStepToGltfOptions = {},
): Promise<GltfAsset> {
  const startedAt = Date.now();
  mkdirSync(outputDir, { recursive: true });

  // 先用主引擎跑一遍拿包围盒（gmsh 网格密度按模型尺寸定标）；
  // 主引擎失败/为空时用保守默认值
  let estimatedSize = 100;
  let dominantColor: [number, number, number] | null = null;
  try {
    const occt = await occtimportjs();
    const fileBuffer = new Uint8Array(readFileSync(inputPath));
    const nameToCheck = originalName || inputPath;
    const ext = nameToCheck.split('.').pop()?.toLowerCase();
    const probe: OcctResult =
      ext === 'iges' || ext === 'igs'
        ? (occt.ReadIgesFile(fileBuffer, null) as OcctResult)
        : (occt.ReadStepFile(fileBuffer, null) as OcctResult);
    let minC = [Infinity, Infinity, Infinity];
    let maxC = [-Infinity, -Infinity, -Infinity];
    let colorSum = [0, 0, 0];
    let colorVerts = 0;
    for (const m of probe?.meshes || []) {
      const arr = m.attributes.position.array;
      const verts = arr.length / 3;
      // 整体色：按顶点数加权平均所有零件的 STEP 颜色——gmsh 输出单 mesh 无法
      // 分零件着色，用加权均值让整体明暗观感与原模型（多零件多色）一致，
      // 避免缩略图比修复前明显偏亮或偏暗
      // 无 STEP 颜色的零件按主管线 default 材质灰计入，保证与主管线缩略图明暗一致
      const partColor = m.color || [0.75, 0.75, 0.78];
      colorSum[0] += partColor[0] * verts;
      colorSum[1] += partColor[1] * verts;
      colorSum[2] += partColor[2] * verts;
      colorVerts += verts;
      for (let i = 0; i < arr.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = arr[i + k];
          if (v < minC[k]) minC[k] = v;
          if (v > maxC[k]) maxC[k] = v;
        }
      }
    }
    if (Number.isFinite(minC[0])) {
      estimatedSize = Math.max(maxC[0] - minC[0], maxC[1] - minC[1], maxC[2] - minC[2]);
    }
    if (colorVerts > 0) {
      dominantColor = [colorSum[0] / colorVerts, colorSum[1] / colorVerts, colorSum[2] / colorVerts];
    }
  } catch {
    /* probe 失败不影响兜底流程 */
  }

  const { convertStepViaGmsh, isGmshAvailable } = await import('./gmshFallback.js');
  if (!isGmshAvailable()) {
    throw new Error('服务器未安装 gmsh，无法使用修复引擎（请联系管理员在容器内安装 gmsh）');
  }
  const fallback = convertStepViaGmsh(inputPath, estimatedSize, dominantColor);
  if (!fallback) {
    throw new Error('修复引擎（gmsh）转换失败，请稍后重试或检查源文件');
  }

  const sourceName = originalName || basename(inputPath);
  const mesh = fallback as unknown as OcctMesh;
  const { json, bin, meta } = meshesToGltf([mesh], sourceName, {
    sourceFormat: 'step+gmsh',
    sourceMeshCount: 1,
    skippedMeshCount: 0,
    tessellation: { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.15 },
    conversionMs: Date.now() - startedAt,
  });
  meta.diagnostics.converter = 'gmsh-fallback';
  if (meta.parts.length === 0) throw new Error('修复引擎未产生有效零件数据');

  const gltfPath = writeGlb(json, bin, outputDir, modelId);
  await persistFile(gltfPath);
  const originalSize = statSync(inputPath).size;
  const gltfSize = readFileSync(gltfPath).length;
  const cacheVersion = Date.now().toString(36);
  meta.diagnostics.asset = {
    gltfSize,
    originalSize,
    compressionRatio: originalSize > 0 ? Number((gltfSize / originalSize).toFixed(4)) : null,
    cacheVersion,
  };

  return {
    modelId,
    gltfPath,
    gltfUrl: versionedAssetUrl(`${options.urlBase || '/static/models'}/${modelId}.glb`, cacheVersion),
    originalName: sourceName,
    gltfSize,
    originalSize,
    previewMeta: meta,
  };
}

export async function convertStepToGltf(
  inputPath: string,
  outputDir: string,
  modelId?: string,
  originalName?: string,
  options: ConvertStepToGltfOptions = {},
): Promise<GltfAsset> {
  const startedAt = Date.now();
  modelId = modelId || randomUUID().slice(0, 12);
  mkdirSync(outputDir, { recursive: true });

  const occt = await occtimportjs();

  // Guard against OOM: reject files larger than 200MB
  const inputSize = statSync(inputPath).size;
  if (inputSize > 200 * 1024 * 1024) {
    throw new Error(`文件过大（${(inputSize / 1024 / 1024).toFixed(1)}MB），暂不支持超过 200MB 的文件转换`);
  }

  const fileBuffer = new Uint8Array(readFileSync(inputPath));
  const nameToCheck = originalName || inputPath;
  const ext = nameToCheck.split('.').pop()?.toLowerCase();

  // Keep OCCT tessellation tight enough for CAD details. 0.001 is the
  // library's default bbox ratio; the previous 0.01 was visibly too coarse.
  const tessellationParams: OcctImportParams = {
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.001,
    angularDeflection: 0.15,
  };

  let result: OcctResult;
  if (ext === 'step' || ext === 'stp') {
    result = occt.ReadStepFile(fileBuffer, tessellationParams) as OcctResult;
  } else if (ext === 'iges' || ext === 'igs') {
    result = occt.ReadIgesFile(fileBuffer, tessellationParams) as OcctResult;
  } else {
    throw new Error(`Unsupported format: ${ext}`);
  }

  if (!result?.meshes || result.meshes.length === 0) {
    throw new Error('无法解析模型文件 - 没有有效网格数据');
  }

  const validMeshes = result.meshes.filter((m) => Math.floor(m.attributes.position.array.length / 3) >= 3);
  if (validMeshes.length === 0) {
    throw new Error('模型文件中无有效顶点数据');
  }

  // ── 兜底引擎说明（2026-09）──
  // occt-import-js 的 WASM OCCT 7.6 BRepMesh 对特定几何会静默丢面（实测丢过整个
  // 浮球 solid 和喷嘴管中段）。曾尝试自动检测（断口/面数比/表面积比）但误报率
  // 不可控（CAD 零件形状太多样）。最终方案：不自动切换，提供手动「修复预览」
  // 重转接口（POST /api/models/:id/reconvert-gmsh）走 gmsh 完整网格化，
  // 见 gmshFallback.ts 与 models/reconvert.ts。

  const sourceName = originalName || basename(inputPath);
  const { json, bin, meta } = meshesToGltf(validMeshes, sourceName, {
    sourceFormat: ext || 'unknown',
    sourceMeshCount: result.meshes.length,
    skippedMeshCount: result.meshes.length - validMeshes.length,
    tessellation: tessellationParams,
    conversionMs: Date.now() - startedAt,
  });
  if (meta.parts.length === 0) {
    throw new Error('模型文件中无可显示零件数据');
  }
  const gltfPath = writeGlb(json, bin, outputDir, modelId);
  await persistFile(gltfPath);
  const originalSize = fileBuffer.length;
  const gltfSize = readFileSync(gltfPath).length;
  const cacheVersion = Date.now().toString(36);
  meta.diagnostics.asset = {
    gltfSize,
    originalSize,
    compressionRatio: originalSize > 0 ? Number((gltfSize / originalSize).toFixed(4)) : null,
    cacheVersion,
  };
  meta.diagnostics.precheck = getPrecheckDiagnostics(originalSize);
  meta.diagnostics.performance = getPerformanceDiagnostics(meta.totals, gltfSize);

  return {
    modelId,
    gltfPath,
    gltfUrl: versionedAssetUrl(`${options.urlBase || '/static/models'}/${modelId}.glb`, cacheVersion),
    originalName: originalName || basename(inputPath),
    gltfSize,
    originalSize,
    previewMeta: meta,
  };
}

export async function getMeshStats(inputPath: string): Promise<{
  vertices: number;
  faces: number;
  meshes: number;
}> {
  const occt = await occtimportjs();
  const fileBuffer = new Uint8Array(readFileSync(inputPath));
  const ext = inputPath.split('.').pop()?.toLowerCase();

  let result: OcctResult;
  if (ext === 'step' || ext === 'stp') {
    result = occt.ReadStepFile(fileBuffer, null) as OcctResult;
  } else if (ext === 'iges' || ext === 'igs') {
    result = occt.ReadIgesFile(fileBuffer, null) as OcctResult;
  } else {
    return { vertices: 0, faces: 0, meshes: 0 };
  }

  if (!result?.meshes) return { vertices: 0, faces: 0, meshes: 0 };

  let totalVertices = 0;
  let totalFaces = 0;
  for (const mesh of result.meshes) {
    totalVertices += Math.floor(mesh.attributes.position.array.length / 3);
    if (mesh.index) {
      totalFaces += mesh.index.array.length / 3;
    } else if (mesh.attributes.position) {
      totalFaces += mesh.attributes.position.array.length / 9;
    }
  }

  return {
    vertices: totalVertices,
    faces: Math.floor(totalFaces),
    meshes: result.meshes.length,
  };
}
