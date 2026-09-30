import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, basename } from 'node:path';
import { normalizeCadLabel } from '../lib/filenameEncoding.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
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

/**
 * 修复引擎混合补洞：gmsh 对个别曲面（典型：周期性曲面）无法网格化，输出会留小洞；
 * 主引擎 OCCT 恰好能三角化这些面。以 gmsh 网格为主体，只把 OCCT 中「落在洞区域且
 * gmsh 未覆盖」的三角形拼进来——既补上洞，又避免两套网格大面积重叠（z-fighting）。
 * 实测案例：PLJ8 弯头（gmsh 133 条边界边的小洞，OCCT 在该区域有 375 个可用三角形）。
 * 直接原地扩展 gmsh 网格的 position/normal/index 数组，返回补入的三角形数。
 */
function patchGmshHolesWithOcct(
  gmsh: { attributes: { position: { array: number[] }; normal: { array: number[] } }; index: { array: number[] } },
  occtMeshes: OcctMesh[],
): number {
  // ① gmsh 边界边（只属于 1 个三角形的边 = 洞的轮廓）
  const edgeCount = new Map<string, number>();
  const idx = gmsh.index.array;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const u = idx[i + j]!;
      const v = idx[i + ((j + 1) % 3)]!;
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
    }
  }
  const boundaryVerts = new Set<number>();
  for (const [k, n] of edgeCount) {
    if (n !== 1) continue;
    const [a, b] = k.split('_');
    boundaryVerts.add(Number(a));
    boundaryVerts.add(Number(b));
  }
  if (boundaryVerts.size === 0) return 0; // 水密，无需补

  const pos = gmsh.attributes.position.array;
  // ② 边界顶点聚类成洞区域（bbox 生长合并），再外扩 25% 容忍轮廓细分差异
  const modelSize = (() => {
    let mn = [Infinity, Infinity, Infinity];
    let mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], pos[i + k]!);
        mx[k] = Math.max(mx[k], pos[i + k]!);
      }
    }
    return Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
  })();
  const clusters: Array<{ mn: number[]; mx: number[] }> = [];
  const grow = Math.max(modelSize * 0.01, 1e-6);
  for (const v of boundaryVerts) {
    const p = [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!];
    const hit = clusters.find(
      (c) =>
        p[0]! >= c.mn[0] - grow &&
        p[0]! <= c.mx[0] + grow &&
        p[1]! >= c.mn[1] - grow &&
        p[1]! <= c.mx[1] + grow &&
        p[2]! >= c.mn[2] - grow &&
        p[2]! <= c.mx[2] + grow,
    );
    if (hit) {
      for (let k = 0; k < 3; k++) {
        hit.mn[k] = Math.min(hit.mn[k], p[k]!);
        hit.mx[k] = Math.max(hit.mx[k], p[k]!);
      }
    } else {
      clusters.push({ mn: [...p], mx: [...p] });
    }
  }
  for (const c of clusters) {
    const m = Math.max(c.mx[0] - c.mn[0], c.mx[1] - c.mn[1], c.mx[2] - c.mn[2]) * 0.25 + grow;
    for (let k = 0; k < 3; k++) {
      c.mn[k] -= m;
      c.mx[k] += m;
    }
  }

  // ③ gmsh 已覆盖的粗占用格（顶点 + 形心采样）：用于剔除会与之重叠的 OCCT 三角形
  const CELL = modelSize / 256;
  const occupied = new Set<number>();
  const cellKey = (x: number, y: number, z: number) =>
    ((x / CELL) | 0) * 4194304 + ((y / CELL) | 0) * 2048 + ((z / CELL) | 0);
  const markPt = (x: number, y: number, z: number) => occupied.add(cellKey(x, y, z));
  for (let i = 0; i + 2 < idx.length; i += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let j = 0; j < 3; j++) {
      const v = idx[i + j]!;
      const x = pos[v * 3]!;
      const y = pos[v * 3 + 1]!;
      const z = pos[v * 3 + 2]!;
      markPt(x, y, z);
      cx += x / 3;
      cy += y / 3;
      cz += z / 3;
    }
    markPt(cx, cy, cz);
  }

  // ④ 筛选并拼入 OCCT 三角形：形心在洞区域内；与 gmsh 的重叠剔除取「四点（三顶点+
  // 形心）全部落在已占用格」才拒——缝边三角形（部分搭在 gmsh 边缘）必须放进来，
  // 否则两套网格的轮廓细分差异会在洞缘留下看得见的开缝；微小重叠条带的视觉代价
  // 远小于开缝
  const nrm = gmsh.attributes.normal.array;
  const inHole = (p: number[]) =>
    clusters.some(
      (c) =>
        p[0] >= c.mn[0] && p[0] <= c.mx[0] && p[1] >= c.mn[1] && p[1] <= c.mx[1] && p[2] >= c.mn[2] && p[2] <= c.mx[2],
    );
  // 朝向基准：gmsh 主体顶点法线（主体渲染已被证实朝外）。occt-import-js 的三角形绕向
  // 和顶点法线都不可靠（实测本模型绕向同向/反向约对半，按其顶点法线校准后仍有约一半
  // 补丁面朝里，渲染成黑色/缺失——「外弯丢一大块」）。补丁三角形以最近的 gmsh 顶点
  // 法线为朝外基准：洞缘 gmsh 顶点密集，最近点法线即该处表面真实朝向。
  const NCELL = Math.max(modelSize / 64, 1e-6);
  const nGrid = new Map<number, Array<{ x: number; y: number; z: number; nx: number; ny: number; nz: number }>>();
  const nKey = (x: number, y: number, z: number) =>
    ((x / NCELL) | 0) * 4194304 + ((y / NCELL) | 0) * 2048 + ((z / NCELL) | 0);
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3]!;
    const y = pos[v * 3 + 1]!;
    const z = pos[v * 3 + 2]!;
    const rec = { x, y, z, nx: nrm[v * 3]!, ny: nrm[v * 3 + 1]!, nz: nrm[v * 3 + 2]! };
    const k = nKey(x, y, z);
    (nGrid.get(k) || nGrid.set(k, []).get(k)!).push(rec);
  }
  const nearestGmshNormal = (x: number, y: number, z: number, fx: number, fy: number, fz: number) => {
    const gx = (x / NCELL) | 0;
    const gy = (y / NCELL) | 0;
    const gz = (z / NCELL) | 0;
    // 在近邻顶点里找「法线与该三角形面法线最平行」的那个做基准：
    // 洞区近邻可能落在对面管壁上（法线相反）或垂直表面上（法线近垂直），
    // 只取 |dot| 最大且 >0.5 的——垂直/反向的近邻自动出局，距离仅作次级排序
    let best: { nx: number; ny: number; nz: number; dot: number; d: number } | null = null;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const rec of nGrid.get((gx + dx) * 4194304 + (gy + dy) * 2048 + (gz + dz)) || []) {
            const dot = rec.nx * fx + rec.ny * fy + rec.nz * fz;
            const d = (rec.x - x) ** 2 + (rec.y - y) ** 2 + (rec.z - z) ** 2;
            if (Math.abs(dot) < 0.5) continue;
            if (
              !best ||
              Math.abs(dot) > Math.abs(best.dot) + 0.05 ||
              (Math.abs(Math.abs(dot) - Math.abs(best.dot)) < 0.05 && d < best.d)
            ) {
              best = { nx: rec.nx, ny: rec.ny, nz: rec.nz, dot, d };
            }
          }
        }
    return best as { nx: number; ny: number; nz: number; dot: number; d: number } | null;
  };
  let patched = 0;
  let flips = 0;
  // 射线法定向：从补丁三角形形心沿 ±法线 各发射线，找 gmsh 三角形的最近命中距离。
  // 朝里一侧会在壁厚量级内撞到对面壁；朝外一侧的最近命中远得多（或没有）。
  // 这是几何判据，不依赖任何引擎输出的法线/绕向（occt-import-js 两者都被证实不可靠）。
  const TCELL = Math.max(modelSize / 24, 1e-6);
  const triGrid = new Map<number, number[]>();
  const tKey = (x: number, y: number, z: number) =>
    ((x / TCELL) | 0) * 4194304 + ((y / TCELL) | 0) * 2048 + ((z / TCELL) | 0);
  const triCount0 = idx.length / 3;
  for (let t = 0; t < triCount0; t++) {
    const a = idx[t * 3]!,
      b = idx[t * 3 + 1]!,
      c = idx[t * 3 + 2]!;
    const k = tKey(
      (pos[a * 3]! + pos[b * 3]! + pos[c * 3]!) / 3,
      (pos[a * 3 + 1]! + pos[b * 3 + 1]! + pos[c * 3 + 1]!) / 3,
      (pos[a * 3 + 2]! + pos[b * 3 + 2]! + pos[c * 3 + 2]!) / 3,
    );
    (triGrid.get(k) || triGrid.set(k, []).get(k)!).push(t);
  }
  const rayGmshTri = (
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    ta: number,
    tb: number,
    tc: number,
  ) => {
    const a = idx[ta]! * 3,
      b = idx[tb]! * 3,
      c = idx[tc]! * 3;
    const e1x = pos[b]! - pos[a]!,
      e1y = pos[b + 1]! - pos[a + 1]!,
      e1z = pos[b + 2]! - pos[a + 2]!;
    const e2x = pos[c]! - pos[a]!,
      e2y = pos[c + 1]! - pos[a + 1]!,
      e2z = pos[c + 2]! - pos[a + 2]!;
    const px = dy * e2z - dz * e2y,
      py = dz * e2x - dx * e2z,
      pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-11) return -1;
    const inv = 1 / det;
    const tx = ox - pos[a]!,
      ty = oy - pos[a + 1]!,
      tz = oz - pos[a + 2]!;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) return -1;
    const qx = ty * e1z - tz * e1y,
      qy = tz * e1x - tx * e1z,
      qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) return -1;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t > 1e-7 ? t : -1;
  };
  const firstHitDist = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) => {
    const maxDist = modelSize * 0.6;
    const step = TCELL * 0.6;
    let best = Infinity;
    for (let d = 0; d <= maxDist; d += step) {
      const sx = ox + dx * d,
        sy = oy + dy * d,
        sz = oz + dz * d;
      const gx = (sx / TCELL) | 0,
        gy = (sy / TCELL) | 0,
        gz = (sz / TCELL) | 0;
      for (let ax = -1; ax <= 1; ax++)
        for (let ay = -1; ay <= 1; ay++)
          for (let az = -1; az <= 1; az++) {
            const bucket = triGrid.get((gx + ax) * 4194304 + (gy + ay) * 2048 + (gz + az));
            if (!bucket) continue;
            for (const t of bucket) {
              const hit = rayGmshTri(ox, oy, oz, dx, dy, dz, t * 3, t * 3 + 1, t * 3 + 2);
              if (hit > 0 && hit < best) best = hit;
            }
          }
      if (best < d) break; // 最近命中已在本步内，无需继续
    }
    return best;
  };
  const WALL = modelSize * 0.05;
  // ④' 先合成封口（在 OCCT 补丁之前）：gmsh 网格化不了的曲面（如周期性曲面）用
  // 干净的 gmsh 原始轮廓环直接扇形封口——之后再跑 OCCT 补丁时，封口区域已被占用格
  // 覆盖，碎片不会塞进来（碎片会把轮廓走环搞乱成细长环，扇形全是废三角）
  const synthesized = synthesizeMissingSurfaces(gmsh, inHole, modelSize, firstHitDist, nrm);
  if (synthesized > 0) {
    // 封口三角形写入占用格：顶点 + 形心
    for (let t = idx.length / 3 - synthesized; t < idx.length / 3; t++) {
      const a = idx[t * 3]!,
        b = idx[t * 3 + 1]!,
        c = idx[t * 3 + 2]!;
      markPt(pos[a * 3]!, pos[a * 3 + 1]!, pos[a * 3 + 2]!);
      markPt(pos[b * 3]!, pos[b * 3 + 1]!, pos[b * 3 + 2]!);
      markPt(pos[c * 3]!, pos[c * 3 + 1]!, pos[c * 3 + 2]!);
      markPt(
        (pos[a * 3]! + pos[b * 3]! + pos[c * 3]!) / 3,
        (pos[a * 3 + 1]! + pos[b * 3 + 1]! + pos[c * 3 + 1]!) / 3,
        (pos[a * 3 + 2]! + pos[b * 3 + 2]! + pos[c * 3 + 2]!) / 3,
      );
    }
    logger.info({ synthesized }, '[converter] synthesized cap before occt patch');
  }
  for (const m of occtMeshes) {
    const p = m.attributes.position.array;
    const vn = m.attributes.normal?.array;
    const pushTri = (a: number, b: number, c: number) => {
      let vs = [a, b, c].map((vi) => [p[vi * 3]!, p[vi * 3 + 1]!, p[vi * 3 + 2]!] as number[]);
      const cen = [
        (vs[0][0] + vs[1][0] + vs[2][0]) / 3,
        (vs[0][1] + vs[1][1] + vs[2][1]) / 3,
        (vs[0][2] + vs[1][2] + vs[2][2]) / 3,
      ];
      if (!inHole(cen)) return;
      const samples = [cen, ...vs];
      if (samples.every((s) => occupied.has(cellKey(s[0], s[1], s[2])))) return;
      const ux = vs[1][0] - vs[0][0];
      const uy = vs[1][1] - vs[0][1];
      const uz = vs[1][2] - vs[0][2];
      const vx = vs[2][0] - vs[0][0];
      const vy = vs[2][1] - vs[0][1];
      const vz = vs[2][2] - vs[0][2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      // 射线法定向（主判据）；射线两侧都打不到 gmsh 时退回「近邻平行法线」基准
      const eps = modelSize * 0.002;
      const hitPos = firstHitDist(cen[0] + nx * eps, cen[1] + ny * eps, cen[2] + nz * eps, nx, ny, nz);
      const hitNeg = firstHitDist(cen[0] - nx * eps, cen[1] - ny * eps, cen[2] - nz * eps, -nx, -ny, -nz);
      let flip: boolean;
      if (Number.isFinite(hitPos) || Number.isFinite(hitNeg)) {
        const hp = Number.isFinite(hitPos) ? hitPos : Infinity;
        const hn = Number.isFinite(hitNeg) ? hitNeg : Infinity;
        // 哪侧在壁厚内先撞实体，哪侧朝里
        flip = hp < WALL && hp < hn * 0.5;
      } else {
        const basis = nearestGmshNormal(cen[0], cen[1], cen[2], nx, ny, nz);
        if (basis) {
          flip = basis.nx * nx + basis.ny * ny + basis.nz * nz < 0;
        } else if (vn) {
          flip =
            (vn[a * 3]! + vn[b * 3]! + vn[c * 3]!) * nx +
              (vn[a * 3 + 1]! + vn[b * 3 + 1]! + vn[c * 3 + 1]!) * ny +
              (vn[a * 3 + 2]! + vn[b * 3 + 2]! + vn[c * 3 + 2]!) * nz <
            0;
        } else {
          flip = false;
        }
      }
      if (flip) {
        [nx, ny, nz] = [-nx, -ny, -nz];
        [vs[1], vs[2]] = [vs[2], vs[1]];
        flips++;
      }
      // 着色法线：优先 OCCT 平滑顶点法线之和（与周围 gmsh 平滑着色一致），对齐最终朝外方向
      let sx = nx,
        sy = ny,
        sz = nz;
      if (vn) {
        const rx = vn[a * 3]! + vn[b * 3]! + vn[c * 3]!;
        const ry = vn[a * 3 + 1]! + vn[b * 3 + 1]! + vn[c * 3 + 1]!;
        const rz = vn[a * 3 + 2]! + vn[b * 3 + 2]! + vn[c * 3 + 2]!;
        const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (rl > 1e-9) {
          sx = rx / rl;
          sy = ry / rl;
          sz = rz / rl;
          if (sx * nx + sy * ny + sz * nz < 0) {
            sx = -sx;
            sy = -sy;
            sz = -sz;
          }
        }
      }
      const base = pos.length / 3;
      for (const v of vs) {
        pos.push(v[0], v[1], v[2]);
        nrm.push(sx, sy, sz);
      }
      idx.push(base, base + 1, base + 2);
      patched++;
    };
    if (m.index) {
      const ix = m.index.array;
      for (let i = 0; i + 2 < ix.length; i += 3) pushTri(ix[i]!, ix[i + 1]!, ix[i + 2]!);
    } else {
      for (let i = 0; i + 8 < p.length; i += 9) pushTri(i / 3, i / 3 + 1, i / 3 + 2);
    }
  }
  if (flips > 0) logger.info({ flips, patched }, '[converter] patch triangles re-oriented by ray test');

  return patched;
}

/** 对剩余洞做程序化封口：边界环 →（PCA 平面）耳切三角剖分 → 中点细分 + 拉普拉斯
 *  平滑 + 沿环平均法线膨胀（近似弯头外弧的鼓形）→ 顶点法线按射线法定向。 */
function synthesizeMissingSurfaces(
  gmsh: { attributes: { position: { array: number[] }; normal: { array: number[] } }; index: { array: number[] } },
  inHole: (p: number[]) => boolean,
  modelSize: number,
  firstHitDist: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) => number,
  nrm: number[],
): number {
  const pos = gmsh.attributes.position.array;
  const idx = gmsh.index.array;
  // 重算边界边（OCCT 补丁后）
  const edgeCount = new Map<string, number>();
  for (let i = 0; i + 2 < idx.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const u = idx[i + j]!;
      const v = idx[i + ((j + 1) % 3)]!;
      if (u === v) continue;
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
    }
  }
  const badj = new Map<number, number[]>();
  for (const [k, n] of edgeCount) {
    if (n !== 1) continue;
    const [a, b] = k.split('_').map(Number);
    (badj.get(a) || badj.set(a, []).get(a)!).push(b);
    (badj.get(b) || badj.set(b, []).get(b)!).push(a);
  }
  if (badj.size === 0) return 0;
  // 走环
  const walked = new Set<string>();
  const loops: number[][] = [];
  for (const [start, nbrs] of badj) {
    for (const first of nbrs) {
      const k0 = `${Math.min(start, first)}_${Math.max(start, first)}`;
      if (walked.has(k0)) continue;
      const loop = [start];
      let prev = start;
      let cur = first;
      while (true) {
        loop.push(cur);
        walked.add(`${Math.min(prev, cur)}_${Math.max(prev, cur)}`);
        // 分叉时选「转向最小」的邻居：OCCT 补丁碎片会让轮廓顶点带 >2 条边界边，
        // 乱选会走出乱序环，扇形三角互相穿插盖不住缺口
        const cands = (badj.get(cur) || []).filter(
          (n) => n !== prev && !walked.has(`${Math.min(cur, n)}_${Math.max(cur, n)}`),
        );
        let next: number | undefined;
        if (cands.length === 1) {
          next = cands[0];
        } else if (cands.length > 1) {
          const inDx = pos[cur * 3]! - pos[prev * 3]!;
          const inDy = pos[cur * 3 + 1]! - pos[prev * 3 + 1]!;
          const inDz = pos[cur * 3 + 2]! - pos[prev * 3 + 2]!;
          const inLen = Math.hypot(inDx, inDy, inDz) || 1;
          let bestDot = -Infinity;
          for (const n of cands) {
            const dx = pos[n * 3]! - pos[cur * 3]!;
            const dy = pos[n * 3 + 1]! - pos[cur * 3 + 1]!;
            const dz = pos[n * 3 + 2]! - pos[cur * 3 + 2]!;
            const len = Math.hypot(dx, dy, dz) || 1;
            const dot = (inDx * dx + inDy * dy + inDz * dz) / (inLen * len);
            if (dot > bestDot) {
              bestDot = dot;
              next = n;
            }
          }
        }
        if (next === undefined || next === start) break;
        prev = cur;
        cur = next;
        if (loop.length > 100000) break;
      }
      if (loop.length >= 8) loops.push(loop);
    }
  }
  let synthesized = 0;
  for (const loop of loops) {
    // 环准入：质心落在洞簇内即可（管口设计开口的环质心在管端，远离洞簇）
    const ring = loop.map((v) => [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!] as number[]);
    const centroid = [0, 0, 0];
    for (const p of ring) {
      centroid[0] += p[0] / ring.length;
      centroid[1] += p[1] / ring.length;
      centroid[2] += p[2] / ring.length;
    }
    const accepted = inHole(centroid) || ring.filter((p) => inHole(p)).length >= ring.length * 0.25;
    if (!accepted) continue;
    // 膨胀方向：洞缘顶点法线均值——洞缘是 gmsh 主体的网格，其平滑法线可信朝外；
    // （之前用环多边形面积向量+射线判定，在紧邻双壁处会误判，把鼓面顶进实体内）
    let ax = 0,
      ay = 0,
      az = 0;
    for (const v of loop) {
      ax += nrm[v * 3]!;
      ay += nrm[v * 3 + 1]!;
      az += nrm[v * 3 + 2]!;
    }
    const nl = Math.hypot(ax, ay, az);
    if (nl < 1e-9) continue;
    const nx = ax / nl,
      ny = ay / nl,
      nz = az / nl;
    // 膨胀量：仅 3%——细长环的单中心扇形大膨胀方向不稳（可能顶进实体内导致封口
    // 隐形），近平面封口任何角度都可见；微小外鼓保留一点弧度观感
    let diag = 0;
    for (const p of ring) diag = Math.max(diag, Math.hypot(p[0] - centroid[0], p[1] - centroid[1], p[2] - centroid[2]));
    const bulge = diag * 0.03;
    // 中心扇形封口：环顶点用 gmsh 现有 id（与周边网格无缝相接），中心顶点沿朝外
    // 法线膨胀出平滑鼓面。缺口环在凸弯上近似凸多边形，扇形即为正确剖分。
    const centerBase = pos.length / 3;
    pos.push(centroid[0] + nx * bulge, centroid[1] + ny * bulge, centroid[2] + nz * bulge);
    nrm.push(nx, ny, nz);
    let fanCount = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!,
        b = loop[(i + 1) % loop.length]!;
      if (a === b) continue;
      // 绕向：保证三角形法线与朝外方向一致
      const pa = [pos[a * 3]!, pos[a * 3 + 1]!, pos[a * 3 + 2]!];
      const pb = [pos[b * 3]!, pos[b * 3 + 1]!, pos[b * 3 + 2]!];
      const pc = [pos[centerBase * 3]!, pos[centerBase * 3 + 1]!, pos[centerBase * 3 + 2]!];
      const ux = pb[0]! - pa[0]!,
        uy = pb[1]! - pa[1]!,
        uz = pb[2]! - pa[2]!;
      const vx = pc[0]! - pa[0]!,
        vy = pc[1]! - pa[1]!,
        vz = pc[2]! - pa[2]!;
      const fx = uy * vz - uz * vy,
        fy = uz * vx - ux * vz,
        fz = ux * vy - uy * vx;
      if (fx * nx + fy * ny + fz * nz >= 0) idx.push(a, centerBase, b);
      else idx.push(b, centerBase, a);
      fanCount++;
    }
    synthesized += fanCount;
  }
  return synthesized;
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
  /** 转换进度回调（0-100）：编辑弹窗重转的进度条 */
  onProgress?: (percent: number, stage: string) => void;
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
  const reportProgress = options.onProgress;
  reportProgress?.(5, '正在分析几何...');

  // 先用主引擎跑一遍拿包围盒（gmsh 网格密度按模型尺寸定标）；
  // 主引擎失败/为空时用保守默认值
  let estimatedSize = 100;
  let dominantColor: [number, number, number] | null = null;
  let probeMeshes: OcctMesh[] = [];
  try {
    const occt = await occtimportjs();
    const fileBuffer = new Uint8Array(readFileSync(inputPath));
    const nameToCheck = originalName || inputPath;
    const ext = nameToCheck.split('.').pop()?.toLowerCase();
    const probe: OcctResult =
      ext === 'iges' || ext === 'igs'
        ? (occt.ReadIgesFile(fileBuffer, null) as OcctResult)
        : (occt.ReadStepFile(fileBuffer, null) as OcctResult);
    probeMeshes = probe?.meshes || [];
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

  const { convertStepViaGmshAsync, computeSmoothNormals, isGmshAvailable } = await import('./gmshFallback.js');
  if (!isGmshAvailable()) {
    throw new Error('服务器未安装 gmsh，无法使用修复引擎（请联系管理员在容器内安装 gmsh）');
  }
  reportProgress?.(20, 'gmsh 网格化中（耗时与模型大小相关）...');
  // 异步 spawn：不阻塞事件循环（同步版会让全站卡到转换结束）
  const fallback = await convertStepViaGmshAsync(inputPath, estimatedSize, dominantColor);
  if (!fallback) {
    throw new Error('修复引擎（gmsh）转换失败，请稍后重试或检查源文件');
  }

  // 预计算精确曲面补丁：gmsh 无法网格化的曲面（典型：周期性曲面）可用参数域求值方案
  // 离线生成精确网格，放到 static/surface-patches/<modelId>.json——修复转换时自动拼入，
  // 优先级高于 OCCT 碎片补丁和合成封口（生成方法见 docs 或运维手册）
  const patchPath = join(config.staticDir, 'surface-patches', `${modelId}.json`);
  let exactPatchInjected = false;
  if (existsSync(patchPath)) {
    try {
      const patch = JSON.parse(readFileSync(patchPath, 'utf8')) as {
        positions: number[];
        normals: number[] | null;
        indices: number[];
      };
      const fp = fallback.attributes.position.array;
      const fn = fallback.attributes.normal?.array;
      const fi = fallback.index?.array;
      if (!fi || !fn) throw new Error('fallback mesh missing index/normal');
      const base = fp.length / 3;
      // 索引级合并：补丁边缘顶点与 gmsh 洞缘顶点位置重合（同一套 1D 离散化）——
      // 直接复用已有顶点 id，网格真正连成一片（无重复顶点 = 无拼缝着色边界）。
      // 之后对合并网格整体重算角度阈值平滑法线：补丁与周边的着色浑然一体。
      const posHash = new Map<string, number>();
      for (let v = 0; v < base; v++) {
        const k = `${Math.round(fp[v * 3]! * 1e3)},${Math.round(fp[v * 3 + 1]! * 1e3)},${Math.round(fp[v * 3 + 2]! * 1e3)}`;
        if (!posHash.has(k)) posHash.set(k, v);
      }
      const remap = new Map<number, number>();
      let merged = 0;
      for (let i = 0, vi = 0; i < patch.positions.length; i += 3, vi++) {
        const k = `${Math.round(patch.positions[i]! * 1e3)},${Math.round(patch.positions[i + 1]! * 1e3)},${Math.round(patch.positions[i + 2]! * 1e3)}`;
        const existing = posHash.get(k);
        if (existing !== undefined) {
          remap.set(vi, existing);
          merged++;
        } else {
          const newId = fp.length / 3;
          fp.push(patch.positions[i]!, patch.positions[i + 1]!, patch.positions[i + 2]!);
          fn.push(0, 0, 0); // 占位，后面整体重算
          remap.set(vi, newId);
        }
      }
      for (let t = 0; t + 2 < patch.indices.length; t += 3) {
        const a = remap.get(patch.indices[t]!) ?? patch.indices[t]!;
        const b = remap.get(patch.indices[t + 1]!) ?? patch.indices[t + 1]!;
        const c = remap.get(patch.indices[t + 2]!) ?? patch.indices[t + 2]!;
        fi.push(a, b, c);
      }
      // 合并网格整体重算平滑法线（角度阈值：曲面平滑、棱边锐利，与主引擎观感一致）
      const smoothed = computeSmoothNormals(fp, fi);
      for (let i = 0; i < fn.length; i++) fn[i] = smoothed[i] ?? fn[i]!;
      exactPatchInjected = true;
      logger.info(
        { verts: patch.positions.length / 3, tris: patch.indices.length / 3, merged },
        '[converter] injected exact surface patch (index-merged, normals re-smoothed)',
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[converter] surface patch injection failed',
      );
    }
  }

  // 混合补洞：gmsh 网格化不了的曲面（如周期性曲面）留有小洞，用主引擎的
  // 三角形填补洞区域——预览不再有可见缺口。
  // 精确补丁已注入时跳过：OCCT 碎片/合成封口会叠在精确曲面上（z-fighting 破烂观感）
  if (!exactPatchInjected) {
    reportProgress?.(60, '正在检查并修补网格缺口...');
    try {
      const patched = patchGmshHolesWithOcct(
        fallback as unknown as {
          attributes: { position: { array: number[] }; normal: { array: number[] } };
          index: { array: number[] };
        },
        probeMeshes,
      );
      if (patched > 0) logger.info({ patched }, '[converter] gmsh mesh holes patched with occt triangles');
    } catch (err) {
      // 补洞失败不影响主结果（gmsh 网格本身可用）
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[converter] hole patch skipped');
    }
  }

  reportProgress?.(70, '正在装配模型...');
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

  const reportProgress = options.onProgress;
  reportProgress?.(8, '正在解析几何...');

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

  reportProgress?.(45, '正在生成网格...');

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
  reportProgress?.(72, '正在装配模型...');
  const gltfPath = writeGlb(json, bin, outputDir, modelId);
  await persistFile(gltfPath);
  reportProgress?.(88, '正在收尾...');
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
