"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, Segmented } from "@/components/ui/Card";
import { useAdminStrategies, type AdminStrategy, type StrategyReturn } from "@/queries/use-strategies";
import { useStrategyNames } from "@/queries/use-strategy-names";
import { gbp, signedPct, toneOf } from "@/lib/format";

type Mode = "live" | "sim";

/** A Sim strategy's longer record must be at least this long, and making money, before a good day counts for anything. */
const RECORD_MIN = 50;
/** And today must be more than a couple of bets. */
const DAY_MIN = 5;

/**
 * Whether a Sim strategy's good day is worth acting on. One day is mostly luck, so a good day only earns "worth a look"
 * when its longer Sim record (since its rules last changed) is also making money over 50+ picks.
 */
function verdict(r: AdminStrategy, day: StrategyReturn): { kind: "look" | "wait" | null; text: string } {
  if (r.sendingOn || day.counted < DAY_MIN || day.profit <= 0) return { kind: null, text: "" };
  const sim = r.returns?.sim;
  if (sim && sim.counted >= RECORD_MIN && sim.roi !== null && sim.roi > 0)
    return { kind: "look", text: `Good day, and ${signedPct(sim.roi)} per £1 over ${sim.counted} Sim picks: worth a look for Live.` };
  return {
    kind: "wait",
    text: sim && sim.counted > 0 ? `Good day, but its longer record is ${signedPct(sim.roi)} over ${sim.counted} picks: wait.` : "Good day, but no longer record yet: wait.",
  };
}

/**
 * Today, strategy by strategy (folded in from the old /more/admin/day page, 27 Oct 2026 tidy-up): Live (real money) or
 * Sim (what the picks would have made), each with its bets, wins, profit and return so far today (UK day). Sim
 * strategies having a good day that their longer record backs up are marked "worth a look for Live".
 */
export function TodayByStrategy() {
  const { data, error, isLoading } = useAdminStrategies();
  const names = useStrategyNames();
  const [mode, setMode] = useState<Mode>("live");
  const [open, setOpen] = useState(false);

  const rows = (data?.strategies ?? [])
    .map((r) => ({ r, day: r.today?.[mode] }))
    .filter((x): x is { r: AdminStrategy; day: StrategyReturn } => !!x.day && x.day.settled > 0)
    .sort((a, b) => b.day.profit - a.day.profit);
  const total = rows.reduce((t, x) => ({ n: t.n + x.day.counted, won: t.won + (x.day.pricedHits ?? x.day.hits ?? 0), staked: t.staked + x.day.staked, profit: t.profit + x.day.profit }), {
    n: 0,
    won: 0,
    staked: 0,
    profit: 0,
  });
  const looks = mode === "sim" ? rows.filter((x) => verdict(x.r, x.day).kind === "look") : [];

  if (error || isLoading || !data) return null;

  return (
    <Card
      title={
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
          <span>By strategy today</span>
          <span className="text-xs font-normal text-ink-muted">
            {total.n > 0 ? `${total.won}–${total.n - total.won} · ${gbp(total.profit)}` : "nothing settled yet"} {open ? "▲" : "▼"}
          </span>
        </button>
      }
    >
      {open && (
        <div className="space-y-3">
          <Segmented label="Show" value={mode} onChange={setMode} options={[{ value: "live", label: "Live" }, { value: "sim", label: "Sim" }]} />

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-line bg-surface p-3">
              <p className="text-xs text-ink-muted">{mode === "live" ? "Profit today" : "Sim today"}</p>
              <p className={`font-display text-xl font-bold tabular-nums ${toneOf(total.profit)}`}>{gbp(total.profit)}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-3">
              <p className="text-xs text-ink-muted">Bets</p>
              <p className="font-display text-xl font-bold tabular-nums text-ink">
                {total.won}–{total.n - total.won}
              </p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-3">
              <p className="text-xs text-ink-muted">Per £1</p>
              <p className={`font-display text-xl font-bold tabular-nums ${toneOf(total.staked ? total.profit / total.staked : null)}`}>
                {total.staked ? signedPct(total.profit / total.staked) : "–"}
              </p>
            </div>
          </div>

          {mode === "sim" && looks.length > 0 && (
            <div className="rounded-xl border-2 border-accent bg-accent/5 p-3 text-xs">
              <p className="text-sm font-semibold text-ink">Worth a look for Live</p>
              <p className="mt-0.5 text-ink-muted">A good day alone is mostly luck; these also have a longer Sim record that makes money. Switch one on Strategies (it asks first, with its clash check).</p>
              <ul className="mt-2 space-y-1">
                {looks.map((x) => (
                  <li key={x.r.label}>
                    <span className="font-medium text-ink">{names.name(x.r.label)}</span> <span className="text-hit">{gbp(x.day.profit)} today</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-ink-muted">{mode === "live" ? "No Live bets settled yet today." : "No Sim picks settled yet today."}</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {rows.map(({ r, day }) => {
                const won = day.pricedHits ?? day.hits ?? 0;
                const v = mode === "sim" ? verdict(r, day) : { kind: null, text: "" };
                return (
                  <li key={r.label} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">{names.name(r.label)}</span>
                        <span className="block text-xs tabular-nums text-ink-muted">
                          {won}–{day.counted - won} · staked {gbp(day.staked, false)}
                          {mode === "sim" && r.sendingOn ? " · Live now" : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={`block text-sm font-semibold tabular-nums ${toneOf(day.profit)}`}>{gbp(day.profit)}</span>
                        <span className={`block text-xs tabular-nums ${toneOf(day.roi)}`}>{signedPct(day.roi)}</span>
                      </span>
                    </div>
                    {v.kind && <p className={`mt-1 text-xs ${v.kind === "look" ? "text-hit" : "text-ink-muted"}`}>{v.text}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-ink-muted">
            Change a strategy on{" "}
            <Link href="/more/admin/strategies" className="text-accent underline">
              Strategies
            </Link>
            . Bets still running aren&apos;t counted until they settle.
          </p>
        </div>
      )}
    </Card>
  );
}
