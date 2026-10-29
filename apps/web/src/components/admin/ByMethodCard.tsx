"use client";

import { useState } from "react";
import { Card, Segmented } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp, units as formatUnits } from "@/lib/format";
import { useByMethod } from "@/queries/use-by-method";
import type { MethodTotals } from "@/server/engine-client";

type Period = "today" | "d7" | "d30" | "all";
const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "today", label: "Today" },
  { value: "d7", label: "7 days" },
  { value: "d30", label: "30 days" },
  { value: "all", label: "All" },
];

const tone = (n: number) => (n > 0 ? "text-hit" : n < 0 ? "text-loss" : "text-ink");
/** The return per £1 staked, as a percentage. */
const perPound = (t: MethodTotals) => (t.staked > 0 ? Math.round((1000 * t.profit) / t.staked) / 10 : null);

function Column({ title, hint, t }: { title: string; hint: string; t: MethodTotals }) {
  const roi = perPound(t);
  return (
    <div className="min-w-0 rounded-md bg-surface-2 px-3 py-2.5">
      <p className="text-xs font-medium text-ink">{title}</p>
      <p className="text-xs text-ink-muted">{hint}</p>
      {t.bets === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No settled bets</p>
      ) : (
        <>
          <p className={`mt-1 font-display text-xl font-bold tabular-nums [font-stretch:108%] ${tone(t.profit)}`}>{gbp(t.profit)}</p>
          <p className={`text-sm font-semibold tabular-nums ${tone(t.units)}`}>{formatUnits(t.units)}</p>
          <p className="mt-1 text-xs tabular-nums text-ink-muted">
            {t.bets} bet{t.bets === 1 ? "" : "s"} · {Math.round((100 * t.won) / t.bets)}% won
            {roi !== null && (
              <>
                {" "}
                · {roi > 0 ? "+" : roi < 0 ? "−" : ""}
                {Math.abs(roi)}% per £1
              </>
            )}
          </p>
          <p className="text-xs tabular-nums text-ink-muted">{gbp(t.staked, false)} staked</p>
        </>
      )}
    </div>
  );
}

/**
 * Profit: bets placed by hand next to bets GoalBrew placed itself, in £ and in units (profit at a flat 1-unit stake per
 * bet, so a bigger stake can't flatter either). Real-money bets only; information only.
 */
export function ByMethodCard() {
  const { data, isLoading, error } = useByMethod();
  const [period, setPeriod] = useState<Period>("d30");
  const p = data?.periods[period];
  // Per bet rather than in total, so a side that simply placed more bets doesn't look better: units per bet.
  const perBet = (t: MethodTotals) => (t.bets > 0 ? t.units / t.bets : null);
  const gap = p && p.auto.bets > 0 && p.hand.bets > 0 ? (perBet(p.hand)! - perBet(p.auto)!) * 100 : null;
  return (
    <Card title="By hand or automatic" subtitle="Bets you placed yourself, against bets GoalBrew placed. Real money only.">
      <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} className="mb-3" />
      {error ? (
        <p className="text-sm text-destructive">Couldn&apos;t load this: {error.message}</p>
      ) : isLoading || !p ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Column title="By hand" hint="logged on Live, or Bet this for real" t={p.hand} />
            <Column title="Automatic" hint="placed by GoalBrew" t={p.auto} />
          </div>
          {gap !== null && (
            <p className="mt-2 text-xs text-ink-muted">
              Per bet, your hand bets are{" "}
              <span className={`font-medium ${tone(gap)}`}>
                {Math.abs(Math.round(gap * 10) / 10)} points {gap >= 0 ? "better" : "worse"}
              </span>{" "}
              than the automatic ones
              {Math.min(p.hand.bets, p.auto.bets) < 30 ? ". Too few bets on one side to trust yet" : ""}.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
