/**
 * Shared option sorting logic for selection wizard.
 * Sort type is determined by column definition's sortType field:
 *   "thread" → thread/spec sorting (R, G, NPT, PT, ZG, M)
 *   "numeric" → extract leading number
 *   "default" / undefined → Chinese locale with numeric support
 */

import { DEFAULT_THREAD_PRIORITY } from "./businessConfig";

const THREAD_PREFIX_PRIORITY: Record<string, number> = {
  R: 0,
  RC: 0,
  G: 1,
  "": 2,
  NPT: 3,
  PT: 4,
  ZG: 4,
  M: 5,
};

function extractLeadingNumber(value: string): number | null {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseThreadSize(raw: string): number | null {
  const value = raw.replace(/"/g, "").trim();
  if (!value) return null;

  if (value.includes("-")) {
    const [whole, fraction] = value.split("-", 2);
    const wholeNumber = Number(whole);
    const fractionNumber = parseThreadSize(fraction);
    if (Number.isFinite(wholeNumber) && fractionNumber !== null) {
      return wholeNumber + fractionNumber;
    }
  }

  if (value.includes("/")) {
    const [num, den] = value.split("/", 2).map(Number);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return num / den;
    }
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractThreadSortKey(value: string, priority: Record<string, number>): { prefixRank: number; size: number | null; token: string } | null {
  const match = value.toUpperCase().match(/(RC|R|G|NPT|PT|ZG|M)?\s*(\d+(?:-\d+\/\d+|\/\d+|(?:\.\d+)?)?)/);
  if (!match) return null;

  const prefix = match[1] ?? "";
  const token = match[2] ?? "";
  const size = parseThreadSize(token);

  return {
    prefixRank: priority[prefix] ?? 99,
    size,
    token,
  };
}

/** Compare two option values given a sortType */
export function compareOptionValues(sortType: string | undefined, left: string, right: string, threadPriority: Record<string, number> = THREAD_PREFIX_PRIORITY): number {
  if (sortType === "thread") {
    const priority = { ...DEFAULT_THREAD_PRIORITY, ...threadPriority };
    const leftThread = extractThreadSortKey(left, priority);
    const rightThread = extractThreadSortKey(right, priority);

    if (leftThread && rightThread) {
      if (leftThread.prefixRank !== rightThread.prefixRank) {
        return leftThread.prefixRank - rightThread.prefixRank;
      }
      if (leftThread.size !== null && rightThread.size !== null && leftThread.size !== rightThread.size) {
        return leftThread.size - rightThread.size;
      }
      if (leftThread.size !== null && rightThread.size === null) return -1;
      if (leftThread.size === null && rightThread.size !== null) return 1;
    } else if (leftThread || rightThread) {
      return leftThread ? -1 : 1;
    }
  }

  if (sortType === "numeric") {
    const leftNum = extractLeadingNumber(left);
    const rightNum = extractLeadingNumber(right);
    if (leftNum !== null && rightNum !== null && leftNum !== rightNum) {
      return leftNum - rightNum;
    }
    if (leftNum !== null && rightNum === null) return -1;
    if (leftNum === null && rightNum !== null) return 1;
  }

  return left.localeCompare(right, "zh-CN", { numeric: true });
}

/** Sort an array of option values using the given sortType */
export function smartSortOptions(values: string[], sortType?: string): string[] {
  return [...values].sort((a, b) => compareOptionValues(sortType, a, b));
}
