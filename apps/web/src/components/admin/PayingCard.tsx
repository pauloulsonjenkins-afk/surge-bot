"use client";

import Link from "next/link";
import { useWinLoss } from "@/queries/use-winloss";
import { gbp } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import type { WinLossState } from "@/server/engine-client";

type Period = WinLossState["periods"]["d7"];

/**
 * "Is it paying?": the one success measure, at the top of Home (14 Nov 2026; asked for in the 11 Nov review). The big
 * figure is real money only (Live bets), the last 7 days and this month, after the monthly running cost when that is
 * switched on (Profit > Expenditure): it is what reached the Betfair balance, so it reconciles to it. The year is gone
 * (owner, 22 Nov 2026). Under each, the breakdown: what the trial (pretend) bets made over the same days, and the two
 * together, so a strategy that wins in trial and loses with real money can't hide on either side.
 */
export function PayingCard() {
  const real = useWinLoss("live");
  const trial = useWinLoss("sim");
  const { data, isLoading, error } = real;
  if (error) return null;
  if (isLoading || !data) return <Skeleton className="h-32 w-full" />;

  const costsOn = data.settings.expenditure.enabled;
  const cell = (label: string, p: Period, trialP: Period | undefined) => {
    const figure = costsOn ? p.totalAfter : p.total;
    const tone = figure > 0 ? "hit" : figure < 0 ? "loss" : "ink";
    const t = trialP?.total;
    const toneOf = (n: number) => (n > 0 ? "text-hit" : n < 0 ? "text-loss" : "text-ink-muted");
    return (
      <div className={`min-w-0 rounded-xl p-3.5 ${tone === "hit" ? "kpi-glow kpi-glow-hit" : tone === "loss" ? "kpi-glow kpi-glow-loss" : "border border-line bg-surface"}`}>
        <p className="text-xs text-ink-muted">{label}</p>
        <p className={`mt-0.5 font-display text-2xl font-bold tabular-nums [font-stretch:108%] ${tone === "hit" ? "text-hit" : tone === "loss" ? "text-loss" : "text-ink"}`}>
          {figure === 0 ? "£0.00" : gbp(figure)}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Real money · {p.picks} {p.picks === 1 ? "bet" : "bets"}
          {costsOn && p.expenditure > 0 ? ` · ${gbp(p.total)} less £${p.expenditure.toFixed(2)} costs` : ""}
        </p>
        {t !== undefined && (
          <dl className="mt-2 space-y-0.5 border-t border-line/60 pt-2 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Trial (pretend)</dt>
              <dd className={`tabular-nums ${toneOf(t)}`}>{t === 0 ? "£0.00" : gbp(t)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Together</dt>
              <dd className={`font-medium tabular-nums ${toneOf(p.total + t)}`}>{p.total + t === 0 ? "£0.00" : gbp(p.total + t)}</dd>
            </div>
          </dl>
        )}
      </div>
    );
  };

  return (
    <section aria-label="Is it paying?" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-ink">Is it paying?</h3>
        <p className="text-xs text-ink-muted">Big figure is real money{costsOn ? ", after running costs" : ""}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {cell("Last 7 days", data.periods.d7, trial.data?.periods.d7)}
        {cell("This month", data.periods.mtd, trial.data?.periods.mtd)}
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
