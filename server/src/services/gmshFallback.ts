import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';

/**
 * gmsh 兜底转换引擎。
 *
 * 背景：主引擎 occt-import-js（WASM OCCT 7.6）的 BRepMesh 对两类几何会静默丢面：
 *   1. 特定 solid 组合（实测：浮球液位开关的球面 solid 整体丢失）
 *   2. 斜轴圆柱面 + B 样条修剪边界（实测：高压喷嘴的管子中段 26mm 缺失）
 * OCCT 新版（7.9.3 原生实测）修复了第 1 类，但第 2 类是 BRepMesh 全系问题；
 * gmsh 用自己的 Delaunay 网格算法 + 内嵌 OCCT 读 STEP，两类都能正确网格化。
 *
 * 本模块把 STEP 交给 gmsh 生成 msh2 网格（共享节点），再解析为与主引擎一致的
 * OcctMesh 结构（带索引 + 平滑法线），由 converter 复用 meshesToGltf 出 GLB——
 * 预览/结构树/缩略图管线全部不变。
 *
 * 为什么不用 STL：STL 每个三角形独立三个顶点 + 逐面法线（flat shading），
 * 圆柱/球面在预览里呈明显多面体棱面感，观感远差于主引擎的平滑着色。
 * msh2 的节点在三角形间共享，可以按「法线夹角阈值」生成平滑顶点法线，
 * 曲面光滑、棱边锐利，与主引擎观感一致。
 */

export type FallbackMesh = {
  index?: { array: number[] };
  attributes: {
    position: { array: number[] };
    normal?: { array: number[] };
  };
  color?: [number, number, number];
  name?: string;
};

// gmsh 可执行文件探测路径：
// - 本地/裸机：PATH 里的 gmsh（brew/apt 安装）
// - Docker：宿主机 gmsh 通过 docker-compose 挂载到 /usr/local/host-bin/gmsh
//   （alpine 无 gmsh 包；镜像保持纯净，由部署侧按需挂载）
const GMSH_CANDIDATES = ['gmsh', '/usr/local/host-bin/gmsh', '/opt/host-bin/gmsh'];

function resolveGmshBin(): string | null {
  for (const bin of GMSH_CANDIDATES) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore', timeout: 10_000 });
      return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** gmsh 是否可用（本地需安装；Docker 部署需挂载宿主 gmsh，见部署文档） */
export function isGmshAvailable(): boolean {
  return resolveGmshBin() !== null;
}

type Msh2Mesh = {
  positions: number[]; // 共享节点坐标（每顶点 3 个数）
  indices: number[]; // 三角形索引（quad 已拆分为 2 个三角）
};

/**
 * 解析 ASCII msh2 网格（gmsh `-format msh2` 输出）。
 * 只取表面单元：type 2（三角）和 type 3（四边形，拆成 2 个三角）。
 * 节点在单元间共享 —— 这是平滑法线的前提。
 */
function parseMsh2(text: string): Msh2Mesh | null {
  const lines = text.split('\n');
  const nodesStart = lines.indexOf('$Nodes');
  const nodesEnd = lines.indexOf('$EndNodes');
  const elementsStart = lines.indexOf('$Elements');
  const elementsEnd = lines.indexOf('$EndElements');
  if (nodesStart < 0 || nodesEnd < 0 || elementsStart < 0 || elementsEnd < 0) return null;

  const nodeCount = Number(lines[nodesStart + 1]);
  if (!Number.isFinite(nodeCount) || nodeCount < 3) return null;

  // msh2 节点编号不保证连续，建 id → 序号映射
  const nodeIdToIndex = new Map<number, number>();
  const positions: number[] = [];
  for (let k = 0; k < nodeCount; k++) {
    const parts = lines[nodesStart + 2 + k].trim().split(/\s+/);
    if (parts.length < 4) return null;
    const id = Number(parts[0]);
    if (!Number.isFinite(id)) return null;
    nodeIdToIndex.set(id, positions.length / 3);
    positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
  }

  const elementCount = Number(lines[elementsStart + 1]);
  if (!Number.isFinite(elementCount)) return null;
  const indices: number[] = [];
  for (let k = 0; k < elementCount; k++) {
    const parts = lines[elementsStart + 2 + k].trim().split(/\s+/);
    if (parts.length < 5) continue;
    const etype = Number(parts[1]);
    if (etype === 2) {
      // 三角：末尾 3 个是节点 id
      const a = nodeIdToIndex.get(Number(parts[parts.length - 3]));
      const b = nodeIdToIndex.get(Number(parts[parts.length - 2]));
      const c = nodeIdToIndex.get(Number(parts[parts.length - 1]));
      if (a !== undefined && b !== undefined && c !== undefined) indices.push(a, b, c);
    } else if (etype === 3) {
      // 四边形：拆成 2 个三角（0-1-2 + 0-2-3）
      const q = [
        nodeIdToIndex.get(Number(parts[parts.length - 4])),
        nodeIdToIndex.get(Number(parts[parts.length - 3])),
        nodeIdToIndex.get(Number(parts[parts.length - 2])),
        nodeIdToIndex.get(Number(parts[parts.length - 1])),
      ];
      if (q.every((x) => x !== undefined)) {
        indices.push(q[0]!, q[1]!, q[2]!);
        indices.push(q[0]!, q[2]!, q[3]!);
      }
    }
    // 其余类型（1=线、15=点、4=四面体等）跳过——线/点是 CAD 边界标记，体单元不参与表面渲染
  }
  if (indices.length / 3 < 1) return null;
  return { positions, indices };
}

/** 顶点法线与「参考法线」夹角阈值（弧度）——超过则不并入平滑，保留棱边锐利 */
const SMOOTH_ANGLE_COS = Math.cos((35 * Math.PI) / 180);

/**
 * 由共享节点网格生成平滑顶点法线（角度阈值法）：
 * 每个顶点收集邻接面法线，与种子面法线夹角 < 35° 的才平均——
 * 圆柱/球面相邻面法线夹角小，平滑成连续渐变；棱边两侧夹角大，保持锐利。
 * 这与主引擎 OCCT 顶点法线的观感一致。
 */
function computeSmoothNormals(positions: number[], indices: number[]): number[] {
  const vertexCount = positions.length / 3;
  const faceCount = indices.length / 3;

  // 面法线
  const faceNormals = new Float32Array(faceCount * 3);
  for (let f = 0; f < faceCount; f++) {
    const a = indices[f * 3]! * 3;
    const b = indices[f * 3 + 1]! * 3;
    const c = indices[f * 3 + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    faceNormals[f * 3] = nx;
    faceNormals[f * 3 + 1] = ny;
    faceNormals[f * 3 + 2] = nz;
  }

  // 顶点 → 邻接面
  const adjacency: number[][] = new Array(vertexCount);
  for (let f = 0; f < faceCount; f++) {
    for (let k = 0; k < 3; k++) {
      const v = indices[f * 3 + k]!;
      (adjacency[v] ??= []).push(f);
    }
  }

  const normals = new Array<number>(vertexCount * 3).fill(0);
  for (let v = 0; v < vertexCount; v++) {
    const faces = adjacency[v];
    if (!faces || faces.length === 0) continue;
    // 以第一个面法线为种子；法线一致的邻面才平均（保持棱边）
    const seed = faces[0]!;
    const sx = faceNormals[seed * 3]!;
    const sy = faceNormals[seed * 3 + 1]!;
    const sz = faceNormals[seed * 3 + 2]!;
    let ax = 0,
      ay = 0,
      az = 0;
    for (const f of faces) {
      const nx = faceNormals[f * 3]!;
      const ny = faceNormals[f * 3 + 1]!;
      const nz = faceNormals[f * 3 + 2]!;
      if (nx * sx + ny * sy + nz * sz > SMOOTH_ANGLE_COS) {
        ax += nx;
        ay += ny;
        az += nz;
      }
    }
    const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    normals[v * 3] = ax / len;
    normals[v * 3 + 1] = ay / len;
    normals[v * 3 + 2] = az / len;
  }
  return normals;
}

/**
 * 用 gmsh 把 STEP 网格化为带平滑法线的单 mesh 结构。
 * clmax 由模型包围盒决定：gmsh 的 -clmax 是特征长度上限。
 * 返回 null 表示 gmsh 不可用或失败（调用方保留主引擎结果）。
 */
export function convertStepViaGmsh(
  inputPath: string,
  estimatedModelSizeMm: number,
  /** 主色（可选）：主引擎结果的按顶点加权平均色，保持缩略图色调一致 */
  dominantColor?: [number, number, number] | null,
): FallbackMesh | null {
  let tmpDir: string | null = null;
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'gmsh-fallback-'));
    const mshPath = join(tmpDir, 'out.msh');
    // clmax 阶梯重试：粗网格快但多 volume 装配易边界相交失败，失败自动加密一档
    // （实测浮球装配在 clmax>2 时报 segment-facet intersection，0.5 档成功）
    const baseSize = Math.max(1, estimatedModelSizeMm);
    const attempts = [Math.min(2, baseSize / 120), Math.min(1, baseSize / 240), Math.min(0.5, baseSize / 480), 0.2];
    // 曲率自适应（对齐主引擎精度）：
    // - clcurv 20：每 2π 弧度至少 20 段（18°/段），小圆角/小孔按曲率细分而不是被
    //   clmax 切平——否则 R1 的圆角只有 3 段，观感明显比主引擎粗
    // - clmin = size/1000：与主引擎 linearDeflection（bbox 比例 0.001）同基准的
    //   最小边长下限，防止 clcurv 对微小特征无限细分（实测无下限时浮球装配
    //   冲到 220 万三角/300MB+，加上限后 45.6 万——与主引擎同量级）
    const clmin = Math.max(0.05, baseSize / 1000);
    let ok = false;
    let lastErr: unknown = null;
    const gmshBin = resolveGmshBin();
    if (!gmshBin) return null;
    for (const clmax of attempts) {
      try {
        execFileSync(
          // msh2（ASCII）：节点在单元间共享，才能做角度阈值平滑法线
          // （STL 逐三角独立顶点 + 面法线 → flat shading，圆柱/球面呈多面体棱面）
          gmshBin,
          [
            inputPath,
            '-3',
            '-format',
            'msh2',
            '-o',
            mshPath,
            '-clmax',
            clmax.toFixed(4),
            '-clcurv',
            '20',
            '-clmin',
            clmin.toFixed(4),
            '-v',
            '2',
          ],
          { timeout: 300_000, stdio: ['ignore', 'ignore', 'pipe'] },
        );
        if (existsSync(mshPath)) {
          ok = true;
          break;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    if (!ok) {
      if (lastErr) throw lastErr;
      return null;
    }
    const mesh = parseMsh2(readFileSync(mshPath, 'utf8'));
    if (!mesh) return null;
    const normals = computeSmoothNormals(mesh.positions, mesh.indices);
    return {
      attributes: {
        position: { array: mesh.positions },
        normal: { array: normals },
      },
      index: { array: mesh.indices },
      // 用主引擎结果的加权平均色（无则纯白）——保持列表缩略图与原模型色调一致
      color: dominantColor || [1, 1, 1],
      name: 'model_gmsh',
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), inputPath },
      '[gmshFallback] gmsh conversion failed',
    );
    return null;
  } finally {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

/**
 * 主引擎结果的完整性检测：判断是否疑似丢面需要触发兜底。
 *
 * 检测原理（断口检测）：BRepMesh 丢面的典型形态是「某个面的三角形整段缺失」，
 * 表现为网格在包围盒内部出现异常大的顶点空档（实测喷嘴案例：管轴方向
 * 26mm 空档 / 40mm 总长 = 65%）。完整 CAD 网格的顶点间距是网格单元级别，
 * 内部空档超过包围盒对应轴长度的 30% 即可确定有面丢失（正常模型两个
 * 零件之间即便有空隙，也远达不到 30% 连续无顶点——顶点沿边界分布）。
 *
 * 逐轴检查所有 mesh 的并集顶点，任一轴命中即判定丢面。
 */
export function looksLikeMissingFaces(
  meshes: Array<{ attributes: { position: { array: ArrayLike<number> } } }>,
): boolean {
  const axes: [number[], number[], number[]] = [[], [], []];
  let total = 0;
  for (const m of meshes) {
    const arr = m.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      axes[0].push(arr[i]!);
      axes[1].push(arr[i + 1]!);
      axes[2].push(arr[i + 2]!);
      total++;
    }
  }
  if (total < 90) return false; // 顶点太少（<30 三角形）无法可靠判定
  for (const coords of axes) {
    const sorted = coords.slice().sort((a, b) => a - b);
    const span = sorted[sorted.length - 1]! - sorted[0]!;
    if (span <= 0) continue;
    // 内部空档：去掉首尾各 5% 的边界区
    const lo = sorted[0]! + span * 0.05;
    const hi = sorted[sorted.length - 1]! - span * 0.05;
    let prev: number | null = null;
    for (const c of sorted) {
      if (prev !== null && c > lo && prev < hi) {
        if (c - prev > span * 0.3) return true;
      }
      prev = c;
    }
  }
  return false;
}

/** 从 STEP 文本统计 ADVANCED_FACE（容错：无面的文件返回 0） */
export function countStepFaces(stepBuffer: Buffer): number {
  const text = stepBuffer.toString('latin1');
  const matches = text.match(/ADVANCED_FACE\s*\(/g);
  return matches ? matches.length : 0;
}
