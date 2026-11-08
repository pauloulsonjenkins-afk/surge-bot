/**
 * Golden alert notifications: a phone notification the moment an alert arrives in a watched slice the admin has
 * switched "Notify me" on for (Golden page), so a Sim one can be considered for a bet by hand, and a Live one seen.
 *
 *   - One notification per alert, however many switched-on slices it is in.
 *   - Quiet hours (on unless switched off): nothing between 23:00 and 07:00 UK time.
 *   - Only fresh alerts: one recovered by the catch-up sync more than 10 minutes after it was posted isn't sent.
 *   - The notification has a "Mute" button that switches that slice's notifications off (public/sw.js).
 * Since 8 Nov 2026 (owner: "alerts on games where the strategy is doing well that day / Golden slice"), two more switches:
 *   - Every Golden slice: any watched slice counts, without switching each one on.
 *   - Doing well today: an alert from a strategy that has already settled HOT_MIN_SETTLED or more priced picks today
 *     (UK day, Live and Sim together), is up in units and winning at or above its break-even rate. Same-day form is a
 *     weak guide on its own; this tells you, it doesn't bet.
 *   An alert that is both gets one notification saying both.
 * Nothing here bets or changes how anything is bet.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { alertOddsOfPick, getSendingSettings, pickSegments, segmentBetFor, strategyLabel } from "../inplayguru/bet-feed";
import { displayName } from "../inplayguru/strategy-names";
import { marketName } from "../members/catalogue";
import { computeStrategyReturns } from "./winloss";
import { ukDateOf, ukDayBounds } from "./uk-time";
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
  /** Every watched Golden slice counts, whatever its own switch. */
  allSlices: boolean;
  /** Alerts from a strategy doing well today (hotToday). */
  hotToday: boolean;
}

/** "Doing well today" needs at least this many settled, priced picks today. */
export const HOT_MIN_SETTLED = 3;

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
    return { slices, quiet: raw.quiet !== false, allSlices: raw.allSlices === true, hotToday: raw.hotToday === true };
  } catch {
    return { slices: {}, quiet: true, allSlices: false, hotToday: false };
  }
}

/** Switches one slice's notifications on or off, and/or quiet hours. Returns the settings now in force. */
export function setGoldenNotify(
  db: EngineDb,
  patch: { slice?: { strategyKey: string; id: string; on: boolean }; quiet?: boolean; allSlices?: boolean; hotToday?: boolean },
): GoldenNotifySettings {
  const s = getGoldenNotify(db);
  if (patch.slice) {
    const k = `${patch.slice.strategyKey.toLowerCase()}#${patch.slice.id}`;
    if (patch.slice.on) s.slices[k] = true;
    else delete s.slices[k];
  }
  if (typeof patch.quiet === "boolean") s.quiet = patch.quiet;
  if (typeof patch.allSlices === "boolean") s.allSlices = patch.allSlices;
  if (typeof patch.hotToday === "boolean") s.hotToday = patch.hotToday;
  db.setSetting(KEY, JSON.stringify(s));
  return s;
}

/** 23:00 to 07:00 UK time. */
export function isQuietHour(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour >= 23 || hour < 7;
}

/**
 * A strategy's record today (UK day, Live and Sim together, priced picks only), and whether it counts as doing well:
 * HOT_MIN_SETTLED+ settled, up in units, and winning at or above its break-even rate. Null with nothing settled today.
 */
export function todayForm(db: EngineDb, key: string, now = new Date()): { settled: number; won: number; units: number; hitRate: number; breakeven: number | null; hot: boolean } | null {
  const from = ukDayBounds(ukDateOf(now)).from;
  const rows = db.listResultsForWinLoss(from).filter((r) => strategyLabel(r.strategy).toLowerCase() === key);
  const r = computeStrategyReturns(db, from, { rows })[key]?.all;
  if (!r || r.counted === 0) return null;
  const hitRate = Math.round((1000 * r.pricedHits) / r.counted) / 10;
  const breakeven = r.breakevenEffective ?? r.breakeven ?? null;
  const units = Math.round((r.units ?? 0) * 100) / 100;
  const hot = r.counted >= HOT_MIN_SETTLED && units > 0 && breakeven !== null && hitRate >= breakeven;
  return { settled: r.counted, won: r.pricedHits, units, hitRate, breakeven, hot };
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
  const on = segments.filter((s) => notify.allSlices || notify.slices[`${key}#${s.id}`]);
  if (on.length === 0 && !notify.hotToday) return null;
  if (notify.quiet && isQuietHour(now)) return null;
  const posted = Date.parse(p.messageAt ?? p.firstSeenAt);
  if (Number.isFinite(posted) && now.getTime() - posted > FRESH_MS) return null;
  // Worked out only when the switch is on and a notification could still go (it reads today's settled picks).
  const form = notify.hotToday ? todayForm(db, key, now) : null;
  const hot = form?.hot === true;
  if (on.length === 0 && !hot) return null;

  const first = on[0];
  const sliceNames = on.map((s) => s.label.replace(/^Golden: /, "")).join(" · ");
  const formLine = form && hot ? `Today: ${form.won} of ${form.settled} won · ${form.units > 0 ? "+" : ""}${form.units}u · ${form.hitRate}% vs ${form.breakeven}% needed` : null;
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
    title: `${first ? "Golden alert" : "Doing well today"} · ${displayName(db, key)}`,
    body: [first ? sliceNames : null, formLine, match, `${bet} · ${what}`].filter(Boolean).join("\n"),
    url: "/live",
    tag: `golden-${p.id}`,
    ...(first ? { muteSlice: { strategyKey: key, id: first.id, name: first.label.replace(/^Golden: /, "") } } : {}),
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
