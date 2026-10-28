import type { TodaySnapshot } from "@/server/engine-client";

/**
 * Whether today's not-placed bets need a look: 5+ sent and over 30% of them not placed for a reason that may need
 * action. Goal suspensions, prices under a strategy's minimum and the safety limits don't count (the engine's
 * `expected` reasons): on 28 Oct 2026 Today went amber for 7 of 19 not placed when 6 were exactly those. An older
 * engine without the split counts them all, as before.
 */
export function notPlacedWarns(q: TodaySnapshot["queue"]): boolean {
  const n = q.notPlacedNeedsLook ?? q.notPlacedToday;
  return q.sentToday >= 5 && n / q.sentToday > 0.3;
}

/** "7 of 19 not placed today", with how many need a look once some are expected ("1 needs a look"). */
export function notPlacedText(q: TodaySnapshot["queue"]): string {
  const base = `${q.notPlacedToday} of ${q.sentToday} not placed today`;
  if (q.notPlacedNeedsLook === undefined || q.notPlacedToday === 0) return base;
  return q.notPlacedNeedsLook === 0 ? `${base}, all expected` : `${base}, ${q.notPlacedNeedsLook} need${q.notPlacedNeedsLook === 1 ? "s" : ""} a look`;
}
