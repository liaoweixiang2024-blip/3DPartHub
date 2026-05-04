import * as THREE from 'three';

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

export type CadFormat = 'step' | 'stp' | 'iges' | 'igs';

function detectFormat(filename: string): CadFormat | null {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'step' || ext === 'stp') return 'step';
  if (ext === 'iges' || ext === 'igs') return 'iges';
  return null;
}

type OcctInstance = any;

declare global {
  var occtimportjs: any;
  var Module: { locateFile?: (name: string) => string } | undefined;
}

let _occtCache: OcctInstance | null = null;
let _occtScriptPromise: Promise<void> | null = null;

function ensureOcctScript(): Promise<void> {
  if (typeof globalThis.occtimportjs !== 'undefined') {
    return Promise.resolve();
  }

  if (_occtScriptPromise) {
    return _occtScriptPromise;
  }

  if (typeof document === 'undefined') {
    return Promise.reject(new Error('OCCT WASM 模块仅能在浏览器中加载'));
  }

  globalThis.Module = {
    ...(globalThis.Module || {}),
    locateFile: (name: string) => `/${name}`,
  };

  _occtScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/occt-import-js.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      _occtScriptPromise = null;
      reject(new Error('OCCT WASM 模块加载失败，请检查网络连接后重试。'));
    };
    document.head.appendChild(script);
  });

  return _occtScriptPromise;
}

async function getOcct(): Promise<OcctInstance> {
  if (_occtCache) return _occtCache;

  await ensureOcctScript();

  if (typeof globalThis.occtimportjs === 'function') {
    _occtCache = await globalThis.occtimportjs();
    return _occtCache;
  }

  if (globalThis.occtimportjs && typeof globalThis.occtimportjs === 'object' && globalThis.occtimportjs.ReadStepFile) {
    _occtCache = globalThis.occtimportjs;
    return _occtCache;
  }

  throw new Error('OCCT WASM 模块未加载。请检查网络连接后刷新页面重试。');
}

export async function loadCadFile(file: File | ArrayBuffer, fileName: string): Promise<THREE.Group> {
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
    format === 'step' ? occt.ReadStepFile(fileBuffer, null) : occt.ReadIgesFile(fileBuffer, null);

  if (!result || !result.meshes || result.meshes.length === 0) {
    throw new Error('无法解析模型文件');
  }

  return cadResultToThreeGroup(result);
}

export async function loadCadFromUrl(
  url: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<THREE.Group> {
  onProgress?.(3);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`加载失败: ${response.status}`);

  const total = Number(response.headers.get('Content-Length') || 0);
  let buffer: ArrayBuffer;
  if (response.body && total > 0) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.(Math.min(55, 5 + Math.round((loaded / total) * 50)));
      }
    }
    const merged = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    buffer = merged.buffer;
  } else {
    buffer = await response.arrayBuffer();
    onProgress?.(55);
  }

  onProgress?.(70);
  const fileName = url.split('/').pop() || 'model.step';
  const group = await loadCadFile(buffer, fileName);
  onProgress?.(100);
  return group;
}

function cadResultToThreeGroup(result: OcctResult): THREE.Group {
  const group = new THREE.Group();

  for (const mesh of result.meshes) {
    const geometry = new THREE.BufferGeometry();

    if (mesh.attributes.position) {
      const positions = new Float32Array(mesh.attributes.position.array);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    }

    if (mesh.attributes.normal) {
      const normals = new Float32Array(mesh.attributes.normal.array);
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
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
