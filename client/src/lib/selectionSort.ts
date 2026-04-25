/**
 * Shared option sorting logic for selection wizard.
 * Used by both SelectionPage and SelectionAdminPage.
 */

const NUMERIC_SORT_FIELDS = new Set(["管径", "适用管外径", "适用管径"]);
const THREAD_SORT_FIELDS = new Set(["螺纹规格", "螺纹"]);
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

function extractThreadSortKey(value: string): { prefixRank: number; size: number | null; token: string } | null {
  const match = value.toUpperCase().match(/(RC|R|G|NPT|PT|ZG|M)?\s*(\d+(?:-\d+\/\d+|\/\d+|(?:\.\d+)?)?)/);
  if (!match) return null;

  const prefix = match[1] ?? "";
  const token = match[2] ?? "";
  const size = parseThreadSize(token);

  return {
    prefixRank: THREAD_PREFIX_PRIORITY[prefix] ?? 99,
    size,
    token,
  };
}

export function compareOptionValues(field: string, left: string, right: string): number {
  if (THREAD_SORT_FIELDS.has(field)) {
    const leftThread = extractThreadSortKey(left);
    const rightThread = extractThreadSortKey(right);

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

  if (NUMERIC_SORT_FIELDS.has(field)) {
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

/** Sort an array of option values using smart comparison for the given field */
export function smartSortOptions(values: string[], field: string): string[] {
  return [...values].sort((a, b) => compareOptionValues(field, a, b));
}
