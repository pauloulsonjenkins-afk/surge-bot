import type { HitRateRow } from "@/queries/use-stats";
import { EmptyState } from "./EmptyState";

/** A ranked list of hit rates with a bar behind each row. Rows with no settled picks show a dash, not 0%. */
export function RateList({ rows, emptyDetail }: { rows: HitRateRow[]; emptyDetail: string }) {
  if (rows.length === 0) return <EmptyState title="Nothing here yet" detail={emptyDetail} />;

  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const settled = r.hits + r.misses;
        return (
          <li key={r.label} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-ink">{r.label}</span>
              <span className="shrink-0 text-sm font-medium tabular-nums text-ink">
                {r.hitRate === null ? "–" : `${r.hitRate}%`}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-chart" style={{ width: `${r.hitRate ?? 0}%` }} />
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {r.hits} hit{r.hits === 1 ? "" : "s"} · {r.misses} miss{r.misses === 1 ? "" : "es"} · {r.alerts} alert
              {r.alerts === 1 ? "" : "s"}
              {settled < 30 && settled > 0 ? " · small sample" : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
