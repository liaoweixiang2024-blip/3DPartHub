import { cacheGetOrSet, TTL } from './cache.js';
import { prisma } from './prisma.js';

type MatchIndexEntry = [string, { id: string; thumbnailUrl: string | null }];

/**
 * Normalize a string for fuzzy matching:
 * - lowercase, remove spaces, treat _ and / as equivalent
 */
function normalizePN(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').replace(/[/]/g, '_');
}

/**
 * Build a match map: for each selection product modelNo, find the matching model.
 * Matches against model.name (exact, after normalization; 「中文名_型号」的型号尾段也建了键).
 * When multiple versions exist in a group, prefers the primary.
 *
 * 注意：只做精确匹配。此前的「包含兜底」（型号段互为子串即可匹配）在同号不同物的
 * 家族/变体/尺寸间大量错配，例如：TKN-PC4-01（铜快拧）↔ 白色直快插_PC4-01（塑料
 * 快插）、BZHF-W-1 ↔ BZHF-W-1/2（口径不同）、QG-W-20L-B-11 ↔ QG-W-20L（变体不同）、
 * KP5404-25 ↔ KP5404-25-DC24V（电压配置不同）——差一段就是不同的东西，
 * 宁可不配（结果卡不显示 3D 缩略图）不可错配。
 */
export async function buildModelMatchMap(modelNos: string[]) {
  const result = new Map<string, { id: string; thumbnailUrl: string | null }>();

  if (modelNos.length === 0) return result;

  const { value: matchIndex } = await cacheGetOrSet<MatchIndexEntry[]>(
    'cache:models:match-index:v4',
    TTL.MODEL_MATCH_INDEX,
    buildModelMatchIndex,
    { lockTtlMs: 30_000, waitTimeoutMs: 20_000, pollMs: 50 },
  );

  const normMap = new Map<string, { id: string; thumbnailUrl: string | null }>(matchIndex);

  for (const raw of modelNos) {
    const exact = normMap.get(normalizePN(raw));
    if (exact) result.set(raw, exact);
  }

  return result;
}

async function buildModelMatchIndex(): Promise<MatchIndexEntry[]> {
  const allModels = await prisma.model.findMany({
    select: { id: true, name: true, thumbnailUrl: true, groupId: true },
  });

  // Collect groupIds to find primary models
  const groupIds = new Set(allModels.map((m) => m.groupId).filter(Boolean) as string[]);
  const primaryIds = new Set<string>();
  if (groupIds.size > 0) {
    const groups = await prisma.modelGroup.findMany({
      where: { id: { in: Array.from(groupIds) } },
      select: { id: true, primaryId: true },
    });
    for (const g of groups) {
      if (g.primaryId) primaryIds.add(g.primaryId);
    }
  }

  // Build normalized lookup: normalized name → ALL matching models
  const normBuckets = new Map<string, { id: string; thumbnailUrl: string | null; isPrimary: boolean }[]>();
  const addBucket = (nk: string, m: { id: string; thumbnailUrl: string | null }) => {
    if (!nk) return;
    if (!normBuckets.has(nk)) normBuckets.set(nk, []);
    normBuckets.get(nk)!.push({ id: m.id, thumbnailUrl: m.thumbnailUrl, isPrimary: primaryIds.has(m.id) });
  };
  for (const m of allModels) {
    const nk = normalizePN(m.name);
    addBucket(nk, m);
    // 站内命名规约「中文名_型号」（如 白色联管直通_PU8）：型号段单独立 key，
    // 选型产品的 PU8 才能精确命中（匹配只走精确，见 buildModelMatchMap 注释）。
    // 型号段取「第一个 _ 之后」的整段：型号里的 / 在文件名中被清洗成 _（SLF-3/8 → 不锈钢内牙弯头_SLF-3_8），
    // 按全部 _ 切分会把尾段切碎成 "8"；最后一个 _ 段同时保留，兼容历史「A_B_C 只以 C 为型号」的命名
    const segments = nk.split('_');
    if (segments.length > 1) {
      const tail = segments.slice(1).join('_');
      if (tail) addBucket(tail, m);
      const last = segments[segments.length - 1];
      if (last && last !== tail) addBucket(last, m);
    }
  }

  // Flatten: pick primary if available, else first
  const normMap = new Map<string, { id: string; thumbnailUrl: string | null }>();
  for (const [nk, bucket] of normBuckets) {
    const primary = bucket.find((b) => b.isPrimary);
    const selected = primary ?? bucket[0];
    normMap.set(nk, { id: selected.id, thumbnailUrl: selected.thumbnailUrl });
  }
  return Array.from(normMap.entries());
}
