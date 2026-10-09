/**
 * Safety switches around direct betting that act on their own:
 *
 *   Circuit breaker  new bets are paused (picks wait, then age out) while Betfair isn't answering properly:
 *                    five passes in a row (about 20 seconds) with a Betfair error, or the read-only bet check not having
 *                    answered for 3 minutes. Bets already placed keep being followed. It closes by itself once
 *                    Betfair answers again, and the admin gets a notification both ways.
 *   Daily loss stop  the admin gets one notification the first time Live hits the whole-account daily loss limit
 *                    (Sending). The stop itself is in the bet feed (dailyLossStopReason), so it applies to every route.
 */
import type { EngineDb } from "../storage/engine-db";
import { getBetfairLinkStatus } from "./exchange";
import { dailyLossStopReason, getSendingSettings } from "../inplayguru/bet-feed";
import { sendPush } from "../server/push";
import { ukDateOf } from "../server/uk-time";
import { log } from "../server/log";

const ERROR_PASSES = 5;
const POLL_STALE_MS = 3 * 60_000;
/** Don't judge the bet check until the engine has been up this long (it needs a first poll). */
const STARTUP_GRACE_MS = 3 * 60_000;
const startedAt = Date.now();

let errorPasses = 0;
let open: { reason: string; since: string } | null = null;
let lossNotifiedDay: string | null = null;

/** Why new bets are paused right now, or null. */
export function breakerReason(): string | null {
  return open?.reason ?? null;
}

export function breakerStatus(): { open: boolean; reason: string | null; since: string | null; errorPasses: number } {
  return { open: open !== null, reason: open?.reason ?? null, since: open?.since ?? null, errorPasses };
}

/** Records how a direct-betting pass went: any Betfair error in it counts towards the breaker. */
export function recordPass(hadError: boolean): void {
  errorPasses = hadError ? errorPasses + 1 : 0;
}

/** Works out whether the breaker should be open; notifies on a change. Called before every pass. */
export async function guardTick(db: EngineDb, now = new Date()): Promise<void> {
  const link = getBetfairLinkStatus();
  let reason: string | null = null;
  if (errorPasses >= ERROR_PASSES) reason = `Betfair has returned errors on ${errorPasses} checks in a row.`;
  else if (link.configured && now.getTime() - startedAt > STARTUP_GRACE_MS) {
    const last = link.lastOkAt ? Date.parse(link.lastOkAt) : startedAt;
    if (now.getTime() - last > POLL_STALE_MS) reason = `The Betfair bet check hasn't answered for ${Math.round((now.getTime() - last) / 60_000)} minutes.`;
  }

  if (reason && !open) {
    open = { reason, since: now.toISOString() };
    log.warn(`Circuit breaker: new bets paused. ${reason}`);
    await sendPush(db, { title: "Betting paused: Betfair problem", body: `${reason} New bets wait until it answers again.`, url: "/more/admin/today", tag: "breaker" });
  } else if (reason && open) {
    open.reason = reason;
  } else if (!reason && open) {
    const mins = Math.round((now.getTime() - Date.parse(open.since)) / 60_000);
    open = null;
    log.info("Circuit breaker: Betfair is answering again; new bets resume.");
    await sendPush(db, { title: "Betting resumed", body: `Betfair is answering again after ${mins} minute${mins === 1 ? "" : "s"}.`, url: "/more/admin/today", tag: "breaker" });
  }

  // One notification the first time the whole-account daily loss stop trips each day.
  const limit = getSendingSettings(db).dailyLossLimit;
  const day = ukDateOf(now);
  if (limit > 0 && lossNotifiedDay !== day) {
    const stop = dailyLossStopReason(db, limit, now);
    if (stop) {
      lossNotifiedDay = day;
      log.warn(stop);
      await sendPush(db, { title: "Daily loss stop", body: stop, url: "/more/admin/today", tag: "loss-stop" });
    }
  }
}

/** For tests. */
export function resetGuard(): void {
  errorPasses = 0;
  open = null;
  lossNotifiedDay = null;
}
