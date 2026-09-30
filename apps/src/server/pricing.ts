/**
 * How one settled pick is priced in pounds. Shared by Win/Loss, the stop loss and the Strategies page, so
 * every figure in the app agrees.
 *
 *   stake  live pick (sent):          the stake it was sent with
 *          sim pick, recorded:         the stake recorded when it arrived (see recordSimBets in bet-feed.ts);
 *                                      a pick the bet feed's rules would have held back is not priced at all
 *          sim pick from before
 *          recording existed:          the strategy's stake today
 *   odds   the price printed in the alert (the "Over" price on the alert's Over/Under line for Next Goal bets,
 *          the favourite's live price for Favourite to win), otherwise the odds set for the strategy
 *   profit hit: stake x (odds - 1), less commission on the winnings; miss: minus the stake
 */

export interface PriceableResult {
  market: string | null;
  result: "hit" | "miss";
  targetLine: number | null;
  overLine: number | null;
  overOdds: number | null;
  favouriteOdds: number | null;
  sent: boolean;
  sentStake: number | null;
  /** What was recorded for a simulation pick when it arrived, or null for one from before recording existed. */
  sim: SimRecord | null;
}

/** The simulated bet stored on a pick that wasn't sent. */
export interface SimRecord {
  /** Null when the bet feed's rules would have held it back (then `skipped` says why). */
  stake: number | null;
  minPrice: number | null;
  skipped: string | null;
}

export type PriceOutcome =
  | { kind: "priced"; stake: number; odds: number; profit: number; usedAlertOdds: boolean }
  | { kind: "noStake" }
  | { kind: "noOdds" }
  /** A simulation pick the bet feed would not have placed (below the minimum odds, daily limit, stop loss...). */
  | { kind: "notPlaced"; reason: string };

/** The price printed in the alert, but only when it is for the very line that was bet. */
export function alertOddsOf(r: Pick<PriceableResult, "market" | "targetLine" | "overLine" | "overOdds" | "favouriteOdds">): number | null {
  if (r.market === "NEXT_GOAL") {
    return r.targetLine !== null && r.overLine === r.targetLine && r.overOdds !== null && r.overOdds > 1 ? r.overOdds : null;
  }
  if (r.market === "FAVOURITE_TO_WIN") return r.favouriteOdds !== null && r.favouriteOdds > 1 ? r.favouriteOdds : null;
  return null;
}

export function priceResult(
  r: PriceableResult,
  ctx: { strategyStake: number | null; assumedOdds: number | null; commission: number },
): PriceOutcome {
  let stake: number | null;
  if (r.sent) stake = r.sentStake ?? ctx.strategyStake;
  else if (r.sim) {
    if (r.sim.skipped !== null || r.sim.stake === null) return { kind: "notPlaced", reason: r.sim.skipped ?? "No stake set" };
    stake = r.sim.stake;
  } else stake = ctx.strategyStake;
  if (stake === null) return { kind: "noStake" };

  const alertOdds = alertOddsOf(r);
  const odds = alertOdds ?? ctx.assumedOdds;
  if (odds === null) return { kind: "noOdds" };

  const profit = r.result === "hit" ? stake * (odds - 1) * (1 - ctx.commission) : -stake;
  return { kind: "priced", stake, odds, profit, usedAlertOdds: alertOdds !== null };
}
