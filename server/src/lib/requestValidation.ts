export function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
}

export function optionalString(value: unknown, options: { trim?: boolean; maxLength?: number } = {}): string | undefined {
  const raw = firstString(value);
  if (raw === undefined) return undefined;
  const result = options.trim === false ? raw : raw.trim();
  if (!result) return undefined;
  if (options.maxLength && result.length > options.maxLength) {
    return result.slice(0, options.maxLength);
  }
  return result;
}

export function requiredString(value: unknown, fieldName: string, options: { trim?: boolean; maxLength?: number } = {}): string {
  const result = optionalString(value, options);
  if (result === undefined) {
    throw new RequestValidationError(`缺少 ${fieldName}`);
  }
  return result;
}

export function booleanFlag(value: unknown): boolean {
  const text = optionalString(value)?.toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

export function numericValue(value: unknown, fallback: number, min: number, max: number): number {
  const raw = firstString(value);
  const parsed = raw === undefined ? Number(value) : Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function routeParam(value: unknown, fieldName = "id"): string {
  const result = optionalString(value, { maxLength: 160 });
  if (!result) {
    throw new RequestValidationError(`缺少 ${fieldName}`);
  }
  return result;
}

export function stringArray(value: unknown, options: { limit?: number; maxLength?: number } = {}): string[] {
  const limit = options.limit ?? 100;
  const maxLength = options.maxLength ?? 160;
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => {
      if (typeof item === "string") return optionalString(item, { maxLength });
      if (typeof item === "number" || typeof item === "boolean") return optionalString(String(item), { maxLength });
      return undefined;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, limit);
}

export function paginationQuery(
  query: Record<string, unknown>,
  options: {
    pageKey?: string;
    pageSizeKey?: string;
    defaultPage?: number;
    defaultPageSize?: number;
    maxPageSize?: number;
  } = {}
) {
  const pageKey = options.pageKey ?? "page";
  const pageSizeKey = options.pageSizeKey ?? "page_size";
  const page = numericValue(query[pageKey], options.defaultPage ?? 1, 1, 100000);
  const pageSize = numericValue(query[pageSizeKey], options.defaultPageSize ?? 20, 1, options.maxPageSize ?? 100);
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

export class RequestValidationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
