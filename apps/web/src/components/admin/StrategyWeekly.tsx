"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { StrategyName } from "@/components/ui/StrategyName";
import { SegmentLabel, sliceName } from "@/components/ui/SegmentLabel";
import { useSliceStatus } from "@/queries/use-golden";
import type { StrategyWeeksReport, WeekTally } from "@/server/engine-client";

type Mode = "live" | "sim" | "all";

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const money = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;
const pct = (t: WeekTally) => (t.staked > 0 ? `${t.profit >= 0 ? "+" : "−"}${Math.abs(Math.round((t.profit / t.staked) * 1000) / 10)}%` : "–");
/** Profit at a flat 1-unit stake (an older engine without it falls back to the % per £1). */
const unitsOf = (t: WeekTally) => t.units ?? (t.staked > 0 ? (t.profit / t.staked) * t.counted : 0);
const units = (t: WeekTally) => {
  const u = unitsOf(t);
  return `${u > 0 ? "+" : u < 0 ? "−" : ""}${Math.abs(u).toFixed(1)}u`;
};
const tone = (t: WeekTally) => (t.counted === 0 || unitsOf(t) === 0 ? "bg-surface-2 text-ink" : unitsOf(t) > 0 ? "bg-hit/15 text-hit" : "bg-loss/15 text-loss");
/** The bets the figure is made from: the priced ones once there are any, else every settled alert. */
const betCount = (t: WeekTally) => {
  const n = t.counted > 0 ? t.counted : t.picks;
  return `${n} bet${n === 1 ? "" : "s"}`;
};
const detail = (t: WeekTally) => `${t.won}–${t.lost} from ${t.picks} settled alerts, ${t.counted} priced · ${pct(t)} per £1 · ${money(t.profit)} in £`;

/** Short names for watched slices' rows. */
const SLICE_NAMES: Record<string, string> = { golden: "Golden", "two-apart": "2+ goals apart", "home-one-down": "Home team 1 down" };

/**
 * A watched slice's row name ("strategy#slice"): Second Pour's own slice is simply "Golden"; any other is named by the
 * slice itself, since every slice's label starts "Golden: " (until 20 Oct 2026 all of them read "Golden").
 */
export function sliceRowName(key: string, sliceLabels?: Record<string, string>): string {
  const id = key.split("#")[1]!;
  return id === "golden" ? "Golden" : sliceName(sliceLabels?.[key] ?? SLICE_NAMES[id] ?? id);
}

/** Under this many bets in the last 7 days there's no trend label. */
const TREND_FROM = 5;

/** The trend label: the last 7 days against the 4 weeks before. */
export function trendOf(last7: WeekTally, prev28: WeekTally): { label: string; cls: string } {
  if (last7.counted < TREND_FROM) return { label: "Too few bets", cls: "bg-surface-2 text-ink-muted" };
  const now = unitsOf(last7);
  const before = prev28.counted > 0 ? unitsOf(prev28) : 0;
  if (now > 0 && before < 0) return { label: "Turning up", cls: "bg-accent/15 text-accent" };
  if (now < 0 && before > 0) return { label: "Slipping", cls: "bg-warn/20 text-warn" };
  if (now > 0) return { label: "Steady +", cls: "bg-hit/15 text-hit" };
  if (now < 0) return { label: "Steady −", cls: "bg-loss/15 text-loss" };
  return { label: "Level", cls: "bg-surface-2 text-ink-muted" };
}

/**
 * Units (profit at a flat 1-unit stake per bet), with the bet count: £ and % per £1 were both misleading here
 * (28 Oct 2026). £ grows with a bigger stake, and % per £1 is weighted towards the bigger-stake bets and swings
 * wildly on a handful of them (one loss is −100%). Units count every bet the same, and a few bets can only make a
 * small number. The £ and % are in the tooltip; the full £ breakdown stays on Profit.
 */
function Cell({ t }: { t: WeekTally }) {
  if (t.picks === 0) return <span className="block rounded-md bg-surface-2 py-1.5 text-center text-xs text-ink-muted">–</span>;
  return (
    <span className={`block rounded-md py-1.5 text-center text-xs tabular-nums ${tone(t)}`} title={detail(t)}>
      {t.counted > 0 ? units(t) : `${t.won}–${t.lost}`}
      {/* The bets the units come from (priced ones), not every settled alert: a Sim row once read "216 bets" for units
          made from 62 (28 Oct 2026), the other 154 being alerts the feed's rules wouldn't have bet. */}
      <span className="block text-ink-muted">{betCount(t)}</span>
    </span>
  );
}

/** One strategy's weeks as bars: units per week, with the bet count under each. */
function WeekBars({ weeks, labels }: { weeks: WeekTally[]; labels: string[] }) {
  const max = Math.max(0.01, ...weeks.map((w) => Math.abs(unitsOf(w))));
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <p className="mb-2 text-xs font-medium text-ink-muted">Units per week (Monday to Sunday): profit as if every bet were the same 1-unit stake</p>
      <div className="grid items-end gap-2" style={{ height: 90, gridTemplateColumns: `repeat(${weeks.length},minmax(0,1fr))` }}>
        {weeks.map((w, i) => (
          <div key={labels[i]} className="flex h-full flex-col justify-end">
            <div
              className={`rounded-sm ${unitsOf(w) >= 0 ? "bg-hit/60" : "bg-loss/60"}`}
              style={{ height: `${w.counted > 0 ? Math.max(4, (Math.abs(unitsOf(w)) / max) * 100) : 0}%` }}
              title={detail(w)}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 grid gap-2 text-center text-xs text-ink-muted" style={{ gridTemplateColumns: `repeat(${weeks.length},minmax(0,1fr))` }}>
        {weeks.map((w, i) => (
          <span key={labels[i]}>
            {dayMonth.format(new Date(`${labels[i]}T12:00:00Z`))}
            <span className="block tabular-nums">{w.counted > 0 ? `${units(w)} · ${w.counted}` : "–"}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Strategies → Weekly: one row per strategy, its units for each of the last 6 weeks (Monday to Sunday, UK), the last 7
 * days, and a trend label. Tap a row for its weekly bars and its full card.
 */
export function StrategyWeekly({
  rows,
  data,
  modeOf,
  renderCard,
  showTotal = false,
  sliceLabels,
}: {
  /** "strategy#slice" -> its label, for the slice rows. */
  sliceLabels?: Record<string, string>;
  rows: Array<{ label: string }>;
  data: StrategyWeeksReport | undefined;
  /** Whose figures each row shows (Own mode / Live / Sim / All). */
  modeOf: (label: string) => Mode;
  renderCard: (label: string) => React.ReactNode;
  /** Adds the "All strategies" row (shown once, under the last section). */
  showTotal?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const sliceStatus = useSliceStatus();
  if (!data) return <p className="text-xs text-ink-muted">Loading the weeks…</p>;
  // Columns start from the first week anything in this section has picks (no empty weeks before the data begins).
  const keys = rows.flatMap((r) => [r.label.toLowerCase(), ...Object.keys(data.strategies).filter((k) => k.startsWith(`${r.label.toLowerCase()}#`))]);
  const firstWeek = data.weeks.findIndex((_, i) => keys.some((k) => (data.strategies[k]?.weeks[i]?.[modeOf(k.split("#")[0]!)]?.picks ?? 0) > 0));
  const from = firstWeek < 0 ? data.weeks.length - 1 : firstWeek;
  // Most recent week first, so the columns read newest-to-oldest left to right.
  const shownWeeks = data.weeks.slice(from).reverse();
  // The name, then the two columns you act on (last 7 days, trend), then the weeks. The name stays put while the rest
  // scrolls sideways on a phone.
  const cols = { gridTemplateColumns: `minmax(0,2.4fr) minmax(0,1.5fr) minmax(0,1.5fr) repeat(${shownWeeks.length},minmax(0,1fr))` };
  const sticky = "sticky left-0 z-10 bg-app";
  const grid = "grid items-center gap-1";
  const line = (key: string, name: React.ReactNode, mode: Mode, total = false, slice = false) => {
    const s = data.strategies[key];
    // shownWeeks is newest-first; data.strategies[].weeks is oldest-first, so index back from the end.
    const weeks = shownWeeks.map((_, j) => s?.weeks[data.weeks.length - 1 - j]?.[mode] ?? { picks: 0, won: 0, lost: 0, counted: 0, staked: 0, profit: 0 });
    const last7 = s?.last7[mode] ?? { picks: 0, won: 0, lost: 0, counted: 0, staked: 0, profit: 0 };
    const trend = trendOf(last7, s?.prev28[mode] ?? last7);
    const isOpen = open === key && !total && !slice;
    return (
      <li key={key} className={total ? "border-t border-line pt-1" : ""}>
        <button type="button" disabled={total || slice} aria-expanded={total || slice ? undefined : isOpen} onClick={() => setOpen(isOpen ? null : key)} className={`${grid} w-full py-1 text-left disabled:cursor-default`} style={cols}>
          <span className={`${sticky} flex min-w-0 items-center gap-1 self-stretch text-sm ${total ? "font-semibold" : "font-medium"} text-ink`}>
            <span className="truncate">{name}</span>
            {!total && !slice && <ChevronDown size={13} aria-hidden className={`shrink-0 text-ink-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />}
          </span>
          <span
            className={`block rounded-md py-1.5 text-center text-xs tabular-nums ${last7.counted === 0 ? "bg-surface-2 text-ink-muted" : tone(last7)}`}
            title={last7.counted > 0 ? detail(last7) : undefined}
          >
            {last7.counted > 0 ? units(last7) : "–"}
            <span className="block text-xs text-ink-muted">{betCount(last7)}</span>
          </span>
          <span className={`rounded-md px-1.5 py-0.5 text-center text-xs font-medium leading-tight ${trend.cls}`}>{trend.label}</span>
          {weeks.map((w, i) => (
            <Cell key={shownWeeks[i]} t={w} />
          ))}
        </button>
        {isOpen && (
          <div className="mb-2 mt-1 space-y-2">
            <WeekBars weeks={weeks} labels={shownWeeks} />
            <ul>{renderCard(key)}</ul>
          </div>
        )}
      </li>
    );
  };
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className={`${grid} pb-1 text-xs text-ink-muted`} style={cols}>
          <span className={`${sticky} self-stretch`}>Strategy</span>
          <span className="text-center">Last 7 days</span>
          <span className="text-center">Trend</span>
          {shownWeeks.map((w) => (
            <span key={w} className="text-center">
              {dayMonth.format(new Date(`${w}T12:00:00Z`))}
            </span>
          ))}
        </div>
        <ul className="space-y-0.5">
          {rows.flatMap((r) => {
            const key = r.label.toLowerCase();
            // A watched slice (e.g. Second Pour's Golden) gets its own row under its strategy, from its start date. Every slice's
            // label starts "Golden: ", so the row is named by the slice itself (only Second Pour's own is simply "Golden"), and
            // the word is in gold only once the slice is confirmed.
            const subs = Object.keys(data.strategies).filter((k) => k.startsWith(`${key}#`));
            return [
              line(key, <StrategyName label={r.label} />, modeOf(r.label)),
              ...subs.map((k) =>
                line(k, <span className="pl-3 text-xs text-ink-muted">↳ of which <SegmentLabel label={sliceRowName(k, sliceLabels)} status={sliceStatus(key, k.split("#")[1]!)} /></span>, modeOf(r.label), false, true),
              ),
            ];
          })}
          {showTotal && line("__all__", "All strategies", modeOf("__all__"), true)}
        </ul>
      </div>
    </div>
  );
}
