"use client";

import { PageHeader, Segmented } from "@/components/ui/Card";
import { useMemo, useState } from "react";
import { useAdminStrategies, useDeleteStrategy, useIgnoreStrategy, useMergeStrategy, useStrategyWeeks, type AdminStrategy, type StrategyReturn } from "@/queries/use-strategies";
import { StrategyWeekly, trendOf } from "@/components/admin/StrategyWeekly";
import { SegmentLabel } from "@/components/ui/SegmentLabel";
import { useSliceStatus } from "@/queries/use-golden";
import { SegmentBetting } from "@/components/admin/SegmentBetting";
import type { WeekTally } from "@/server/engine-client";
import { useFreshStart } from "@/queries/use-fresh-start";
import { useDeleteStrategyFlow } from "@/components/admin/useDeleteStrategyFlow";
import { marketName } from "@/lib/markets";
import { gbp, signedPct } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { ModeBadge } from "@/components/ui/ModeToggle";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { againstBreakeven, rangeText, roiText } from "@/lib/hit-rate";
import { strategyKey, useSaveStrategyName, useStrategyNames } from "@/queries/use-strategy-names";
import { ChevronDown } from "lucide-react";
import { BreakevenBar } from "@/components/ui/BreakevenBar";
import { StrategyName } from "@/components/ui/StrategyName";
import { ukMidnightIso } from "@/lib/uk-time";
import { useSending, type SendingSettings, type SendingState } from "@/queries/use-sending";
import { BetSettings, betSummary, LiveSimSwitch, type SendingStrategy } from "@/components/admin/StrategyBetting";
import Link from "next/link";
import dynamic from "next/dynamic";
import { PriceCheck } from "@/components/admin/PriceCheck";
import { usePriceCheck } from "@/queries/use-price-check";
import { useToday } from "@/queries/use-today";
import type { StrategyAdvice } from "@/server/engine-client";
import { ADVICE_LABEL, AdviceRow, ApplyAdvice, isGoodAdvice } from "@/components/admin/Advice";
import { isLayRow, LaySection } from "@/components/admin/LaySection";
import { Sparkline } from "@/components/ui/Sparkline";

// The chart library is about a tenth of the app's code: loaded only when an equity curve is opened, not with the page.
const EquityCurve = dynamic(() => import("@/components/admin/EquityCurve").then((m) => m.EquityCurve), {
  ssr: false,
  loading: () => <Skeleton className="h-48 w-full" />,
});

/** A strategy with no alert for this many days (and not Live) goes into the collapsed Inactive section. */
const INACTIVE_DAYS = 14;

const lastSeen = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });

type FormKind = "recent" | "week";

const pctOf = (hits: number, n: number) => Math.round((100 * hits) / n);
const money = (r: StrategyReturn) => `${gbp(r.profit)}${r.roi !== null ? ` (${signedPct(r.roi)})` : ""}`;

/** Before and after a rule change: the 7 days before it against everything since, side by side. */
function ChangeCompare({ c }: { c: NonNullable<NonNullable<AdminStrategy["form"]>["change"]> }) {
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
function FormParagraph({ row, kind }: { row: AdminStrategy; kind: FormKind }) {
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

function record(hits: number, misses: number) {
  const settled = hits + misses;
  return { hits, misses, settled, hitRate: settled > 0 ? Math.round((hits / settled) * 1000) / 10 : null };
}

/** Live when its picks are bet with real money; Sim when they are only recorded. */
function modeOf(row: AdminStrategy): "live" | "sim" {
  return row.mode;
}

/** Priced picks a mode needs before "Own mode" shows it (below this, a strategy that just switched shows its old mode). */
const OWN_FROM = 20;

/**
 * Whose figures "Own mode" shows: the strategy's current mode, unless that mode has fewer than OWN_FROM priced picks
 * and the other has more. A strategy just moved from Live to Sim has a "Sim" record made only of the alerts it didn't
 * bet (below minimum odds, too late, not on Betfair), unpriced and unrepresentative; its Live record is the real one.
 */
function ownMode(row: AdminStrategy): { mode: "live" | "sim"; borrowed: boolean } {
  const m = modeOf(row);
  const other = m === "live" ? "sim" : "live";
  const r = row.returns;
  if (r && r[m].counted < OWN_FROM && r[other].counted >= OWN_FROM) return { mode: other, borrowed: true };
  return { mode: m, borrowed: false };
}

/** True once a strategy has a settled pick in this mode and period; the rest are tucked under "No data yet". */
function hasPicks(row: AdminStrategy, m: "live" | "sim"): boolean {
  const hits = m === "live" ? (row.liveHits ?? 0) : (row.simHits ?? 0);
  const misses = m === "live" ? (row.liveMisses ?? 0) : (row.simMisses ?? 0);
  return hits + misses > 0 || (row.returns?.[m]?.counted ?? 0) > 0;
}

/** A strategy's price check result: how many checks, and how far its alert price beat the later one, against typical. */
type CheckResult = { picks: number; vsTypical: number; kickOff: boolean };

/**
 * The written rule for moving a Sim strategy to Live, shown on its card: enough picks, still profitable once pulled
 * towards zero for luck, beating the kick-off price (pre-match only), and a stop loss in place. The same rule as the
 * "Put Live" suggestion on Today (strategy-advice.ts), which also wants the last 30 days up.
 */
function ReadyForLive({ row, check, hasStop }: { row: AdminStrategy; check: CheckResult | undefined; hasStop: boolean }) {
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
function judged(m: StrategyReturn | null, hitRate: number | null, settled: number) {
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
function PriceCheckLine({ check }: { check: CheckResult }) {
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
function ByBetLine({ row, mode }: { row: AdminStrategy; mode: "all" | "live" | "sim" }) {
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
function SegmentLines({ row, mode }: { row: AdminStrategy; mode: "all" | "live" | "sim" }) {
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
const SAMPLE = 50;

function roiTone(roi: number | null): string {
  return roi === null || roi === 0 ? "text-ink" : roi > 0 ? "text-hit" : "text-loss";
}

/** The money figures for the chosen mode; "all" adds live and sim together. */
function returnsFor(row: AdminStrategy, mode: "all" | "live" | "sim") {
  const r = row.returns;
  if (!r) return null;
  if (mode !== "all") return r[mode];
  if (r.all) return r.all;
  // An older engine sends no "all" figures; add the two together.
  const staked = r.live.staked + r.sim.staked;
  const profit = r.live.profit + r.sim.profit;
  return { settled: r.live.settled + r.sim.settled, counted: r.live.counted + r.sim.counted, staked, profit, roi: staked > 0 ? profit / staked : null };
}

type Period = "1D" | "7D" | "30D" | "YTD" | "ALL";

const PERIODS: { value: Period; label: string }[] = [
  { value: "1D", label: "1D" },
  { value: "7D", label: "7D" },
  { value: "30D", label: "30D" },
  { value: "YTD", label: "YTD" },
  { value: "ALL", label: "All" },
];

/** Where a period starts: today since UK midnight, 7 / 30 days back (as on the Dashboard), or 1 January UK time for YTD. */
function periodStart(period: Period): string | null {
  if (period === "ALL") return null;
  if (period === "1D") return ukMidnightIso();
  if (period === "YTD") return new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).toISOString(); // UK is on GMT in January
  const days = period === "7D" ? 7 : 30;
  // Whole minutes, so the request stays the same while the page is open.
  return new Date(Math.floor((Date.now() - days * 86_400_000) / 60_000) * 60_000).toISOString();
}

type SortBy = "adjusted" | "roi" | "profit" | "hitRate";

/** Whose figures each card shows: "own" = its own mode (Live or Sim), else the same mode for every card. */
type View = "own" | "live" | "sim" | "all";
const VIEWS: { value: View; label: string }[] = [
  { value: "own", label: "Own mode" },
  { value: "live", label: "Live" },
  { value: "sim", label: "Sim" },
  { value: "all", label: "All" },
];

const shortDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });

const SORTS: { value: SortBy; label: string }[] = [
  { value: "adjusted", label: "Return % (adjusted)" },
  { value: "roi", label: "Return %" },
  { value: "profit", label: "Profit £" },
  { value: "hitRate", label: "Hit rate %" },
];

/**
 * A return pulled towards zero by how few picks it's from: return x picks / (picks + SAMPLE). 4 picks at +50% becomes
 * +3.7%; 300 picks at +5% stays +4.3%. Ranking by it stops a lucky handful of picks topping the list.
 */
function adjustedRoi(roi: number | null, counted: number): number | null {
  return roi === null ? null : (roi * counted) / (counted + SAMPLE);
}

/** The figure a strategy is ranked by within its Live or Sim section; null sorts last. */
function sortValue(row: AdminStrategy, m: "live" | "sim", by: SortBy): number | null {
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
function OddsContext({ hitRate, settled, money }: { hitRate: number | null; settled: number; money: NonNullable<ReturnType<typeof returnsFor>> }) {
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
function AboutStrategy({ label }: { label: string }) {
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
function LiveSimToday({ row }: { row: AdminStrategy }) {
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

function StrategyCard({
  row,
  mode: pickMode,
  ownView = false,
  borrowed = false,
  last7,
  prev28,
  all,
  sortBy,
  includes,
  busy,
  selecting,
  selected,
  onToggle,
  onMerge,
  onDelete,
  bet,
  settings,
  bank,
  check,
  advice,
}: {
  /** Its kick-off price check result (pre-match strategies), for the Ready for Live checklist. */
  check?: CheckResult;
  /** Today's suggestion for it (Live / Sim or the stake ladder), if any: the one place those rules live. */
  advice?: StrategyAdvice;
  /** Its betting controls (from Sending); missing while they load. */
  bet: SendingStrategy | undefined;
  settings: SendingSettings | undefined;
  /** The Betfair balance percentage stakes work from. */
  bank?: SendingState["bank"];
  row: AdminStrategy;
  /** Whose figures the card shows: its own mode, or the one chosen at the top of the page. */
  mode: "all" | "live" | "sim";
  /** True when `mode` is "Own mode" auto-following the strategy's current switch, not an explicit Live/Sim/All pick: the headline then counts from when that switch was last flipped, not that mode's whole history (see `row.sinceMode`). */
  ownView?: boolean;
  /** Own mode is showing the other mode's record, because its current mode has too few priced picks yet. */
  borrowed?: boolean;
  /** Its last 7 days and the 28 before, in the card's mode (Strategies → Weekly data), for the collapsed card. */
  last7?: WeekTally;
  prev28?: WeekTally;
  all: AdminStrategy[];
  sortBy: SortBy;
  /** Strategies that are reported under this one. */
  includes: string[];
  busy: boolean;
  /** Tick boxes are showing, to delete several strategies at once. */
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onMerge: (into: string | null) => void;
  onDelete: () => void;
}) {
  const [merging, setMerging] = useState(false);
  const [showCurve, setShowCurve] = useState(false);
  const [target, setTarget] = useState("");
  const live = record(row.liveHits ?? 0, row.liveMisses ?? 0);
  const sim = record(row.simHits ?? 0, row.simMisses ?? 0);
  /**
   * Own mode (not an explicit Live/Sim/All pick, and not borrowing the other mode for want of data): counted from
   * when this mode was last switched on, not its whole history. Reported 27 Oct 2026 - switching a strategy to Sim
   * immediately showed its big, mostly pre-switch Sim record as if it were evidence the switch had already paid off.
   * Null (falls back to the whole-history figure below) for a strategy whose switch predates this, or that's never
   * been flipped since.
   */
  const sinceSwitch = ownView && !borrowed && pickMode !== "all" ? (row.sinceMode ?? null) : null;
  // The headline figures follow the All / Live / Sim choice, or since-switch when that applies.
  const shown = sinceSwitch ? record(sinceSwitch.hits ?? 0, sinceSwitch.settled - (sinceSwitch.hits ?? 0)) : pickMode === "live" ? live : pickMode === "sim" ? sim : record(row.hits, row.misses);
  const { hits, misses, settled, hitRate } = shown;
  const money = sinceSwitch ?? returnsFor(row, pickMode);
  // The rule change's "before" figures in the same mode (the headline counts from the change). Not shown alongside
  // since-switch figures: that "before" is about a rule change, a different event from the mode switch.
  const beforeAll = row.returns?.before;
  const before = sinceSwitch ? null : beforeAll ? (pickMode === "all" ? (beforeAll.all ?? null) : beforeAll[pickMode]) : null;
  const good = advice ? isGoodAdvice(advice) : false;
  const options = all.filter((o) => o.label !== row.label);
  const names = useStrategyNames();
  const info = names.info(row.label);
  const shownName = names.name(row.label);
  const [about, setAbout] = useState(false);
  const [open, setOpen] = useState(false);

  const ret = money as StrategyReturn | null;
  const judge = judged(ret, hitRate, settled);
  // The headline is the return on each £1 staked (what decides whether a strategy is worth betting), or the £ total
  // when sorting by it.
  const adj = money ? adjustedRoi(money.roi, money.counted) : null;
  /**
   * The headline can show Live or Sim (Own mode) or either chosen explicitly: whichever it is, the OTHER one is a
   * different pool of money that can easily disagree (a bad recent Live spell with a long, better Sim record, or the
   * reverse). Shown alongside whenever it has a real sample and points the other way, so the big colour is never read
   * as "the verdict" on its own — the fix for the "mixed messages" confusion reported 27 Oct 2026.
   */
  const other = pickMode === "live" ? "sim" : pickMode === "sim" ? "live" : null;
  const otherMoney = other ? row.returns?.[other] : null;
  const otherNote =
    otherMoney && otherMoney.counted >= SAMPLE && otherMoney.roi !== null && money && money.roi !== null && (otherMoney.roi > 0) !== (money.roi > 0)
      ? `${other === "live" ? "Live" : "Sim"} ${roiText(otherMoney.roi)} (${otherMoney.counted})`
      : null;
  const sinceDay = sinceSwitch && row.modeSince ? shortDay.format(new Date(row.modeSince)) : null;
  const sinceTag = sinceDay ? ` since ${sinceDay}` : "";
  const headline =
    sortBy === "adjusted"
      ? {
          value: roiText(adj),
          tone: roiTone(adj),
          sub: money && money.staked > 0 ? `adjusted · ${roiText(money.roi)} on ${money.counted} priced${sinceTag}` : `adjusted return per £1${sinceTag || " (too few picks since)"}`,
        }
      : sortBy === "profit"
      ? {
          value: money && money.staked > 0 ? gbp(money.profit) : "–",
          tone: roiTone(money && money.staked > 0 ? money.profit : null),
          sub: money && money.staked > 0 ? `${roiText(money.roi)} return${sinceTag}` : `profit${sinceTag || " (too few picks since)"}`,
        }
      : {
          value: roiText(money?.roi ?? null),
          tone: roiTone(money?.roi ?? null),
          sub: money && money.staked > 0 ? `${gbp(money.profit)} on ${gbp(money.staked, false)}${sinceTag}` : `return per £1${sinceTag || (sinceSwitch ? " (too few picks since)" : "")}`,
        };
  // Too few priced picks to act on: the figures still show, but faded.
  const thin = (money?.counted ?? 0) < SAMPLE;

  return (
    <li
      className={`card-hover overflow-hidden rounded-xl border transition-colors ${open ? "card-open" : "bg-surface"} ${selected ? "border-accent" : "border-line"} ${advice ? (good ? "ring-2 ring-hit/70" : "ring-2 ring-warn/70") : ""}`}
    >
      {/* The row to compare by: name, record and hit rate against break-even on the left, the headline figure on the right. */}
      {/* Wraps on a narrow screen: the Live / Sim switch drops to its own line instead of squeezing the name to one letter wide. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
        {selecting && (
          <input
            type="checkbox"
            checked={selected}
            disabled={row.sendingOn || busy}
            onChange={onToggle}
            aria-label={`Select ${shownName}`}
            title={row.sendingOn ? "Put this strategy back to Sim first" : undefined}
            style={{ accentColor: "var(--accent)" }}
            className="h-4 w-4 shrink-0 disabled:opacity-40"
          />
        )}
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-[1_1_100%] flex-wrap items-center gap-x-3 gap-y-1 text-left sm:flex-1">
          <span className="min-w-[9rem] flex-1">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
              <span className="min-w-0 break-words">
                <StrategyName label={row.label} />
              </span>
              {!bet && <ModeBadge mode={modeOf(row)} />}
              {bet?.enabled && bet.stopLoss?.stopped && <span className="rounded-full bg-warn px-2 py-0.5 text-xs font-medium text-warn-ink">Stopped today</span>}
            </span>
            <span className={`mt-0.5 block truncate text-xs ${row.market ? "text-ink-muted" : "text-warn"}`}>
              {[marketName(row.market) ?? "No market set", settled > 0 ? `${hits}–${misses}` : "no results yet", hitRate !== null ? `${hitRate}%` : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {last7 && (
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                Last 7 days:{" "}
                <span className={last7.counted > 0 ? roiTone(last7.profit) : ""}>{last7.counted > 0 ? gbp(last7.profit) : "–"}</span> · {last7.picks} bet
                {last7.picks === 1 ? "" : "s"}
                {prev28 && (() => {
                  const t = trendOf(last7, prev28);
                  return <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${t.cls}`}>{t.label}</span>;
                })()}
              </span>
            )}
            <LiveSimToday row={row} />
            {borrowed && (
              <span className="mt-1 block text-xs text-warn">
                Showing its {pickMode === "live" ? "Live" : "Sim"} record: it&apos;s now in {modeOf(row) === "live" ? "Live" : "Sim"}, with fewer than {OWN_FROM} priced picks there yet.
              </span>
            )}
          </span>
          {row.spark && row.spark.length >= 5 && (
            <span className="block shrink-0" title={`Running profit over its last ${row.spark.length} bets (Live and Sim): ${gbp(row.spark[row.spark.length - 1]!)}`}>
              <Sparkline values={row.spark} />
            </span>
          )}
          <span className={`shrink-0 text-right ${thin ? "opacity-60" : ""}`} title={thin ? `Fewer than ${SAMPLE} priced picks: too few to act on yet` : undefined}>
            <span className={`block font-display text-xl font-bold tabular-nums [font-stretch:108%] ${headline.tone}`}>{headline.value}</span>
            <span className="block text-xs text-ink-muted">{headline.sub}</span>
            {otherNote && (
              <span className="block text-xs text-warn" title="A different pool of money, over a different time span: this isn't the same figure the big one above is.">
                but {otherNote}
              </span>
            )}
            {thin && sortBy !== "adjusted" && money && money.counted > 0 && <span className="block text-xs text-ink-muted">{money.counted} priced</span>}
          </span>
          <ChevronDown size={16} aria-hidden className={`shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {bet && settings && !selecting && (
          <span className="ml-auto shrink-0">
            <LiveSimSwitch s={bet} settings={settings} />
          </span>
        )}
      </div>
      {/* A suggestion for this strategy (the same as at the top of the page and on Today), with its own Apply. */}
      {advice && (
        <div className={`mx-3.5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${good ? "border-hit/40 bg-hit/10" : "border-warn/40 bg-warn/10"}`}>
          <span className="min-w-0 flex-1 text-xs">
            <span className={`font-semibold ${good ? "text-hit" : "text-warn"}`}>Suggested: {ADVICE_LABEL[advice.kind]}</span>
            <span className="block text-ink-muted">{advice.reason}</span>
          </span>
          <ApplyAdvice a={advice} name={shownName} />
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t border-line px-3.5 py-3">
          {bet && settings && (() => {
            const b = betSummary(bet, settings);
            return <p className={`text-xs ${b.warn ? "text-warn" : "text-ink-muted"}`}>Bet: {b.text}</p>;
          })()}
          <SegmentLines row={row} mode={pickMode} />
          {info?.description && <p className="text-xs text-ink">{info.description}</p>}
          {/* The detail behind the headline: hit rate against break-even, and the slices being watched. */}
          <div className="space-y-1">
            <span className="block max-w-xs">
              <BreakevenBar hitRate={judge.hitRate} breakeven={judge.breakeven} range={judge.range} settled={judge.settled} noun="priced pick" since={row.recordFrom ? `since ${shortDay.format(new Date(row.recordFrom))}` : undefined} />
            </span>
            {check && check.picks > 0 && <PriceCheckLine check={check} />}
            {before && before.counted > 0 && (
              <span className="block text-xs text-ink-muted">
                Before {shortDay.format(new Date(row.recordFrom!))}: {roiText(before.roi)} on {before.counted}
              </span>
            )}
            <ByBetLine row={row} mode={pickMode} />
            {row.returns?.byHand && row.returns.byHand.settled > 0 && (
              <span className="mt-1 block text-xs text-ink-muted" title="Sim picks you bet for real from the Live tab. They stay in this strategy's Sim record and are left out of its Live record (the stake ladder and back-to-Sim judge that), so your own picking doesn't skew it.">
                Bet by hand: {row.returns.byHand.settled} · won {row.returns.byHand.hits ?? 0}–{row.returns.byHand.settled - (row.returns.byHand.hits ?? 0)}
                {row.returns.byHand.staked > 0 && <span className={roiTone(row.returns.byHand.profit)}> · {gbp(row.returns.byHand.profit)}</span>}
              </span>
            )}
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="mb-1 text-xs font-medium text-ink-muted">Recent form: last 20 picks</p>
            <FormParagraph row={row} kind="recent" />
            <p className="mb-1 mt-2 text-xs font-medium text-ink-muted">Last 7 days</p>
            <FormParagraph row={row} kind="week" />
          </div>
          {modeOf(row) === "sim" && (
            <ReadyForLive row={row} check={check} hasStop={!!bet?.stopLoss && (bet.stopLoss.dailyLoss !== null || bet.stopLoss.lossRun !== null)} />
          )}
          {bet && settings && <BetSettings s={bet} settings={settings} bank={bank} />}
          {settings && (row.returns?.segments ?? []).map((s) => (
            <SegmentBetting key={s.id} strategyKey={row.label.toLowerCase()} strategyName={names.name(row.label)} segment={s} settings={settings} strategyLive={modeOf(row) === "live"} />
          ))}
          <p className="text-xs text-ink-muted">
            {pickMode === "all" && `${row.alertsSince} alert${row.alertsSince === 1 ? "" : "s"} · `}
            {settled > 0 && settled < SAMPLE ? "small sample · " : ""}last alert {lastSeen.format(new Date(row.lastAlertAt))}
          </p>
          {row.form?.change && <ChangeCompare c={row.form.change} />}
          {row.recordFrom && (
            <p className="text-xs text-warn">
              Its rules changed on {lastSeen.format(new Date(row.recordFrom))}, so its record, money and warnings count only alerts from then. The figures
              from before the change are shown as &quot;Before&quot;.
            </p>
          )}
          {money && money.settled > 0 && <OddsContext hitRate={hitRate} settled={settled} money={money} />}
          {/* Live and simulation side by side, so a strategy's real results can be checked against what it does unbet. */}
          {(live.settled > 0 || sim.settled > 0) && (
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {(["live", "sim"] as const).map((m) => {
                const rec = m === "live" ? live : sim;
                const r = row.returns?.[m] ?? null;
                return (
                  <div key={m} className="rounded-md bg-surface-2 px-2.5 py-1.5">
                    <dt className="text-ink-muted">{m === "live" ? "Live" : "Sim"}</dt>
                    <dd className="tabular-nums text-ink">
                      {rec.settled === 0 ? (
                        m === "live" ? "No bets yet" : "None"
                      ) : (
                        <>
                          <span className={roiTone(r?.roi ?? null)}>{roiText(r?.roi ?? null)}</span>
                          <span className="text-ink-muted">
                            {" "}
                            · {rec.hits}–{rec.misses} · {rec.hitRate}%{r && r.counted < rec.settled ? ` · ${r.counted} priced` : ""}
                          </span>
                        </>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
          <div className="flex flex-wrap gap-1.5 text-xs">
            {row.mergedInto && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-muted">Counted under “{names.name(row.mergedInto)}”</span>}
            {includes.length > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-muted">Also counts: {includes.map(names.name).join(", ")}</span>}
            {row.sent > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-muted">{row.sent} sent to bet</span>}
          </div>
          {money && money.counted > 0 && (
            <div>
              <button
                type="button"
                aria-expanded={showCurve}
                onClick={() => setShowCurve((v) => !v)}
                className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2"
              >
                {showCurve ? "Hide equity curve" : "Equity curve and drawdown"}
              </button>
              {showCurve && (
                <div className="mt-2">
                  <EquityCurve label={row.label} mode={pickMode} />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-expanded={about}
              onClick={() => setAbout((v) => !v)}
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2"
            >
              {about ? "Close" : "About and members' name"}
            </button>
            {row.mergedInto ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onMerge(null)}
                className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
              >
                Undo merge
              </button>
            ) : (
              options.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMerging((v) => !v)}
                  className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2"
                >
                  {merging ? "Cancel merge" : "Merge into another…"}
                </button>
              )
            )}
            {/* A Live strategy can't be deleted (put it back to Sim first), so the button only shows when it can be used. */}
            {!row.sendingOn && (
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-destructive hover:bg-surface-2 disabled:opacity-40"
              >
                Delete strategy
              </button>
            )}
          </div>

          {about && <AboutStrategy label={row.label} />}

          {merging && !row.mergedInto && (
            <div className="space-y-2 rounded-lg bg-surface-2 p-2.5">
              <label className="block text-xs text-ink-muted">
                Count this strategy’s alerts under
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                >
                  <option value="">Choose a strategy…</option>
                  {options.map((o) => (
                    <option key={o.label} value={o.label}>
                      {names.name(o.label)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-ink-muted">
                The Dashboard and stats then treat both as one strategy, and nothing is deleted. Betting is not affected: each strategy keeps its own
                switch and stake.
              </p>
              <button
                type="button"
                disabled={busy || !target}
                onClick={() => {
                  onMerge(target);
                  setMerging(false);
                  setTarget("");
                }}
                className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
              >
                Merge
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function StrategiesPage() {
  const [period, setPeriod] = useState<Period>("ALL");
  const since = useMemo(() => periodStart(period), [period]);
  const { data, isLoading, error, isPlaceholderData } = useAdminStrategies(since);
  const merge = useMergeStrategy();
  const remove = useDeleteStrategyFlow();
  const sending = useSending();
  // Price check results by strategy, for each card's Ready for Live checklist (the same figures as the Price check box).
  const priceCheck = usePriceCheck(30, true);
  const checks = useMemo(() => {
    const m = new Map<string, CheckResult>();
    for (const r of priceCheck.data?.rows ?? []) {
      const k = r.strategy.toLowerCase();
      // Pre-match only: the in-play figures leave out every pick a goal settled within the 5 minutes, so the strategies
      // that win quickest look worst (Second Pour, the best Live strategy, shows about -17%). Not a fair verdict.
      if (r.kind === "ko") m.set(k, { picks: r.picks, vsTypical: r.edge, kickOff: true });
    }
    return m;
  }, [priceCheck.data]);
  // Today's suggestions, so each card says the same as Today (one set of rules, in the engine).
  const today = useToday();
  const allAdvice = useMemo<StrategyAdvice[]>(() => today.data?.advice ?? [], [today.data]);
  // Strategies with no alert for INACTIVE_DAYS (retired, or deleted in InPlayGuru) and not Live: listed apart.
  const [loadedAt] = useState(() => Date.now());
  const isInactive = (r: AdminStrategy) => !r.sendingOn && (!r.lastAlertAt || loadedAt - Date.parse(r.lastAlertAt) > INACTIVE_DAYS * 86_400_000);
  const names = useStrategyNames();
  const adviceOf = useMemo(() => new Map(allAdvice.filter((a) => a.kind !== "league-block").map((a) => [a.key.toLowerCase(), a])), [allAdvice]);
  const betOf = useMemo(() => {
    const map = new Map<string, SendingStrategy>();
    for (const s of sending.data?.strategies ?? []) map.set(s.label.toLowerCase(), s);
    return (label: string) => map.get(label.toLowerCase());
  }, [sending.data]);
  const ignore = useIgnoreStrategy();
  const removeMany = useDeleteStrategy();
  const dialog = useDialog();
  const { data: freshAt } = useFreshStart();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("adjusted");
  // Each card shows its own mode's figures (Live strategies their Live bets, Sim ones their Sim picks) unless one is chosen.
  const [view, setView] = useState<View>("own");
  // Weekly (the default): one row per strategy, £ week by week; Cards: the full card per strategy.
  const [layout, setLayout] = useState<"weekly" | "cards">("weekly");
  // Back bets, or the LAY section (lays bet against something, so they get their own view).
  const [side, setSide] = useState<"back" | "lay">("back");
  const [showOptions, setShowOptions] = useState(false);
  const weeksData = useStrategyWeeks();
  const strategies = useMemo(() => data?.strategies ?? [], [data]);
  const inactive = strategies.filter((r) => isInactive(r) && !isLayRow(r));
  const ignored = data?.ignored ?? [];

  const includesOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of strategies) {
      if (r.mergedInto) map.set(r.mergedInto.toLowerCase(), [...(map.get(r.mergedInto.toLowerCase()) ?? []), r.label]);
    }
    return map;
  }, [strategies]);

  function deleteStrategy(row: AdminStrategy) {
    void remove.run(row.label, { alerts: row.alerts, sent: row.sent });
  }

  const [bulkBusy, setBulkBusy] = useState(false);
  const busy = merge.isPending || remove.isPending || ignore.isPending || bulkBusy;
  const failed = merge.error ?? remove.error ?? ignore.error ?? removeMany.error;

  const deletable = strategies.filter((s) => !s.sendingOn);
  const toggle = (label: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  async function deleteSelected() {
    const chosen = strategies.filter((s) => picked.has(s.label) && !s.sendingOn);
    if (chosen.length === 0) return;
    const alerts = chosen.reduce((n, s) => n + s.alerts, 0);
    const sent = chosen.reduce((n, s) => n + s.sent, 0);
    const many = `${chosen.length} strateg${chosen.length === 1 ? "y" : "ies"}`;
    const ok = await dialog.confirm({
      title: `Delete ${many}?`,
      tone: "danger",
      confirmLabel: `Delete ${many}`,
      details: chosen.map((s) => ({ label: s.label, value: `${s.alerts} alert${s.alerts === 1 ? "" : "s"}` })),
      body: (
        <>
          <p>
            Their {alerts} saved alert{alerts === 1 ? "" : "s"} are deleted for good, so they disappear from the Dashboard, Live, Strategies, Trade
            Log and Profit.
          </p>
          {sent > 0 && (
            <p>
              <strong>{sent} were already sent to bet.</strong> Those are kept as records but taken out of every result and figure (unless sent in
              the last 2 hours).
            </p>
          )}
          <p>If one of these names ever arrives again, it will reappear.</p>
        </>
      ),
    });
    if (!ok) return;
    const includeSent =
      sent > 0 &&
      (await dialog.confirm({
        title: `Also delete the ${sent} sent record${sent === 1 ? "" : "s"}?`,
        tone: "danger",
        confirmLabel: `Delete ${sent} sent record${sent === 1 ? "" : "s"}`,
        cancelLabel: "Keep as records",
        body: <p>Deleting them makes these strategies disappear completely from every list. Records of picks sent today are kept until tomorrow.</p>,
      }));
    setBulkBusy(true);
    setBulkMessage(null);
    let done = 0;
    let removedAlerts = 0;
    try {
      for (const s of chosen) {
        const r = await removeMany.mutateAsync({ label: s.label, ignoreFuture: false, includeSent });
        removedAlerts += r.removed;
        done++;
      }
      setBulkMessage(`${done} strateg${done === 1 ? "y" : "ies"} deleted (${removedAlerts} alert${removedAlerts === 1 ? "" : "s"}).`);
      stopSelecting();
    } catch {
      setBulkMessage(`Stopped after ${done} of ${chosen.length}. See the error above, then try again.`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function clearIgnored() {
    if (ignored.length === 0) return;
    const ok = await dialog.confirm({
      title: "Clear the ignored list?",
      confirmLabel: `Stop ignoring ${ignored.length}`,
      body: (
        <>
          <ul className="list-disc pl-5 text-ink">
            {ignored.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p>New alerts with these names would be stored again. Only do this if they will never be used.</p>
        </>
      ),
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      for (const name of ignored) await ignore.mutateAsync({ label: name, ignored: false });
    } catch {
      // the error shows above; the rest stay on the list
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        as="h2"
        title="Strategies"
        subtitle={
          <>
            Each strategy&apos;s results and Live / Sim switch; tap one for its stake and limits. Overall limits are on{" "}
            <Link href="/more/admin/sending?tab=limits" className="text-accent underline">
              Betting
            </Link>
            .
          </>
        }
      />

      {/* Suggestions first, where they can't be missed: the same list as Today, each with Apply. */}
      {allAdvice.length > 0 && (
        <section aria-label="Suggestions" className="rounded-xl border-2 border-accent bg-accent/5 p-3.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            Suggestions
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-ink">{allAdvice.length}</span>
          </h3>
          <p className="mt-0.5 text-xs text-ink-muted">From each strategy&apos;s results since its rules last changed. Nothing changes until you press the button and confirm.</p>
          <ul className="mt-3 space-y-3 text-sm">
            {allAdvice.map((a) => (
              <AdviceRow key={`${a.key}:${a.kind}:${a.league?.key ?? ""}`} a={a} name={a.league ? `${names.name(a.key)} in ${a.league.name}` : names.name(a.key)} link={!!a.league} />
            ))}
          </ul>
        </section>
      )}

      <Segmented
        label="Bets"
        value={side}
        onChange={setSide}
        options={[
          { value: "back", label: "Back bets" },
          { value: "lay", label: `LAY bets${strategies.some(isLayRow) ? ` · ${strategies.filter(isLayRow).length}` : ""}` },
        ]}
      />

      {side === "lay" && data && <LaySection rows={strategies.filter(isLayRow)} all={strategies} betOf={betOf} settings={sending.data?.settings} bank={sending.data?.bank} />}

      {/* The view switches sit behind one button on every screen (27 Oct 2026 tidy-up), with what's chosen written on it, so the strategies come first. */}
      {side !== "lay" && (
        <button
          type="button"
          aria-expanded={showOptions}
          onClick={() => setShowOptions((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-line px-3 py-1.5 text-left text-xs font-medium text-ink"
        >
          <span className="min-w-0 truncate">
            {showOptions ? "Hide view options" : "View options"}
            {!showOptions && (
              <span className="font-normal text-ink-muted">
                {" "}
                · {layout === "weekly" ? "Weekly" : `Cards, ${PERIODS.find((p) => p.value === period)?.label ?? period}`} · {VIEWS.find((v) => v.value === view)?.label ?? view} · by {SORTS.find((s) => s.value === sortBy)?.label ?? sortBy}
              </span>
            )}
          </span>
          <ChevronDown size={14} aria-hidden className={`shrink-0 text-ink-muted transition-transform ${showOptions ? "rotate-180" : ""}`} />
        </button>
      )}
      <div className={`flex-wrap items-center gap-3 ${side === "lay" ? "hidden" : showOptions ? "flex" : "hidden"}`}>
        <Segmented label="Layout" value={layout} onChange={setLayout} options={[{ value: "weekly", label: "Weekly" }, { value: "cards", label: "Cards" }]} />
        {layout === "cards" && <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />}
        <Segmented label="Whose figures" value={view} onChange={setView} options={VIEWS} />
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          Sort by
          <div className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label="Sort strategies by">
            {SORTS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={sortBy === o.value}
                onClick={() => setSortBy(o.value)}
                className={`rounded px-2.5 py-1 font-medium ${sortBy === o.value ? "bg-accent text-accent-ink" : "text-ink hover:bg-surface-2"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {period !== "ALL" && (
        <p className={`text-xs text-ink-muted ${isPlaceholderData ? "animate-pulse" : ""}`}>
          {period === "YTD" ? "Since 1 January" : period === "1D" ? "Today (since midnight)" : `Last ${period === "7D" ? "7 days" : "30 days"}`} only. Figures from
          fewer than {SAMPLE} priced picks are faded. Suggestions (the same as on Today) use their own windows, whatever the period here; the equity curve is always all time.
        </p>
      )}

      {data && strategies.length > 0 && <PriceCheck />}

      {/* Deleting several at once is rare: its button lives with the view options, and stays out once you're mid-selection. */}
      {data && strategies.length > 0 && (showOptions || selecting) && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              disabled={bulkBusy}
              className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
            >
              {selecting ? "Cancel" : "Select several to delete"}
            </button>
            {selecting && (
              <>
                <button
                  type="button"
                  onClick={() => setPicked(new Set(deletable.map((s) => s.label)))}
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2"
                >
                  Select all
                </button>
                {freshAt && (
                  <button
                    type="button"
                    onClick={() => setPicked(new Set(deletable.filter((s) => s.alertsSince === 0).map((s) => s.label)))}
                    className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2"
                  >
                    Select unused since fresh start
                  </button>
                )}
                <button type="button" onClick={() => setPicked(new Set())} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2">
                  Select none
                </button>
              </>
            )}
          </div>
          {selecting && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 p-2.5">
              <p className="text-xs text-ink">
                {picked.size} selected
                {strategies.some((s) => s.sendingOn) && <span className="text-ink-muted"> · Live ones can’t be picked</span>}
              </p>
              <button
                type="button"
                disabled={picked.size === 0 || bulkBusy}
                onClick={() => void deleteSelected()}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-danger-ink disabled:opacity-40"
              >
                {bulkBusy ? "Deleting…" : `Delete ${picked.size || ""} selected`.replace("  ", " ")}
              </button>
            </div>
          )}
          {bulkMessage && <p className="text-xs text-ink">{bulkMessage}</p>}
        </div>
      )}

      {side === "lay" ? null : error ? (
        <QueryError error={error} next="/more/admin/strategies" />
      ) : isLoading || !data ? (
        <div className="space-y-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : strategies.length === 0 && ignored.length === 0 ? (
        <p className="text-sm text-ink-muted">Strategies appear here once alerts arrive.</p>
      ) : (
        <>
          {failed && <p className="rounded-md border border-line bg-surface p-2 text-xs text-destructive">{failed.message}</p>}
          {(["live", "sim"] as const).map((m) => {
            // Best first by the chosen figure (in the section's own mode), so what to act on is at the top and bottom.
            const valueOf = (r: AdminStrategy) => sortValue(r, view === "own" ? ownMode(r).mode : m, sortBy) ?? -Infinity;
            const group = strategies
              .filter((r) => modeOf(r) === m && !isLayRow(r) && !isInactive(r))
              .sort((a, b) => valueOf(b) - valueOf(a) || a.label.localeCompare(b.label));
            if (group.length === 0) return null;
            const renderCard = (r: AdminStrategy) => (
              <StrategyCard
                key={r.label}
                row={r}
                mode={view === "own" ? ownMode(r).mode : view}
                ownView={view === "own"}
                borrowed={view === "own" && ownMode(r).borrowed}
                all={strategies}
                sortBy={sortBy}
                includes={includesOf.get(r.label.toLowerCase()) ?? []}
                busy={busy}
                selecting={selecting}
                selected={picked.has(r.label)}
                onToggle={() => toggle(r.label)}
                onMerge={(into) => merge.mutate({ from: r.label, into })}
                onDelete={() => deleteStrategy(r)}
                bet={betOf(r.label)}
                settings={sending.data?.settings}
                bank={sending.data?.bank}
                check={checks.get(r.label.toLowerCase())}
                advice={adviceOf.get(r.label.toLowerCase())}
                last7={weeksData.data?.strategies[r.label.toLowerCase()]?.last7[view === "own" ? ownMode(r).mode : view]}
                prev28={weeksData.data?.strategies[r.label.toLowerCase()]?.prev28[view === "own" ? ownMode(r).mode : view]}
              />
            );
            const byKey = new Map(group.map((r) => [r.label.toLowerCase(), r]));
            return (
              <section key={m} className="space-y-3">
                <div>
                  <h3 className="text-base font-semibold text-ink">
                    {m === "live" ? "Live strategies" : "Simulation strategies"}{" "}
                    <span className="text-sm font-normal text-ink-muted">· {group.length}</span>
                  </h3>
                  <p className="text-xs text-ink-muted">
                    {m === "live"
                      ? "New picks are bet with real money, at each strategy's stake."
                      : "New picks are recorded and settled as if bet, but no money is placed. Switch one to Live with its Sim / Live switch."}
                  </p>
                </div>
                {layout === "weekly" ? (
                  <StrategyWeekly
                    rows={group}
                    data={weeksData.data}
                    modeOf={(label) => (label === "__all__" ? (view === "own" ? "all" : view) : view === "own" ? ownMode(byKey.get(label.toLowerCase())!).mode : view)}
                    renderCard={(key) => (byKey.has(key) ? renderCard(byKey.get(key)!) : null)}
                    showTotal={m === "sim"}
                    sliceLabels={Object.fromEntries(strategies.flatMap((x) => (x.returns?.segments ?? []).map((s) => [`${x.label.toLowerCase()}#${s.id}`, s.label])))}
                  />
                ) : (
                <ul className="space-y-2">{group.filter((r) => hasPicks(r, m)).map(renderCard)}</ul>
                )}
                {/* No alert for 14 days (retired or deleted in InPlayGuru): out of the way, record kept. */}
                {m === "sim" && inactive.length > 0 && (
                  <details className="rounded-xl border border-line bg-surface p-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink">
                      Inactive <span className="font-normal text-ink-muted">· {inactive.length} · no alerts for {INACTIVE_DAYS}+ days</span>
                    </summary>
                    <ul className="mt-2 space-y-2">{inactive.map(renderCard)}</ul>
                  </details>
                )}
                {layout === "cards" && group.some((r) => !hasPicks(r, m)) && (
                  <details className="rounded-xl border border-line bg-surface p-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink">
                      No data yet <span className="font-normal text-ink-muted">· {group.filter((r) => !hasPicks(r, m)).length}</span>
                    </summary>
                    <p className="mt-1 text-xs text-ink-muted">Nothing settled in this period, so there is no return to rank.</p>
                    <ul className="mt-2 space-y-2">{group.filter((r) => !hasPicks(r, m)).map(renderCard)}</ul>
                  </details>
                )}
              </section>
            );
          })}

          {ignored.length > 0 && (
            <section className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-ink">Ignored strategies</h3>
                  <p className="mt-0.5 text-xs text-ink-muted">New alerts with these names are dropped on arrival, so they never come back.</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void clearIgnored()}
                  className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-destructive hover:bg-surface-2 disabled:opacity-50"
                >
                  Clear list
                </button>
              </div>
              <ul className="mt-2 divide-y divide-line">
                {ignored.map((name) => (
                  <li key={name} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 break-words text-sm text-ink">{name}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => ignore.mutate({ label: name, ignored: false })}
                      className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
                    >
                      Stop ignoring
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
