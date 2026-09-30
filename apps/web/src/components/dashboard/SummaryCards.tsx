"use client";

import Link from "next/link";
import type { HitRateStats } from "@/queries/use-stats";
import { HeroStat, moneyTone } from "@/components/ui/Card";
import { formatNumber } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp } from "@/components/admin/WinLossLines";
import type { Timeframe } from "./TimeframeToggle";
import { profitFor, useDashboardWinLoss } from "./WinLossSummary";

/**
 * The Dashboard's top row: the figures that matter (hit rate, record and, for the admin, profit) as big numbers
 * with no card around them, and everything else as one line of small text underneath.
 */
export function HeroRow({
  stats,
  isLoading,
  timeframe,
  strategy,
}: {
  stats: HitRateStats | undefined;
  isLoading: boolean;
  timeframe: Timeframe;
  strategy: string | null;
}) {
  const winLoss = useDashboardWinLoss();

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-8 w-24" />
          </div>
        ))}
      </div>
    );
  }

  const { totals } = stats;
  const settled = totals.hits + totals.misses;
  const profit = winLoss.data ? profitFor(winLoss.data, timeframe, strategy) : null;

  const secondary = [
    `${formatNumber(totals.alerts)} alerts`,
    `${formatNumber(totals.pending)} awaiting result`,
    totals.needsReview > 0 ? `${totals.needsReview} need review` : null,
  ].filter(Boolean);

  return (
    <section aria-label="Summary" className="space-y-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <HeroStat
          label="Hit rate"
          value={totals.hitRate === null ? "–" : `${totals.hitRate}%`}
          sub={settled === 0 ? "No settled picks yet" : `from ${formatNumber(settled)} settled`}
        />
        <HeroStat
          label="Hits – Misses"
          value={
            <>
              <span className="text-hit">{totals.hits}</span>
              <span className="text-ink-muted"> – </span>
              <span className="text-loss">{totals.misses}</span>
            </>
          }
        />
        {profit && (
          <HeroStat
            label={`Profit · ${profit.label}`}
            tone={moneyTone(profit.value)}
            value={profit.value === 0 ? "£0.00" : gbp(profit.value)}
            sub={
              <>
                {profit.afterCost !== null && <span className="tabular-nums">{gbp(profit.afterCost)} after costs · </span>}
                <Link href="/more/admin/winloss" className="underline">
                  Details
                </Link>
              </>
            }
          />
        )}
      </div>
      <p className="text-xs text-ink-muted">{secondary.join(" · ")}</p>
    </section>
  );
}
