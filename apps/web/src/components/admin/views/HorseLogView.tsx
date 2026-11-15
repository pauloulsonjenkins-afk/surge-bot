"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useHorseBets, type HorseBet, type HorseTipLogEntry, type HorseTipResult } from "@/queries/use-horses";

const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const dayLabel = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`));
const RANK: Record<number, string> = { 1: "NAP", 2: "Next best", 3: "Extra", 4: "Extra" };

const RESULT: Record<HorseBet["result"], { text: string; tone: string }> = {
  won: { text: "Won", tone: "text-hit" },
  placed: { text: "Placed", tone: "text-hit" },
  lost: { text: "Lost", tone: "text-loss" },
  void: { text: "Void", tone: "text-ink-muted" },
  pending: { text: "Bet, result to mark", tone: "text-warn" },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Every horse the daily fetch has found, newest day first, with what happened if a bet was saved on it. */
export default function HorseLogPage() {
  const { data, isLoading, error } = useHorseBets();
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(14);

  // A saved bet on the same day and horse says what became of the tip; a tip with no bet was not taken.
  const rows = useMemo(() => {
    const bets = data?.bets ?? [];
    const results = new Map((data?.tipResults ?? []).map((r) => [`${r.day}|${r.rank}`, r]));
    return (data?.tipLog ?? []).map((t) => ({ tip: t, bet: bets.find((b) => b.day === t.day && b.horse && norm(b.horse) === norm(t.horse)) ?? null, outcome: results.get(`${t.day}|${t.rank}`) ?? null }));
  }, [data]);

  const q = norm(search);
  const filtered = useMemo(() => (q ? rows.filter((r) => norm(r.tip.horse).includes(q) || norm(r.tip.course ?? "").includes(q)) : rows), [rows, q]);
  const byDay = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const r of filtered) (m.get(r.tip.day) ?? m.set(r.tip.day, []).get(r.tip.day)!).push(r);
    return [...m.entries()];
  }, [filtered]);

  const total = rows.length;
  const taken = rows.filter((r) => r.bet).length;
  const won = rows.filter((r) => r.bet && (r.bet.result === "won" || r.bet.result === "placed")).length;
  const settled = rows.filter((r) => r.bet && r.bet.result !== "pending" && r.bet.result !== "void").length;
  // Every tip, bet or not, at level stakes and the starting price (the engine works out each tip's points).
  const priced = rows.filter((r) => r.outcome?.points);
  const staked = priced.reduce((s, r) => s + r.outcome!.points!.staked, 0);
  const profit = priced.reduce((s, r) => s + r.outcome!.points!.profit, 0);
  const winners = rows.filter((r) => r.outcome?.result === "won").length;
  const looked = rows.filter((r) => r.outcome && r.outcome.result !== "not found").length;

  return (
    <div className="space-y-6">
      <PageHeader
        as="h2"
        title="Horse log"
        subtitle={
          <>
            Every tipped horse, day by day, kept for good, and what became of each one.{" "}
            <Link href="/more/admin/horses" className="text-accent underline">
              Today’s bets
            </Link>
          </>
        }
      />

      {error ? (
        <QueryError error={error} next="/more/admin/horses?tab=log" />
      ) : isLoading || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : total === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing yet. Each day’s tipped horses appear here once they come in. {data.importStatus && !data.importStatus.ok ? `The last update failed: ${data.importStatus.message}` : ""}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Horses logged", String(total)],
              ["Bets you took", `${taken}`],
              ["Won or placed", settled > 0 ? `${won} of ${settled}` : "–"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-line bg-surface p-3">
                <p className="text-lg font-semibold tabular-nums text-ink">{value}</p>
                <p className="text-xs text-ink-muted">{label}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-line bg-surface p-3">
            <p className="text-sm font-medium text-ink">Every tip, as if each had been bet (level stakes)</p>
            {priced.length === 0 ? (<p className="mt-1 text-xs text-ink-muted">Results are read from Betfair&apos;s starting-price files once a day&apos;s racing is over. None yet.</p>) : (<>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${profit >= 0 ? "text-hit" : "text-loss"}`}>{profit >= 0 ? "+" : ""}{profit.toFixed(2)} points <span className="text-xs font-normal text-ink-muted">on {staked} staked ({staked > 0 ? `${profit >= 0 ? "+" : ""}${((profit / staked) * 100).toFixed(1)}%` : "–"})</span></p>
              <p className="text-xs text-ink-muted">{winners} winners from {looked} horses found. 1 point to win, or 1 each way, at Betfair starting price less 5% commission. This is the tips&apos; own record, not what your bets returned.</p>
            </>)}
          </div>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a horse or course"
            aria-label="Search the horse log"
            className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
          />

          {byDay.length === 0 ? (
            <p className="text-sm text-ink-muted">No horse or course matches “{search}”.</p>
          ) : (
            <ul className="space-y-3">
              {byDay.slice(0, q ? byDay.length : shown).map(([day, list]) => (
                <li key={day}>
                  <Card title={dayLabel(day)}>
                    <ul className="divide-y divide-line">
                      {list.map(({ tip, bet, outcome }) => (
                        <TipRow key={`${tip.day}-${tip.rank}`} tip={tip} bet={bet} outcome={outcome} />
                      ))}
                    </ul>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {!q && byDay.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + 14)} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2">
              Show older days
            </button>
          )}
        </>
      )}
    </div>
  );
}

function TipRow({ tip, bet, outcome }: { tip: HorseTipLogEntry; bet: HorseBet | null; outcome: HorseTipResult | null }) {
  const result = bet ? RESULT[bet.result] : null;
  return (
    <li className="flex items-baseline justify-between gap-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm text-ink">
          {tip.horse} <span className="text-xs text-ink-muted">· {RANK[tip.rank] ?? `Pick ${tip.rank}`}</span>
        </span>
        <span className="text-xs text-ink-muted">
          {tip.course ?? "Course not known"}
          {tip.raceTime ? ` ${tip.raceTime}` : ""}
          {tip.oddsText ? ` · ${tip.oddsText}` : ""}
          {tip.betType === "ew" ? ` · each-way${tip.ewPlaces ? `, ${tip.ewPlaces} places` : ""}` : ""}
          {outcome && outcome.result !== "not found" ? ` · ${outcome.result === "won" ? "Won" : outcome.placed ? "Placed" : "Lost"}${outcome.bsp ? ` at SP ${outcome.bsp.toFixed(2)}` : ""}` : outcome ? " · not in Betfair's files" : ""}
        </span>
      </span>
      <span className={`shrink-0 text-xs font-medium ${result ? result.tone : "text-ink-muted"}`}>{result ? result.text : "Not bet"}</span>
    </li>
  );
}
