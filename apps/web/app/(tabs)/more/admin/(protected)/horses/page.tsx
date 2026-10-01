"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, HeroStat, PageHeader, Segmented, moneyTone } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { gbp } from "@/lib/format";
import { useHorseBets, useSaveHorseDay, useSetHorseResult, type HorseBet, type HorseDay, type HorseEntryInput } from "@/queries/use-horses";
import {
  RANK_LABEL,
  RANKS,
  byOddsBand,
  byRank,
  byType,
  byWeekday,
  inPeriod,
  longestLosingRun,
  moneyOf,
  fromZero,
  monthsWithBets,
  placeOdds,
  series,
  summarise,
  todayUk,
  yankees,
  YANKEE_BET_COUNT,
  type YankeeMoney,
  type Grain,
  type Preset,
  type Summary,
} from "@/lib/horses";
import { ByChoiceChart, PeriodProfitChart, RunningProfitChart } from "@/components/horses/HorseCharts";

const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const monthFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", year: "numeric" });
const dayLabel = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`));
const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 1000) / 10}%`);
const roiText = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n * 1000) / 10)}%`);
const TONE = { hit: "text-hit", loss: "text-loss", muted: "text-ink-muted" };
const inputCls = "w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink";

/** Decimal odds from what's typed, for the preview under the box (the engine does the real check). */
function previewOdds(v: string): number | null {
  const s = v.trim().toLowerCase();
  if (/^(evens|evs|even|ev)$/.test(s)) return 2;
  const f = /^(\d+(?:\.\d+)?)\s*[/-]\s*(\d+(?:\.\d+)?)$/.exec(s);
  const n = f ? 1 + Number(f[1]) / Number(f[2]) : Number(s);
  return s && Number.isFinite(n) && n >= 1.01 ? n : null;
}

type Row = { horse: string; stake: string; odds: string; betType: "win" | "ew"; ewFraction: number; ewPlaces: string };
const EMPTY: Row = { horse: "", stake: "", odds: "", betType: "win", ewFraction: 4, ewPlaces: "" };

function rowsFor(bets: HorseBet[], day: string): Record<number, Row> {
  const out: Record<number, Row> = { 1: { ...EMPTY }, 2: { ...EMPTY }, 3: { ...EMPTY }, 4: { ...EMPTY } };
  for (const b of bets) {
    if (b.day !== day) continue;
    out[b.rank] = {
      horse: b.horse ?? "",
      stake: String(b.stake),
      odds: b.oddsText,
      betType: b.betType,
      ewFraction: b.ewFraction ?? 4,
      ewPlaces: b.ewPlaces === null ? "" : String(b.ewPlaces),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry

function EntryCard({ bets, days, day, setDay }: { bets: HorseBet[]; days: HorseDay[]; day: string; setDay: (d: string) => void }) {
  const save = useSaveHorseDay();
  const [rows, setRows] = useState<Record<number, Row>>(() => rowsFor(bets, day));
  // The EW Yankee on the four selections: its unit stake, or "" for none.
  const yankeeFor = (d: string) => {
    const s = days.find((x) => x.day === d)?.yankeeStake;
    return s === null || s === undefined ? "" : String(s);
  };
  const [yankee, setYankee] = useState(() => yankeeFor(day));
  const [yankeeOn, setYankeeOn] = useState(() => yankeeFor(day) !== "");
  const [saved, setSaved] = useState(false);
  // Load that day's saved choices whenever the date changes (or after a save, from the refreshed list).
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loadedFor.current === day) return;
    loadedFor.current = day;
    setRows(rowsFor(bets, day));
    const y = days.find((x) => x.day === day)?.yankeeStake;
    setYankee(y === null || y === undefined ? "" : String(y));
    setYankeeOn(y !== null && y !== undefined);
  }, [bets, days, day]);

  const set = (rank: number, patch: Partial<Row>) => {
    setSaved(false);
    setRows((r) => ({ ...r, [rank]: { ...r[rank]!, ...patch } }));
  };
  const unit = Number(yankee.replace(/^£/, ""));
  const yankeeCost = yankeeOn && Number.isFinite(unit) && unit > 0 ? unit * YANKEE_BET_COUNT : 0;
  const outlay =
    RANKS.reduce((n, r) => {
      const s = Number(rows[r]!.stake.replace(/^£/, ""));
      return n + (Number.isFinite(s) && s > 0 ? s * (rows[r]!.betType === "ew" ? 2 : 1) : 0);
    }, 0) + yankeeCost;

  function submit() {
    const entries: HorseEntryInput[] = RANKS.map((rank) => {
      const r = rows[rank]!;
      // Place terms go with an each-way single, and with every selection when there's a Yankee (its place part uses them).
      const terms = r.betType === "ew" || yankeeOn;
      return { rank, horse: r.horse, stake: r.stake, odds: r.odds, betType: r.betType, ewFraction: terms ? r.ewFraction : null, ewPlaces: r.ewPlaces };
    });
    save.mutate({ day, entries, yankeeStake: yankeeOn ? yankee : null }, { onSuccess: () => setSaved(true) });
  }

  return (
    <Card
      title={day === todayUk() ? "Today’s bets" : `Bets for ${dayLabel(day)}`}
      subtitle="Enter your four choices. Odds can be a fraction (5/2), evens, or a decimal (3.5). Each-way stakes are per part, so £5 EW costs £10. Leave a row empty to skip it."
    >
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          Date
          <input
            type="date"
            value={day}
            max={todayUk()}
            onChange={(e) => {
              if (e.target.value) {
                setDay(e.target.value);
                setSaved(false);
              }
            }}
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink"
          />
        </label>

        {RANKS.map((rank) => {
          const r = rows[rank]!;
          const dec = previewOdds(r.odds);
          return (
            <fieldset key={rank} className="rounded-lg border border-line p-2.5">
              <legend className="px-1 text-xs font-semibold text-ink">{RANK_LABEL[rank]}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <label className="col-span-2 text-xs text-ink-muted sm:col-span-1">
                  Horse (optional)
                  <input className={`${inputCls} mt-1`} value={r.horse} onChange={(e) => set(rank, { horse: e.target.value })} />
                </label>
                <label className="text-xs text-ink-muted">
                  Bet amount (£)
                  <input inputMode="decimal" className={`${inputCls} mt-1 tabular-nums`} value={r.stake} onChange={(e) => set(rank, { stake: e.target.value })} />
                </label>
                <label className="text-xs text-ink-muted">
                  Odds
                  <input className={`${inputCls} mt-1 tabular-nums`} placeholder="5/2" value={r.odds} onChange={(e) => set(rank, { odds: e.target.value })} />
                  <span className="mt-0.5 block h-4 text-[12px] tabular-nums">{r.odds && (dec ? `= ${dec.toFixed(2)}` : <span className="text-warn">Not a price</span>)}</span>
                </label>
                <div className="col-span-2 text-xs text-ink-muted sm:col-span-1">
                  Bet
                  <Segmented
                    label={`${RANK_LABEL[rank]}: win or each-way`}
                    value={r.betType}
                    onChange={(v) => set(rank, { betType: v })}
                    className="mt-1 flex w-max"
                    options={[
                      { value: "win", label: "Win" },
                      { value: "ew", label: "EW" },
                    ]}
                  />
                </div>
              </div>
              {(r.betType === "ew" || yankeeOn) && (
                <div className="mt-2 flex flex-wrap items-end gap-3 text-xs text-ink-muted">
                  {r.betType === "win" && <span className="w-full">Place terms for the EW Yankee (this single is win only):</span>}
                  <label>
                    Place terms
                    <select
                      value={r.ewFraction}
                      onChange={(e) => set(rank, { ewFraction: Number(e.target.value) })}
                      className="mt-1 block rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink"
                    >
                      <option value={4}>1/4 odds</option>
                      <option value={5}>1/5 odds</option>
                      <option value={3}>1/3 odds</option>
                    </select>
                  </label>
                  <label>
                    Places paid
                    <input inputMode="numeric" placeholder="e.g. 3" className={`${inputCls} mt-1 w-20`} value={r.ewPlaces} onChange={(e) => set(rank, { ewPlaces: e.target.value })} />
                  </label>
                  {dec && <span className="pb-2 tabular-nums">Place pays {placeOdds(dec, r.ewFraction).toFixed(2)}</span>}
                </div>
              )}
            </fieldset>
          );
        })}

        <fieldset className="rounded-lg border border-line p-2.5">
          <legend className="px-1 text-xs font-semibold text-ink">EW Yankee</legend>
          <label className="flex items-center gap-2 text-xs text-ink">
            <input type="checkbox" checked={yankeeOn} onChange={(e) => (setYankeeOn(e.target.checked), setSaved(false))} style={{ accentColor: "var(--accent)" }} className="h-4 w-4" />
            Also an each-way Yankee on these four
          </label>
          {yankeeOn && (
            <div className="mt-2 flex flex-wrap items-end gap-3 text-xs text-ink-muted">
              <label>
                Unit stake (£)
                <input inputMode="decimal" className={`${inputCls} mt-1 w-24 tabular-nums`} value={yankee} onChange={(e) => (setYankee(e.target.value), setSaved(false))} />
              </label>
              <span className="pb-2 tabular-nums">
                {YANKEE_BET_COUNT} bets{yankeeCost > 0 && ` × £${unit.toFixed(2)} = £${yankeeCost.toFixed(2)}`}: 6 doubles, 4 trebles and a fourfold, each to win and to place.
              </span>
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={submit} disabled={save.isPending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50">
            {save.isPending ? "Saving…" : "Save day"}
          </button>
          <span className="text-xs tabular-nums text-ink-muted">Total outlay £{outlay.toFixed(2)}</span>
          {saved && !save.isPending && <span className="text-xs text-hit">Saved.</span>}
        </div>
        {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The daily record

function ResultButtons({ bet, yankeeDay }: { bet: HorseBet; yankeeDay: boolean }) {
  const set = useSetHorseResult();
  const options: Array<{ value: HorseBet["result"]; label: string; cls: string }> = [
    { value: "won", label: "Won", cls: "bg-hit text-app" },
    // Placed matters for an each-way single, and for every selection when the day has a Yankee (its place part).
    ...(bet.betType === "ew" || yankeeDay ? [{ value: "placed" as const, label: "Placed", cls: "bg-hit/40 text-ink" }] : []),
    { value: "lost", label: "Lost", cls: "bg-loss text-app" },
    { value: "void", label: "Void", cls: "bg-ink-muted text-app" },
  ];
  return (
    <div role="radiogroup" aria-label={`Result for ${RANK_LABEL[bet.rank]}`} className="inline-flex gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => {
        const on = bet.result === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            // Tapping the chosen result again puts the bet back to not marked.
            onClick={() => set.mutate({ id: bet.id, result: on ? "pending" : o.value })}
            className={`rounded-md px-2 py-1 text-xs font-medium ${on ? o.cls : "text-ink-muted hover:text-ink"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function DayRecord({ day, bets, yankee, onEdit }: { day: string; bets: HorseBet[]; yankee: YankeeMoney | null; onEdit: () => void }) {
  const s = summarise(bets, yankee ? [yankee] : []);
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink">{dayLabel(day)}</p>
        <p className="text-xs tabular-nums text-ink-muted">
          £{s.staked.toFixed(2)} staked ·{" "}
          {s.settled === 0 ? "not marked yet" : <span className={TONE[moneyTone(s.profit)]}>{gbp(s.profit)}</span>}
          {s.pending > 0 && s.settled > 0 && ` · ${s.pending} to mark`}
          {" · "}
          <button type="button" onClick={onEdit} className="underline">
            Edit
          </button>
        </p>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {bets.map((b) => {
          const m = moneyOf(b);
          return (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 text-xs">
                <span className="font-semibold text-ink">{RANK_LABEL[b.rank]}</span>
                {b.horse && <span className="text-ink"> · {b.horse}</span>}
                <span className="block tabular-nums text-ink-muted">
                  £{b.stake.toFixed(2)}
                  {b.betType === "ew" ? ` EW (1/${b.ewFraction}${b.ewPlaces ? `, ${b.ewPlaces} places` : ""})` : " win"} @ {b.oddsText}
                  {m.profit !== null && <span className={TONE[moneyTone(m.profit)]}> · {gbp(m.profit)}</span>}
                </span>
              </span>
              <ResultButtons bet={b} yankeeDay={yankee !== null} />
            </li>
          );
        })}
        {yankee && (
          <li className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-xs">
            <span>
              <span className="font-semibold text-ink">EW Yankee</span>
              <span className="tabular-nums text-ink-muted">
                {" "}
                · £{yankee.unit.toFixed(2)} × {YANKEE_BET_COUNT} = £{yankee.cost.toFixed(2)}
              </span>
            </span>
            <span className="tabular-nums text-ink-muted">
              {yankee.profit === null ? (
                "settles when all four are marked"
              ) : (
                <>
                  win £{yankee.winPart!.toFixed(2)} + place £{yankee.placePart!.toFixed(2)} back ·{" "}
                  <span className={TONE[moneyTone(yankee.profit)]}>{gbp(yankee.profit)}</span>
                </>
              )}
            </span>
          </li>
        )}
      </ul>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Analysis

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "all", label: "All" },
  { value: "custom", label: "Pick months" },
];

function SummaryTable({ rows, first }: { rows: Array<{ label: string; summary: Summary }>; first: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-ink-muted">
            <th className="py-1.5 pr-2 font-medium">{first}</th>
            <th className="px-2 font-medium">Bets</th>
            <th className="px-2 font-medium">Won–Placed–Lost</th>
            <th className="hidden px-2 font-medium sm:table-cell">Strike</th>
            <th className="hidden px-2 font-medium sm:table-cell">Staked</th>
            <th className="px-2 text-right font-medium">Profit</th>
            <th className="pl-2 text-right font-medium">Per £1</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums">
          {rows.map(({ label, summary: s }) => (
            <tr key={label}>
              <td className="py-1.5 pr-2 text-ink">{label}</td>
              <td className="px-2 text-ink">{s.bets}</td>
              <td className="px-2 text-ink">
                {/* A Yankee isn't won or lost as one bet: show how many have settled instead. */}
                {s.bets === s.yankees ? (
                  <span className="text-ink-muted">{s.settled} settled</span>
                ) : (
                  <>
                    {s.won}–{s.placed}–{s.lost}
                    {s.pending > 0 && <span className="text-ink-muted"> ({s.pending} open)</span>}
                  </>
                )}
              </td>
              <td className="hidden px-2 text-ink sm:table-cell">{pct(s.strike)}</td>
              <td className="hidden px-2 text-ink sm:table-cell">£{s.staked.toFixed(2)}</td>
              <td className={`px-2 text-right ${TONE[moneyTone(s.profit)]}`}>{s.settled === 0 ? "–" : gbp(s.profit)}</td>
              <td className={`pl-2 text-right ${s.roi === null ? "text-ink-muted" : TONE[moneyTone(s.roi)]}`}>{roiText(s.roi)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Analysis({ bets, allYankees }: { bets: HorseBet[]; allYankees: YankeeMoney[] }) {
  const [preset, setPreset] = useState<Preset>("all");
  const [months, setMonths] = useState<Set<string>>(new Set());
  const [grain, setGrain] = useState<Grain>("day");
  const today = todayUk();
  const available = useMemo(() => monthsWithBets(bets), [bets]);
  const chosen = useMemo(() => bets.filter((b) => inPeriod(b.day, preset, months, today)), [bets, preset, months, today]);
  const yk = useMemo(() => allYankees.filter((y) => inPeriod(y.day, preset, months, today)), [allYankees, preset, months, today]);
  const s = summarise(chosen, yk);
  const points = useMemo(() => series(chosen, grain, yk), [chosen, grain, yk]);
  const rankRows = byRank(chosen).map((x) => ({ label: RANK_LABEL[x.rank], summary: x.summary }));
  const run = longestLosingRun(chosen);
  const best = [...rankRows].filter((r) => r.summary.roi !== null).sort((a, b) => (b.summary.roi ?? 0) - (a.summary.roi ?? 0));
  const days = useMemo(() => series(chosen, "day", yk), [chosen, yk]);
  const bestDay = [...days].sort((a, b) => b.profit - a.profit)[0];
  const worstDay = [...days].sort((a, b) => a.profit - b.profit)[0];

  const toggleMonth = (m: string) =>
    setMonths((cur) => {
      const next = new Set(cur);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });

  return (
    <section className="space-y-4" aria-label="Results">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="Period" value={preset} onChange={setPreset} options={PRESETS} />
          <Segmented
            label="Chart by"
            value={grain}
            onChange={setGrain}
            options={[
              { value: "day", label: "Daily" },
              { value: "week", label: "Weekly" },
              { value: "month", label: "Monthly" },
            ]}
          />
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Months to include">
            {available.length === 0 && <p className="text-xs text-ink-muted">Months appear here once you have bets in them.</p>}
            {available.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={months.has(m)}
                onClick={() => toggleMonth(m)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${months.has(m) ? "border-accent bg-accent text-accent-ink" : "border-line text-ink hover:bg-surface-2"}`}
              >
                {monthFmt.format(new Date(`${m}-15T12:00:00Z`))}
              </button>
            ))}
          </div>
        )}
      </div>

      {chosen.length === 0 ? (
        <p className="text-sm text-ink-muted">No bets in this period{preset === "custom" && months.size === 0 ? ": pick one or more months above" : ""}.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <HeroStat label="Profit" tone={moneyTone(s.profit)} value={s.settled === 0 ? "–" : gbp(s.profit)} sub={s.pending > 0 ? `${s.pending} bet${s.pending === 1 ? "" : "s"} still to mark` : `${s.settled} settled`} />
            <HeroStat
              label="Staked"
              value={`£${s.staked.toFixed(2)}`}
              sub={`${s.bets - s.yankees} single${s.bets - s.yankees === 1 ? "" : "s"}${s.yankees > 0 ? ` + ${s.yankees} Yankee${s.yankees === 1 ? "" : "s"}` : ""}`}
            />
            <HeroStat label="Returned" value={`£${s.returns.toFixed(2)}`} sub="winnings plus stakes back" />
            <HeroStat label="Return per £1" tone={s.roi === null ? "muted" : moneyTone(s.roi)} value={roiText(s.roi)} sub="profit on settled stakes" />
            <HeroStat label="Strike rate" value={pct(s.strike)} sub={`${s.won} won of ${s.won + s.placed + s.lost}`} />
            <HeroStat label="Average odds" value={s.avgOdds === null ? "–" : s.avgOdds.toFixed(2)} sub={s.avgWinOdds === null ? "no winners yet" : `winners ${s.avgWinOdds.toFixed(2)}`} />
          </div>

          <Card title="Running profit" subtitle="Singles and Yankees, settled only; open bets join when you mark them.">
            {points.length === 0 ? <p className="text-xs text-ink-muted">Mark some results to see the line.</p> : <RunningProfitChart points={fromZero(points)} />}
          </Card>
          <Card title={`Profit by ${grain}`}>
            {points.length === 0 ? <p className="text-xs text-ink-muted">Nothing settled yet.</p> : <PeriodProfitChart points={points} />}
          </Card>
          <Card title="Which choice is paying" subtitle="Running profit for your NAP, Next best, 3rd and 4th choice as singles (Yankees are in Patterns, by bet type).">
            {points.length === 0 ? <p className="text-xs text-ink-muted">Nothing settled yet.</p> : <ByChoiceChart points={fromZero(points)} />}
            <div className="mt-3">
              <SummaryTable rows={rankRows} first="Choice" />
            </div>
          </Card>

          <Card title="Patterns">
            <ul className="mb-3 space-y-1 text-xs text-ink">
              {best.length > 0 && (
                <li>
                  Best choice: <strong>{best[0]!.label}</strong> ({roiText(best[0]!.summary.roi)} per £1)
                  {best.length > 1 && (
                    <>
                      ; weakest: <strong>{best[best.length - 1]!.label}</strong> ({roiText(best[best.length - 1]!.summary.roi)})
                    </>
                  )}
                  .
                </li>
              )}
              {run.length > 0 && (
                <li>
                  Longest losing run: <strong>{run.length}</strong> bets in a row{run.endedOn && `, ending ${dayLabel(run.endedOn)}`}.
                </li>
              )}
              {bestDay && bestDay.profit > 0 && (
                <li>
                  Best day: <strong>{dayLabel(bestDay.key)}</strong> <span className="text-hit">{gbp(bestDay.profit)}</span>
                  {worstDay && worstDay.profit < 0 && (
                    <>
                      ; worst: <strong>{dayLabel(worstDay.key)}</strong> <span className="text-loss">{gbp(worstDay.profit)}</span>
                    </>
                  )}
                  .
                </li>
              )}
              {s.placeRate !== null && (
                <li>
                  Each-way bets placed or won <strong>{pct(s.placeRate)}</strong> of the time.
                </li>
              )}
            </ul>
            <div className="space-y-4">
              <SummaryTable rows={byOddsBand(chosen)} first="Odds" />
              <SummaryTable rows={byType(chosen, yk)} first="Bet type" />
              <SummaryTable rows={byWeekday(chosen)} first="Day" />
            </div>
          </Card>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

export default function HorsesPage() {
  const { data, isLoading, error } = useHorseBets();
  const [day, setDay] = useState(() => todayUk());
  const [showDays, setShowDays] = useState(7);
  const entryRef = useRef<HTMLDivElement>(null);
  const bets = useMemo(() => data?.bets ?? [], [data]);
  const days = useMemo(() => data?.days ?? [], [data]);
  const allYankees = useMemo(() => yankees(days, bets), [days, bets]);
  const byDay = useMemo(() => {
    const m = new Map<string, HorseBet[]>();
    for (const b of [...bets].sort((a, c) => c.day.localeCompare(a.day) || a.rank - c.rank)) (m.get(b.day) ?? m.set(b.day, []).get(b.day)!).push(b);
    return [...m.entries()];
  }, [bets]);
  const toMark = bets.filter((b) => b.result === "pending").length;

  return (
    <div className="space-y-6">
      <PageHeader
        as="h2"
        title="Horses"
        subtitle="Your daily NAP and choices, their results, and what’s paying over time. Entered by hand; nothing here is sent to your betting software."
      />

      {error ? (
        <QueryError error={error} next="/more/admin/horses" />
      ) : isLoading || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          <div ref={entryRef}>
            <EntryCard bets={bets} days={days} day={day} setDay={setDay} />
          </div>

          <section className="space-y-2" aria-label="Daily record">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold text-ink">Daily record</h3>
              {toMark > 0 && <span className="text-xs text-warn">{toMark} result{toMark === 1 ? "" : "s"} to mark</span>}
            </div>
            {byDay.length === 0 ? (
              <p className="text-sm text-ink-muted">Your saved days will appear here, with a button to mark each result.</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {byDay.slice(0, showDays).map(([d, list]) => (
                    <DayRecord
                      key={d}
                      day={d}
                      bets={list}
                      yankee={allYankees.find((y) => y.day === d) ?? null}
                      onEdit={() => {
                        setDay(d);
                        entryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    />
                  ))}
                </ul>
                {byDay.length > showDays && (
                  <button type="button" onClick={() => setShowDays((n) => n + 14)} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2">
                    Show older days
                  </button>
                )}
              </>
            )}
          </section>

          <div className="space-y-2">
            <h3 className="text-base font-semibold text-ink">How it’s going</h3>
            <Analysis bets={bets} allYankees={allYankees} />
          </div>
        </>
      )}
    </div>
  );
}
