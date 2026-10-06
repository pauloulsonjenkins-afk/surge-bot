"use client";

/** Horses: "How it's going" — results, charts and patterns over a chosen period. */

import { useMemo, useState } from "react";
import { Card, HeroStat, Segmented, moneyTone } from "@/components/ui/Card";
import { gbp } from "@/lib/format";
import { type HorseBet } from "@/queries/use-horses";
import {
  RANK_LABEL,
  byCourse,
  byOddsBand,
  byRank,
  byType,
  byWeekday,
  inPeriod,
  longestLosingRun,
  fromZero,
  monthsWithBets,
  series,
  summarise,
  todayUk,
  yankees,
  type YankeeMoney,
  type Grain,
  type Preset,
  type Summary,
} from "@/lib/horses";
import { ByChoiceChart, CourseChart, PeriodProfitChart, RunningProfitChart } from "@/components/horses/HorseCharts";


const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const monthFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", year: "numeric" });
const dayLabel = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`));
const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 1000) / 10}%`);
const roiText = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n * 1000) / 10)}%`);
const TONE = { hit: "text-hit", loss: "text-loss", muted: "text-ink-muted" };

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

export function Analysis({ bets, allYankees }: { bets: HorseBet[]; allYankees: YankeeMoney[] }) {
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
  const courseRows = useMemo(() => byCourse(chosen), [chosen]);
  const noCourse = chosen.filter((b) => !b.course).length;
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

          <Card
            title="Racecourses"
            subtitle={`Profit at each course you've bet at, best first. Hover or tap a bar for return per £1 and wins.${noCourse > 0 ? ` ${noCourse} bet${noCourse === 1 ? "" : "s"} in this period ${noCourse === 1 ? "has" : "have"} no course entered.` : ""}`}
          >
            {courseRows.length === 0 ? (
              <p className="text-xs text-ink-muted">Add a racecourse to your bets to see which tracks you do well at.</p>
            ) : (
              <>
                <CourseChart rows={courseRows} />
                <div className="mt-3">
                  <SummaryTable rows={courseRows} first="Racecourse" />
                </div>
              </>
            )}
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

