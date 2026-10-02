"use client";

import Link from "next/link";
import type { HitRateStats } from "@/queries/use-stats";
import { HeroStat, moneyTone } from "@/components/ui/Card";
import { formatNumber } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp } from "@/components/admin/WinLossLines";
import type { Timeframe } from "./TimeframeToggle";
import type { PickMode } from "@/server/engine-client";
import { profitFor, useDashboardWinLoss } from "./WinLossSummary";
import { againstBreakeven, rangeText, roiText } from "@/lib/hit-rate";

/**
 * The Dashboard's top row: the figures that matter (hit rate, record and, for the admin, profit) as big numbers
 * with no card around them, and everything else as one line of small text underneath.
 */
export function HeroRow({
  stats,
  isLoading,
  timeframe,
  strategy,
  mode,
}: {
  stats: HitRateStats | undefined;
  isLoading: boolean;
  timeframe: Timeframe;
  strategy: string | null;
  mode: PickMode;
}) {
  const winLoss = useDashboardWinLoss(mode);

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
    totals.pending > 0 ? (
      <Link key="pending" href="/live" className="underline hover:text-ink">
        {formatNumber(totals.pending)} awaiting result
      </Link>
    ) : (
      "0 awaiting result"
    ),
    totals.needsReview > 0 ? `${totals.needsReview} need review` : null,
  ].filter(Boolean);

  return (
    <section aria-label="Summary" className="space-y-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <HeroStat
          label="Hit rate"
          value={totals.hitRate === null ? "–" : `${totals.hitRate}%`}
          sub={
            settled === 0
              ? "No settled picks yet"
              : `from ${formatNumber(settled)} settled${stats.context?.range ? ` · likely ${rangeText(stats.context.range)}` : ""}`
          }
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
            label={`${mode === "sim" ? "Sim profit" : mode === "live" ? "Live profit" : "Profit"} · ${profit.label}`}
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
      <HitRateContextRow stats={stats} />
      <p className="text-xs text-ink-muted">
        {secondary.map((s, i) => (
          <span key={i}>
            {i > 0 && " · "}
            {s}
          </span>
        ))}
      </p>
    </section>
  );
}

/**
 * What the hit rate needs beside it to be judged: the average odds it was won at, the hit rate those odds need to break
 * even after commission, and (for the admin) the return on each £1 staked.
 */
function HitRateContextRow({ stats }: { stats: HitRateStats }) {
  const c = stats.context;
  if (!c || c.settled === 0) return null;
  const verdict = againstBreakeven(stats.totals.hitRate, c.breakeven, c.range);
  const cells: Array<{ label: string; value: string; tone?: "hit" | "loss" | "muted" }> = [
    { label: "Average odds", value: c.avgOdds === null ? "Unknown" : c.avgOdds.toFixed(2) },
    { label: "Break-even hit rate", value: c.breakeven === null ? "–" : `${c.breakeven}%` },
  ];
  if (c.roi !== null) cells.push({ label: "Return per £1", value: roiText(c.roi), tone: moneyTone(c.roi) });
  const colour = { hit: "text-hit", loss: "text-loss", muted: "text-ink" };
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <dl className="flex flex-wrap gap-x-6 gap-y-1">
        {cells.map((x) => (
          <div key={x.label} className="flex items-baseline gap-1.5">
            <dt className="text-xs text-ink-muted">{x.label}</dt>
            <dd className={`text-sm font-semibold tabular-nums ${colour[x.tone ?? "muted"]}`}>{x.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-xs text-ink-muted">
        {verdict ? <span className={colour[verdict.tone]}>{verdict.text}.</span> : "No odds are known for these picks, so break-even can’t be worked out yet."}
        {c.oddsKnown < c.settled && c.oddsKnown > 0 && ` Odds known for ${formatNumber(c.oddsKnown)} of ${formatNumber(c.settled)} picks.`}
        {c.assumed ? (
          <span className="text-warn">
            {" "}
            {formatNumber(c.assumed)} of them priced at an assumed price set on Win/Loss, not a real one, so the return is partly a guess.
          </span>
        ) : null}
      </p>
    </div>
  );
}
