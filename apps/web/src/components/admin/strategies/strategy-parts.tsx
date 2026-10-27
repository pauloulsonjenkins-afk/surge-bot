"use client";

import { useState } from "react";
import { type AdminStrategy, type StrategyReturn } from "@/queries/use-strategies";
import { SegmentLabel } from "@/components/ui/SegmentLabel";
import { useSliceStatus } from "@/queries/use-golden";
import { gbp, signedPct } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import { againstBreakeven, rangeText, roiText } from "@/lib/hit-rate";
import { strategyKey, useSaveStrategyName, useStrategyNames } from "@/queries/use-strategy-names";
import { ukMidnightIso } from "@/lib/uk-time";
import dynamic from "next/dynamic";

// The chart library is about a tenth of the app's code: loaded only when an equity curve is opened, not with the page.
export const EquityCurve = dynamic(() => import("@/components/admin/EquityCurve").then((m) => m.EquityCurve), {
  ssr: false,
  loading: () => <Skeleton className="h-48 w-full" />,
});

/** A strategy with no alert for this many days (and not Live) goes into the collapsed Inactive section. */
export const INACTIVE_DAYS = 14;

export const lastSeen = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });

export type FormKind = "recent" | "week";

const pctOf = (hits: number, n: number) => Math.round((100 * hits) / n);
const money = (r: StrategyReturn) => `${gbp(r.profit)}${r.roi !== null ? ` (${signedPct(r.roi)})` : ""}`;

/** Before and after a rule change: the 7 days before it against everything since, side by side. */
export function ChangeCompare({ c }: { c: NonNullable<NonNullable<AdminStrategy["form"]>["change"]> }) {
  const cell = (w: typeof c.before, label: string) => {
    const a = w.all;
    const rate = a.settled ? pctOf(a.hits ?? 0, a.settled) : null;
    return (
      <div className="rounded-lg border border-line p-2.5">
        <p className="text-xs text-ink-muted">{label}</p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{rate === null ? "–" : `${rate}%`}</p>
        <p className="text-xs tabular-nums text-ink-muted">
          {a.settled} settled{a.breakeven != null ? ` · needs ${Math.round(a.breakeven)}%` : ""}
          {a.counted > 0 ? ` · ${money(a)}` : ""}
        </p>
      </div>
    );
  };
  const b = c.before.all;
  const af = c.after.all;
  const verdict =
    af.settled < 20
      ? `Too early to judge: ${af.settled} settled since the change. Give it about 20+.`
      : b.settled === 0
        ? "Nothing to compare against from the week before."
        : (() => {
            const diff = pctOf(af.hits ?? 0, af.settled) - pctOf(b.hits ?? 0, b.settled);
            return Math.abs(diff) < 3 ? "About the same as before the change so far." : diff > 0 ? `Better since the change: up ${diff} points.` : `Weaker since the change: down ${-diff} points.`;
          })();
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-ink-muted">Before and after the change on {dayMonth.format(new Date(c.at))}</p>
      <div className="grid grid-cols-2 gap-2">
        {cell(c.before, "Week before")}
        {cell(c.after, "Since the change")}
      </div>
      <p className="text-xs text-ink">{verdict}</p>
    </div>
  );
}

/**
 * A strategy's recent form in words: hit rate against what its odds need, against the window before, the money in
 * Live and Sim, and its current run. From the engine's computeStrategyForm (counted from a rule change, if any).
 */
export function FormParagraph({ row, kind }: { row: AdminStrategy; kind: FormKind }) {
  const w = row.form?.[kind];
  if (!w || w.all.settled === 0) {
    return <p className="text-sm text-ink-muted">{kind === "week" ? "No settled picks in the last 7 days." : "No settled picks yet."}</p>;
  }
  const a = w.all;
  const hits = a.hits ?? 0;
  const rate = pctOf(hits, a.settled);
  const span = w.from && w.to ? (dayMonth.format(new Date(w.from)) === dayMonth.format(new Date(w.to)) ? dayMonth.format(new Date(w.to)) : `${dayMonth.format(new Date(w.from))} – ${dayMonth.format(new Date(w.to))}`) : "";
  const parts: string[] = [];
  parts.push(
    kind === "recent"
      ? `Won ${hits} of its last ${a.settled} pick${a.settled === 1 ? "" : "s"} (${rate}%)${span ? `, ${span}` : ""}.`
      : `In the last 7 days it won ${hits} of ${a.settled} settled pick${a.settled === 1 ? "" : "s"} (${rate}%).`,
  );
  if (a.breakeven != null && a.avgOdds != null) {
    const gap = rate - a.breakeven;
    const how = gap >= 5 ? "comfortably ahead of" : gap >= 0 ? "just ahead of" : gap > -5 ? "just behind" : "well behind";
    parts.push(`At average odds of ${a.avgOdds.toFixed(2)} it needs ${Math.round(a.breakeven)}% to break even, so it is ${how} that.`);
  }
  if (w.before.settled >= 5) {
    const prev = pctOf(w.before.hits, w.before.settled);
    const label = kind === "week" ? "the week before" : `the ${w.before.settled} picks before`;
    parts.push(prev === rate ? `That matches ${label} (${prev}%).` : `That is ${rate > prev ? "up" : "down"} from ${prev}% ${label}.`);
  }
  const m: string[] = [];
  if (w.live.counted > 0) m.push(`Live: ${money(w.live)} on ${w.live.counted} real bet${w.live.counted === 1 ? "" : "s"}`);
  if (w.sim.counted > 0) m.push(`Sim: ${money(w.sim)} on ${w.sim.counted} pick${w.sim.counted === 1 ? "" : "s"}`);
  if (m.length > 0) parts.push(`${m.join("; ")}.`);
  const run = [
    (a.longestLosingRun ?? 0) > 1 ? `Longest losing run ${a.longestLosingRun}` : null,
    w.streak && w.streak.n > 1 ? `${a.longestLosingRun && a.longestLosingRun > 1 ? "; it" : "It"} is on ${w.streak.n} ${w.streak.result === "hit" ? "wins" : "losses"} in a row now` : null,
  ].filter(Boolean);
  if (run.length > 0) parts.push(`${run.join("")}.`);
  if (a.settled < 10) parts.push("Too few picks to read much into yet.");
  return <p className="text-sm leading-relaxed text-ink">{parts.join(" ")}</p>;
}

export function record(hits: number, misses: number) {
  const settled = hits + misses;
  return { hits, misses, settled, hitRate: settled > 0 ? Math.round((hits / settled) * 1000) / 10 : null };
}

/** Live when its picks are bet with real money; Sim when they are only recorded. */
export function modeOf(row: AdminStrategy): "live" | "sim" {
  return row.mode;
}

/** Priced picks a mode needs before "Own mode" shows it (below this, a strategy that just switched shows its old mode). */
export const OWN_FROM = 20;

/**
 * Whose figures "Own mode" shows: the strategy's current mode, unless that mode has fewer than OWN_FROM priced picks
 * and the other has more. A strategy just moved from Live to Sim has a "Sim" record made only of the alerts it didn't
 * bet (below minimum odds, too late, not on Betfair), unpriced and unrepresentative; its Live record is the real one.
 */
export function ownMode(row: AdminStrategy): { mode: "live" | "sim"; borrowed: boolean } {
  const m = modeOf(row);
  const other = m === "live" ? "sim" : "live";
  const r = row.returns;
  if (r && r[m].counted < OWN_FROM && r[other].counted >= OWN_FROM) return { mode: other, borrowed: true };
  return { mode: m, borrowed: false };
}

/** True once a strategy has a settled pick in this mode and period; the rest are tucked under "No data yet". */
export function hasPicks(row: AdminStrategy, m: "live" | "sim"): boolean {
  const hits = m === "live" ? (row.liveHits ?? 0) : (row.simHits ?? 0);
  const misses = m === "live" ? (row.liveMisses ?? 0) : (row.simMisses ?? 0);
  return hits + misses > 0 || (row.returns?.[m]?.counted ?? 0) > 0;
}

/** A strategy's price check result: how many checks, and how far its alert price beat the later one, against typical. */
export type CheckResult = { picks: number; vsTypical: number; kickOff: boolean };

/**
 * The written rule for moving a Sim strategy to Live, shown on its card: enough picks, still profitable once pulled
 * towards zero for luck, beating the kick-off price (pre-match only), and a stop loss in place. The same rule as the
 * "Put Live" suggestion on Today (strategy-advice.ts), which also wants the last 30 days up.
 */
export function ReadyForLive({ row, check, hasStop }: { row: AdminStrategy; check: CheckResult | undefined; hasStop: boolean }) {
  const sim = row.returns?.sim;
  const adj = sim ? adjustedRoi(sim.roi, sim.counted) : null;
  const items: Array<{ ok: boolean; text: string }> = [
    { ok: (sim?.counted ?? 0) >= SAMPLE, text: `${SAMPLE}+ priced Sim picks (has ${sim?.counted ?? 0})` },
    { ok: adj !== null && adj > 0, text: `Adjusted Sim return above zero (${roiText(adj)})` },
    // Pre-match strategies only: their price at the alert against the kick-off price.
    ...(check
      ? [
          {
            ok: check.picks >= SAMPLE && check.vsTypical > 0,
            text: `Beats the kick-off price over ${SAMPLE}+ checks (${check.vsTypical > 0 ? "+" : ""}${check.vsTypical.toFixed(1)}%, ${check.picks} checks)`,
          },
        ]
      : []),
    { ok: hasStop, text: "A stop loss is set" },
  ];
  const ready = items.every((i) => i.ok);
  return (
    <div className="rounded-md bg-surface-2 p-2.5 text-xs">
      <p className={`font-medium ${ready ? "text-hit" : "text-ink"}`}>{ready ? "Ready for Live: Today suggests it once its last 30 days are up too." : "Ready for Live? Not yet."}</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((i) => (
          <li key={i.text} className={i.ok ? "text-ink" : "text-ink-muted"}>
            <span aria-hidden className={i.ok ? "text-hit" : "text-ink-muted"}>
              {i.ok ? "✓" : "○"}
            </span>{" "}
            {i.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The hit rate to hold against break-even, and that break-even: over the PRICED picks (the same ones as the money) and
 * from what the winners actually paid, so a card can't say "above break-even" while its money says it loses. Falls back
 * to every settled pick and the average-odds break-even with an older engine.
 */
export function judged(m: StrategyReturn | null, hitRate: number | null, settled: number) {
  if (m && m.pricedHits !== undefined) {
    // No priced picks: nothing to hold against break-even (an unpriced hit rate would colour the bar on its own).
    if (m.counted === 0) return { hitRate: null, breakeven: null, range: null, settled: 0 };
    return {
      hitRate: Math.round((m.pricedHits / m.counted) * 1000) / 10,
      breakeven: m.breakevenEffective ?? m.breakeven ?? null,
      range: m.pricedRange ?? null,
      settled: m.counted,
    };
  }
  return { hitRate, breakeven: m?.breakeven ?? null, range: m?.range ?? null, settled };
}

/** Checks before a price-check figure is coloured as a verdict (it settles much sooner than a hit rate). */
const CHECKS_TO_JUDGE = 20;

/**
 * Did the alert's price beat Betfair's price a few minutes later (against the typical drift), or at kick-off? The
 * earliest sign of a real edge: it settles in about 20 picks, long before a hit rate does.
 */
export function PriceCheckLine({ check }: { check: CheckResult }) {
  const judged = check.picks >= CHECKS_TO_JUDGE;
  const tone = !judged ? "text-ink-muted" : check.vsTypical > 0 ? "text-hit" : "text-loss";
  const v = `${check.vsTypical > 0 ? "+" : ""}${check.vsTypical.toFixed(1)}%`;
  return (
    <span className="mt-0.5 block text-xs text-ink-muted" title="How much better the alert's price was than Betfair's price a few minutes later (against the typical drift), or at kick-off for pre-match picks. Positive, again and again, means the strategy finds value the market hasn't priced yet.">
      Price check: <span className={tone}>{v} {check.kickOff ? "vs kick-off" : "vs the market"}</span> · {check.picks} check{check.picks === 1 ? "" : "s"}
      {judged ? "" : " (too early)"}
    </span>
  );
}

const BET_KINDS = [
  { key: "unders", label: "Unders" },
  { key: "overs", label: "Overs" },
  { key: "btts", label: "Both teams to score" },
  { key: "result", label: "Result" },
] as const;

/**
 * Best Value Cuppa's record split by bet type, on its card. Unders are being watched as a possible strategy of their
 * own (backtested Unders lose in general, but its value-picked ones started well): 50+ priced picks before acting.
 */
export function ByBetLine({ row, mode }: { row: AdminStrategy; mode: "all" | "live" | "sim" }) {
  const by = row.returns?.byBet;
  if (!by) return null;
  const parts = BET_KINDS.flatMap(({ key, label }) => {
    const m = by[key]?.[mode];
    if (!m || m.settled === 0) return [];
    const hits = m.hits ?? 0;
    return [{ key, text: `${label} ${hits}–${m.settled - hits}`, roi: m.counted > 0 ? m.roi : null, counted: m.counted }];
  });
  if (parts.length === 0) return null;
  return (
    <span className="mt-1 block text-xs text-ink-muted" title={`By bet type. Unders are being watched: ${SAMPLE}+ priced picks before reading anything into them.`}>
      By bet:{" "}
      {parts.map((p, i) => (
        <span key={p.key}>
          {i > 0 && " · "}
          {p.text}
          {p.roi !== null && (
            <span className={p.counted >= SAMPLE ? roiTone(p.roi) : ""}>
              {" "}
              {roiText(p.roi)} on {p.counted}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * A slice being watched on the card (engine segments.ts), against the rest of the strategy: e.g. Second Pour's Golden
 * alerts. Nothing is bet differently; it's judged on new matches once it has 50+ priced picks.
 */
export function SegmentLines({ row, mode }: { row: AdminStrategy; mode: "all" | "live" | "sim" }) {
  const sliceStatus = useSliceStatus();
  const segs = row.returns?.segments;
  if (!segs?.length) return null;
  const part = (m: StrategyReturn) => {
    const hits = m.hits ?? 0;
    return (
      <>
        {hits}–{m.settled - hits}
        {m.counted > 0 && m.roi !== null && <span className={m.counted >= SAMPLE ? roiTone(m.roi) : ""}> {roiText(m.roi)} on {m.counted}</span>}
      </>
    );
  };
  return (
    <>
      {segs.map((s) =>
        s.in[mode].settled + s.out[mode].settled === 0 ? null : (
          <span key={s.id} className="mt-1 block text-xs text-ink-muted">
            <SegmentLabel label={s.label} status={sliceStatus(row.label, s.id)} />
            {s.since ? ` since ${shortDay.format(new Date(s.since))}` : ""}: {part(s.in[mode])} of these picks · the rest {part(s.out[mode])}
          </span>
        ),
      )}
    </>
  );
}

/** Below this many priced picks a return is too noisy to act on. */
export const SAMPLE = 50;

export function roiTone(roi: number | null): string {
  return roi === null || roi === 0 ? "text-ink" : roi > 0 ? "text-hit" : "text-loss";
}

/** The money figures for the chosen mode; "all" adds live and sim together. */
export function returnsFor(row: AdminStrategy, mode: "all" | "live" | "sim") {
  const r = row.returns;
  if (!r) return null;
  if (mode !== "all") return r[mode];
  if (r.all) return r.all;
  // An older engine sends no "all" figures; add the two together.
  const staked = r.live.staked + r.sim.staked;
  const profit = r.live.profit + r.sim.profit;
  return { settled: r.live.settled + r.sim.settled, counted: r.live.counted + r.sim.counted, staked, profit, roi: staked > 0 ? profit / staked : null };
}

export type Period = "1D" | "7D" | "30D" | "YTD" | "ALL";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "1D", label: "1D" },
  { value: "7D", label: "7D" },
  { value: "30D", label: "30D" },
  { value: "YTD", label: "YTD" },
  { value: "ALL", label: "All" },
];

/** Where a period starts: today since UK midnight, 7 / 30 days back (as on the Dashboard), or 1 January UK time for YTD. */
export function periodStart(period: Period): string | null {
  if (period === "ALL") return null;
  if (period === "1D") return ukMidnightIso();
  if (period === "YTD") return new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).toISOString(); // UK is on GMT in January
  const days = period === "7D" ? 7 : 30;
  // Whole minutes, so the request stays the same while the page is open.
  return new Date(Math.floor((Date.now() - days * 86_400_000) / 60_000) * 60_000).toISOString();
}

export type SortBy = "adjusted" | "roi" | "profit" | "hitRate";

/** Whose figures each card shows: "own" = its own mode (Live or Sim), else the same mode for every card. */
export type View = "own" | "live" | "sim" | "all";
export const VIEWS: { value: View; label: string }[] = [
  { value: "own", label: "Own mode" },
  { value: "live", label: "Live" },
  { value: "sim", label: "Sim" },
  { value: "all", label: "All" },
];

export const shortDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });

export const SORTS: { value: SortBy; label: string }[] = [
  { value: "adjusted", label: "Return % (adjusted)" },
  { value: "roi", label: "Return %" },
  { value: "profit", label: "Profit £" },
  { value: "hitRate", label: "Hit rate %" },
];

/**
 * A return pulled towards zero by how few picks it's from: return x picks / (picks + SAMPLE). 4 picks at +50% becomes
 * +3.7%; 300 picks at +5% stays +4.3%. Ranking by it stops a lucky handful of picks topping the list.
 */
export function adjustedRoi(roi: number | null, counted: number): number | null {
  return roi === null ? null : (roi * counted) / (counted + SAMPLE);
}

/** The figure a strategy is ranked by within its Live or Sim section; null sorts last. */
export function sortValue(row: AdminStrategy, m: "live" | "sim", by: SortBy): number | null {
  if (by === "adjusted") {
    const r = row.returns?.[m];
    return r ? adjustedRoi(r.roi, r.counted) : null;
  }
  if (by === "hitRate") return m === "live" ? record(row.liveHits ?? 0, row.liveMisses ?? 0).hitRate : record(row.simHits ?? 0, row.simMisses ?? 0).hitRate;
  const r = row.returns?.[m];
  if (!r) return null;
  if (by === "profit") return r.staked > 0 ? r.profit : null;
  return r.roi;
}

/** A nudge once there are enough picks to go on: a Sim strategy that makes money, or a Live one that loses it. */
/**
 * What the hit rate needs beside it: the odds it was won at, the hit rate those odds need to break even after
 * commission, and the range the true hit rate is probably in, given how few picks there are.
 */
export function OddsContext({ hitRate, settled, money }: { hitRate: number | null; settled: number; money: NonNullable<ReturnType<typeof returnsFor>> }) {
  const m = money as StrategyReturn;
  if (m.avgOdds === undefined) return null; // older engine
  const j = judged(m, hitRate, settled);
  const verdict = againstBreakeven(j.hitRate, j.breakeven, j.range);
  const range = rangeText(j.range);
  return (
    <p className="mt-1 text-xs text-ink-muted">
      {m.avgOdds === null
        ? "Odds unknown: set assumed odds on Profit"
        : `Avg odds ${m.avgOdds.toFixed(2)} · priced picks hit ${j.hitRate}% · break-even ${j.breakeven}% (from what winners paid)`}
      {range && ` · likely ${range}`}
      {verdict && <span className={verdict.tone === "hit" ? "text-hit" : verdict.tone === "loss" ? "text-loss" : ""}> · {verdict.text}</span>}
      {m.assumed ? (
        <span className="text-warn">
          {" "}
          · {m.assumed === m.counted ? "All" : `${m.assumed} of ${m.counted}`} priced at the assumed odds set on Profit, not a real
          price, so treat this return as a guess
        </span>
      ) : null}
    </p>
  );
}

/**
 * What a strategy looks for and what it backs (InPlayGuru's rules, in short), and the name and description the app
 * shows for it. InPlayGuru's own name stays the key, so renaming here changes nothing about sending or results.
 */
export function AboutStrategy({ label }: { label: string }) {
  const names = useStrategyNames();
  const save = useSaveStrategyName();
  const info = names.info(label);
  const [name, setName] = useState(info?.name ?? "");
  const [description, setDescription] = useState(info?.description ?? "");
  const [saved, setSaved] = useState(false);
  const dirty = name.trim() !== (info?.name ?? "") || description.trim() !== (info?.description ?? "");
  const submit = (n: string, d: string) =>
    save.mutate(
      { key: label, name: n, description: d },
      {
        onSuccess: (r) => {
          const now = r.names[strategyKey(label)];
          setName(now?.name ?? "");
          setDescription(now?.description ?? "");
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        },
      },
    );
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-surface-2 p-2.5 text-xs">
      {(info?.trigger || info?.bet) && (
        <dl className="space-y-1.5">
          {info?.trigger && (
            <div>
              <dt className="text-ink-muted">When it fires</dt>
              <dd className="text-ink">{info.trigger}</dd>
            </div>
          )}
          {info?.bet && (
            <div>
              <dt className="text-ink-muted">The bet</dt>
              <dd className="text-ink">{info.bet}</dd>
            </div>
          )}
          <div>
            <dt className="text-ink-muted">Original name</dt>
            <dd className="text-ink">{label}</dd>
          </div>
        </dl>
      )}
      <label className="block text-ink-muted">
        Members&apos; name (what members see; you see InPlayGuru&apos;s name)
        <input
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder={label}
          className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <label className="block text-ink-muted">
        Description
        <textarea
          value={description}
          maxLength={300}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        />
      </label>
      {save.error && <p className="text-destructive">{save.error.message}</p>}
      <p className="text-ink-muted">Only the name shown in the app changes. Betting, stakes and results keep using the original name.</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => submit(name, description)}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
        >
          Save
        </button>
        {info?.custom && (
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => submit("", "")}
            className="rounded-md border border-line px-3 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
          >
            Back to the default
          </button>
        )}
        {saved && <span className="text-hit">Saved</span>}
      </div>
    </div>
  );
}

/**
 * Live and Sim always side by side, so switching a strategy never changes what's shown, and today on its own line.
 * Live is real money (its bets since the last rule change); Sim is what the picks would have made.
 */
export function LiveSimToday({ row }: { row: AdminStrategy }) {
  const r = row.returns;
  const t = row.today;
  const part = (label: string, x: StrategyReturn | undefined, money: boolean) =>
    x && x.counted > 0 ? (
      <span>
        {label} <span className={roiTone(money ? x.profit : x.roi)}>{money ? gbp(x.profit) : roiText(x.roi)}</span>
        <span className="text-ink-muted"> ({x.counted})</span>
      </span>
    ) : (
      <span className="text-ink-muted">{label} –</span>
    );
  return (
    <span className="mt-1 block space-y-0.5 text-xs text-ink-muted">
      <span className="flex flex-wrap gap-x-3">
        {part("Live", r?.live, false)}
        {part("Sim", r?.sim, false)}
      </span>
      {t && (t.live.counted > 0 || t.sim.counted > 0) && (
        <span className="flex flex-wrap gap-x-3">
          <span className="font-medium text-ink">Today</span>
          {part("Live", t.live, true)}
          {part("Sim", t.sim, true)}
        </span>
      )}
    </span>
  );
}

