import type { HitRateStats } from "@/queries/use-stats";
import { formatNumber } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1.5 text-xl font-medium tabular-nums tracking-tight text-ink">{value}</p>
      <p className="mt-0.5 text-[11px] text-ink-muted">{sub}</p>
    </div>
  );
}

export function SummaryCards({ stats, isLoading }: { stats: HitRateStats | undefined; isLoading: boolean }) {
  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-3.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-20" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
    );
  }

  const { totals } = stats;
  const settled = totals.hits + totals.misses;

  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Card
        label="Hit rate"
        value={totals.hitRate === null ? "–" : `${totals.hitRate}%`}
        sub={settled === 0 ? "No settled picks yet" : `from ${formatNumber(settled)} settled`}
      />
      <Card label="Hits – Misses" value={`${totals.hits} – ${totals.misses}`} sub="settled picks" />
      <Card label="Alerts" value={formatNumber(totals.alerts)} sub="received in this period" />
      <Card
        label="Awaiting result"
        value={formatNumber(totals.pending)}
        sub={totals.needsReview > 0 ? `${totals.needsReview} need review` : "live or not yet finished"}
      />
    </div>
  );
}
