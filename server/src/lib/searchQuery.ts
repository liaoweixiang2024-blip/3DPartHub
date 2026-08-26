import { createHash } from 'node:crypto';

export const MAX_SEARCH_LENGTH = 200;
export const MAX_SEARCH_TERMS = 12;
export const MAX_MODEL_PAGE_SIZE = 10000;
export const MAX_MODEL_PAGE = 1000;

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const WHITESPACE = /\s+/g;
const MAX_SEARCH_ALIASES_PER_TERM = 48;

const PIPE_SIZE_ALIAS_GROUPS = [
  ['1/8', '1／8', '1_8', '1分'],
  ['1/4', '1／4', '1_4', '1分半', '2分'],
  ['3/8', '3／8', '3_8', '3分'],
  ['1/2', '1／2', '1_2', '1.2寸', '4分'],
  ['5/8', '5／8', '5_8', '5分'],
  ['3/4', '3／4', '3_4', '3.4寸', '6分'],
  ['7/8', '7／8', '7_8', '7分'],
  ['1寸', '8分', '1英寸', '1in', '1"'],
] as const;

const SIZE_MULTIPLY_ALIAS_GROUP = ['*', 'x', 'X', '×', '叉'] as const;
const SEARCH_ALIAS_GROUPS = [...PIPE_SIZE_ALIAS_GROUPS, SIZE_MULTIPLY_ALIAS_GROUP] as const;

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function replaceAllLiteral(value: string, search: string, replacement: string) {
  return value.split(search).join(replacement);
}

function pushLimited(set: Set<string>, value: string) {
  if (set.size >= MAX_SEARCH_ALIASES_PER_TERM) return;
  const normalized = value.trim();
  if (normalized) set.add(normalized);
}

export function normalizeSearchParam(value: unknown, maxLength = MAX_SEARCH_LENGTH): string {
  const raw = firstQueryValue(value);
  if (typeof raw !== 'string') return '';
  const normalized = raw.replace(CONTROL_CHARS, ' ').replace(WHITESPACE, ' ').trim();
  return Array.from(normalized).slice(0, maxLength).join('');
}

export function numericQuery(value: unknown, fallback: number, min: number, max: number): number {
  const raw = firstQueryValue(value);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function enumQuery<T extends string>(value: unknown, fallback: T, allowed: readonly T[]): T {
  const raw = firstQueryValue(value);
  if (typeof raw !== 'string') return fallback;
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export function searchCacheToken(search: string): string {
  if (!search) return '';
  return createHash('sha256').update(search).digest('hex').slice(0, 20);
}

export function getSearchTerms(search: string): string[] {
  return search
    .split(WHITESPACE)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TERMS);
}

export function getSearchTermAliases(term: string): string[] {
  const normalized = term.trim();
  if (!normalized) return [];
  const aliases = new Set<string>([normalized]);

  for (const group of SEARCH_ALIAS_GROUPS) {
    const currentAliases = Array.from(aliases);
    const sortedGroup = [...group].sort((a, b) => b.length - a.length);
    for (const current of currentAliases) {
      for (const source of sortedGroup) {
        if (!current.includes(source)) continue;
        for (const replacement of group) {
          if (replacement === source) continue;
          pushLimited(aliases, replaceAllLiteral(current, source, replacement));
        }
      }
    }
  }

  return Array.from(aliases).slice(0, MAX_SEARCH_ALIASES_PER_TERM);
}

export function modelTextSearchCondition(term: string): Record<string, unknown> {
  const termAliases = getSearchTermAliases(term);
  const textConditions = termAliases.flatMap((alias) => {
    const contains = { contains: alias, mode: 'insensitive' as const };
    return [
      { name: contains },
      { originalName: contains },
      { description: contains },
      { partNumber: contains },
      { category: contains },
      { dimensions: contains },
      { format: contains },
      { originalFormat: contains },
      { drawings: { some: { name: contains } } },
      { categoryRef: { is: { name: contains } } },
      { group: { is: { name: contains } } },
    ];
  });
  return {
    OR: textConditions,
  };
}

export function modelTextSearchWhere(search: string): Record<string, unknown> | null {
  const terms = getSearchTerms(search);
  if (!terms.length) return null;
  if (terms.length === 1) return modelTextSearchCondition(terms[0]);
  return { AND: terms.map(modelTextSearchCondition) };
}
