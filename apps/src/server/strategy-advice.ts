/**
 * Suggestions for each strategy, from how it has done, sent as a phone notification when one first appears and listed
 * on the Today page (and on the strategy's card) with an Apply button. Nothing changes until the admin presses Apply.
 *
 *   Try Live (a Sim strategy), all of:
 *     - 50+ priced Sim picks, with the return still above zero once pulled towards zero for luck (adjusted);
 *     - still making money in Sim over the last 30 days (20+ priced picks);
 *     - beating Betfair's later price over 50+ price checks (vs typical at 5 minutes, or at kick-off);
 *     - a stop loss set.
 *     Apply: Live at £1 (or its own stake if it has one).
 *   Back to Sim (a Live strategy):
 *     - losing over the last 30 days: 30+ priced Live bets and an adjusted return below -2%.
 *   THE STAKE LADDER (a Live strategy, judged on its Live bets since its rules last changed):
 *     - Raise one step: 50+ priced Live bets, a return of +5% or more, its priced picks hitting above the break-even
 *       its winners actually paid, and still making money over the last 30 days.
 *     - Lower one step: 30+ priced Live bets and losing, but not badly enough for "back to Sim".
 *     Steps: 1, 1.5, 2, 3, 4, 5 (% of the balance), or £1, £2, £3, £5 for a flat stake. The highest-stake limit on
 *     Sending still caps every bet.
 *
 * One notification per change: the same suggestion isn't sent again until it has gone away and come back.
 *
 * AUTOMATIC STAKES (Sending: ladderAuto): stake raises and cuts are applied by the hourly check instead of waiting,
 * one step per strategy at most every 7 days (counting manual Applies too), each with its own notification. "Try Live"
 * and "Back to Sim" are never automatic.
 */
import type { EngineDb } from "../storage/engine-db";
import { computeStrategyReturns, type StrategyReturn } from "./winloss";
import { getSendingSettings, saveSendingSettings } from "../inplayguru/bet-feed";
import { getStopLossRules } from "../inplayguru/stop-loss";
import { priceCheckReport } from "../betfair/price-check";
import { displayName } from "../inplayguru/strategy-names";
import { sendPush } from "./push";
import { log } from "./log";

const SAMPLE = 50;
const STATE_KEY = "strategy_advice_state";
/** When each strategy's stake last moved on the ladder (manually or automatically), so automatic steps are 7 days apart. */
const LAST_STEP_KEY = "stake_ladder_last_step";
export const AUTO_GAP_MS = 7 * 86_400_000;

function lastSteps(db: EngineDb): Record<string, string> {
  try {
    return JSON.parse(db.getSetting(LAST_STEP_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
export const PCT_STEPS = [1, 1.5, 2, 3, 4, 5];
export const FLAT_STEPS = [1, 2, 3, 5];

export type AdviceKind = "try-live" | "back-to-sim" | "stake-up" | "stake-down";

export interface Advice {
  key: string;
  kind: AdviceKind;
  reason: string;
  /** What Apply does, in words ("Raise to 3% of the balance"). */
  action: string;
  /** The stake after Apply (stake-up / stake-down / try-live). */
  to?: { pct: number } | { flat: number };
}

const adjusted = (roi: number | null, counted: number) => (roi === null ? null : (roi * counted) / (counted + SAMPLE));
const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n * 1000) / 10}%`;
const stakeWords = (to: { pct: number } | { flat: number }) => ("pct" in to ? `${to.pct}% of the balance` : `£${to.flat}`);

/** The next step up or down the ladder from the current stake, or null at the end of it. */
export function ladderStep(current: { pct: number } | { flat: number }, dir: 1 | -1): { pct: number } | { flat: number } | null {
  const steps = "pct" in current ? PCT_STEPS : FLAT_STEPS;
  const now = "pct" in current ? current.pct : current.flat;
  const next = dir === 1 ? steps.find((s) => s > now + 1e-9) : [...steps].reverse().find((s) => s < now - 1e-9);
  if (next === undefined) return null;
  return "pct" in current ? { pct: next } : { flat: next };
}

function beatsBreakeven(r: StrategyReturn): boolean {
  if (!r.counted || r.pricedHits === undefined) return false;
  const be = r.breakevenEffective ?? r.breakeven;
  return be !== null && (100 * r.pricedHits) / r.counted > be;
}

export function strategyAdvice(db: EngineDb, now = new Date()): Advice[] {
  const settings = getSendingSettings(db);
  const stops = getStopLossRules(db);
  const all = computeStrategyReturns(db, null);
  // The ladder judges a strategy's current rules only: from its rule change, like its card.
  const sinceChange = computeStrategyReturns(db, null, { fromRuleChange: true });
  const recent = computeStrategyReturns(db, new Date(now.getTime() - 30 * 86_400_000).toISOString(), { fromRuleChange: true });
  const checks = priceCheckReport(db, 30, now);
  const typical = checks.typical.t5;
  const out: Advice[] = [];
  for (const [key, r] of Object.entries(all)) {
    const live = settings.enabled && settings.strategies[key] === true;
    const rec = recent[key];
    const stake = settings.stakePct[key] !== undefined ? { pct: settings.stakePct[key]! } : settings.stakes[key] !== undefined ? { flat: settings.stakes[key]! } : null;
    if (!live) {
      if (settings.strategies[key] === true) continue; // switched Live, but betting is off overall: nothing to suggest
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
        const to = stake ?? { flat: 1 };
        out.push({
          key,
          kind: "try-live",
          action: `Put Live at ${stakeWords(to)}`,
          to,
          reason: `${pct(sim.roi!)} per £1 over ${sim.counted} Sim picks (${pct(adj!)} adjusted), ${pct(recentSim!.roi!)} in the last 30 days, and beating Betfair's later price by ${check!.edge.toFixed(1)}% over ${check!.picks} checks.`,
        });
      }
      continue;
    }
    // Live: back to Sim first (losing clearly over the last 30 days), else the stake ladder.
    if (rec) {
      const l = rec.live;
      const adj = adjusted(l.roi, l.counted);
      if (l.counted >= 30 && adj !== null && adj < -0.02) {
        out.push({ key, kind: "back-to-sim", action: "Put back to Sim", reason: `${pct(l.roi!)} per £1 over its last ${l.counted} Live bets (30 days), ${pct(adj)} adjusted for luck.` });
        continue;
      }
    }
    const l = sinceChange[key]?.live;
    if (!l || !stake) continue;
    const recentOk = !!rec && rec.live.counted > 0 && rec.live.roi !== null && rec.live.roi > 0;
    if (l.counted >= SAMPLE && l.roi !== null && l.roi >= 0.05 && beatsBreakeven(l) && recentOk) {
      const to = ladderStep(stake, 1);
      if (to) {
        const be = l.breakevenEffective ?? l.breakeven;
        out.push({
          key,
          kind: "stake-up",
          action: `Raise to ${stakeWords(to)}`,
          to,
          reason: `${pct(l.roi)} per £1 over ${l.counted} Live bets, hitting ${Math.round((1000 * l.pricedHits) / l.counted) / 10}% against ${be}% needed, and still up over the last 30 days.`,
        });
      }
    } else if (l.counted >= 30 && l.roi !== null && l.roi < 0) {
      const to = ladderStep(stake, -1);
      if (to) out.push({ key, kind: "stake-down", action: `Lower to ${stakeWords(to)}`, to, reason: `${pct(l.roi)} per £1 over ${l.counted} Live bets since its rules last changed.` });
    }
  }
  return out;
}

/** Carries out one current suggestion (the admin pressed Apply). Throws if it no longer applies. */
export function applyAdvice(db: EngineDb, key: string, kind: AdviceKind, now = new Date()): Advice {
  const a = strategyAdvice(db, now).find((x) => x.key === key.toLowerCase() && x.kind === kind);
  if (!a) throw new Error("That suggestion no longer applies. Refresh to see the current ones.");
  const k = a.key;
  if (a.kind === "back-to-sim") saveSendingSettings(db, { strategies: { [k]: false } });
  else {
    const to = a.to!;
    const stake = "pct" in to ? { stakePct: { [k]: to.pct } } : { stakes: { [k]: to.flat } };
    saveSendingSettings(db, { ...stake, ...(a.kind === "try-live" ? { strategies: { [k]: true } } : {}) });
  }
  if (a.kind === "stake-up" || a.kind === "stake-down") db.setSetting(LAST_STEP_KEY, JSON.stringify({ ...lastSteps(db), [k]: now.toISOString() }));
  log.info(`Strategy suggestion applied: ${displayName(db, k)}: ${a.action}.`);
  return a;
}

const LABEL: Record<AdviceKind, string> = {
  "try-live": "ready to try Live",
  "back-to-sim": "consider putting back to Sim",
  "stake-up": "worth a bigger stake",
  "stake-down": "worth a smaller stake",
};

/** With automatic stakes on: applies each stake step that's due (7+ days since that strategy's last step). Returns them. */
export function autoApplyStakes(db: EngineDb, now = new Date()): Advice[] {
  if (!getSendingSettings(db).ladderAuto) return [];
  const last = lastSteps(db);
  const done: Advice[] = [];
  for (const a of strategyAdvice(db, now)) {
    if (a.kind !== "stake-up" && a.kind !== "stake-down") continue;
    const prev = last[a.key];
    if (prev && now.getTime() - Date.parse(prev) < AUTO_GAP_MS) continue;
    try {
      done.push(applyAdvice(db, a.key, a.kind, now));
    } catch (err) {
      log.warn(`Automatic stake for ${a.key} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return done;
}

/** Sends one notification for any NEW suggestions, in one message, and remembers what was sent. */
export async function notifyAdvice(db: EngineDb, now = new Date()): Promise<number> {
  // Automatic stakes first, each told on its own; what's left are suggestions.
  for (const a of autoApplyStakes(db, now)) {
    await sendPush(db, {
      title: `Stake ${a.kind === "stake-up" ? "raised" : "lowered"}: ${displayName(db, a.key)}`,
      body: `${a.action.replace(/^Raise/, "Raised").replace(/^Lower/, "Lowered")} automatically. ${a.reason} Turn automatic stakes off on Betting → Limits.`,
      url: "/more/admin/strategies",
      tag: `stake-auto-${a.key}`,
    });
  }
  const advice = strategyAdvice(db, now);
  let state: Record<string, string> = {};
  try {
    state = JSON.parse(db.getSetting(STATE_KEY) ?? "{}") as Record<string, string>;
  } catch {
    state = {};
  }
  const sig = (a: Advice) => `${a.kind}:${a.action}`;
  const fresh = advice.filter((a) => state[a.key] !== sig(a) && state[a.key] !== a.kind);
  const next: Record<string, string> = {};
  for (const a of advice) next[a.key] = sig(a);
  db.setSetting(STATE_KEY, JSON.stringify(next));
  if (fresh.length === 0) return 0;
  const line = (a: Advice) => `${displayName(db, a.key)}: ${LABEL[a.kind]} (${a.action.toLowerCase()})`;
  const body = fresh.length === 1 ? `${line(fresh[0]!)}. ${fresh[0]!.reason} Tap to review and apply.` : fresh.map(line).join(" · ");
  log.info(`Strategy suggestions: ${fresh.map(line).join("; ")}`);
  await sendPush(db, { title: fresh.length === 1 ? "Strategy suggestion" : `${fresh.length} strategy suggestions`, body, url: "/more/admin/today", tag: "strategy-advice" });
  return fresh.length;
}
