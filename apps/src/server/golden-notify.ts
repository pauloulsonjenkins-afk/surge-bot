/**
 * Golden alert notifications: a phone notification the moment an alert arrives in a watched slice the admin has
 * switched "Notify me" on for (Golden page), so a Sim one can be considered for a bet by hand, and a Live one seen.
 *
 *   - One notification per alert, however many switched-on slices it is in.
 *   - Quiet hours (on unless switched off): nothing between 23:00 and 07:00 UK time.
 *   - Only fresh alerts: one recovered by the catch-up sync more than 10 minutes after it was posted isn't sent.
 *   - The notification has a "Mute" button that switches that slice's notifications off (public/sw.js).
 * Nothing here bets or changes how anything is bet.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { alertOddsOfPick, getSendingSettings, pickSegments, segmentBetFor, strategyLabel } from "../inplayguru/bet-feed";
import { displayName } from "../inplayguru/strategy-names";
import { marketName } from "../members/catalogue";
import { sendPush, type PushMessage } from "./push";
import { log } from "./log";

const KEY = "golden_notify";
/** An alert older than this when stored (recovered by the catch-up sync) is too late to act on. */
const FRESH_MS = 10 * 60_000;

export interface GoldenNotifySettings {
  /** "strategy key#slice id" -> notify. */
  slices: Record<string, true>;
  /** No notifications between 23:00 and 07:00 UK time. */
  quiet: boolean;
}

export function getGoldenNotify(db: EngineDb): GoldenNotifySettings {
  try {
    const raw = JSON.parse(db.getSetting(KEY) ?? "{}") as Partial<GoldenNotifySettings>;
    const slices: Record<string, true> = {};
    // The strategy part is lower case; the slice id keeps its own case (finder slices are named like "f-closeMatch+homeDown1").
    for (const [k, v] of Object.entries(raw.slices ?? {})) {
      if (v !== true) continue;
      const at = k.indexOf("#");
      slices[at < 0 ? k : `${k.slice(0, at).toLowerCase()}${k.slice(at)}`] = true;
    }
    return { slices, quiet: raw.quiet !== false };
  } catch {
    return { slices: {}, quiet: true };
  }
}

/** Switches one slice's notifications on or off, and/or quiet hours. Returns the settings now in force. */
export function setGoldenNotify(
  db: EngineDb,
  patch: { slice?: { strategyKey: string; id: string; on: boolean }; quiet?: boolean },
): GoldenNotifySettings {
  const s = getGoldenNotify(db);
  if (patch.slice) {
    const k = `${patch.slice.strategyKey.toLowerCase()}#${patch.slice.id}`;
    if (patch.slice.on) s.slices[k] = true;
    else delete s.slices[k];
  }
  if (typeof patch.quiet === "boolean") s.quiet = patch.quiet;
  db.setSetting(KEY, JSON.stringify(s));
  return s;
}

/** 23:00 to 07:00 UK time. */
export function isQuietHour(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour >= 23 || hour < 7;
}

/**
 * The notification for a new alert, or null when none is due: not in a switched-on slice, quiet hours, or too old.
 * `segments` are the watched slices the alert is in (pickSegments).
 */
export function goldenNotification(
  db: EngineDb,
  p: LivePick,
  segments: Array<{ id: string; label: string }>,
  now = new Date(),
): PushMessage | null {
  const notify = getGoldenNotify(db);
  const key = strategyLabel(p.strategy).toLowerCase();
  const on = segments.filter((s) => notify.slices[`${key}#${s.id}`]);
  if (on.length === 0) return null;
  if (notify.quiet && isQuietHour(now)) return null;
  const posted = Date.parse(p.messageAt ?? p.firstSeenAt);
  if (Number.isFinite(posted) && now.getTime() - posted > FRESH_MS) return null;

  const first = on[0]!;
  const sliceNames = on.map((s) => s.label.replace(/^Golden: /, "")).join(" · ");
  const match = [p.home && p.away ? `${p.home} v ${p.away}` : null, p.minute !== null ? `${p.minute}'` : "pre-match"].filter(Boolean).join(", ");
  const odds = alertOddsOfPick(p);
  const bet = [marketName(p.market) ?? p.selection ?? p.market, odds ? `@ ${odds.toFixed(2)}` : null].filter(Boolean).join(" ");

  // What GoalBrew does with it: its own Golden betting, else its strategy's, else nothing (Sim).
  const settings = getSendingSettings(db);
  const own = segmentBetFor(settings, p);
  const strategyLive = settings.enabled && settings.strategies[key] === true;
  const what = own
    ? own.cfg.live && settings.enabled
      ? `Bet Live${own.cfg.stakePct != null ? ` at ${own.cfg.stakePct}%` : ""}`
      : "Sim: not bet"
    : strategyLive
      ? "Bet Live with its strategy"
      : "Sim: not bet";

  return {
    title: `Golden alert · ${displayName(db, key)}`,
    body: `${sliceNames}\n${match}\n${bet} · ${what}`,
    url: "/live",
    tag: `golden-${p.id}`,
    muteSlice: { strategyKey: key, id: first.id, name: first.label.replace(/^Golden: /, "") },
  };
}

/** Sends the notification for a newly stored alert, if one is due. Never throws. */
export async function notifyGoldenAlert(db: EngineDb, p: LivePick, now = new Date()): Promise<void> {
  try {
    const message = goldenNotification(db, p, pickSegments(p), now);
    if (!message) return;
    const reached = await sendPush(db, message);
    log.info(`Golden alert notification for pick ${p.id}: reached ${reached} device(s).`);
  } catch (err) {
    log.warn(`Golden alert notification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
