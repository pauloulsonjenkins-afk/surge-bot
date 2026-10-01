/**
 * How one settled pick is priced in pounds. Shared by Win/Loss, the stop loss and the Strategies page, so
 * every figure in the app agrees.
 *
 *   stake  live pick (sent):          the stake it was sent with
 *          sim pick, recorded:         the stake recorded when it arrived (see recordSimBets in bet-feed.ts);
 *                                      a pick the bet feed's rules would have held back is not priced at all
 *          sim pick from before
 *          recording existed:          the strategy's stake today
 *   odds   for a bet placed by hand (logged on Live), the price taken; otherwise the first of: the price printed in the alert (the "Over" price on the alert's Over/Under line for Next
 *          Goal bets, the favourite's live price for Favourite to win); the price the pick's bet actually matched at
 *          on Betfair; the Betfair price of that bet when the alert arrived (read by betfair/exchange.ts, so Sim
 *          picks of strategies whose alerts carry no price, such as Both Teams to Score, are priced too); and last,
 *          the odds set for the strategy on Win/Loss
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
  /** The price the pick's bet matched at on Betfair, when it has one. */
  betOdds?: number | null;
  /** The price taken on a bet placed by hand (logged on Live): what was actually bet, so it comes first. */
  takenOdds?: number | null;
  /** The Betfair price of the bet the feed would send, read when the alert arrived. */
  exchangeOdds?: number | null;
}

/** Where a pick's price came from. */
export type OddsSource = "taken" | "alert" | "bet" | "exchange" | "assumed";

/** The simulated bet stored on a pick that wasn't sent. */
export interface SimRecord {
  /** Null when the bet feed's rules would have held it back (then `skipped` says why). */
  stake: number | null;
  minPrice: number | null;
  skipped: string | null;
}

export type PriceOutcome =
  | { kind: "priced"; stake: number; odds: number; profit: number; usedAlertOdds: boolean; oddsSource: OddsSource }
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

  const found = pickOdds(r, ctx.assumedOdds);
  if (found === null) return { kind: "noOdds" };
  const { odds, source } = found;

  const profit = r.result === "hit" ? stake * (odds - 1) * (1 - ctx.commission) : -stake;
  return { kind: "priced", stake, odds, profit, usedAlertOdds: source === "alert", oddsSource: source };
}

/**
 * The hit rate a strategy needs at these odds just to break even after commission:
 * 1 / (1 + (odds - 1) x (1 - commission)). At 1.50 odds and no commission that is 66.7%, so a 63.8% hit rate loses.
 * Returned as a percent (0-100), or null without odds.
 */
export function breakevenHitRate(odds: number | null, commission: number): number | null {
  if (odds === null || !(odds > 1)) return null;
  return Math.round((1000 / (1 + (odds - 1) * (1 - commission)))) / 10;
}

/**
 * The range the true hit rate is likely to be in (95% Wilson interval), as percents. With few picks it is wide:
 * 37 hits from 58 is 63.8%, but anything from about 51% to 75% fits.
 */
export function hitRateRange(hits: number, settled: number): { low: number; high: number } | null {
  if (settled <= 0) return null;
  const z = 1.96;
  const p = hits / settled;
  const denom = 1 + (z * z) / settled;
  const centre = (p + (z * z) / (2 * settled)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / settled + (z * z) / (4 * settled * settled))) / denom;
  return { low: Math.round(Math.max(0, centre - half) * 1000) / 10, high: Math.round(Math.min(1, centre + half) * 1000) / 10 };
}

/** A pick's price and where it came from, in the order described at the top of this file; null when there is none. */
export function pickOdds(
  r: Pick<PriceableResult, "market" | "targetLine" | "overLine" | "overOdds" | "favouriteOdds" | "betOdds" | "exchangeOdds" | "takenOdds">,
  assumedOdds: number | null,
): { odds: number; source: OddsSource } | null {
  if (r.takenOdds != null && r.takenOdds > 1) return { odds: r.takenOdds, source: "taken" };
  const alert = alertOddsOf(r);
  if (alert !== null) return { odds: alert, source: "alert" };
  if (r.betOdds != null && r.betOdds > 1) return { odds: r.betOdds, source: "bet" };
  if (r.exchangeOdds != null && r.exchangeOdds > 1) return { odds: r.exchangeOdds, source: "exchange" };
  if (assumedOdds !== null) return { odds: assumedOdds, source: "assumed" };
  return null;
}

/** The odds a pick is judged at, whether or not it could be staked (see pickOdds). */
export function oddsFor(
  r: Pick<PriceableResult, "market" | "targetLine" | "overLine" | "overOdds" | "favouriteOdds" | "betOdds" | "exchangeOdds" | "takenOdds">,
  assumedOdds: number | null,
): number | null {
  return pickOdds(r, assumedOdds)?.odds ?? null;
}
