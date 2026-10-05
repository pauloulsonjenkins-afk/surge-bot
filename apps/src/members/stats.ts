/**
 * A MEMBER's own performance, from their own bets only (never the house's or a community strategy's figures).
 *
 *   settled     won, lost or void; pending, unmatched, rejected, failed and cancelled bets are never counted as settled
 *   hit rate    won / (won + lost); voids are left out
 *   staked      the stake actually at risk: the matched amount for live bets, the stake for simulated ones
 *   profit      sum of settled profit (wins after commission; a void is 0)
 *   ROI         profit / staked x 100, over won and lost bets
 *   bank (sim)  starting bank + profit of the current simulation's settled bets
 *   drawdown    the largest fall from a high point of the running profit
 * Simulation and live are always worked out separately.
 */
import type { BetMode, MemberBet } from "./store";
import { hitRate } from "./house";
import { ukDateOf } from "../server/uk-time";

export interface PerformanceSummary {
  bets: number;
  settled: number;
  wins: number;
  losses: number;
  voids: number;
  open: number;
  openExposure: number;
  /** Bets the risk checks or Betfair refused, or that never matched. */
  notPlaced: number;
  hitRate: number | null;
  staked: number;
  returns: number;
  profit: number;
  roi: number | null;
  avgOdds: number | null;
  maxDrawdown: number;
  longestWinningRun: number;
  longestLosingRun: number;
  /** "W3" = three wins in a row now, "L2" = two losses; null with nothing settled. */
  currentStreak: string | null;
}

export interface StrategyPerformance extends PerformanceSummary {
  strategyKey: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function stakeAtRisk(b: MemberBet): number {
  return b.mode === "live" ? (b.matchedStake ?? 0) : b.stake;
}

/** Open bets' stake at risk (pending ones count at their full stake, as they may still be placed). */
export function openExposure(bets: MemberBet[]): number {
  return r2(bets.filter((b) => b.status === "pending" || b.status === "placing" || b.status === "matched" || b.status === "partially_matched").reduce((t, b) => t + (b.status === "pending" || b.status === "placing" ? b.stake : Math.max(stakeAtRisk(b), 0)), 0));
}

export function summarise(bets: MemberBet[]): PerformanceSummary {
  const settled = bets.filter((b) => b.status === "won" || b.status === "lost" || b.status === "void").sort((a, b) => (a.settledAt ?? a.createdAt).localeCompare(b.settledAt ?? b.createdAt) || a.id - b.id);
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let staked = 0;
  let returns = 0;
  let profit = 0;
  let oddsSum = 0;
  let oddsN = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let run = 0; // positive = wins in a row, negative = losses
  let longestW = 0;
  let longestL = 0;
  for (const b of settled) {
    const p = b.profit ?? 0;
    profit += p;
    peak = Math.max(peak, profit);
    maxDrawdown = Math.max(maxDrawdown, peak - profit);
    if (b.status === "void") {
      voids++;
      continue;
    }
    const s = stakeAtRisk(b);
    staked += s;
    returns += s + p;
    const odds = b.matchedPrice ?? b.requestedPrice;
    if (odds) {
      oddsSum += odds;
      oddsN++;
    }
    if (b.status === "won") {
      wins++;
      run = run > 0 ? run + 1 : 1;
      longestW = Math.max(longestW, run);
    } else {
      losses++;
      run = run < 0 ? run - 1 : -1;
      longestL = Math.max(longestL, -run);
    }
  }
  const open = bets.filter((b) => b.status === "pending" || b.status === "placing" || b.status === "matched" || b.status === "partially_matched");
  return {
    bets: bets.length,
    settled: settled.length,
    wins,
    losses,
    voids,
    open: open.length,
    openExposure: openExposure(bets),
    notPlaced: bets.filter((b) => b.status === "rejected" || b.status === "failed" || b.status === "cancelled").length,
    hitRate: hitRate(wins, losses),
    staked: r2(staked),
    returns: r2(returns),
    profit: r2(profit),
    roi: staked > 0 ? Math.round((profit / staked) * 1000) / 10 : null,
    avgOdds: oddsN ? r2(oddsSum / oddsN) : null,
    maxDrawdown: r2(maxDrawdown),
    longestWinningRun: longestW,
    longestLosingRun: longestL,
    currentStreak: run === 0 ? null : run > 0 ? `W${run}` : `L${-run}`,
  };
}

export function byStrategy(bets: MemberBet[]): StrategyPerformance[] {
  const groups = new Map<string, MemberBet[]>();
  for (const b of bets) (groups.get(b.strategyKey) ?? groups.set(b.strategyKey, []).get(b.strategyKey)!).push(b);
  return [...groups.entries()].map(([strategyKey, list]) => ({ strategyKey, ...summarise(list) })).sort((a, b) => b.profit - a.profit);
}

/** Running bank (sim) or running profit (live), one point per UK day with settled bets. */
export function equityCurve(bets: MemberBet[], start: number): Array<{ date: string; value: number }> {
  const settled = bets.filter((b) => b.status === "won" || b.status === "lost" || b.status === "void").sort((a, b) => (a.settledAt ?? a.createdAt).localeCompare(b.settledAt ?? b.createdAt));
  const points: Array<{ date: string; value: number }> = [];
  let v = start;
  for (const b of settled) {
    v += b.profit ?? 0;
    const date = ukDateOf(new Date(b.settledAt ?? b.createdAt));
    const last = points[points.length - 1];
    if (last && last.date === date) last.value = r2(v);
    else points.push({ date, value: r2(v) });
  }
  return points;
}

/** Today's (UK day) stake, profit and bet count for one mode: what the daily risk limits look at. */
export function todayTotals(bets: MemberBet[], mode: BetMode, now: Date): { staked: number; profit: number; bets: number } {
  const today = ukDateOf(now);
  let staked = 0;
  let profit = 0;
  let n = 0;
  for (const b of bets) {
    if (b.mode !== mode || ukDateOf(new Date(b.createdAt)) !== today) continue;
    if (b.status === "rejected" || b.status === "failed") continue;
    n++;
    staked += b.status === "pending" || b.status === "placing" ? b.stake : stakeAtRisk(b);
    if (b.profit !== null && (b.status === "won" || b.status === "lost")) profit += b.profit;
  }
  return { staked: r2(staked), profit: r2(profit), bets: n };
}
