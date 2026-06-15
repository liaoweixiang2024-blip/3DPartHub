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

    // 2) Containment match — model name is a complete segment of modelNo
    //    (or vice versa), longest match wins. The shorter side must cover
    //    at least 60 % of the longer side so that "SQG-PAU1208-6M-03" will
    //    never match a bare "SQG" (only 3/18 = 17 %).
    let best: { id: string; thumbnailUrl: string | null } | undefined;
    let bestLen = 0;
    const isSep = (c: string) => c === '_' || c === '-';
    const longerLen = (a: string, b: string) => Math.max(a.length, b.length);
    // Check whether `needle` appears as a complete segment in `hay` at least once.
    const segmentMatch = (hay: string, needle: string) => {
      let from = 0;
      let idx = hay.indexOf(needle, from);
      while (idx !== -1) {
        const end = idx + needle.length;
        const precededOk = idx === 0 || isSep(hay[idx - 1]);
        const followedOk = end === hay.length || isSep(hay[end]);
        if (precededOk && followedOk) return true;
        from = idx + 1;
        idx = hay.indexOf(needle, from);
      }
      return false;
    };
    for (const nk of normKeys) {
      // modelNo contains model name → model name must be a complete segment
      if (nk.length > bestLen && nk.length >= longerLen(nq, nk) * 0.6 && segmentMatch(nq, nk)) {
        best = normMap.get(nk);
        bestLen = nk.length;
      }
      // model name contains modelNo → modelNo must be a complete segment
      else if (nk.length > bestLen && nq.length >= longerLen(nq, nk) * 0.6 && segmentMatch(nk, nq)) {
        best = normMap.get(nk);
        bestLen = nk.length;
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
