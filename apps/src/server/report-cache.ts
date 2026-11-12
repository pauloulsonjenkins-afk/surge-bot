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
 *
 * TODAY is the one exception to the minute-long reuse: its own subtitle is "what's at risk right now" (the open bet
 * queue, alert health), none of which `inputsStamp` below tracks (they aren't a "result" or a settings change). It is
 * kept for only 10 seconds instead (added 27 Oct 2026, the site's speed pass) - comfortably under its own 15-second
 * poll, so a burst of requests in that window still shares one computation, without masking live operational state.
 */
import type { EngineDb } from "../storage/engine-db";
import { getSendingSettings } from "../inplayguru/bet-feed";
import { getBank } from "../inplayguru/stake";
import { getWinLossSettings } from "./winloss";
import { log } from "./log";
import { runReport, type ReportName } from "./reports";
import { reportWorkerReady, workerReport } from "./report-client";

export const REPORT_TTL_MS = 60_000;
/**
 * How long a report that has gone out of date (a result was written, or its minute is up) may still be shown while a fresh
 * one is worked out in the background. Without this the first view after every settled pick waited for the whole report
 * (3 Nov 2026, from the phone: Win/Loss 7.7 s, Golden 4.1 s, Strategies 2.5 s cold, 0.2-0.6 s warm). A change made from the
 * admin site clears the cache, so a change you make is never shown stale.
 */
export const STALE_OK_MS = 90_000;
const refreshing = new WeakMap<EngineDb, Set<string>>();
/** Today's own, much shorter reuse window (see above). */
export const TODAY_TTL_MS = 10_000;

const cache = new WeakMap<EngineDb, Map<string, { at: number; stamp: string; body: Record<string, unknown> }>>();

/** What the reports are worked out from, besides the clock: when this differs, a kept report is out of date. */
function inputsStamp(db: EngineDb): string {
  return JSON.stringify([db.resultsVersion(), getSendingSettings(db), getWinLossSettings(db), getBank(db).total, db.getStrategyMerges(), db.getFreshStart()]);
}

/** The report under `key`: the one kept, while it still holds (above), else worked out now and kept. */
export function cachedReport(db: EngineDb, key: string, compute: () => Record<string, unknown>, now = Date.now(), ttlMs = REPORT_TTL_MS): Record<string, unknown> {
  let byKey = cache.get(db);
  if (!byKey) cache.set(db, (byKey = new Map()));
  const stamp = inputsStamp(db);
  const hit = byKey.get(key);
  const age = hit ? now - hit.at : -1;
  if (hit && hit.stamp === stamp && age >= 0 && age < ttlMs) return hit.body;
  // Out of date, but recent: show it now and bring it up to date straight after, so nobody waits for the report.
  if (hit && age >= 0 && age < STALE_OK_MS && ttlMs === REPORT_TTL_MS) {
    let busy = refreshing.get(db);
    if (!busy) refreshing.set(db, (busy = new Set()));
    if (!busy.has(key)) {
      busy.add(key);
      setImmediate(() => {
        try {
          const fresh = cache.get(db)?.get(key);
          // Skipped if a request (or a clear) has dealt with it since.
          if (fresh === hit) {
            const again = inputsStamp(db);
            byKey.set(key, { at: Date.now(), stamp: again, body: compute() });
          }
        } catch {
          // The next request works it out itself.
        } finally {
          busy!.delete(key);
        }
      });
    }
    return hit.body;
  }
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

const inFlight = new WeakMap<EngineDb, Map<string, Promise<Record<string, unknown>>>>();

/**
 * cachedReport for a report in reports.ts, worked out on the report worker when it is running (report-client.ts), so
 * the engine's thread is not held while a page loads. The same rules for reuse as above. Without the worker, or if it
 * fails or is too slow, the report is worked out here on the engine's own thread, exactly as cachedReport does: the
 * worker can only make a page faster, never stop it loading.
 */
export async function cachedReportVia(db: EngineDb, key: string, name: ReportName, args: unknown[], now = Date.now(), ttlMs = REPORT_TTL_MS): Promise<Record<string, unknown>> {
  if (!reportWorkerReady()) return cachedReport(db, key, () => runReport(db, name, args), now, ttlMs);
  let byKey = cache.get(db);
  if (!byKey) cache.set(db, (byKey = new Map()));
  const stamp = inputsStamp(db);
  const hit = byKey.get(key);
  const age = hit ? now - hit.at : -1;
  if (hit && hit.stamp === stamp && age >= 0 && age < ttlMs) return hit.body;

  let flying = inFlight.get(db);
  if (!flying) inFlight.set(db, (flying = new Map()));
  const fetchFresh = (): Promise<Record<string, unknown>> => {
    const already = flying!.get(key);
    if (already) return already;
    const p = workerReport(name, args, db.resultsVersion())
      .catch((err: unknown) => {
        log.warn(`Report "${name}" fell back to the engine's own thread: ${err instanceof Error ? err.message : String(err)}`);
        return runReport(db, name, args);
      })
      .then((body) => {
        // Kept under the stamp read before it was asked for: if something changed meanwhile, the next view sees that.
        let m = cache.get(db);
        if (!m) cache.set(db, (m = new Map()));
        m.set(key, { at: Date.now(), stamp, body });
        if (m.size > 50) m.delete(m.keys().next().value as string);
        return body;
      })
      .finally(() => flying!.delete(key));
    flying!.set(key, p);
    return p;
  };
  // Out of date, but recent: show it now and bring it up to date behind the scenes.
  if (hit && age >= 0 && age < STALE_OK_MS && ttlMs === REPORT_TTL_MS) {
    void fetchFresh().catch(() => {});
    return hit.body;
  }
  return fetchFresh();
}
