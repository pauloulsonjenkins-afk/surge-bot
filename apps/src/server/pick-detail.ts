/**
 * One pick in detail, for the admin's Trade Log (click to expand): the times (alert, sent, bet), the goals after the
 * alert (fixtures/goal-times.ts), the match picture the alert gave, and how that compares with the strategy's winners.
 * Admin only: the stats at each alert hint at a strategy's rules.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { strategyLabel } from "../inplayguru/bet-feed";
import { goalsForPick, type GoalEvent } from "../fixtures/goal-times";

/** The stats shown, in this order, as [home, away]. */
const SHOWN = ["Momentum", "Shots On Target", "Shots Off Target", "Dangerous Attacks", "Attacks", "Possession %", "Corners", "xG", "Key Passes", "Red Cards"];
/** The ones compared with the strategy's winners: the match total (both sides), except momentum: the stronger side. */
const COMPARED: Array<{ label: string; of: (v: [number, number]) => number }> = [
  { label: "Momentum", of: (v) => Math.max(v[0], v[1]) },
  { label: "Shots On Target", of: (v) => v[0] + v[1] },
  { label: "Dangerous Attacks", of: (v) => v[0] + v[1] },
  { label: "xG", of: (v) => v[0] + v[1] },
];

export interface PickDetail {
  id: number;
  times: {
    alertAt: string | null;
    receivedAt: string;
    sentAt: string | null;
    /** Betfair bets on this pick: when placed, how much matched and at what price. */
    bets: Array<{ placedAt: string | null; matched: number | null; odds: number | null; status: string }>;
    /** GoalBrew's own direct betting, when it handled the pick. */
    direct: { state: string; placedAt: string | null; price: number | null; matched: number | null; reason: string | null } | null;
  };
  minute: number | null;
  scoreAtAlert: string | null;
  lastGoalBefore: string | null;
  /** Null when the match isn't linked or not fetched yet; then `goalsNote` says why. */
  goals: Array<GoalEvent & { afterAlert: boolean }> | null;
  goalsNote: string | null;
  stats: Array<{ label: string; home: number; away: number }>;
  /** This pick against the averages of the strategy's settled winners and losers (last 60 days, with that stat). */
  compare: Array<{ label: string; pick: number; winners: number | null; losers: number | null }>;
  /** A sentence for a miss: what happened after the alert and how the picture compared. */
  summary: string | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function averages(db: EngineDb, strategy: string, result: "hit" | "miss", now: Date): Map<string, number> {
  const key = strategyLabel(strategy).toLowerCase();
  const rows = db
    .listLivePicks(5000, { from: new Date(now.getTime() - 60 * 86_400_000).toISOString(), to: now.toISOString() })
    .filter((p) => p.result === result && !p.excluded && strategyLabel(p.strategy).toLowerCase() === key && p.detail?.stats);
  const out = new Map<string, number>();
  for (const c of COMPARED) {
    const vals = rows.map((p) => p.detail!.stats[c.label]).filter((v): v is [number, number] => Array.isArray(v));
    if (vals.length >= 3) out.set(c.label, r1(vals.reduce((t, v) => t + c.of(v), 0) / vals.length));
  }
  return out;
}

export function pickDetail(db: EngineDb, id: number, now = new Date()): PickDetail | null {
  const p: LivePick | null = db.getLivePick(id);
  if (!p) return null;
  const bets = db.sqlite
    .prepare(`SELECT placed_at, matched, odds, status FROM betfair_bets WHERE pick_id = ? ORDER BY placed_at`)
    .all(id) as Array<{ placed_at: string | null; matched: number | null; odds: number | null; status: string }>;
  const d = db.getDirectBet(id);
  const stats = SHOWN.flatMap((label) => {
    const v = p.detail?.stats?.[label];
    return Array.isArray(v) ? [{ label, home: v[0], away: v[1] }] : [];
  });

  const g = goalsForPick(db, id);
  const alertMinute = p.minute;
  const goals = g.goals
    ? g.goals.map((x) => ({ ...x, afterAlert: alertMinute === null ? true : x.minute + (x.extra ?? 0) / 100 > alertMinute }))
    : null;
  const goalsNote =
    goals !== null
      ? null
      : g.linked === "notFound"
        ? "Goal times aren't available for this match: it wasn't found in API-Football's fixture list."
        : g.linked === "no"
          ? "Goal times are only looked up for alerts from now on."
          : "Goal times arrive a few hours after the match ends.";

  const winners = averages(db, p.strategy, "hit", now);
  const losers = averages(db, p.strategy, "miss", now);
  const compare = COMPARED.flatMap((c) => {
    const v = p.detail?.stats?.[c.label];
    return Array.isArray(v) ? [{ label: c.label, pick: r1(c.of(v)), winners: winners.get(c.label) ?? null, losers: losers.get(c.label) ?? null }] : [];
  });

  let summary: string | null = null;
  if (p.result === "miss") {
    const after = goals?.filter((x) => x.afterAlert) ?? null;
    const first =
      after === null
        ? `Missed${alertMinute !== null ? ` from ${alertMinute}'` : ""}.`
        : after.length === 0
          ? `No goal after the alert${alertMinute !== null ? ` at ${alertMinute}'` : ""}.`
          : `${after.length} goal${after.length === 1 ? "" : "s"} after the alert, but not the one the bet needed.`;
    const weaker = compare.filter((c) => c.winners !== null && c.pick < c.winners);
    const second =
      compare.length === 0
        ? ""
        : weaker.length === 0
          ? " The picture at the alert was as strong as this strategy's winners, so this looks like bad luck rather than a weak signal."
          : ` Weaker than this strategy's winners on ${weaker.map((c) => `${c.label.toLowerCase()} (${c.pick} v ${c.winners})`).join(", ")}.`;
    summary = first + second;
  }

  return {
    id,
    times: {
      alertAt: p.messageAt,
      receivedAt: p.firstSeenAt,
      sentAt: p.sentAt,
      bets: bets.map((b) => ({ placedAt: b.placed_at, matched: b.matched, odds: b.odds, status: b.status })),
      direct: d ? { state: d.state, placedAt: d.state === "placed" ? d.updatedAt : null, price: d.avgPrice ?? d.price, matched: d.sizeMatched, reason: d.reason } : null,
    },
    minute: p.minute,
    scoreAtAlert: p.goalsHome !== null && p.goalsAway !== null ? `${p.goalsHome}-${p.goalsAway}` : null,
    lastGoalBefore: p.detail?.lastGoal ?? null,
    goals,
    goalsNote,
    stats,
    compare,
    summary,
  };
}
