/**
 * Suggestions for each strategy, from how it has done, sent as a phone notification when one first appears and listed
 * on the Today page (and on the strategy's card) with an Apply button. Nothing changes until the admin presses Apply.
 *
 *   Try Live (a Sim strategy), all of:
 *     - 50+ priced Sim picks, with the return still above zero once pulled towards zero for luck (adjusted);
 *     - still making money in Sim over the last 30 days (20+ priced picks);
 *     - pre-match strategies only: beating the kick-off price over 50+ price checks (the in-play check leaves out picks a
 *       goal settled, so it isn't a fair verdict);
 *     - a stop loss set.
 *     Apply: Live at £1 (or its own stake if it has one).
 *   Back to Sim (a Live strategy):
 *     - losing over the last 30 days: 30+ priced Live bets and an adjusted return below -2%.
 *   THE STAKE LADDER (a Live strategy, judged on its Live bets since its rules last changed):
 *     - Raise one step: 50+ priced Live bets, a return of +5% or more, its priced picks hitting above the break-even
 *       its winners actually paid, and still making money over the last 30 days.
 *     - Lower one step: 30+ priced Live bets and losing, but not badly enough for "back to Sim".
 *     - Lower one step at once after a raise: its Live bets since that raise losing 15% or more per £1 over 15+ bets.
 *       With automatic stakes this doesn't wait for the 7 days, and it isn't raised again for 14 days.
 *     Steps: 1, 1.5, 2, 3, 4, 5 (% of the balance), or £1, £2, £3, £5 for a flat stake. The highest-stake limit on
 *     Sending still caps every bet.
 *
 *   Stop in a league (a Live strategy): 100+ priced picks in one league (Live and Sim together, all time) and the
 *     whole likely range of its return there below zero (league-returns.ts). Apply: it isn't bet in that league any
 *     more; its picks there are recorded in Sim instead. Undo on Leagues → Profit.
 *
 * One notification per change: the same suggestion isn't sent again until it has gone away and come back.
 *
 * AUTOMATIC STAKES (Sending: ladderAuto): stake raises and cuts are applied by the hourly check instead of waiting,
 * one step per strategy at most every 7 days (counting manual Applies too; a cut after a raise that went wrong doesn't
 * wait), each with its own notification. "Try Live"
 * and "Back to Sim" are never automatic.
 */
import type { EngineDb } from "../storage/engine-db";
import { ALL_TIME, computeStrategyReturns, type StrategyReturn } from "./winloss";
import { getSendingSettings, saveSendingSettings } from "../inplayguru/bet-feed";
import { getStopLossRules } from "../inplayguru/stop-loss";
import { priceCheckReport } from "../betfair/price-check";
import { displayName } from "../inplayguru/strategy-names";
import { sendPush } from "./push";
import { log } from "./log";
import { BLOCK_FROM, computeLeagueReturns, getLeagueBlocks, isLeagueBlocked, judge, setLeagueBlock } from "./league-returns";

const SAMPLE = 50;
const STATE_KEY = "strategy_advice_state";
/** When each strategy's stake last moved on the ladder (manually or automatically), so automatic steps are 7 days apart. */
const LAST_STEP_KEY = "stake_ladder_last_step";
export const AUTO_GAP_MS = 7 * 86_400_000;
/** Each strategy's last raise on the ladder, and when it was cut again because the bets since went badly. */
const RAISES_KEY = "stake_ladder_raises";
/** A raise is undone at once when its Live bets since lose this much per £1... */
export const FAST_CUT_ROI = -0.15;
/** ...over at least this many. */
export const FAST_CUT_BETS = 15;
/** After such a cut, no raise for this long. */
export const NO_RAISE_AFTER_CUT_MS = 14 * 86_400_000;

function raises(db: EngineDb): Record<string, { at: string; cutAt?: string }> {
  try {
    return JSON.parse(db.getSetting(RAISES_KEY) ?? "{}") as Record<string, { at: string; cutAt?: string }>;
  } catch {
    return {};
  }
}

function lastSteps(db: EngineDb): Record<string, string> {
  try {
    return JSON.parse(db.getSetting(LAST_STEP_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
export const PCT_STEPS = [1, 1.5, 2, 3, 4, 5];
export const FLAT_STEPS = [1, 2, 3, 5];

export type AdviceKind = "try-live" | "back-to-sim" | "stake-up" | "stake-down" | "league-block";

export interface Advice {
  key: string;
  kind: AdviceKind;
  reason: string;
  /** What Apply does, in words ("Raise to 3% of the balance"). */
  action: string;
  /** The stake after Apply (stake-up / stake-down / try-live). */
  to?: { pct: number } | { flat: number };
  /** league-block: the league it would be stopped in. */
  league?: { key: string; name: string };
  /** stake-down: undoing a raise whose bets since went badly (not held back by the 7 days between automatic steps). */
  fast?: boolean;
}

/** One suggestion's identity: a strategy can have one per kind, and one league-block per league. */
export const adviceId = (a: Pick<Advice, "key" | "kind" | "league">) => (a.league ? `${a.key}@${a.league.key}` : a.key);

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
  // Every settled pick, read once for all four sets of figures below (the same picks each would read for itself).
  const rows = db.listResultsForWinLoss(ALL_TIME);
  const all = computeStrategyReturns(db, null, { rows });
  // The ladder judges a strategy's current rules only: from its rule change, like its card.
  const sinceChange = computeStrategyReturns(db, null, { fromRuleChange: true, rows });
  const recent = computeStrategyReturns(db, new Date(now.getTime() - 30 * 86_400_000).toISOString(), { fromRuleChange: true, rows });
  const checks = priceCheckReport(db, 30, now);
  const raised = raises(db);
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
      // Pre-match strategies must also beat the kick-off price. The in-play check isn't used: it leaves out every pick a
      // goal settled within 5 minutes, so the quickest winners look worst.
      const check = ko ? { picks: ko.picks, edge: ko.edge } : null;
      const stop = stops[key];
      // Its own Live bets in the last 30 days (from an earlier spell Live) count too: if they'd put it straight back to
      // Sim (the rule below), "Put Live" would only flip-flop. Boiling Point, 24 Oct 2026: +2.4% in Sim, -6.6% Live.
      const recentLive = rec?.live;
      const liveAdj = recentLive ? adjusted(recentLive.roi, recentLive.counted) : null;
      const liveLosing = !!recentLive && recentLive.counted >= 30 && liveAdj !== null && liveAdj < -0.02;
      const ok =
        !liveLosing &&
        sim.counted >= SAMPLE &&
        adj !== null &&
        adj > 0 &&
        !!recentSim &&
        recentSim.counted >= 20 &&
        recentSim.roi !== null &&
        recentSim.roi > 0 &&
        (!check || (check.picks >= SAMPLE && check.edge > 0)) &&
        !!stop &&
        (stop.dailyLoss !== null || stop.lossRun !== null);
      if (ok) {
        const to = stake ?? { flat: 1 };
        out.push({
          key,
          kind: "try-live",
          action: `Put Live at ${stakeWords(to)}`,
          to,
          reason: `${pct(sim.roi!)} per £1 over ${sim.counted} Sim picks (${pct(adj!)} adjusted), ${pct(recentSim!.roi!)} in the last 30 days${check ? `, and beating the kick-off price by ${check.edge.toFixed(1)}% over ${check.picks} checks` : ""}.`,
        });
      }
      continue;
    }
    // Live: back to Sim first (losing clearly over the last 30 days), else the stake ladder.
    if (rec) {
      const l = rec.live;
      const adj = adjusted(l.roi, l.counted);
      if (l.counted >= 30 && adj !== null && adj < -0.02) {
        // The strategy's whole Live record since its rules last changed, for comparison: it's often still green even
        // when the last 30 days have turned, which otherwise reads as a contradiction once the admin switches to Sim
        // and the headline figure (a different window) looks fine. Said here so the two numbers are never seen apart.
        const whole = sinceChange[key]?.live;
        const wholeNote = whole && whole.counted >= 30 && whole.roi !== null ? ` Its whole Live record is still ${pct(whole.roi)} over ${whole.counted} bets — this is about its LAST 30 days only, not a change to that overall figure.` : "";
        out.push({ key, kind: "back-to-sim", action: "Put back to Sim", reason: `${pct(l.roi!)} per £1 over its last ${l.counted} Live bets (30 days), ${pct(adj)} adjusted for luck.${wholeNote}` });
        continue;
      }
    }
    const l = sinceChange[key]?.live;
    if (!l || !stake) continue;
    // A raise that went wrong straight away: back down a step now, rather than waiting for the whole record to turn.
    const raise = raised[key];
    if (raise && !raise.cutAt) {
      const since = computeStrategyReturns(db, raise.at, { rows })[key]?.live;
      const to = ladderStep(stake, -1);
      if (since && since.counted >= FAST_CUT_BETS && since.roi !== null && since.roi <= FAST_CUT_ROI && to) {
        out.push({
          key,
          kind: "stake-down",
          fast: true,
          action: `Lower to ${stakeWords(to)}`,
          to,
          reason: `${pct(since.roi)} per £1 over ${since.counted} Live bets since it was raised on ${new Date(raise.at).toISOString().slice(0, 10)}.`,
        });
        continue;
      }
    }
    const cutRecently = !!raise?.cutAt && now.getTime() - Date.parse(raise.cutAt) < NO_RAISE_AFTER_CUT_MS;
    const recentOk = !!rec && rec.live.counted > 0 && rec.live.roi !== null && rec.live.roi > 0;
    if (l.counted >= SAMPLE && l.roi !== null && l.roi >= 0.05 && beatsBreakeven(l) && recentOk) {
      if (cutRecently) continue;
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
  // Stop in a league: a Live strategy clearly losing in one league over 100+ picks.
  const blocks = getLeagueBlocks(db);
  for (const l of computeLeagueReturns(db, null, rows)) {
    for (const [key, m] of Object.entries(l.byStrategy)) {
      if (!(settings.enabled && settings.strategies[key] === true) || isLeagueBlocked(blocks, key, l.key)) continue;
      const t = m.all;
      if (t.counted < BLOCK_FROM) continue;
      const j = judge(t);
      if (j.verdict !== "losing") continue;
      const name = l.country ? `${l.league} (${l.country})` : l.league;
      out.push({
        key,
        kind: "league-block",
        league: { key: l.key, name },
        action: `Stop it in ${l.league}`,
        reason: `${pct(j.roi!)} per £1 over ${t.counted} picks in ${name} (likely ${pct(j.low!)} to ${pct(j.high!)}). Its picks there would be recorded in Sim instead; undo on Leagues → Profit.`,
      });
    }
  }
  return out;
}

/** Carries out one current suggestion (the admin pressed Apply). Throws if it no longer applies. */
export function applyAdvice(db: EngineDb, key: string, kind: AdviceKind, now = new Date(), leagueKey?: string): Advice {
  const a = strategyAdvice(db, now).find((x) => x.key === key.toLowerCase() && x.kind === kind && (kind !== "league-block" || x.league?.key === leagueKey));
  if (!a) throw new Error("That suggestion no longer applies. Refresh to see the current ones.");
  const k = a.key;
  if (a.kind === "league-block") setLeagueBlock(db, k, a.league!.key, a.league!.name, true, now);
  else if (a.kind === "back-to-sim") saveSendingSettings(db, { strategies: { [k]: false } });
  else {
    const to = a.to!;
    const stake = "pct" in to ? { stakePct: { [k]: to.pct } } : { stakes: { [k]: to.flat } };
    saveSendingSettings(db, { ...stake, ...(a.kind === "try-live" ? { strategies: { [k]: true } } : {}) });
  }
  if (a.kind === "stake-up" || a.kind === "stake-down") {
    db.setSetting(LAST_STEP_KEY, JSON.stringify({ ...lastSteps(db), [k]: now.toISOString() }));
    // Raises are watched for a quick cut; a cut after one blocks raising for a while; any other cut ends the watch.
    const r = raises(db);
    if (a.kind === "stake-up") r[k] = { at: now.toISOString() };
    else if (a.fast && r[k]) r[k] = { ...r[k]!, cutAt: now.toISOString() };
    else delete r[k];
    db.setSetting(RAISES_KEY, JSON.stringify(r));
  }
  log.info(`Strategy suggestion applied: ${displayName(db, k)}: ${a.action}.`);
  return a;
}

const LABEL: Record<AdviceKind, string> = {
  "try-live": "ready to try Live",
  "back-to-sim": "consider putting back to Sim",
  "stake-up": "worth a bigger stake",
  "stake-down": "worth a smaller stake",
  "league-block": "losing in one league",
};

/**
 * How long the suggestions may be reused for showing. Working them out reads every past result three times over (about
 * 2-3 seconds on the live database), and the engine can't read alerts or place bets while it does; the Today page asks
 * every 15 seconds. A change to any setting they depend on (betting, stakes, stop losses, league stops) starts afresh,
 * and Apply always works them out anew.
 */
const VIEW_TTL_MS = 2 * 60_000;
const viewCache = new WeakMap<EngineDb, { at: number; stamp: string; advice: Advice[] }>();

/** strategyAdvice for showing: the same answer for up to two minutes while its settings are unchanged. */
function adviceForView(db: EngineDb, now: Date): Advice[] {
  const stamp = JSON.stringify([getSendingSettings(db), getStopLossRules(db), getLeagueBlocks(db)]);
  const hit = viewCache.get(db);
  const age = hit ? now.getTime() - hit.at : -1;
  if (hit && hit.stamp === stamp && age >= 0 && age < VIEW_TTL_MS) return hit.advice;
  const advice = strategyAdvice(db, now);
  viewCache.set(db, { at: now.getTime(), stamp, advice });
  return advice;
}

/**
 * The suggestions to show and notify: with automatic stakes on, stake raises and cuts aren't suggestions (they happen
 * by themselves, one step a week), so only Live / Sim and league stops are left for the admin to decide.
 */
export function visibleAdvice(db: EngineDb, now = new Date()): Advice[] {
  const all = adviceForView(db, now);
  return getSendingSettings(db).ladderAuto ? all.filter((a) => a.kind !== "stake-up" && a.kind !== "stake-down") : all;
}

/** With automatic stakes on: the stake steps waiting for their week to pass, and when each is due. */
export function autoStakeQueue(db: EngineDb, now = new Date()): Array<{ key: string; action: string; due: string }> {
  if (!getSendingSettings(db).ladderAuto) return [];
  const last = lastSteps(db);
  return adviceForView(db, now)
    .filter((a) => a.kind === "stake-up" || a.kind === "stake-down")
    .map((a) => {
      const prev = last[a.key] ? Date.parse(last[a.key]!) : NaN;
      const due = Number.isFinite(prev) ? Math.max(now.getTime(), prev + AUTO_GAP_MS) : now.getTime();
      return { key: a.key, action: a.action, due: new Date(due).toISOString() };
    });
}

/** With automatic stakes on: applies each stake step that's due (7+ days since that strategy's last step). Returns them. */
export function autoApplyStakes(db: EngineDb, now = new Date()): Advice[] {
  if (!getSendingSettings(db).ladderAuto) return [];
  const last = lastSteps(db);
  const done: Advice[] = [];
  for (const a of strategyAdvice(db, now)) {
    if (a.kind !== "stake-up" && a.kind !== "stake-down") continue;
    const prev = last[a.key];
    if (!a.fast && prev && now.getTime() - Date.parse(prev) < AUTO_GAP_MS) continue;
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
  // With automatic stakes on, the next step (due in a week) is not a suggestion: it would read as a second change.
  const advice = visibleAdvice(db, now);
  let state: Record<string, string> = {};
  try {
    state = JSON.parse(db.getSetting(STATE_KEY) ?? "{}") as Record<string, string>;
  } catch {
    state = {};
  }
  const sig = (a: Advice) => `${a.kind}:${a.action}`;
  const fresh = advice.filter((a) => state[adviceId(a)] !== sig(a) && state[adviceId(a)] !== a.kind);
  const next: Record<string, string> = {};
  for (const a of advice) next[adviceId(a)] = sig(a);
  db.setSetting(STATE_KEY, JSON.stringify(next));
  if (fresh.length === 0) return 0;
  const line = (a: Advice) => `${displayName(db, a.key)}: ${LABEL[a.kind]} (${a.action.toLowerCase()})`;
  const body = fresh.length === 1 ? `${line(fresh[0]!)}. ${fresh[0]!.reason} Tap to review and apply.` : fresh.map(line).join(" · ");
  log.info(`Strategy suggestions: ${fresh.map(line).join("; ")}`);
  await sendPush(db, { title: fresh.length === 1 ? "Strategy suggestion" : `${fresh.length} strategy suggestions`, body, url: "/more/admin/today", tag: "strategy-advice" });
  return fresh.length;
}
