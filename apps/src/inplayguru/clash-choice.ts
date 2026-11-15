/**
 * CLASH CHOICE (added 15 Nov 2026, Sim only): when a back bet and a LAY that cancel each other (clash.ts) are both
 * wanted on a match, which one has the better record?
 *
 * Today the first one to arrive wins and the other is not placed. This works out which SHOULD win from each side's
 * strategy record (return per £1, from settled bets before the clash). It changes no bets: it is a pure function for
 * the Sim record to log what it would have chosen, so the choice can be checked against results before it is trusted.
 *
 * Back test on 14 Nov 2026 (about 1,300 settled pairs, record before each pair only): always back -7.8%, always lay
 * -1.0%, coin flip -4.4%, pick by record -1.9%. So it beats backing blindly but not (yet) always laying: hence Sim only.
 */

/** A strategy's settled record: bets and return per £1 (profit / stake, a LAY's stake being its liability). */
export interface TrackRecord {
  bets: number;
  roi: number;
}

export type ClashSide = "back" | "lay";

export interface ClashChoice {
  /** The side to place, or "first" when neither has enough record: the first to arrive stays as it is today. */
  side: ClashSide | "first";
  reason: string;
}

/** Bets a strategy needs before its record counts. */
export const MIN_BETS = 30;
/** How much better (return per £1) the winner must be, or the first to arrive stays: below this is noise. */
export const MIN_EDGE = 0.02;

export function chooseClash(back: TrackRecord | null, lay: TrackRecord | null): ClashChoice {
  const ok = (r: TrackRecord | null): r is TrackRecord => r !== null && r.bets >= MIN_BETS && Number.isFinite(r.roi);
  if (!ok(back) && !ok(lay)) return { side: "first", reason: "Neither side has a record yet." };
  if (!ok(back)) return { side: "lay", reason: "Only the LAY has a record." };
  if (!ok(lay)) return { side: "back", reason: "Only the back bet has a record." };
  const gap = back.roi - lay.roi;
  if (Math.abs(gap) < MIN_EDGE) return { side: "first", reason: "Records too close to call." };
  return gap > 0
    ? { side: "back", reason: `Back record ${(back.roi * 100).toFixed(1)}% beats LAY ${(lay.roi * 100).toFixed(1)}%.` }
    : { side: "lay", reason: `LAY record ${(lay.roi * 100).toFixed(1)}% beats back ${(back.roi * 100).toFixed(1)}%.` };
}

/** A strategy's record from its settled bets before a time: [{ at, ret }] (ret = return per £1), oldest or newest first. */
export function recordBefore(bets: Array<{ at: number; ret: number }>, before: number): TrackRecord | null {
  const prior = bets.filter((b) => b.at < before && Number.isFinite(b.ret));
  if (prior.length === 0) return null;
  return { bets: prior.length, roi: prior.reduce((s, b) => s + b.ret, 0) / prior.length };
}
