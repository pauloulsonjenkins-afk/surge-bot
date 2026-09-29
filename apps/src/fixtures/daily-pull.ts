/**
 * Pulls the day's fixtures from API-Football twice a day, at 06:00 and 15:00 UK
 * time (Europe/London, so it follows the clocks going forward and back). The
 * 15:00 run refreshes kick-off changes and postponements and brings in statuses.
 *
 * Each run fetches today and tomorrow: 2 of the free plan's 100 daily requests,
 * so two runs use 4. Having tomorrow already stored means the Schedule tab has
 * something to show between midnight and 06:00, and a Tomorrow view.
 *
 * Restarts: the check runs every minute, so an engine that restarts or redeploys
 * later in the day pulls straight away if the latest slot hasn't been pulled yet
 * (once, not once per missed slot). A failed run is retried after 30 minutes, at
 * most 4 times per slot, so a bad key or a plan problem can't eat the allowance.
 */
import type { EngineDb } from "../storage/engine-db";
import { fetchFixturesForDate } from "./api-football";
import { log } from "../server/log";

/** UK hours (24h clock) at which a pull is due, in order. */
const PULL_HOURS_UK = [6, 15];
const RETRY_AFTER_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS_PER_SLOT = 4;
const STATUS_KEY = "schedule_pull";

/** What the Schedule tab shows about the last pull. Stored in the settings table. */
export interface SchedulePullStatus {
  /** The latest scheduled slot that was pulled successfully, e.g. "2026-09-29T15". */
  lastSuccessSlot: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  /** The slot the attempt count below belongs to. */
  attemptsSlot: string | null;
  attempts: number;
  lastError: string | null;
  remainingToday: number | null;
}

const EMPTY_STATUS: SchedulePullStatus = {
  lastSuccessSlot: null,
  lastSuccessAt: null,
  lastAttemptAt: null,
  attemptsSlot: null,
  attempts: 0,
  lastError: null,
  remainingToday: null,
};

const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
const ukHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" });

export function ukDateOf(d: Date): string {
  return ukDay.format(d);
}

export function addDays(ukDate: string, days: number): string {
  const [y, m, d] = ukDate.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return t.toISOString().slice(0, 10);
}

export function readPullStatus(db: EngineDb): SchedulePullStatus {
  try {
    const raw = db.getSetting(STATUS_KEY);
    return raw ? { ...EMPTY_STATUS, ...(JSON.parse(raw) as Partial<SchedulePullStatus>) } : { ...EMPTY_STATUS };
  } catch {
    return { ...EMPTY_STATUS };
  }
}

function savePullStatus(db: EngineDb, status: SchedulePullStatus): void {
  db.setSetting(STATUS_KEY, JSON.stringify(status));
}

/** The most recent pull slot that has already arrived today (UK time), or null before the first one. */
export function dueSlot(now: Date): string | null {
  const hour = Number(ukHour.format(now));
  const passed = PULL_HOURS_UK.filter((h) => hour >= h);
  const latest = passed[passed.length - 1];
  return latest === undefined ? null : `${ukDateOf(now)}T${String(latest).padStart(2, "0")}`;
}

/** True when a run should happen now. Exported for testing. */
export function shouldPull(status: SchedulePullStatus, now: Date): boolean {
  const slot = dueSlot(now);
  if (slot === null) return false;
  // Slots sort as text (YYYY-MM-DDTHH), so a later success also covers an earlier slot.
  if (status.lastSuccessSlot !== null && status.lastSuccessSlot >= slot) return false;
  const attempts = status.attemptsSlot === slot ? status.attempts : 0;
  if (attempts >= MAX_ATTEMPTS_PER_SLOT) return false;
  if (status.attemptsSlot === slot && status.lastAttemptAt) {
    if (now.getTime() - Date.parse(status.lastAttemptAt) < RETRY_AFTER_MS) return false;
  }
  return true;
}

export async function runPull(db: EngineDb, apiKey: string, now = new Date()): Promise<void> {
  const today = ukDateOf(now);
  const slot = dueSlot(now) ?? `${today}T00`;
  const status = readPullStatus(db);
  const attempts = status.attemptsSlot === slot ? status.attempts : 0;
  const next: SchedulePullStatus = {
    ...status,
    lastAttemptAt: now.toISOString(),
    attemptsSlot: slot,
    attempts: attempts + 1,
  };

  try {
    // Today is the one that matters: if it fails, the run fails and is retried.
    const first = await fetchFixturesForDate(apiKey, today);
    db.replaceScheduleDay(today, first.fixtures, now.toISOString());
    let total = first.fixtures.length;
    let remaining = first.remainingToday;

    // Tomorrow is a bonus: a problem here is logged but doesn't fail the run or use up retries.
    const tomorrow = addDays(today, 1);
    try {
      const second = await fetchFixturesForDate(apiKey, tomorrow);
      db.replaceScheduleDay(tomorrow, second.fixtures, now.toISOString());
      total += second.fixtures.length;
      remaining = second.remainingToday ?? remaining;
    } catch (err) {
      log.warn(`Could not pull tomorrow's fixtures (${tomorrow}): ${err instanceof Error ? err.message : String(err)}`);
    }

    db.pruneScheduleBefore(addDays(today, -1));
    savePullStatus(db, {
      ...next,
      lastSuccessSlot: slot,
      lastSuccessAt: now.toISOString(),
      lastError: null,
      remainingToday: remaining,
    });
    log.info(
      `Fixtures pulled from API-Football (${slot.slice(11)}:00 run): ${total} match(es) for ${today} and the day after` +
        `${remaining !== null ? ` (${remaining} request(s) left today)` : ""}.`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    savePullStatus(db, { ...next, lastError: message.slice(0, 300) });
    log.error(`Fixture pull failed (attempt ${next.attempts} of ${MAX_ATTEMPTS_PER_SLOT} for the ${slot.slice(11)}:00 run): ${message}`);
  }
}

export function startDailyFixturePull(db: EngineDb, apiKey: string): void {
  let running = false;
  const tick = () => {
    if (running) return;
    if (!shouldPull(readPullStatus(db), new Date())) return;
    running = true;
    runPull(db, apiKey).finally(() => {
      running = false;
    });
  };
  tick();
  setInterval(tick, 60 * 1000).unref();
  log.info(`Fixture pull scheduled for ${PULL_HOURS_UK.map((h) => `${String(h).padStart(2, "0")}:00`).join(" and ")} UK time.`);
}
