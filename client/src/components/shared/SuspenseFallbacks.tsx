import { AdminPageShell } from './AdminPageShell';
import { PublicPageShell } from './PublicPageShell';

/** Admin layout content skeleton -- mimics AdminManagementPage header + list */
export function AdminContentSkeleton() {
  return (
    <AdminPageShell>
      <div className="flex h-full min-h-0 flex-col gap-3 md:gap-4">
        <section className="shrink-0 rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 md:px-5">
          <div className="flex min-h-[58px] items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-h-7 items-center gap-2.5">
                <div className="h-5 w-32 animate-pulse rounded bg-surface-container-lowest" />
                <div className="h-4 w-16 animate-pulse rounded bg-surface-container-lowest" />
              </div>
              <div className="mt-0.5 h-3 w-48 animate-pulse rounded bg-surface-container-lowest" />
            </div>
            <div className="h-8 w-24 animate-pulse rounded-md bg-surface-container-lowest shrink-0" />
          </div>
        </section>
        <div className="min-h-0 flex-1 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-surface-container-low" />
          ))}
        </div>
      </div>
    </AdminPageShell>
  );
}

/** Public layout content skeleton */
export function PublicContentSkeleton() {
  return (
    <PublicPageShell>
      <div className="flex flex-1 flex-col p-4 md:p-8 gap-4">
        <div className="h-6 w-48 animate-pulse rounded bg-surface-container-lowest" />
        <div className="h-4 w-64 animate-pulse rounded bg-surface-container-lowest" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-container-low" />
          ))}
        </div>
      </div>
    </PublicPageShell>
  );
}

/** Login page skeleton */
export function LoginSkeleton() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-full max-w-sm mx-4 p-6 rounded-xl border border-outline-variant/15 bg-surface-container-low space-y-4 animate-pulse">
        <div className="h-8 w-24 mx-auto rounded bg-surface-container-lowest" />
        <div className="h-10 w-full rounded bg-surface-container-lowest" />
        <div className="h-10 w-full rounded bg-surface-container-lowest" />
        <div className="h-10 w-full rounded-md bg-surface-container-lowest" />
      </div>
    </div>
  );
}
