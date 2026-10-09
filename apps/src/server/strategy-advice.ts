/**
 * Suggestions to put a strategy Live or back to Sim, from how it has done, sent as a phone notification when one
 * first appears (and listed on the Today page). Only a suggestion: nothing is switched automatically.
 *
 *   Try Live (a Sim strategy), all of:
 *     - 50+ priced Sim picks, with the return still above zero once pulled towards zero for luck (adjusted);
 *     - still making money in Sim over the last 30 days (20+ priced picks);
 *     - beating Betfair's later price over 50+ price checks (vs typical at 5 minutes, or at kick-off);
 *     - a stop loss set.
 *   Back to Sim (a Live strategy):
 *     - losing over the last 30 days: 30+ priced Live bets and an adjusted return below -2%.
 *
 * One notification per change: the same suggestion isn't sent again until it has gone away and come back.
 */
import type { EngineDb } from "../storage/engine-db";
import { computeStrategyReturns } from "./winloss";
import { getSendingSettings } from "../inplayguru/bet-feed";
import { getStopLossRules } from "../inplayguru/stop-loss";
import { priceCheckReport } from "../betfair/price-check";
import { displayName } from "../inplayguru/strategy-names";
import { sendPush } from "./push";
import { log } from "./log";

const SAMPLE = 50;
const STATE_KEY = "strategy_advice_state";

export interface Advice {
  key: string;
  kind: "try-live" | "back-to-sim";
  reason: string;
}

const adjusted = (roi: number | null, counted: number) => (roi === null ? null : (roi * counted) / (counted + SAMPLE));
const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n * 1000) / 10}%`;

export function strategyAdvice(db: EngineDb, now = new Date()): Advice[] {
  const settings = getSendingSettings(db);
  const stops = getStopLossRules(db);
  const all = computeStrategyReturns(db, null);
  const recent = computeStrategyReturns(db, new Date(now.getTime() - 30 * 86_400_000).toISOString());
  const checks = priceCheckReport(db, 30, now);
  const typical = checks.typical.t5;
  const out: Advice[] = [];
  for (const [key, r] of Object.entries(all)) {
    const live = settings.strategies[key] === true;
    const rec = recent[key];
    if (!live) {
      const sim = r.sim;
      const adj = adjusted(sim.roi, sim.counted);
      const recentSim = rec?.sim;
      const ko = checks.rows.find((x) => x.strategy.toLowerCase() === key && x.kind === "ko");
      const t5 = checks.rows.find((x) => x.strategy.toLowerCase() === key && x.kind === "t5");
      const check = ko ? { picks: ko.picks, edge: ko.edge } : t5 && typical !== undefined ? { picks: t5.picks, edge: t5.edge - typical } : null;
      const stop = stops[key];
      const ok =
        sim.counted >= SAMPLE &&
        adj !== null &&
        adj > 0 &&
        !!recentSim &&
        recentSim.counted >= 20 &&
        recentSim.roi !== null &&
        recentSim.roi > 0 &&
        !!check &&
        check.picks >= SAMPLE &&
        check.edge > 0 &&
        !!stop &&
        (stop.dailyLoss !== null || stop.lossRun !== null);
      if (ok) {
        out.push({
          key,
          kind: "try-live",
          reason: `${pct(sim.roi!)} per £1 over ${sim.counted} Sim picks (${pct(adj!)} adjusted), ${pct(recentSim!.roi!)} in the last 30 days, and beating Betfair's later price by ${check!.edge.toFixed(1)}% over ${check!.picks} checks.`,
        });
      }
    } else if (rec) {
      const l = rec.live;
      const adj = adjusted(l.roi, l.counted);
      if (l.counted >= 30 && adj !== null && adj < -0.02) {
        out.push({ key, kind: "back-to-sim", reason: `${pct(l.roi!)} per £1 over its last ${l.counted} Live bets (30 days), ${pct(adj)} adjusted for luck.` });
      }
    }
  }
  return out;
}

/** Sends one notification for any NEW suggestions, in one message, and remembers what was sent. */
export async function notifyAdvice(db: EngineDb, now = new Date()): Promise<number> {
  const advice = strategyAdvice(db, now);
  let state: Record<string, string> = {};
  try {
    state = JSON.parse(db.getSetting(STATE_KEY) ?? "{}") as Record<string, string>;
  } catch {
    state = {};
  }
  const fresh = advice.filter((a) => state[a.key] !== a.kind);
  const next: Record<string, string> = {};
  for (const a of advice) next[a.key] = a.kind;
  db.setSetting(STATE_KEY, JSON.stringify(next));
  if (fresh.length === 0) return 0;
  const line = (a: Advice) => `${displayName(db, a.key)}: ${a.kind === "try-live" ? "ready to try Live at £1" : "consider putting back to Sim"}`;
  const body = fresh.length === 1 ? `${line(fresh[0]!)}. ${fresh[0]!.reason}` : fresh.map(line).join(" · ");
  log.info(`Strategy suggestions: ${fresh.map(line).join("; ")}`);
  await sendPush(db, { title: fresh.length === 1 ? "Strategy suggestion" : `${fresh.length} strategy suggestions`, body, url: "/more/admin/today", tag: "strategy-advice" });
  return fresh.length;
}
