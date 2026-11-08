export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-surface-2 ${className}`}
      aria-hidden="true"
    />
  );
}

/** For list-style pages (trade log, schedule): a row of skeleton cards. */
export function ListSkeleton({ items = 6 }: { items?: number }) {
  return (
    <div className="space-y-2 px-4 py-4">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-line p-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A grid of figures loading, shaped like the divided strips on Today and Live (a label, a figure, a line under it), so
 * the page doesn't jump when the real ones arrive (design polish, 8 Nov 2026).
 */
export function StripSkeleton({ cells = 4, columns = 2 }: { cells?: number; columns?: number }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} aria-hidden="true">
      {Array.from({ length: cells }).map((_, i) => (
        <div key={i} className="space-y-2 bg-surface p-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  );
}
