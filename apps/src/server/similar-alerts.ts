/**
 * "Similar alerts" for the admin's Live tab (29 Oct 2026): how alerts like this one - the same strategy, in the same
 * match-minute band and the same price band - actually did over the last 30 days, as one short line ("112 bets · 57%
 * won · -13% per £1").
 *
 * INFORMATION ONLY. It never blocks, changes or places a bet, and costs nothing to run (no Claude call): it is a lookup
 * of GoalBrew's own settled alerts. A backtest of the same idea over 3,472 alerts found the best third by this record
 * lost 1.0% a bet against 7.6% for the worst third: a modest edge that narrows a loss rather than making a profit, so it
 * points at the parts of a strategy worth betting and away from the parts that lose; it doesn't promise a profit.
 *
 * Every settled alert counts, bet or not, at its own price and a flat unit stake (after commission), so the figure is
 * about the alerts, not about what happened to be bet. The band edges are the ones the backtest used.
 */
import type { EngineDb } from "../storage/engine-db";
import type { LivePick } from "../storage/engine-db";
import { alertOddsOfPick, strategyLabel } from "../inplayguru/bet-feed";
import { pricingInputs } from "./winloss";
import { cachedReport } from "./report-cache";

/** How far back the lookup reaches. */
export const SIMILAR_DAYS = 30;
/** Under this many similar alerts there is no line worth showing a figure for: it says "too few". */
export const SIMILAR_MIN = 10;
const TTL_MS = 5 * 60_000;

export interface SimilarAlerts {
  /** Similar settled alerts in the window. */
  n: number;
  /** Per cent of them that won (null under SIMILAR_MIN). */
  wonPct: number | null;
  /** Return per £1 staked, in per cent (null under SIMILAR_MIN). */
  roiPct: number | null;
  days: number;
}

const MINUTE_CUTS = [30, 45, 60, 70, 80];
const PRICE_CUTS = [1.3, 1.45, 1.6, 1.8, 2.1];
const band = (x: number, cuts: number[]) => {
  const i = cuts.findIndex((c) => x < c);
  return i === -1 ? cuts.length : i;
};

/** The strategy, minute band ("pre" for a pre-match alert) and price band an alert falls in. */
export function similarKey(strategy: string, minute: number | null, odds: number): string {
  return `${strategyLabel(strategy).toLowerCase()}|${minute === null ? "pre" : band(minute, MINUTE_CUTS)}|${band(odds, PRICE_CUTS)}`;
}

type Tally = { n: number; won: number; profit: number };

function tallies(db: EngineDb, now: Date): Record<string, Tally> {
  const since = new Date(now.getTime() - SIMILAR_DAYS * 86_400_000).toISOString();
  const { price, commission } = pricingInputs(db);
  const out: Record<string, Tally> = {};
  for (const r of db.listResultsForWinLoss(since)) {
    if (r.result !== "hit" && r.result !== "miss") continue;
    const odds = price(r).odds;
    if (odds === null || !(odds > 1)) continue;
    const t = (out[similarKey(r.strategy, r.facts?.minute ?? null, odds)] ??= { n: 0, won: 0, profit: 0 });
    t.n++;
    if (r.result === "hit") {
      t.won++;
      t.profit += (odds - 1) * (1 - commission);
    } else t.profit -= 1;
  }
  return out;
}

/** The lookup for one unsettled alert, or null when it has no price to place it by (or is already settled). */
export function similarAlertsFor(db: EngineDb, pick: LivePick, now = new Date()): SimilarAlerts | null {
  if (pick.status === "settled") return null;
  const odds = alertOddsOfPick(pick);
  if (odds === null || !(odds > 1)) return null;
  const table = cachedReport(db, "similar-alerts", () => tallies(db, now) as Record<string, unknown>, now.getTime(), TTL_MS) as Record<string, Tally>;
  const t = table[similarKey(pick.strategy, pick.minute, odds)];
  const n = t?.n ?? 0;
  if (!t || n < SIMILAR_MIN) return { n, wonPct: null, roiPct: null, days: SIMILAR_DAYS };
  return { n, wonPct: Math.round((1000 * t.won) / n) / 10, roiPct: Math.round((1000 * t.profit) / n) / 10, days: SIMILAR_DAYS };
}
