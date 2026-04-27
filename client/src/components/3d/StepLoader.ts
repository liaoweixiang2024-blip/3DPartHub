import * as THREE from "three";

interface MeshAttribute {
  array: ArrayLike<number>;
}

interface MeshData {
  index?: { array: ArrayLike<number> };
  attributes: {
    position: MeshAttribute;
    normal?: MeshAttribute;
  };
  color?: [number, number, number];
  name?: string;
}

interface OcctResult {
  meshes: MeshData[];
}

export type CadFormat = "step" | "stp" | "iges" | "igs";

function detectFormat(filename: string): CadFormat | null {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (ext === "step" || ext === "stp") return "step";
  if (ext === "iges" || ext === "igs") return "iges";
  return null;
}

type OcctInstance = any;

declare global {
  var occtimportjs: any;
}

let _occtCache: OcctInstance | null = null;

async function getOcct(): Promise<OcctInstance> {
  if (_occtCache) return _occtCache;

  if (typeof globalThis.occtimportjs === "function") {
    _occtCache = await globalThis.occtimportjs();
    return _occtCache;
  }

  if (
    globalThis.occtimportjs &&
    typeof globalThis.occtimportjs === "object" &&
    globalThis.occtimportjs.ReadStepFile
  ) {
    _occtCache = globalThis.occtimportjs;
    return _occtCache;
  }

  throw new Error(
    "OCCT WASM 模块未加载。请检查网络连接后刷新页面重试。"
  );
}

export async function loadCadFile(
  file: File | ArrayBuffer,
  fileName: string
): Promise<THREE.Group> {
  const format = detectFormat(fileName);
  if (!format) {
    throw new Error(`不支持的格式: ${fileName}`);
  }

  const occt = await getOcct();

  let buffer: ArrayBuffer;
  if (file instanceof File) {
    buffer = await file.arrayBuffer();
  } else {
    buffer = file;
  }

  const fileBuffer = new Uint8Array(buffer);

  const result: OcctResult =
    format === "step"
      ? occt.ReadStepFile(fileBuffer, null)
      : occt.ReadIgesFile(fileBuffer, null);

  if (!result || !result.meshes || result.meshes.length === 0) {
    throw new Error("无法解析模型文件");
  }

  return cadResultToThreeGroup(result);
}

export async function loadCadFromUrl(
  url: string
): Promise<THREE.Group> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`加载失败: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const fileName = url.split("/").pop() || "model.step";
  return loadCadFile(buffer, fileName);
}

function cadResultToThreeGroup(result: OcctResult): THREE.Group {
  const group = new THREE.Group();

  for (const mesh of result.meshes) {
    const geometry = new THREE.BufferGeometry();

    if (mesh.attributes.position) {
      const positions = new Float32Array(mesh.attributes.position.array);
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    }

    if (mesh.attributes.normal) {
      const normals = new Float32Array(mesh.attributes.normal.array);
      geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    }

    if (mesh.index) {
      const indices = new Uint32Array(mesh.index.array);
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    }

    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }

    const material = new THREE.MeshStandardMaterial({
      color: mesh.color ? new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2]) : 0xcccccc,
      metalness: 0.3,
      roughness: 0.5,
      side: THREE.DoubleSide,
    });

    const threeMesh = new THREE.Mesh(geometry, material);
    group.add(threeMesh);
  }

  group.rotation.x = -Math.PI / 2;

  return group;
}
