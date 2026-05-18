export const DEMAND_DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
export const MESSAGE_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

export function cleanUserText(value: unknown, maxLength = 2000) {
  return typeof value === 'string' ? value.trim().replace(/\r\n/g, '\n').slice(0, maxLength) : '';
}

export function normalizeDuplicateText(value: unknown) {
  return cleanUserText(value, 2000).replace(/\s+/g, ' ').toLowerCase();
}

export function duplicateSince(windowMs: number) {
  return new Date(Date.now() - windowMs);
}

export function lowQualitySubmissionReason(text: string, label = '内容') {
  const compact = text.replace(/\s+/g, '');
  if (compact.length < 6) return `${label}请至少填写 6 个有效字符`;
  if (/(.)\1{20,}/u.test(compact)) return `${label}包含过多重复字符，请补充有效说明`;
  if (compact.length >= 20 && new Set(Array.from(compact)).size <= 2) {
    return `${label}过于简单，请补充有效说明`;
  }
  return null;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}
