"use client";

import { useMemo, useState } from "react";
import { usePriceCheck, type PriceCheckRow } from "@/queries/use-price-check";
import { StrategyName } from "@/components/ui/StrategyName";

/** Fewer checks than this and an average says little. */
const ENOUGH = 20;
const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
const tone = (n: number) => (n > 0 ? "text-hit" : n < 0 ? "text-loss" : "text-ink");

/**
 * Price check, folded away on Strategies: for each strategy, how its alert price compares with Betfair's price for the
 * same bet a few minutes later. Beating the later price again and again is the earliest sign of a real edge.
 */
export function PriceCheck() {
  const [open, setOpen] = useState(false);
  const { data, error, isLoading } = usePriceCheck(30, open);

  const byStrategy = useMemo(() => {
    const m = new Map<string, Partial<Record<PriceCheckRow["kind"], PriceCheckRow>>>();
    for (const r of data?.rows ?? []) {
      const e = m.get(r.strategy) ?? {};
      e[r.kind] = r;
      m.set(r.strategy, e);
    }
    return [...m.entries()];
  }, [data]);

  const cell = (r: PriceCheckRow | undefined, typical: number | undefined, relative: boolean) => {
    if (!r) return <span className="text-ink-muted">–</span>;
    const v = relative && typical !== undefined ? r.edge - typical : r.edge;
    return (
      <span className={r.picks < ENOUGH ? "opacity-60" : ""}>
        <span className={`font-medium tabular-nums ${tone(v)}`}>{signed(Math.round(v * 10) / 10)}</span>
        <span className="text-xs text-ink-muted"> · {r.picks}</span>
      </span>
    );
  };

  return (
    <details className="rounded-xl border border-line bg-surface p-3" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-medium text-ink">Price check: does each strategy beat the market?</summary>
      <p className="mt-2 text-xs text-ink-muted">
        Each pick’s Betfair price at the alert, against Betfair’s price for the same bet a little later: 2 and 5 minutes after an in-play alert, and at
        kick-off for a pre-match one. Plus means the alert got a better price than the market a few minutes later. Doing that again and again is the
        earliest sign a strategy has a real edge, well before enough results come in to prove it.
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        In-play goal prices drift out as minutes pass without a goal, so every in-play pick looks a little worse later. In-play figures are therefore shown
        against the average of all strategies (“vs typical”). Picks where a goal had already settled the bet are left out. Last 30 days; faded = fewer
        than {ENOUGH} checks.
      </p>
      {error ? (
        <p className="mt-2 text-sm text-destructive">{error.message}</p>
      ) : isLoading || !data ? (
        open && <p className="mt-2 text-xs text-ink-muted">Loading…</p>
      ) : byStrategy.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No checks yet. They start with the next alerts whose matches are on Betfair.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="text-xs text-ink-muted">
              <tr>
                <th className="py-1.5 pr-2 font-medium">Strategy</th>
                <th className="px-2 font-medium">2 min, vs typical</th>
                <th className="px-2 font-medium">5 min, vs typical</th>
                <th className="px-2 font-medium">At kick-off</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {byStrategy.map(([name, k]) => (
                <tr key={name}>
                  <td className="py-2 pr-2 text-ink">
                    <StrategyName label={name} />
                  </td>
                  <td className="px-2">{cell(k.t2, data.typical.t2, true)}</td>
                  <td className="px-2">{cell(k.t5, data.typical.t5, true)}</td>
                  <td className="px-2">{cell(k.ko, undefined, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-muted">
            Typical in-play drift: {data.typical.t2 !== undefined ? `${signed(data.typical.t2)} at 2 min` : "–"}
            {data.typical.t5 !== undefined ? `, ${signed(data.typical.t5)} at 5 min` : ""}. The number after each figure is how many checks it’s from.
          </p>
        </div>
      )}
    </details>
  );
}
