/**
 * The admin's heavy reports (Strategies, Weekly, Golden, Profit), reused for up to a minute.
 *
 * The engine reads alerts and places bets on the same thread that works these out, and each one re-reads every settled
 * pick: on 20 Oct 2026 that held both up for 0.7-2 seconds on every call. Between results the answer is the same, so it
 * is kept and given again while all of these hold:
 *   - it is under a minute old, so figures that move with the clock still roll on;
 *   - no result has been written since (EngineDb.resultsVersion: a pick settled, a result amended, a bet matched...);
 *   - the settings the figures are worked out with are the same: stakes and Live switches (which the automatic stakes
 *     and the Golden safety check change by themselves), commission and assumed odds, merges, the fresh start, and the
 *     balance a percentage stake is taken from.
 * Every change made from the admin site starts afresh as well (http.ts clears this on each POST and PUT), so a change
 * shows straight away.
 *
 * Only for showing. Apply, the automatic stakes and the hourly checks never use it: they work their figures out anew.
 */
import type { EngineDb } from "../storage/engine-db";
import { getSendingSettings } from "../inplayguru/bet-feed";
import { getBank } from "../inplayguru/stake";
import { getWinLossSettings } from "./winloss";

export const REPORT_TTL_MS = 60_000;

const cache = new WeakMap<EngineDb, Map<string, { at: number; stamp: string; body: Record<string, unknown> }>>();

/** What the reports are worked out from, besides the clock: when this differs, a kept report is out of date. */
function inputsStamp(db: EngineDb): string {
  return JSON.stringify([db.resultsVersion(), getSendingSettings(db), getWinLossSettings(db), getBank(db).total, db.getStrategyMerges(), db.getFreshStart()]);
}

/** The report under `key`: the one kept, while it still holds (above), else worked out now and kept. */
export function cachedReport(db: EngineDb, key: string, compute: () => Record<string, unknown>, now = Date.now()): Record<string, unknown> {
  let byKey = cache.get(db);
  if (!byKey) cache.set(db, (byKey = new Map()));
  const stamp = inputsStamp(db);
  const hit = byKey.get(key);
  const age = hit ? now - hit.at : -1;
  if (hit && hit.stamp === stamp && age >= 0 && age < REPORT_TTL_MS) return hit.body;
  const body = compute();
  byKey.set(key, { at: now, stamp, body });
  // Oldest first out, so a run of different requests (each "since" date) can't grow it without limit.
  if (byKey.size > 50) byKey.delete(byKey.keys().next().value as string);
  return body;
}

/** Forgets every kept report, so the next of each is worked out anew. */
export function clearReportCache(db: EngineDb): void {
  cache.delete(db);
}
