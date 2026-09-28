"use client";

import { EmptyState } from "@/components/dashboard/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { marketName } from "@/lib/markets";
import { useHitRateStats } from "@/queries/use-stats";

const whenFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

export default function StrategiesPage() {
  const { data, isLoading, error } = useHitRateStats(null);

  return (
    <div className="space-y-3 px-4 py-4">
      <div>
        <h1 className="text-lg font-medium tracking-tight text-ink">Strategies</h1>
        <p className="text-xs text-ink-muted">All time, from settled picks</p>
      </div>

      {error ? (
        <QueryError error={error} next="/more/bots" />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (data?.byStrategy.length ?? 0) === 0 ? (
        <EmptyState title="No strategies yet" detail="Strategies appear here as picks arrive." />
      ) : (
        data?.byStrategy.map((s) => {
          const settled = s.hits + s.misses;
          return (
            <article key={s.label} className="rounded-xl border border-line bg-surface p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium text-ink">{s.label}</h2>
                  <p className={`text-xs ${s.market ? "text-ink-muted" : "text-danger"}`}>
                    {marketName(s.market) ?? "No market set"}
                  </p>
                </div>
                <p className="shrink-0 text-xl font-medium tabular-nums text-ink">
                  {s.hitRate === null ? "–" : `${s.hitRate}%`}
                </p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${s.hitRate ?? 0}%` }} />
              </div>
              <p className="mt-2 text-[11px] text-ink-muted">
                {s.hits} hit{s.hits === 1 ? "" : "s"} · {s.misses} miss{s.misses === 1 ? "" : "es"} · {s.alerts} alert
                {s.alerts === 1 ? "" : "s"}
                {settled > 0 && settled < 30 ? " · small sample" : ""} · last {whenFmt.format(new Date(s.lastAlertAt))}
              </p>
            </article>
          );
        })
      )}
    </div>
  );
}
