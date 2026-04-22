/**
 * Skeleton loading components — replace spinners for smoother perceived loading.
 * All use Tailwind's animate-pulse for the shimmer effect.
 */

/** Card skeleton — matches ProductCard aspect ratio */
export function SkeletonCard() {
  return (
    <div className="bg-surface-container-high rounded-sm overflow-hidden animate-pulse">
      <div className="aspect-square bg-surface-container-lowest" />
      <div className="p-2.5 space-y-2">
        <div className="h-3 bg-surface-container-lowest rounded w-3/4" />
        <div className="h-3 bg-surface-container-lowest rounded w-1/2" />
      </div>
    </div>
  );
}

/** Compact card skeleton for mobile grids */
export function SkeletonCardCompact() {
  return (
    <div className="bg-surface-container-high rounded-sm overflow-hidden animate-pulse">
      <div className="aspect-square bg-surface-container-lowest" />
      <div className="p-2 space-y-1.5">
        <div className="h-2.5 bg-surface-container-lowest rounded w-3/4" />
      </div>
    </div>
  );
}

/** List row skeleton — for table/list views */
export function SkeletonRow({ cols = 3 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="h-4 bg-surface-container-lowest rounded flex-1" style={{ maxWidth: `${90 / cols}%` }} />
      ))}
    </div>
  );
}

/** Full-page skeleton grid — drop-in replacement for centered spinners */
export function SkeletonGrid({ count = 12, compact = false }: { count?: number; compact?: boolean }) {
  const Comp = compact ? SkeletonCardCompact : SkeletonCard;
  const cols = compact
    ? "grid-cols-2"
    : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";
  return (
    <div className={`grid gap-3 ${cols}`}>
      {Array.from({ length: count }).map((_, i) => <Comp key={i} />)}
    </div>
  );
}

/** Full-page skeleton list */
export function SkeletonList({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-0 divide-y divide-outline-variant/10">
      {Array.from({ length: rows }).map((_, i) => <SkeletonRow key={i} />)}
    </div>
  );
}
