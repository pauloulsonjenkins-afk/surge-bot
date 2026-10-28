"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { StrategyName } from "@/components/ui/StrategyName";
import { SegmentLabel, sliceName } from "@/components/ui/SegmentLabel";
import { useSliceStatus } from "@/queries/use-golden";
import { useUiStore } from "@/state/ui.store";
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

/** A slice making at least this many units per priced bet over the last 7 days is "doing very well" (10p per £1). */
const VERY_WELL_PER_BET = 0.1;

/**
 * How a Golden slice is doing over the last 7 days, for the tint on its folded line: "good" once it has TREND_FROM
 * priced bets making VERY_WELL_PER_BET units a bet or more, "bad" once it has as many and is down. Fewer bets: no
 * judgement either way.
 */
export function sliceHealth(last7: WeekTally): "good" | "bad" | null {
  if (last7.counted < TREND_FROM) return null;
  const u = unitsOf(last7);
  if (u < 0) return "bad";
  return u / last7.counted >= VERY_WELL_PER_BET ? "good" : null;
}

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
  const openSlices = useUiStore((s) => s.openSlices);
  const setSlicesOpen = useUiStore((s) => s.setSlicesOpen);
  if (!data) return <p className="text-xs text-ink-muted">Loading the weeks…</p>;
  const withSlices = rows.map((r) => r.label.toLowerCase()).filter((k) => Object.keys(data.strategies).some((x) => x.startsWith(`${k}#`)));
  const allOpen = withSlices.length > 0 && withSlices.every((k) => openSlices.includes(k));
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
    // The other mode's last 7 days, under the name, when it has enough bets and points the other way: a strategy green in
    // Sim and red in Live (or the reverse) otherwise looked like switching it had changed its results (28 Oct 2026).
    const other = !total && !slice && mode !== "all" ? (mode === "live" ? "sim" : "live") : null;
    const otherLast7 = other ? s?.last7[other] : undefined;
    const disagrees = otherLast7 && otherLast7.counted >= TREND_FROM && (last7.counted === 0 || unitsOf(otherLast7) > 0 !== unitsOf(last7) > 0);
    return (
      <li key={key} className={total ? "border-t border-line pt-1" : ""}>
        <button type="button" disabled={total || slice} aria-expanded={total || slice ? undefined : isOpen} onClick={() => setOpen(isOpen ? null : key)} className={`${grid} w-full py-1 text-left disabled:cursor-default`} style={cols}>
          <span className={`${sticky} flex min-w-0 items-center gap-1 self-stretch text-sm ${total ? "font-semibold" : "font-medium"} text-ink`}>
            <span className="min-w-0">
              <span className="block truncate">{name}</span>
              {disagrees && otherLast7 && (
                <span className={`block truncate text-xs font-normal ${unitsOf(otherLast7) > 0 ? "text-hit" : "text-loss"}`} title={`Its ${other === "live" ? "Live" : "Sim"} bets in the last 7 days, a separate record from the figures on this row`}>
                  {other === "live" ? "Live" : "Sim"} {units(otherLast7)} ({otherLast7.counted})
                </span>
              )}
            </span>
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
  /**
   * One line standing in for a strategy's Golden slice rows while they're folded (or heading them when open): how many,
   * tinted green when one is doing very well and red when one is losing (red wins: a problem shouldn't hide). Tap to
   * show or hide them. Sticky, like the names, so it stays put while the weeks scroll sideways.
   */
  const sliceToggle = (key: string, subs: string[], mode: Mode, shown: boolean) => {
    const health = subs.map((k) => sliceHealth(data.strategies[k]?.last7[mode] ?? { picks: 0, won: 0, lost: 0, counted: 0, staked: 0, profit: 0 }));
    const good = health.filter((h) => h === "good").length;
    const bad = health.filter((h) => h === "bad").length;
    const cls = bad > 0 ? "bg-loss/15 text-loss" : good > 0 ? "bg-hit/15 text-hit" : "bg-surface-2 text-ink-muted";
    const words = [good > 0 && `${good} doing very well`, bad > 0 && `${bad} losing`].filter(Boolean).join(", ");
    return (
      <li key={`${key}#toggle`}>
        <button
          type="button"
          aria-expanded={shown}
          onClick={() => setSlicesOpen([key], !shown)}
          className={`sticky left-0 z-10 ml-3 flex max-w-[calc(100vw-3rem)] items-center gap-1 rounded-md px-2 py-1 text-left text-xs font-medium ${cls}`}
        >
          <ChevronDown size={12} aria-hidden className={`shrink-0 transition-transform ${shown ? "rotate-180" : ""}`} />
          <span className="truncate">
            {shown ? "Hide" : "↳"} {subs.length} Golden slice{subs.length === 1 ? "" : "s"}
            {words && ` · ${words}`}
          </span>
        </button>
      </li>
    );
  };
  return (
    <div className="overflow-x-auto">
      <div className="sticky left-0 mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-ink-muted">Each row is its own mode&apos;s bets: Live for a Live strategy, Sim for a Sim one. A different-coloured line under a name is its other record.</p>
        {withSlices.length > 0 && (
          <button type="button" onClick={() => setSlicesOpen(withSlices, !allOpen)} className="shrink-0 text-xs text-ink-muted underline">
            {allOpen ? "Fold all slices" : "Show all slices"}
          </button>
        )}
      </div>
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
            const shown = openSlices.includes(key);
            const mode = modeOf(r.label);
            return [
              line(key, <StrategyName label={r.label} />, mode),
              ...(subs.length > 0 ? [sliceToggle(key, subs, mode, shown)] : []),
              ...(shown
                ? subs.map((k) => {
                    const h = sliceHealth(data.strategies[k]?.last7[mode] ?? { picks: 0, won: 0, lost: 0, counted: 0, staked: 0, profit: 0 });
                    return line(
                      k,
                      <span className="pl-3 text-xs text-ink-muted">
                        {h && <span aria-label={h === "good" ? "doing very well" : "losing"} className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${h === "good" ? "bg-hit" : "bg-loss"}`} />}
                        ↳ of which <SegmentLabel label={sliceRowName(k, sliceLabels)} status={sliceStatus(key, k.split("#")[1]!)} />
                      </span>,
                      mode,
                      false,
                      true,
                    );
                  })
                : []),
            ];
          })}
          {showTotal && line("__all__", "All strategies", modeOf("__all__"), true)}
        </ul>
      </div>
    </div>
  );
}
