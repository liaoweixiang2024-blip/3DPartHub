import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join } from "node:path";

export interface GltfAssetData {
  json: any;
  binData: Buffer;
}

function cleanPath(value: string): string {
  return value.split(/[?#]/)[0];
}

export function getPreviewAssetExtension(value: string): "glb" | "gltf" {
  return extname(cleanPath(value)).toLowerCase() === ".glb" ? "glb" : "gltf";
}

export function resolveFileUrlPath(value: string): string {
  const clean = cleanPath(value);
  if (isAbsolute(clean) && !clean.startsWith("/static/")) return clean;
  return clean.startsWith("/")
    ? join(process.cwd(), clean.slice(1))
    : join(process.cwd(), clean);
}

export function findPreviewAssetPath(modelDir: string, modelId: string, preferred?: string | null): string | null {
  if (preferred) {
    const preferredPath = resolveFileUrlPath(preferred);
    if (existsSync(preferredPath)) return preferredPath;
  }

  const glbPath = join(modelDir, `${modelId}.glb`);
  if (existsSync(glbPath)) return glbPath;

  const gltfPath = join(modelDir, `${modelId}.gltf`);
  if (existsSync(gltfPath)) return gltfPath;

  return null;
}

export function previewAssetFileName(baseName: string, pathOrUrl: string): string {
  return `${baseName}.${getPreviewAssetExtension(pathOrUrl)}`;
}

function parseGlb(filePath: string): GltfAssetData {
  const data = readFileSync(filePath);
  if (data.byteLength < 20 || data.readUInt32LE(0) !== 0x46546c67) {
    throw new Error("Invalid GLB header");
  }
  const version = data.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported GLB version: ${version}`);

  let offset = 12;
  let json: any = null;
  let binData = Buffer.alloc(0);

  while (offset + 8 <= data.byteLength) {
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > data.byteLength) break;

    const chunk = data.subarray(chunkStart, chunkEnd);
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(chunk.toString("utf8").trim());
    } else if (chunkType === 0x004e4942) {
      binData = chunk;
    }
    offset = chunkEnd;
  }

  if (!json) throw new Error("GLB JSON chunk missing");
  return { json, binData };
}

function readExternalBuffer(gltf: any, filePath: string): Buffer {
  const uri = gltf.buffers?.[0]?.uri;
  if (typeof uri === "string" && uri.startsWith("data:")) {
    const base64 = uri.split(",")[1] || "";
    return Buffer.from(base64, "base64");
  }
  if (typeof uri === "string" && uri.length > 0) {
    return readFileSync(join(dirname(filePath), uri));
  }
  const binPath = filePath.replace(/\.gltf$/i, ".bin");
  return existsSync(binPath) ? readFileSync(binPath) : Buffer.alloc(0);
}

export function readGltfAsset(filePath: string): GltfAssetData {
  if (getPreviewAssetExtension(filePath) === "glb") return parseGlb(filePath);

  const json = JSON.parse(readFileSync(filePath, "utf-8"));
  return { json, binData: readExternalBuffer(json, filePath) };
}
