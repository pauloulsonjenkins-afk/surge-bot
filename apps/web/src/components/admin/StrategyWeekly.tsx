"use client";

import { Fragment, useState } from "react";
import { ChevronDown } from "lucide-react";
import { StrategyName } from "@/components/ui/StrategyName";
import { SegmentLabel } from "@/components/ui/SegmentLabel";
import type { StrategyWeeksReport, WeekTally } from "@/server/engine-client";

type Mode = "live" | "sim" | "all";

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const money = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;
const pct = (t: WeekTally) => (t.staked > 0 ? `${t.profit >= 0 ? "+" : "−"}${Math.abs(Math.round((t.profit / t.staked) * 1000) / 10)}%` : "–");

/** Short names for watched slices' rows. */
const SLICE_NAMES: Record<string, string> = { golden: "Golden", "two-apart": "2+ goals apart", "home-one-down": "Home team 1 down" };

/** Under this many bets in the last 7 days there's no trend label. */
const TREND_FROM = 5;

/** The trend label: the last 7 days against the 4 weeks before. */
export function trendOf(last7: WeekTally, prev28: WeekTally): { label: string; cls: string } {
  if (last7.counted < TREND_FROM) return { label: "Too few bets", cls: "bg-surface-2 text-ink-muted" };
  const now = last7.profit;
  const before = prev28.counted > 0 ? prev28.profit : 0;
  if (now > 0 && before < 0) return { label: "Turning up", cls: "bg-accent/15 text-accent" };
  if (now < 0 && before > 0) return { label: "Slipping", cls: "bg-warn/20 text-warn" };
  if (now > 0) return { label: "Steady +", cls: "bg-hit/15 text-hit" };
  if (now < 0) return { label: "Steady −", cls: "bg-loss/15 text-loss" };
  return { label: "Level", cls: "bg-surface-2 text-ink-muted" };
}

function Cell({ t }: { t: WeekTally }) {
  if (t.picks === 0) return <span className="block rounded-md bg-surface-2 py-1.5 text-center text-xs text-ink-muted">–</span>;
  const cls = t.counted === 0 || t.profit === 0 ? "bg-surface-2 text-ink" : t.profit > 0 ? "bg-hit/15 text-hit" : "bg-loss/15 text-loss";
  return (
    <span className={`block rounded-md py-1.5 text-center text-xs tabular-nums ${cls}`} title={`${t.won}–${t.lost}, ${t.counted} priced, ${pct(t)} per £1`}>
      {t.counted > 0 ? money(t.profit) : `${t.won}–${t.lost}`}
    </span>
  );
}

/** One strategy's weeks as bars: £ per week, with the return per £1 under each. */
function WeekBars({ weeks, labels }: { weeks: WeekTally[]; labels: string[] }) {
  const max = Math.max(0.01, ...weeks.map((w) => Math.abs(w.profit)));
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <p className="mb-2 text-xs font-medium text-ink-muted">£ per week (Monday to Sunday), with the return per £1</p>
      <div className="grid grid-cols-6 items-end gap-2" style={{ height: 90 }}>
        {weeks.map((w, i) => (
          <div key={labels[i]} className="flex h-full flex-col justify-end">
            <div
              className={`rounded-sm ${w.profit >= 0 ? "bg-hit/60" : "bg-loss/60"}`}
              style={{ height: `${w.counted > 0 ? Math.max(4, (Math.abs(w.profit) / max) * 100) : 0}%` }}
              title={`${money(w.profit)} · ${w.won}–${w.lost}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-6 gap-2 text-center text-[11px] text-ink-muted">
        {weeks.map((w, i) => (
          <span key={labels[i]}>
            {dayMonth.format(new Date(`${labels[i]}T12:00:00Z`))}
            <span className="block tabular-nums">{w.counted > 0 ? pct(w) : "–"}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Strategies → Weekly: one row per strategy, its £ for each of the last 6 weeks (Monday to Sunday, UK), the last 7
 * days, and a trend label. Tap a row for its weekly bars and its full card.
 */
export function StrategyWeekly({
  rows,
  data,
  modeOf,
  renderCard,
  showTotal = false,
}: {
  rows: Array<{ label: string }>;
  data: StrategyWeeksReport | undefined;
  /** Whose figures each row shows (Own mode / Live / Sim / All). */
  modeOf: (label: string) => Mode;
  renderCard: (label: string) => React.ReactNode;
  /** Adds the "All strategies" row (shown once, under the last section). */
  showTotal?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return <p className="text-xs text-ink-muted">Loading the weeks…</p>;
  const grid = "grid grid-cols-[minmax(0,2.4fr)_repeat(6,minmax(0,1fr))_minmax(0,1.5fr)_minmax(0,1.4fr)] items-center gap-1";
  const line = (key: string, name: React.ReactNode, mode: Mode, total = false, slice = false) => {
    const s = data.strategies[key];
    const weeks = data.weeks.map((_, i) => s?.weeks[i]?.[mode] ?? { picks: 0, won: 0, lost: 0, counted: 0, staked: 0, profit: 0 });
    const last7 = s?.last7[mode] ?? { picks: 0, won: 0, lost: 0, counted: 0, staked: 0, profit: 0 };
    const trend = trendOf(last7, s?.prev28[mode] ?? last7);
    const isOpen = open === key && !total && !slice;
    return (
      <li key={key} className={total ? "border-t border-line pt-1" : ""}>
        <button type="button" disabled={total || slice} aria-expanded={total || slice ? undefined : isOpen} onClick={() => setOpen(isOpen ? null : key)} className={`${grid} w-full py-1 text-left disabled:cursor-default`}>
          <span className={`flex min-w-0 items-center gap-1 text-sm ${total ? "font-semibold" : "font-medium"} text-ink`}>
            <span className="truncate">{name}</span>
            {!total && !slice && <ChevronDown size={13} aria-hidden className={`shrink-0 text-ink-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />}
          </span>
          {weeks.map((w, i) => (
            <Cell key={data.weeks[i]} t={w} />
          ))}
          <span className={`block rounded-md py-1.5 text-center text-xs tabular-nums ${last7.counted === 0 ? "bg-surface-2 text-ink-muted" : last7.profit >= 0 ? "bg-hit/15 text-hit" : "bg-loss/15 text-loss"}`}>
            {last7.counted > 0 ? money(last7.profit) : "–"}
            <span className="block text-[10px] text-ink-muted">{last7.picks} bet{last7.picks === 1 ? "" : "s"}</span>
          </span>
          <span className={`rounded-full px-1.5 py-0.5 text-center text-[11px] font-medium ${trend.cls}`}>{trend.label}</span>
        </button>
        {isOpen && (
          <div className="mb-2 mt-1 space-y-2">
            <WeekBars weeks={weeks} labels={data.weeks} />
            <ul>{renderCard(key)}</ul>
          </div>
        )}
      </li>
    );
  };
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className={`${grid} pb-1 text-[11px] text-ink-muted`}>
          <span>Strategy</span>
          {data.weeks.map((w) => (
            <span key={w} className="text-center">
              {dayMonth.format(new Date(`${w}T12:00:00Z`))}
            </span>
          ))}
          <span className="text-center">Last 7 days</span>
          <span className="text-center">Trend</span>
        </div>
        <ul className="space-y-0.5">
          {rows.flatMap((r) => {
            const key = r.label.toLowerCase();
            // A watched slice (e.g. Second Pour's Golden) gets its own row under its strategy, from its start date.
            const subs = Object.keys(data.strategies).filter((k) => k.startsWith(`${key}#`));
            return [
              line(key, <StrategyName label={r.label} />, modeOf(r.label)),
              ...subs.map((k) =>
                line(k, <span className="pl-3 text-xs">↳ <SegmentLabel label={SLICE_NAMES[k.split("#")[1]!] ?? k.split("#")[1]!} /></span>, modeOf(r.label), false, true),
              ),
            ];
          })}
          {showTotal && line("__all__", "All strategies", modeOf("__all__"), true)}
        </ul>
      </div>
    </div>
  );
}
