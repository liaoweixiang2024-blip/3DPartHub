import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const occtimportjs = require("../../occt-import-js.node.cjs");

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

interface GltfAsset {
  modelId: string;
  gltfPath: string;
  gltfUrl: string;
  originalName: string;
  gltfSize: number;
  originalSize: number;
}

function meshesToGltf(meshes: OcctMesh[]): { json: object; bin: Buffer } {
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const materials: object[] = [];
  const primitives: object[] = [];
  let byteOffset = 0;

  const buffers: ArrayBuffer[] = [];

  for (let mi = 0; mi < meshes.length; mi++) {
    const mesh = meshes[mi];
    const posArray = new Float32Array(mesh.attributes.position.array);
    const hasNormals = !!mesh.attributes.normal;
    const normArray = hasNormals
      ? new Float32Array(mesh.attributes.normal!.array)
      : null;
    const hasIndex = !!mesh.index;
    const idxArray = hasIndex ? new Uint32Array(mesh.index!.array) : null;

    const vertexCount = posArray.length / 3;

    const posBV = { buffer: 0, byteOffset, byteLength: posArray.byteLength, target: 34962 };
    const posAcc = {
      bufferView: bufferViews.length,
      componentType: 5126,
      count: vertexCount,
      type: "VEC3",
      max: [0, 0, 0] as number[],
      min: [0, 0, 0] as number[],
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
    buffers.push(posArray.buffer.slice(0));
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
        type: "VEC3",
      });
      buffers.push(normArray.buffer.slice(0));
      byteOffset += normArray.byteLength;
    }

    let indexAccessorIdx = -1;
    if (idxArray) {
      const idxBV = { buffer: 0, byteOffset, byteLength: idxArray.byteLength, target: 34933 };
      indexAccessorIdx = accessors.length;
      bufferViews.push(idxBV);
      accessors.push({
        bufferView: indexAccessorIdx,
        componentType: 5125,
        count: idxArray.length,
        type: "SCALAR",
      });
      buffers.push(idxArray.buffer.slice(0));
      byteOffset += idxArray.byteLength;
    }

    let materialIdx = 0;
    if (mesh.color) {
      materialIdx = materials.length;
      let [r, g, b] = mesh.color;
      // Boost very dark colors for better visibility in dark theme
      if (r + g + b < 1.0) {
        r = Math.max(r, 0.55); g = Math.max(g, 0.55); b = Math.max(b, 0.58);
      }
      materials.push({
        pbrMetallicRoughness: {
          baseColorFactor: [r, g, b, 1],
          metallicFactor: 0.3,
          roughnessFactor: 0.5,
        },
        name: mesh.name || `material_${mi}`,
        doubleSided: true,
      });
    } else {
      if (materials.length === 0) {
        materials.push({
          pbrMetallicRoughness: {
            baseColorFactor: [0.75, 0.75, 0.78, 1],
            metallicFactor: 0.3,
            roughnessFactor: 0.5,
          },
          name: "default",
          doubleSided: true,
        });
      }
    }

    const prim: Record<string, any> = {
      attributes: { POSITION: posAccessorIdx },
      material: materialIdx,
    };
    if (normArray) prim.attributes.NORMAL = normalAccessorIdx;
    if (idxArray) prim.indices = indexAccessorIdx;

    primitives.push(prim);
  }

  const totalBuffer = Buffer.concat(buffers.map((b) => Buffer.from(b)));

  const json = {
    asset: { version: "2.0", generator: "model-converter" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "converted_model" }],
    meshes: [{ name: "model", primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ uri: "model.bin", byteLength: totalBuffer.length }],
  };

  return { json, bin: totalBuffer };
}

function writeGltfSet(gltf: object, binData: Buffer, outputDir: string, modelId: string): string {
  const gltfPath = join(outputDir, `${modelId}.gltf`);
  const binPath = join(outputDir, `${modelId}.bin`);

  const gltfAny = gltf as { buffers: { uri: string }[] };
  gltfAny.buffers[0].uri = `${modelId}.bin`;

  writeFileSync(binPath, binData);
  writeFileSync(gltfPath, JSON.stringify(gltf));
  return gltfPath;
}

export async function convertStepToGltf(
  inputPath: string,
  outputDir: string,
  modelId?: string,
  originalName?: string
): Promise<GltfAsset> {
  modelId = modelId || randomUUID().slice(0, 12);
  mkdirSync(outputDir, { recursive: true });

  const occt = await occtimportjs();

  const fileBuffer = new Uint8Array(readFileSync(inputPath));
  const nameToCheck = originalName || inputPath;
  const ext = nameToCheck.split(".").pop()?.toLowerCase();

  // Higher tessellation quality for smoother surfaces
  const tessellationParams = {
    linearDeflection: 0.01,  // default 0.1 → 10x finer mesh
    angularDeflection: 0.1,  // default 0.5 → 5x finer mesh
  };

  let result: OcctResult;
  if (ext === "step" || ext === "stp") {
    result = occt.ReadStepFile(fileBuffer, tessellationParams) as OcctResult;
  } else if (ext === "iges" || ext === "igs") {
    result = occt.ReadIgesFile(fileBuffer, tessellationParams) as OcctResult;
  } else {
    throw new Error(`Unsupported format: ${ext}`);
  }

  if (!result?.meshes || result.meshes.length === 0) {
    throw new Error("无法解析模型文件 - 没有有效网格数据");
  }

  const validMeshes = result.meshes.filter(
    (m) => m.attributes.position.array.length > 0
  );
  if (validMeshes.length === 0) {
    throw new Error("模型文件中无有效顶点数据");
  }

  const { json, bin } = meshesToGltf(validMeshes);
  const gltfPath = writeGltfSet(json, bin, outputDir, modelId);

  const originalSize = fileBuffer.length;
  const gltfSize =
    readFileSync(gltfPath).length +
    readFileSync(join(outputDir, `${modelId}.bin`)).length;

  return {
    modelId,
    gltfPath,
    gltfUrl: `/static/models/${modelId}.gltf`,
    originalName: basename(inputPath),
    gltfSize,
    originalSize,
  };
}

export async function getMeshStats(inputPath: string): Promise<{
  vertices: number;
  faces: number;
  meshes: number;
}> {
  const occt = await occtimportjs();
  const fileBuffer = new Uint8Array(readFileSync(inputPath));
  const ext = inputPath.split(".").pop()?.toLowerCase();

  let result: OcctResult;
  if (ext === "step" || ext === "stp") {
    result = occt.ReadStepFile(fileBuffer, null) as OcctResult;
  } else if (ext === "iges" || ext === "igs") {
    result = occt.ReadIgesFile(fileBuffer, null) as OcctResult;
  } else {
    return { vertices: 0, faces: 0, meshes: 0 };
  }

  if (!result?.meshes) return { vertices: 0, faces: 0, meshes: 0 };

  let totalVertices = 0;
  let totalFaces = 0;
  for (const mesh of result.meshes) {
    totalVertices += mesh.attributes.position.array.length / 3;
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
