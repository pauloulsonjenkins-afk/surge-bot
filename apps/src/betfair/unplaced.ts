/**
 * Sent picks the betting software didn't place: no bet on Betfair for them UNPLACED_AFTER_MS after they were handed to
 * the bet feed. BF Bot Manager reads the feed every few seconds and bets straight away when its rules allow, pre-match
 * picks included (its "Time to bet" window opens before the alert arrives), so a pick still with no bet 3 minutes on
 * has almost always been turned down: a market type not ticked, a strategy paused, a price rule, or a match it can't
 * find. Listed on the Sending page, and the admin gets one push notification per pick.
 */
import type { EngineDb } from "../storage/engine-db";
import { addMatchName, betableUntil, getSendingSettings, strategyLabel } from "../inplayguru/bet-feed";
import { sendPush } from "../server/push";
import { log } from "../server/log";

/** How long after a pick is sent it must have a bet on Betfair. */
export const UNPLACED_AFTER_MS = 3 * 60 * 1000;
/** Picks sent longer ago than this aren't notified about (e.g. when the check first starts, or after downtime). */
const NOTIFY_WITHIN_MS = 30 * 60 * 1000;

export interface UnplacedPick {
  id: number;
  strategy: string;
  match: string;
  competition: string | null;
  sentAt: string;
  /** The likely reason, from what the engine found on Betfair when the alert arrived. */
  reason: string;
  /** When the admin was notified, or null. */
  alertedAt: string | null;
  /** Betfair's name for the match when only a team's spelling differs: the pick can then be fixed and re-sent. */
  betfairEvent: string | null;
}

/**
 * Picks handed to the bet feed in the last `hours` with no Betfair bet at all (matched or not) UNPLACED_AFTER_MS on,
 * newest first. Only once Betfair has been checked after that point (`lastOkAt`), so a slow poll isn't a false alarm.
 * Picks placed by hand (logged on Live), and ones the admin has cleared after looking at them, are left out.
 */
export function listUnplaced(db: EngineDb, lastOkAt: string | null, now = new Date(), hours = 24): UnplacedPick[] {
  if (!lastOkAt) return [];
  const checked = Date.parse(lastOkAt);
  const since = now.getTime() - hours * 60 * 60 * 1000;
  const withBets = db.pickIdsWithBets();
  const alerted = db.unplacedAlertTimes();
  const cleared = db.unplacedClearedIds();
  const out: UnplacedPick[] = [];
  for (const p of db.listSentPicks()) {
    if (!p.viaFeed || p.manualBet || withBets.has(p.id) || cleared.has(p.id)) continue;
    const sent = Date.parse(p.sentAt);
    if (sent < since || checked < sent + UNPLACED_AFTER_MS) continue;
    const pick = db.getLivePick(p.id);
    if (!pick) continue;
    out.push({
      id: p.id,
      strategy: strategyLabel(p.strategy),
      match: `${pick.home ?? "?"} v ${pick.away ?? "?"}`,
      competition: pick.competition,
      sentAt: p.sentAt,
      reason: reasonFor(pick.exchange, pick.marketCheck, pick.marketCheckDetail, pick.exchangeOdds, minPriceSent(pick.sentRowJson)),
      alertedAt: alerted.get(p.id) ?? null,
      betfairEvent: pick.exchange === "nameDiffers" && pick.exchangeEvent ? pick.exchangeEvent : null,
    });
  }
  return out.sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
}

/** The MinPrice the feed row carried, or null when there was none. */
function minPriceSent(rowJson: string | null): number | null {
  if (!rowJson) return null;
  try {
    const m = (JSON.parse(rowJson) as { minPrice?: unknown }).minPrice;
    return typeof m === "number" && Number.isFinite(m) ? m : null;
  } catch {
    return null;
  }
}

function reasonFor(exchange: string | null, check: string | null, detail: string | null, price: number | null, minPrice: number | null): string {
  if (exchange === "off") return "The match wasn't found on Betfair.";
  if (exchange === "nameDiffers") return "Betfair spells a team differently: add it under Sending → Match names.";
  if (check === "noMarket" || check === "noSelection") return detail ?? "The market sent isn't on Betfair for this match.";
  if (check === "ok" && price !== null && minPrice !== null && price < minPrice) {
    return `Betfair's price was ${price.toFixed(2)}, below this strategy's minimum odds of ${minPrice.toFixed(2)}, so BF Bot Manager wouldn't take it.`;
  }
  if (check === "ok") return "The bet is on Betfair as sent, so BF Bot Manager turned it down: check that strategy's market types, Time to bet and price rules, and that it's started.";
  return "Not checked on Betfair. Check BF Bot Manager's log for this match.";
}

/**
 * Notifies the admin about newly unplaced picks (sent within the last 30 minutes, not notified before), in one
 * notification however many there are, and marks them. Called after each Betfair poll.
 */
export async function notifyUnplaced(db: EngineDb, lastOkAt: string | null, now = new Date()): Promise<number> {
  const fresh = listUnplaced(db, lastOkAt, now, 1).filter((u) => u.alertedAt === null && now.getTime() - Date.parse(u.sentAt) <= NOTIFY_WITHIN_MS);
  if (fresh.length === 0) return 0;
  // Marked first, so a failed or slow push never repeats the alert every poll.
  db.markUnplacedAlerted(
    fresh.map((u) => u.id),
    now.toISOString(),
  );
  const first = fresh[0]!;
  const message =
    fresh.length === 1
      ? {
          title: `Not placed: ${first.strategy}`,
          body: `${first.match}: no bet on Betfair 3 minutes after it was sent. ${first.reason}`,
          ...(first.betfairEvent ? { fixPickId: first.id } : {}),
        }
      : {
          title: `${fresh.length} picks not placed`,
          body: `No bet on Betfair 3 minutes after sending: ${fresh.map((u) => `${u.strategy} (${u.match})`).join("; ")}.`,
        };
  log.info(`Not placed after 3 minutes: ${fresh.map((u) => `pick ${u.id} ${u.strategy} ${u.match}`).join("; ")}`);
  await sendPush(db, { ...message, url: "/more/admin/sending", tag: "unplaced" });
  return fresh.length;
}

/**
 * For a Not placed pick whose team Betfair spells differently: adds the Match names line(s) (alert name = Betfair's
 * name) so future alerts go out right, then hands the pick over again under Betfair's event name, if its match can
 * still be bet (the same window as the bet feed). Returns what was done; throws with a reason for the admin.
 */
export function fixAndResend(db: EngineDb, id: number, now = new Date()): { added: string[]; sent: boolean; message: string } {
  const pick = db.getLivePick(id);
  if (!pick || !pick.sentAt) throw new Error("That pick wasn't sent.");
  if (pick.manualBet || db.pickIdsWithBets().has(id)) throw new Error("That pick already has a bet.");
  if (!pick.exchangeEvent || !pick.home || !pick.away) throw new Error("Betfair's name for this match isn't known.");
  const teams = pick.exchangeEvent.split(/\s+v\s+/i);
  if (teams.length !== 2) throw new Error(`Couldn't read the two teams from "${pick.exchangeEvent}".`);
  const added: string[] = [];
  for (const [ours, theirs] of [
    [pick.home, teams[0]!],
    [pick.away, teams[1]!],
  ] as const) {
    if (ours.trim().toLowerCase() !== theirs.trim().toLowerCase()) added.push(addMatchName(db, ours, theirs));
  }
  const settings = getSendingSettings(db);
  if (now.getTime() > betableUntil(pick, settings.maxAgeMinutes)) {
    return { added, sent: false, message: "Name added for next time, but it's too late to send this bet now." };
  }
  let row: Record<string, unknown> = {};
  try {
    row = pick.sentRowJson ? (JSON.parse(pick.sentRowJson) as Record<string, unknown>) : {};
  } catch {
    row = {};
  }
  if (typeof row.marketType !== "string") throw new Error("The bet as first sent couldn't be read, so it can't be re-sent.");
  db.resendPick(id, JSON.stringify({ ...row, eventName: pick.exchangeEvent }), now.toISOString());
  log.info(`Not placed: pick ${id} re-sent as "${pick.exchangeEvent}"${added.length ? `; Match names added: ${added.join("; ")}` : ""}.`);
  return { added, sent: true, message: `Sent again as "${pick.exchangeEvent}".` };
}
