/**
 * Suggestions for each strategy, from how it has done, sent as a phone notification when one first appears and listed
 * on the Today page (and on the strategy's card) with an Apply button. Nothing changes until the admin presses Apply.
 *
 *   Try Live (a Sim strategy), all of:
 *     - 200+ priced Sim picks (PROMOTE_FROM), with the return still above zero once pulled towards zero for luck
 *       (adjusted), AND making money in both the older and the newer half of them;
 *     - still making money in Sim over the last 30 days (20+ priced picks);
 *     - pre-match strategies only: beating the kick-off price over 50+ price checks (the in-play check leaves out picks a
 *       goal settled, so it isn't a fair verdict);
 *     - a stop loss set.
 *     Apply: Live at a TRIAL stake, 1% of the balance (or £1 for a flat-stake strategy), whatever its own stake was; the
 *     stake ladder raises it from there once its Live bets earn it.
 *     Stricter since 29 Oct 2026: at 50 picks, strategies were promoted on short good Sim runs and then lost Live
 *     (Fav Pressure Level +£18.53 in Sim, -£11.08 Live; LAY home win +£33.46 in Sim, -£10.46 Live).
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
 *   GOLDEN SLICES (1 Nov 2026, the owner's request: the parts of a strategy that work, not the whole strategy):
 *     - Slice ready to try Live: a watched slice that has reached candidate or better (50+ priced picks, in profit, its
 *       last 30 not losing more than 5%), is not already Live on its own, and isn't following a Live strategy.
 *       Apply: its own Live switch on at a 1% trial stake.
 *     - Slice back to Sim: Live on its own, and its own Live bets are losing 10% or more per £1 over 15+ bets.
 *     - Slice stake up: Live on its own, 20+ priced picks, +10% or better per £1, 3+ units, last 30 not losing. One step up
 *       the ladder, never above BEST_SLICE_PCT (4%); the single best such slice goes to 4% in one go, the owner's "run the best one at 4%+".
 *     - Slice stake down: Live on its own with its own Live bets losing over 15+ bets: one step down.
 *   EARLY WARNING (a Live strategy): 12+ priced Live bets in the last 30 days, 8% or more below zero and down a unit or
 *     more, at a stake of 3% or higher: back to Sim, ahead of the slower 30-bet rule. Underdog taking charge, 1 Nov 2026:
 *     -9.1% over 16 Live bets at 4%.
 *
 * One notification per change: the same suggestion isn't sent again until it has gone away and come back.
 *
 * AUTOMATIC STAKES (Sending: ladderAuto): stake raises and cuts are applied by the hourly check instead of waiting,
 * one step per strategy at most every 7 days (counting manual Applies too; a cut after a raise that went wrong doesn't
 * wait), each with its own notification. "Try Live"
 * and "Back to Sim" are never automatic.
 */
import type { EngineDb } from "../storage/engine-db";
import { ALL_TIME, computeStrategyReturns, pricingInputs, type ResultRow, type StrategyReturn } from "./winloss";
import { getSendingSettings, saveSendingSettings, strategyLabel, type SendingSettings } from "../inplayguru/bet-feed";
import { goldenReport } from "./golden";
import { getArchived } from "./archive";
import { getStopLossRules } from "../inplayguru/stop-loss";
import { priceCheckReport } from "../betfair/price-check";
import { displayName } from "../inplayguru/strategy-names";
import { sendPush } from "./push";
import { log } from "./log";
import { BLOCK_FROM, computeLeagueReturns, getLeagueBlocks, isLeagueBlocked, judge, setLeagueBlock } from "./league-returns";

const SAMPLE = 50;
/** Priced Sim picks a strategy needs before "Try Live" is suggested (see the header). */
export const PROMOTE_FROM = 200;
/** The stake "Try Live" puts a strategy Live at: a trial, not its full stake. */
const TRIAL_STAKE = { pct: 1 } as const;
const TRIAL_FLAT = { flat: 1 } as const;

/**
 * A strategy's priced Sim picks split into the older and newer half, as the return per £1 of each: both must be in profit
 * for "Try Live", so one lucky spell can't carry it. Null when it has no priced Sim picks.
 */
export function simHalves(db: EngineDb, rows: ResultRow[], key: string): [number, number] | null {
  const { price } = pricingInputs(db);
  const picks: Array<{ stake: number; profit: number }> = [];
  for (const r of rows) {
    if (r.placement !== "sim" || r.byHand || strategyLabel(r.strategy).toLowerCase() !== key) continue;
    const p = price(r).priced;
    if (p.kind === "priced" && p.stake > 0) picks.push({ stake: p.stake, profit: p.profit });
  }
  if (picks.length === 0) return null;
  const half = (xs: typeof picks) => {
    const staked = xs.reduce((a, x) => a + x.stake, 0);
    return staked > 0 ? xs.reduce((a, x) => a + x.profit, 0) / staked : 0;
  };
  const mid = Math.floor(picks.length / 2);
  return [half(picks.slice(0, mid)), half(picks.slice(mid))];
}
const STATE_KEY = "strategy_advice_state";
/** When each strategy's stake last moved on the ladder (manually or automatically), so automatic steps are 7 days apart. */
const LAST_STEP_KEY = "stake_ladder_last_step";
export const AUTO_GAP_MS = 7 * 86_400_000;
/** Each strategy's last raise on the ladder, and when it was cut again because the bets since went badly. */
const RAISES_KEY = "stake_ladder_raises";
/** A raise is undone at once when its Live bets since lose this much per £1... */
const FAST_CUT_ROI = -0.15;
/** ...over at least this many. */
const FAST_CUT_BETS = 15;
/** After such a cut, no raise for this long. */
const NO_RAISE_AFTER_CUT_MS = 14 * 86_400_000;

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
const PCT_STEPS = [1, 1.5, 2, 3, 4, 5];
const FLAT_STEPS = [1, 2, 3, 5];

export type AdviceKind = "try-live" | "back-to-sim" | "stake-up" | "stake-down" | "league-block" | "slice-live" | "slice-sim" | "slice-stake-up" | "slice-stake-down";

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
  /** A Golden slice's suggestion: key is "strategy#slice", and name is how to show it ("Time to fight · 1 goal apart"). */
  name?: string;
  slice?: { strategyKey: string; id: string };
}

/** The Golden slice figures the advice reads (engine golden.ts), so it can be tested without a database. */
type SliceInput = ReturnType<typeof goldenReport>["slices"][number];

/** The trial stake a slice is put Live at: a part of a strategy earning its way, not its full stake. */
const SLICE_TRIAL_PCT = 1;
/** The best performing slice is suggested at this stake or more: the owner's own target for it. */
export const BEST_SLICE_PCT = 4;
const SLICE_SIM_BETS = 15;
const SLICE_SIM_ROI = -0.1;
const SLICE_UP_PICKS = 20;
const SLICE_UP_ROI = 0.1;
const SLICE_UP_UNITS = 3;
/** Early warning for a Live strategy (see the header). */
const EARLY_BETS = 12;
const EARLY_ROI = -0.08;
const EARLY_UNITS = -1;
const EARLY_STAKE_PCT = 3;

/** One suggestion's identity: a strategy can have one per kind, and one league-block per league. */
const adviceId = (a: Pick<Advice, "key" | "kind" | "league">) => (a.league ? `${a.key}@${a.league.key}` : a.key);

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

/**
 * Suggestions for Golden slices: put one Live on its own, take one back to Sim, or move its stake. Pure: the slices and
 * the betting settings in, the suggestions out.
 */
export function sliceAdviceFrom(slices: SliceInput[], settings: SendingSettings): Advice[] {
  const out: Advice[] = [];
  const cfgOf = (s: SliceInput) => settings.segmentBets[`${s.strategyKey}#${s.id}`] ?? null;
  const nameOf = (s: SliceInput) => `${s.strategy} · ${s.label.replace(/^Golden: /, "").replace(/ since .*$/, "")}`;
  const per = (r: { units?: number; counted: number }) => (r.counted > 0 && r.units !== undefined ? r.units / r.counted : -Infinity);
  const base = (s: SliceInput) => ({ key: `${s.strategyKey}#${s.id}`, name: nameOf(s), slice: { strategyKey: s.strategyKey, id: s.id } });
  const upCandidates: Array<{ s: SliceInput; now: number }> = [];
  for (const s of slices) {
    const cfg = cfgOf(s);
    const mine = s.slice.all;
    const withLiveStrategy = cfg === null && s.strategyLive;
    if (!cfg?.live) {
      if (withLiveStrategy || !["candidate", "trial", "full"].includes(s.status) || mine.counted < 50 || mine.roi === null || mine.roi <= 0) continue;
      const rest = s.rest.all;
      out.push({
        ...base(s),
        kind: "slice-live",
        action: `Put this slice Live at ${SLICE_TRIAL_PCT}% of the balance`,
        to: { pct: SLICE_TRIAL_PCT },
        reason: `${pct(mine.roi)} per £1${mine.units !== undefined ? ` (${mine.units > 0 ? "+" : ""}${mine.units} units)` : ""} over ${mine.counted} priced picks${rest.counted > 0 && rest.roi !== null ? `, against ${pct(rest.roi)} over ${rest.counted} for the rest of ${s.strategy}` : ""}${s.recent && s.recent.n >= 10 && s.recent.roi !== null ? `; its last ${s.recent.n} are ${pct(s.recent.roi)}` : ""}. Only this part of ${s.strategy} would bet with real money; the rest stays as it is.`,
      });
      continue;
    }
    // Live on its own from here.
    const own = s.ownLive;
    const stakeNow = cfg.stakePct ?? null;
    if (own && own.n >= SLICE_SIM_BETS && own.roi !== null && own.roi <= SLICE_SIM_ROI) {
      out.push({ ...base(s), kind: "slice-sim", action: "Put this slice back to Sim", reason: `Its own Live bets are ${pct(own.roi)} per £1 over ${own.n} bets${own.units !== undefined ? ` (${own.units} units)` : ""}.` });
      continue;
    }
    if (own && own.n >= SLICE_SIM_BETS && own.roi !== null && own.roi < 0 && stakeNow !== null) {
      const down = ladderStep({ pct: stakeNow }, -1);
      if (down && "pct" in down) {
        out.push({ ...base(s), kind: "slice-stake-down", action: `Lower to ${down.pct}% of the balance`, to: down, reason: `Its own Live bets are ${pct(own.roi)} per £1 over ${own.n} bets.` });
        continue;
      }
    }
    const recentOk = !s.recent || s.recent.n < 10 || (s.recent.roi !== null && s.recent.roi >= 0);
    if (stakeNow !== null && stakeNow < BEST_SLICE_PCT && s.status !== "not holding up" && mine.counted >= SLICE_UP_PICKS && mine.roi !== null && mine.roi >= SLICE_UP_ROI && (mine.units ?? 0) >= SLICE_UP_UNITS && recentOk) upCandidates.push({ s, now: stakeNow });
  }
  // The best of the ones earning a raise goes straight to the owner's target; the rest go up one step.
  upCandidates.sort((a, b) => per(b.s.slice.all) - per(a.s.slice.all));
  upCandidates.forEach(({ s, now }, i) => {
    const mine = s.slice.all;
    const best = i === 0 && now < BEST_SLICE_PCT;
    const step = ladderStep({ pct: now }, 1);
    // Slices are small samples: their stake never goes above the best-performer level, whatever the ladder allows.
    const to = best ? { pct: BEST_SLICE_PCT } : step && "pct" in step ? { pct: Math.min(step.pct, BEST_SLICE_PCT) } : null;
    if (!to || to.pct <= now) return;
    out.push({
      ...base(s),
      kind: "slice-stake-up",
      action: `Raise to ${to.pct}% of the balance${best ? " (your best performer)" : ""}`,
      to,
      reason: `${pct(mine.roi!)} per £1 (${mine.units! > 0 ? "+" : ""}${mine.units} units) over ${mine.counted} priced picks${best ? ", the best of your Live slices per pick" : ""}${s.recent && s.recent.n >= 10 && s.recent.roi !== null ? `; its last ${s.recent.n} are ${pct(s.recent.roi)}` : ""}. Currently ${now}% of the balance.`,
    });
  });
  return out;
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
  const archived = getArchived(db);
  for (const [key, r] of Object.entries(all)) {
    if (archived[key]) continue; // archived: hidden everywhere, nothing suggested (archive.ts)
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
      const halves = sim.counted >= PROMOTE_FROM ? simHalves(db, rows, key) : null;
      const ok =
        !liveLosing &&
        sim.counted >= PROMOTE_FROM &&
        adj !== null &&
        adj > 0 &&
        !!halves &&
        halves[0] > 0 &&
        halves[1] > 0 &&
        !!recentSim &&
        recentSim.counted >= 20 &&
        recentSim.roi !== null &&
        recentSim.roi > 0 &&
        (!check || (check.picks >= SAMPLE && check.edge > 0)) &&
        !!stop &&
        (stop.dailyLoss !== null || stop.lossRun !== null);
      if (ok) {
        const to = stake && "flat" in stake ? TRIAL_FLAT : TRIAL_STAKE;
        out.push({
          key,
          kind: "try-live",
          action: `Put Live at a ${stakeWords(to)} trial stake`,
          to,
          reason: `${pct(sim.roi!)} per £1 over ${sim.counted} Sim picks (${pct(adj!)} adjusted; older half ${pct(halves![0])}, newer ${pct(halves![1])}), ${pct(recentSim!.roi!)} in the last 30 days${check ? `, and beating the kick-off price by ${check.edge.toFixed(1)}% over ${check.picks} checks` : ""}.`,
        });
      }
      continue;
    }
    // Live: back to Sim first (losing clearly over the last 30 days), else the stake ladder.
    if (rec) {
      const l = rec.live;
      const adj = adjusted(l.roi, l.counted);
      // The early warning: a heavy stake on a clearly losing short record, ahead of the slower rule below.
      if (l.counted >= EARLY_BETS && l.counted < 30 && l.roi !== null && l.roi <= EARLY_ROI && (l.units ?? 0) <= EARLY_UNITS && (settings.stakePct[key] ?? 0) >= EARLY_STAKE_PCT) {
        out.push({ key, kind: "back-to-sim", action: "Put back to Sim", reason: `Early warning: ${pct(l.roi)} per £1 (${l.units} units) over its last ${l.counted} Live bets at ${settings.stakePct[key]}% of the balance. Too few bets to be sure, but a stake this size is costly if it is real.` });
        continue;
      }
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
  // Golden slices: the working parts of a strategy, bet on their own.
  try {
    out.push(...sliceAdviceFrom(goldenReport(db, now, { skipFinder: true }).slices.filter((sl) => !archived[sl.strategyKey]), settings));
  } catch (err) {
    log.warn(`Slice suggestions failed: ${err instanceof Error ? err.message : String(err)}`);
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
  else if (a.kind === "slice-live") saveSendingSettings(db, { segmentBets: { [k]: { live: true, stakePct: (a.to as { pct: number }).pct } } });
  else if (a.kind === "slice-sim") saveSendingSettings(db, { segmentBets: { [k]: { live: false } } });
  else if (a.kind === "slice-stake-up" || a.kind === "slice-stake-down") saveSendingSettings(db, { segmentBets: { [k]: { stakePct: (a.to as { pct: number }).pct } } });
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
  log.info(`Strategy suggestion applied: ${a.name ?? displayName(db, k)}: ${a.action}.`);
  return a;
}

/**
 * Applies every suggestion currently showing, one by one, and says which went through and which no longer applied (the
 * list can change between the page loading and the button being pressed). League stops are left out: they change what
 * is bet where, and are worth a look each.
 */
export function applyAllAdvice(db: EngineDb, now = new Date()): { applied: Advice[]; failed: Array<{ key: string; kind: AdviceKind; error: string }> } {
  const applied: Advice[] = [];
  const failed: Array<{ key: string; kind: AdviceKind; error: string }> = [];
  for (const a of visibleAdvice(db, now).filter((x) => x.kind !== "league-block")) {
    try {
      applied.push(applyAdvice(db, a.key, a.kind, now));
    } catch (err) {
      failed.push({ key: a.key, kind: a.kind, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { applied, failed };
}

const LABEL: Record<AdviceKind, string> = {
  "try-live": "ready to try Live",
  "back-to-sim": "consider putting back to Sim",
  "stake-up": "worth a bigger stake",
  "stake-down": "worth a smaller stake",
  "league-block": "losing in one league",
  "slice-live": "slice ready to try Live",
  "slice-sim": "slice losing: consider Sim",
  "slice-stake-up": "slice worth a bigger stake",
  "slice-stake-down": "slice worth a smaller stake",
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
  const line = (a: Advice) => `${a.name ?? displayName(db, a.key)}: ${LABEL[a.kind]} (${a.action.toLowerCase()})`;
  const body = fresh.length === 1 ? `${line(fresh[0]!)}. ${fresh[0]!.reason} Tap to review and apply.` : fresh.map(line).join(" · ");
  log.info(`Strategy suggestions: ${fresh.map(line).join("; ")}`);
  await sendPush(db, { title: fresh.length === 1 ? "Strategy suggestion" : `${fresh.length} strategy suggestions`, body, url: "/more/admin/today", tag: "strategy-advice" });
  return fresh.length;
}
