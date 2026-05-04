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
 * Build a match map: for each selection product modelNo, find the best matching model.
 * Matches against model.name. When multiple versions exist in a group, prefers the primary.
 */
export async function buildModelMatchMap(modelNos: string[]) {
  const result = new Map<string, { id: string; thumbnailUrl: string | null }>();

  if (modelNos.length === 0) return result;

  const { value: matchIndex } = await cacheGetOrSet<MatchIndexEntry[]>(
    'cache:models:match-index:v2',
    TTL.MODEL_MATCH_INDEX,
    buildModelMatchIndex,
    { lockTtlMs: 30_000, waitTimeoutMs: 20_000, pollMs: 50 },
  );

  const normMap = new Map<string, { id: string; thumbnailUrl: string | null }>(matchIndex);
  const normKeys = Array.from(normMap.keys());

  for (const raw of modelNos) {
    const nq = normalizePN(raw);

    // 1) Exact normalized match
    const exact = normMap.get(nq);
    if (exact) {
      result.set(raw, exact);
      continue;
    }

    // 2) Segment match — modelNo must appear as a complete _-delimited segment
    //    e.g. "PC10-04" matches "白色直快插_PC10-04" (segment after _, ends at string end)
    //    but "PC10-04" does NOT match "TKN-PC10-04" (TKN- prefix, not after _)
    //    and "QG-L-10L" does NOT match "QG-L-10L-B11" (truncated, not full segment)
    let best: { id: string; thumbnailUrl: string | null } | undefined;
    for (const nk of normKeys) {
      // modelNo is longer/more specific → model name is a prefix segment of modelNo
      if (nq.includes(nk)) {
        best = normMap.get(nk);
        break;
      }
      // model name contains modelNo → must be a full _-segment
      if (nk.includes(nq)) {
        const idx = nk.indexOf(nq);
        const end = idx + nq.length;
        const precededBySep = idx > 0 && nk[idx - 1] === '_';
        const followedByEnd = end === nk.length;
        const followedBySep = end < nk.length && nk[end] === '_';
        if (precededBySep && (followedByEnd || followedBySep)) {
          best = normMap.get(nk);
          break;
        }
      }
    }
    if (best) result.set(raw, best);
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
  for (const m of allModels) {
    const nk = normalizePN(m.name);
    if (!normBuckets.has(nk)) normBuckets.set(nk, []);
    normBuckets.get(nk)!.push({ id: m.id, thumbnailUrl: m.thumbnailUrl, isPrimary: primaryIds.has(m.id) });
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
