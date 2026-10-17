/**
 * The Sunday review: one notification at 19:00 UK on Sundays with the week (Monday to now, UK days): Live and Sim
 * profit, each Live strategy's week, and every current strategy suggestion (stake ladder, Live / Sim), so turning
 * points aren't missed. Tapping it opens Today, where the suggestions have their Apply buttons.
 */
import type { EngineDb } from "../storage/engine-db";
import { computeStrategyReturns } from "./winloss";
import { getSendingSettings } from "../inplayguru/bet-feed";
import { displayName } from "../inplayguru/strategy-names";
import { autoStakeQueue, visibleAdvice } from "./strategy-advice";
import { sendPush } from "./push";
import { ukDateOf, ukDayBounds } from "./uk-time";
import { ukWeekStart } from "../members/time";
import { log } from "./log";

const SENT_KEY = "weekly_review_last";
/** Sunday, 19:00 UK, sent up to 3 hours late (a restart doesn't skip it). */
const HOUR = 19;
const LATE_HOURS = 3;

const ukParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", hourCycle: "h23" });

function money(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `${r < 0 ? "-" : r > 0 ? "+" : ""}£${Math.abs(r).toFixed(2)}`;
}

export function buildWeeklyReview(db: EngineDb, now = new Date()): { title: string; body: string } {
  const from = ukDayBounds(ukWeekStart(ukDateOf(now))).from;
  const week = computeStrategyReturns(db, from);
  const settings = getSendingSettings(db);
  const totals = (mode: "live" | "sim") =>
    Object.values(week).reduce((t, r) => ({ profit: t.profit + r[mode].profit, settled: t.settled + r[mode].settled, hits: t.hits + r[mode].hits }), { profit: 0, settled: 0, hits: 0 });
  const live = totals("live");
  const sim = totals("sim");
  const lines: string[] = [];
  lines.push(`Live ${money(live.profit)} (${live.hits}–${live.settled - live.hits}) · Sim ${money(sim.profit)} (${sim.hits}–${sim.settled - sim.hits})`);
  const liveRows = Object.entries(week)
    .filter(([key, r]) => settings.strategies[key] === true && r.live.settled > 0)
    .sort((a, b) => b[1].live.profit - a[1].live.profit);
  for (const [key, r] of liveRows) lines.push(`${displayName(db, key)} ${money(r.live.profit)} · ${r.live.hits}–${r.live.settled - r.live.hits}`);
  const advice = visibleAdvice(db, now);
  if (advice.length) {
    lines.push(`To review (${advice.length}):`);
    for (const a of advice) lines.push(`• ${displayName(db, a.key)}${a.league ? ` in ${a.league.name}` : ""}: ${a.action}`);
  } else lines.push("No changes suggested this week.");
  for (const q of autoStakeQueue(db, now)) lines.push(`• Automatic: ${displayName(db, q.key)}: ${q.action.toLowerCase()} on ${new Date(q.due).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" })}`);
  return { title: `GoalBrew week: Live ${money(live.profit)}`, body: lines.join("\n") };
}

/** The week's review is due (Sunday from 19:00 UK, up to 3 hours late) and not sent yet: the week's Monday, else null. */
export function dueWeeklyReview(lastSent: string | null, now = new Date()): string | null {
  const parts = Object.fromEntries(ukParts.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  if (parts.weekday !== "Sun" || hour < HOUR || hour >= HOUR + LATE_HOURS) return null;
  const monday = ukWeekStart(ukDateOf(now));
  return lastSent === monday ? null : monday;
}

export function startWeeklyReview(db: EngineDb): void {
  const check = async () => {
    const due = dueWeeklyReview(db.getSetting(SENT_KEY), new Date());
    if (!due) return;
    db.setSetting(SENT_KEY, due);
    try {
      const msg = buildWeeklyReview(db);
      await sendPush(db, { ...msg, url: "/more/admin/today", tag: "weekly-review" });
      log.info(`Weekly review sent: ${msg.title}`);
    } catch (err) {
      log.warn(`Weekly review failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  setInterval(() => void check(), 10 * 60_000).unref?.();
  setTimeout(() => void check(), 60_000).unref?.();
}

