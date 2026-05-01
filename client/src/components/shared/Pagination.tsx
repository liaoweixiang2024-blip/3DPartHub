import Icon from "./Icon";

export const DEFAULT_PAGE_SIZE = 60;
export const PAGE_SIZE_OPTIONS = [30, 60, 120, 180] as const;

export function normalizePageSize(value: string | number | null | undefined, options: readonly number[] = PAGE_SIZE_OPTIONS, defaultSize = DEFAULT_PAGE_SIZE) {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : defaultSize;
  return options.includes(normalized) ? normalized : defaultSize;
}

interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems?: number;
  compact?: boolean;
  className?: string;
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

export default function Pagination({
  page,
  totalPages,
  totalItems = 0,
  compact = false,
  className = "",
  pageSize,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const showPageSize = Boolean(pageSize && onPageSizeChange);
  const minPageSize = pageSizeOptions[0] || 1;
  if (totalPages <= 1 && (!showPageSize || totalItems <= minPageSize)) return null;

  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(page, 1), safeTotalPages);
  const progress = Math.max(4, Math.min(100, (safePage / safeTotalPages) * 100));
  const changePage = (nextPage: number) => {
    const normalized = Math.min(Math.max(nextPage, 1), safeTotalPages);
    if (normalized !== safePage) onPageChange(normalized);
  };

  const pageSizeSelect = showPageSize ? (
    <label className="relative shrink-0">
      <span className="sr-only">每页数量</span>
      <select
        value={pageSize}
        onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
        className={`${compact ? "h-9 border border-outline-variant/20 bg-surface-container px-2.5 pr-6 text-xs" : "h-9 px-3 pr-8 text-sm"} appearance-none rounded-md font-medium text-on-surface outline-none transition-colors hover:bg-surface-container-high`}
      >
        {pageSizeOptions.map((size) => (
          <option key={size} value={size}>{size}/页</option>
        ))}
      </select>
      <Icon name="expand_more" size={12} className={`pointer-events-none absolute ${compact ? "right-1.5" : "right-2"} top-1/2 -translate-y-1/2 text-on-surface-variant`} />
    </label>
  ) : null;

  if (compact) {
    return (
      <nav className={`mt-5 pb-4 ${className}`} aria-label="分页">
        <div className="mx-auto flex w-full max-w-[320px] items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-low/90 p-1.5 shadow-sm">
          <button
            type="button"
            onClick={() => changePage(safePage - 1)}
            disabled={safePage <= 1}
            aria-label="上一页"
            className="flex h-9 w-10 shrink-0 items-center justify-center rounded-md border border-outline-variant/20 bg-surface-container text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Icon name="chevron_left" size={18} />
          </button>
          <div className="min-w-0 flex-1 px-1">
            <div className="h-1 overflow-hidden rounded-full bg-surface-container-high">
              <div className="h-full rounded-full bg-primary-container transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
          {pageSizeSelect}
          <button
            type="button"
            onClick={() => changePage(safePage + 1)}
            disabled={safePage >= safeTotalPages}
            aria-label="下一页"
            className="flex h-9 w-10 shrink-0 items-center justify-center rounded-md border border-outline-variant/20 bg-surface-container text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Icon name="chevron_right" size={18} />
          </button>
        </div>
      </nav>
    );
  }

  const pages: (number | "...")[] = [];
  const showPages = 5;
  if (safeTotalPages <= showPages + 2) {
    for (let i = 1; i <= safeTotalPages; i += 1) pages.push(i);
  } else {
    pages.push(1);
    const start = Math.max(2, safePage - 1);
    const end = Math.min(safeTotalPages - 1, safePage + 1);
    if (start > 2) pages.push("...");
    for (let i = start; i <= end; i += 1) pages.push(i);
    if (end < safeTotalPages - 1) pages.push("...");
    pages.push(safeTotalPages);
  }

  return (
    <nav className={`mt-7 flex flex-col items-center gap-2.5 pb-5 ${className}`} aria-label="分页">
      <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-outline-variant/20 bg-surface-container-low/80 p-1 shadow-sm scrollbar-hidden">
        <button
          type="button"
          onClick={() => changePage(safePage - 1)}
          disabled={safePage <= 1}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Icon name="chevron_left" size={16} />
          <span>上一页</span>
        </button>
        <div className="mx-0.5 h-5 w-px shrink-0 bg-outline-variant/20" />
        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`e${i}`} className="flex h-9 w-9 shrink-0 items-center justify-center text-sm text-on-surface-variant/45">...</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => changePage(p)}
              aria-current={p === safePage ? "page" : undefined}
              className={`flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors ${
                p === safePage
                  ? "bg-primary-container text-on-primary shadow-sm"
                  : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              }`}
            >
              {p}
            </button>
          )
        )}
        <div className="mx-0.5 h-5 w-px shrink-0 bg-outline-variant/20" />
        <button
          type="button"
          onClick={() => changePage(safePage + 1)}
          disabled={safePage >= safeTotalPages}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-35"
        >
          <span>下一页</span>
          <Icon name="chevron_right" size={16} />
        </button>
        {pageSizeSelect && (
          <>
            <div className="mx-0.5 h-5 w-px shrink-0 bg-outline-variant/20" />
            {pageSizeSelect}
          </>
        )}
      </div>
    </nav>
  );
}
