/**
 * Telegram watchdog: tells the admin (push notification to every device switched on in Sending) when alerts stop
 * arriving, and again when they're back.
 *
 * Checked every 2 minutes. A problem is any of:
 *  - not watching: Telegram is set up but the listener isn't attached to the alerts chat (5 minutes' grace after a
 *    restart, while it reconnects);
 *  - catch-up failing: the catch-up sync has been failing for 30 minutes;
 *  - quiet: no new alert for 3 hours between 11:00 and 23:00 UK time, or 8 hours otherwise (the night is often quiet).
 * One notification when a problem starts, a reminder every 3 hours while it lasts, and one when everything is fine
 * again. The state is saved, so a restart doesn't send the same warning twice.
 *
 * GET /health/telegram answers 200 when all is well and 503 with the reasons when not, for an outside uptime monitor
 * (which also notices when the whole engine is down, something this watchdog can't report on itself).
 */
import type { EngineDb } from "../storage/engine-db";
import { getListenerStatus, type ListenerStatus } from "../telegram/listener";
import { sendPush } from "./push";
import { log } from "./log";

const SETTING = "telegram_watchdog";
const CHECK_MS = 2 * 60_000;
const START_GRACE_MS = 5 * 60_000;
const SYNC_FAIL_MS = 30 * 60_000;
const REMIND_MS = 3 * 60 * 60_000;

export interface WatchdogState {
  /** When the current problem was first reported, or null when all is well. */
  alertedAt: string | null;
  lastReminderAt: string | null;
  reasons: string[];
}

export interface WatchdogInput {
  now: Date;
  startedAt: Date;
  configured: boolean;
  listener: Pick<ListenerStatus, "watching" | "lastSyncAt" | "lastSyncError">;
  lastPickAt: string | null;
}

function ukHour(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(d));
}

/** What is wrong right now, in plain words (empty when all is well). */
export function telegramProblems(i: WatchdogInput): string[] {
  if (!i.configured) return [];
  const out: string[] = [];
  const now = i.now.getTime();
  const settled = now - i.startedAt.getTime() >= START_GRACE_MS;
  if (settled && !i.listener.watching) out.push("The Telegram listener isn't connected to the alerts chat.");
  if (settled && i.listener.lastSyncError) {
    const lastOk = i.listener.lastSyncAt ? Date.parse(i.listener.lastSyncAt) : i.startedAt.getTime();
    if (now - lastOk >= SYNC_FAIL_MS) out.push(`Telegram catch-up has been failing for over 30 minutes (${i.listener.lastSyncError}).`);
  }
  if (i.lastPickAt) {
    const hour = ukHour(i.now);
    const quietHours = hour >= 11 && hour < 23 ? 3 : 8;
    const gap = now - Date.parse(i.lastPickAt);
    if (settled && gap >= quietHours * 3_600_000) out.push(`No alert has arrived for ${Math.floor(gap / 3_600_000)} hours.`);
  }
  return out;
}

export type WatchdogAction = { kind: "none" } | { kind: "alert" | "remind"; reasons: string[] } | { kind: "recovered"; downFor: number };

/** What to send, given what's wrong now and what was already sent. */
export function watchdogStep(state: WatchdogState, problems: string[], now: Date): { action: WatchdogAction; state: WatchdogState } {
  const at = now.toISOString();
  if (problems.length === 0) {
    if (!state.alertedAt) return { action: { kind: "none" }, state };
    return { action: { kind: "recovered", downFor: now.getTime() - Date.parse(state.alertedAt) }, state: { alertedAt: null, lastReminderAt: null, reasons: [] } };
  }
  if (!state.alertedAt) return { action: { kind: "alert", reasons: problems }, state: { alertedAt: at, lastReminderAt: at, reasons: problems } };
  const last = Date.parse(state.lastReminderAt ?? state.alertedAt);
  if (now.getTime() - last >= REMIND_MS) return { action: { kind: "remind", reasons: problems }, state: { ...state, lastReminderAt: at, reasons: problems } };
  return { action: { kind: "none" }, state: { ...state, reasons: problems } };
}

function loadState(db: EngineDb): WatchdogState {
  try {
    const raw = db.getSetting(SETTING);
    if (raw) {
      const s = JSON.parse(raw) as Partial<WatchdogState>;
      return { alertedAt: s.alertedAt ?? null, lastReminderAt: s.lastReminderAt ?? null, reasons: Array.isArray(s.reasons) ? s.reasons : [] };
    }
  } catch {
    // start clean
  }
  return { alertedAt: null, lastReminderAt: null, reasons: [] };
}

function lastPickAt(db: EngineDb): string | null {
  const row = db.sqlite.prepare("SELECT MAX(first_seen_at) AS at FROM live_picks").get() as { at: string | null } | undefined;
  return row?.at ?? null;
}

const startedAt = new Date();

function telegramConfigured(env = process.env): boolean {
  return Boolean(env.TELEGRAM_API_ID && env.TELEGRAM_API_HASH && env.TELEGRAM_SESSION && env.TELEGRAM_SOURCE_CHAT_ID) || getListenerStatus().watching !== null;
}

/** The current problems, for GET /health/telegram. */
export function telegramHealth(db: EngineDb, now = new Date()): { ok: boolean; problems: string[]; lastAlertAt: string | null } {
  const last = lastPickAt(db);
  const problems = telegramProblems({ now, startedAt, configured: telegramConfigured(), listener: getListenerStatus(), lastPickAt: last });
  return { ok: problems.length === 0, problems, lastAlertAt: last };
}

const hoursMins = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

export function startTelegramWatchdog(db: EngineDb): () => void {
  const tick = async () => {
    try {
      const now = new Date();
      const { problems } = telegramHealth(db, now);
      const { action, state } = watchdogStep(loadState(db), problems, now);
      db.setSetting(SETTING, JSON.stringify(state));
      if (action.kind === "none") return;
      if (action.kind === "recovered") {
        log.info(`Telegram watchdog: alerts are arriving again (down ${hoursMins(action.downFor)}).`);
        await sendPush(db, { title: "Telegram alerts are back", body: `GoalBrew is receiving alerts again (they were down about ${hoursMins(action.downFor)}).`, url: "/more/admin/settings", tag: "telegram-watchdog" });
        return;
      }
      log.warn(`Telegram watchdog: ${action.reasons.join(" ")}`);
      const reached = await sendPush(db, {
        title: action.kind === "alert" ? "Telegram alerts have stopped" : "Telegram alerts are still down",
        body: `${action.reasons.join(" ")} Open Admin > Settings > Telegram to reconnect.`,
        url: "/more/admin/settings",
        tag: "telegram-watchdog",
      });
      if (reached === 0) log.warn("Telegram watchdog: no device is set up for notifications (switch them on in Sending).");
    } catch (err) {
      log.error(`Telegram watchdog check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const timer = setInterval(() => void tick(), CHECK_MS);
  return () => clearInterval(timer);
}
