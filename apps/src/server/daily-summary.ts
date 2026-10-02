/**
 * Today's results so far as a push notification, at set UK times: Live and Sim profit for the UK day, with each strategy
 * that settled anything. Figures are worked out exactly as the Strategies page does (computeStrategyReturns).
 */
import type { EngineDb } from "../storage/engine-db";
import { displayName } from "../inplayguru/strategy-names";
import { computeStrategyReturns, type StrategyReturn } from "./winloss";
import { sendPush } from "./push";
import { ukDateOf, ukDayBounds } from "./uk-time";
import { log } from "./log";

/** When the summary goes out, UK time (HH:MM). */
export const SUMMARY_TIMES = ["06:50", "14:00", "17:00", "21:30"];
/** A time is still sent this long after it passes, so a restart just before it doesn't skip it. */
const LATE_MS = 10 * 60 * 1000;
/** The last summary sent, as "YYYY-MM-DD HH:MM", so each goes out once. */
const SENT_KEY = "summary_push_last";
/** Most strategies listed one by one; the rest are left to the app. */
const MAX_LINES = 6;

const ukClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function money(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `${r < 0 ? "-" : r > 0 ? "+" : ""}£${Math.abs(r).toFixed(2)}`;
}

function record(r: StrategyReturn): string {
  return `${r.hits}–${r.settled - r.hits}`;
}

/** The notification for the UK day `now` falls in. */
export function buildDailySummary(db: EngineDb, now = new Date()): { title: string; body: string } {
  const { from } = ukDayBounds(ukDateOf(now));
  const returns = Object.entries(computeStrategyReturns(db, from));
  const total = (mode: "live" | "sim") =>
    returns.reduce(
      (t, [, r]) => ({ profit: t.profit + r[mode].profit, staked: t.staked + r[mode].staked, settled: t.settled + r[mode].settled, hits: t.hits + r[mode].hits }),
      { profit: 0, staked: 0, settled: 0, hits: 0 },
    );
  const live = total("live");
  const sim = total("sim");
  const time = ukClock.format(now);

  if (live.settled === 0 && sim.settled === 0) {
    return { title: `GoalBrew ${time}: no results yet today`, body: "Nothing has settled since midnight." };
  }

  const lines: string[] = [];
  const roi = (t: { profit: number; staked: number }) => (t.staked > 0 ? ` (${Math.round((t.profit / t.staked) * 100)}% return)` : "");
  if (live.settled > 0) lines.push(`Live ${money(live.profit)} · ${live.hits}–${live.settled - live.hits}${roi(live)}`);
  if (sim.settled > 0) lines.push(`Sim ${money(sim.profit)} · ${sim.hits}–${sim.settled - sim.hits}${roi(sim)}`);

  // Each strategy that settled something today, biggest money first; Live figures where it bet for real.
  const labels = new Map(db.listStrategiesForAdmin().map((x) => [x.label.toLowerCase(), x.label]));
  const rows = returns
    .map(([key, r]) => {
      const mode = r.live.settled > 0 ? "live" : "sim";
      return { name: displayName(db, labels.get(key) ?? key), r: r[mode], mode };
    })
    .filter((x) => x.r.settled > 0)
    .sort((a, b) => Math.abs(b.r.profit) - Math.abs(a.r.profit));
  for (const x of rows.slice(0, MAX_LINES)) {
    lines.push(`${x.name}${x.mode === "sim" ? " (Sim)" : ""} ${money(x.r.profit)} · ${record(x.r)}`);
  }
  if (rows.length > MAX_LINES) lines.push(`+${rows.length - MAX_LINES} more in the app`);

  const headline = live.settled > 0 ? `Live ${money(live.profit)}` : `Sim ${money(sim.profit)}`;
  return { title: `GoalBrew ${time}: ${headline} today`, body: lines.join("\n") };
}

/** The summary time due at `now` that hasn't been sent yet, as "YYYY-MM-DD HH:MM", or null. */
export function dueSummary(lastSent: string | null, now = new Date()): string | null {
  const date = ukDateOf(now);
  const { from } = ukDayBounds(date);
  // Minutes since UK midnight, from the day's real start (so it holds on the days the clocks change).
  const minutes = Math.floor((now.getTime() - Date.parse(from)) / 60_000);
  for (const t of SUMMARY_TIMES) {
    const [h, m] = t.split(":").map(Number) as [number, number];
    const at = h * 60 + m;
    const slot = `${date} ${t}`;
    if (minutes >= at && minutes < at + LATE_MS / 60_000 && (lastSent === null || slot > lastSent)) return slot;
  }
  return null;
}

/** Checks every 30 seconds and sends each summary once. */
export function startDailySummary(db: EngineDb): () => void {
  const tick = async () => {
    try {
      const slot = dueSummary(db.getSetting(SENT_KEY));
      if (!slot) return;
      // Marked first, so a slow or failed push never sends it twice.
      db.setSetting(SENT_KEY, slot);
      const message = buildDailySummary(db);
      const reached = await sendPush(db, { ...message, url: "/dashboard", tag: `summary-${slot}` });
      log.info(`Daily summary ${slot} sent to ${reached} device(s): ${message.title}`);
    } catch (err) {
      log.error(`Daily summary failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const timer = setInterval(() => void tick(), 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
