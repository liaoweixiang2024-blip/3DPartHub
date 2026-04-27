import { createHash } from "node:crypto";

export const MAX_SEARCH_LENGTH = 200;
export const MAX_SEARCH_TERMS = 12;
export const MAX_MODEL_PAGE_SIZE = 10000;
export const MAX_MODEL_PAGE = 1000;

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const WHITESPACE = /\s+/g;

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeSearchParam(value: unknown, maxLength = MAX_SEARCH_LENGTH): string {
  const raw = firstQueryValue(value);
  if (typeof raw !== "string") return "";
  const normalized = raw.replace(CONTROL_CHARS, " ").replace(WHITESPACE, " ").trim();
  return Array.from(normalized).slice(0, maxLength).join("");
}

export function numericQuery(value: unknown, fallback: number, min: number, max: number): number {
  const raw = firstQueryValue(value);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function enumQuery<T extends string>(value: unknown, fallback: T, allowed: readonly T[]): T {
  const raw = firstQueryValue(value);
  if (typeof raw !== "string") return fallback;
  return allowed.includes(raw as T) ? raw as T : fallback;
}

export function searchCacheToken(search: string): string {
  if (!search) return "";
  return createHash("sha256").update(search).digest("hex").slice(0, 20);
}

export function getSearchTerms(search: string): string[] {
  return search.split(WHITESPACE).map((term) => term.trim()).filter(Boolean).slice(0, MAX_SEARCH_TERMS);
}

export function modelTextSearchCondition(term: string): Record<string, unknown> {
  const contains = { contains: term, mode: "insensitive" as const };
  return {
    OR: [
      { name: contains },
      { originalName: contains },
      { description: contains },
      { partNumber: contains },
      { category: contains },
      { dimensions: contains },
      { format: contains },
      { originalFormat: contains },
      { drawingName: contains },
      { categoryRef: { is: { name: contains } } },
      { group: { is: { name: contains } } },
    ],
  };
}

export function modelTextSearchWhere(search: string): Record<string, unknown> | null {
  const terms = getSearchTerms(search);
  if (!terms.length) return null;
  if (terms.length === 1) return modelTextSearchCondition(terms[0]);
  return { AND: terms.map(modelTextSearchCondition) };
}
