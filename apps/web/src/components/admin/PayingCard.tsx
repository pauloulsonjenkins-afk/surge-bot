"use client";

import Link from "next/link";
import { useWinLoss } from "@/queries/use-winloss";
import { gbp } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * "Is it paying?": the one success measure, at the top of Home (14 Nov 2026; asked for in the 11 Nov review). Real
 * money only: Live bets, this month and this year, after the monthly running cost when that is switched on (Profit >
 * Expenditure). A good day in Sim, or a high win count at short prices, can't make this figure look better.
 */
export function PayingCard() {
  const { data, isLoading, error } = useWinLoss("live");
  if (error) return null;
  if (isLoading || !data) return <Skeleton className="h-28 w-full" />;

  const costsOn = data.settings.expenditure.enabled;
  const cell = (label: string, p: { total: number; expenditure: number; totalAfter: number; picks: number }) => {
    const figure = costsOn ? p.totalAfter : p.total;
    const tone = figure > 0 ? "hit" : figure < 0 ? "loss" : "ink";
    return (
      <div className={`min-w-0 rounded-xl p-3.5 ${tone === "hit" ? "kpi-glow kpi-glow-hit" : tone === "loss" ? "kpi-glow kpi-glow-loss" : "border border-line bg-surface"}`}>
        <p className="text-xs text-ink-muted">{label}</p>
        <p className={`mt-0.5 font-display text-2xl font-bold tabular-nums [font-stretch:108%] ${tone === "hit" ? "text-hit" : tone === "loss" ? "text-loss" : "text-ink"}`}>
          {figure === 0 ? "£0.00" : gbp(figure)}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          {p.picks} Live {p.picks === 1 ? "bet" : "bets"}
          {costsOn && p.expenditure > 0 ? ` · ${gbp(p.total)} less £${p.expenditure.toFixed(2)} costs` : ""}
        </p>
      </div>
    );
  };

  return (
    <section aria-label="Is it paying?" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-ink">Is it paying?</h3>
        <p className="text-xs text-ink-muted">Real money only{costsOn ? ", after running costs" : ""}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {cell("This month", data.periods.mtd)}
        {cell("This year", data.periods.ytd)}
      </div>
      {!costsOn && (
        <p className="text-xs text-ink-muted">
          Running costs aren&apos;t counted yet, so this is before them.{" "}
          <Link href="/more/admin/winloss" className="text-accent underline underline-offset-2">
            Switch them on under Profit, Expenditure
          </Link>
          .
        </p>
      )}
    </section>
  );
}
