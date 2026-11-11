/**
 * One verdict for a set of settled bets, used by the pages AND by the rules that move money (site review S3, 11 Nov
 * 2026). Before this a page showed "+10% per £1" over 20 bets as though it were a result, and a rule acted on it; at
 * the prices bet here 20 bets carry a margin of about +-33 points.
 *
 * The verdict compares the likely range of the true hit rate (95%, pricing.ts hitRateRange, over the priced picks) with
 * the hit rate needed to break even after commission:
 *
 *   "too early"         fewer than VERDICT_FROM priced bets: no opinion, whatever the figure says;
 *   "probably losing"   the whole range is below break-even;
 *   "probably winning"  the whole range is above break-even;
 *   "no clear edge"     break-even is inside the range: it could be either.
 *
 * Pure: the figures in, the verdict out.
 */
export type Verdict = "too early" | "probably losing" | "no clear edge" | "probably winning";

/** Bets needed before any opinion. The stake ladder's RAISE_FROM is the same figure on purpose. */
export const VERDICT_FROM = 100;

export interface VerdictInput {
  /** Priced settled bets. */
  counted: number;
  /** Likely range of the true hit rate over those bets, percents. */
  pricedRange: { low: number; high: number } | null;
  /** Hit rate needed to break even, percent: from what the winners paid and the losers cost when known, else at the average odds. */
  breakevenEffective?: number | null;
  breakeven: number | null;
}

export function verdictOf(r: VerdictInput): Verdict {
  if (r.counted < VERDICT_FROM) return "too early";
  const be = r.breakevenEffective ?? r.breakeven;
  if (be === null || !r.pricedRange) return "no clear edge";
  if (r.pricedRange.high < be) return "probably losing";
  if (r.pricedRange.low > be) return "probably winning";
  return "no clear edge";
}

/**
 * The likely range of the return per £1, from the hit-rate range: at break-even the return is 0, and each point of hit
 * rate above it is worth 1 / break-even of the stake (a win pays stake x (1/be - 1) net when be is the break-even rate).
 * Fractions (0.05 = 5p per £1). Null when break-even or the range isn't known.
 */
export function roiRange(r: VerdictInput): { low: number; high: number } | null {
  const be = r.breakevenEffective ?? r.breakeven;
  if (be === null || be <= 0 || !r.pricedRange) return null;
  const at = (hitPct: number) => Math.round((hitPct / be - 1) * 1000) / 1000;
  return { low: at(r.pricedRange.low), high: at(r.pricedRange.high) };
}
