/**
 * Stakes and risk checks for member bets, simulation and live alike. Pure functions: everything they need is passed in,
 * so they are easy to test and behave the same in both modes.
 *
 * STAKING METHODS (recorded on every bet)
 *   flat           the same £ amount every bet
 *   percent_bank   a % of the bank as it is now (stakes grow and shrink with it)
 *   fixed_percent  a % of the starting bank (a flat stake sized to the bank)
 *   custom         a £ amount per strategy, else the flat amount
 *   strategy       the stake the house uses for the strategy (Sending page), else the flat amount
 *
 * RISK CHECKS (run before every bet; any failure means no bet)
 *   max stake caps the stake; everything else refuses the bet with a reason the member can read.
 */
import type { MemberSettings, RiskLimits, StakingMethod } from "./store";

export const STAKING_LABEL: Record<StakingMethod, string> = {
  flat: "Flat stake",
  percent_bank: "Percentage of bank",
  fixed_percent: "Fixed percentage of starting bank",
  custom: "Custom stake per strategy",
  strategy: "Strategy-defined stake",
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeStake(
  s: Pick<MemberSettings, "stakingMethod" | "stakeValue" | "customStakes" | "simBank">,
  opts: { strategyKey: string; bank: number; houseStake: number | null; advanced: boolean },
): { stake: number; method: StakingMethod } {
  // Without advanced staking, only a flat stake is used (whatever was saved before, e.g. during a trial).
  const method: StakingMethod = opts.advanced ? s.stakingMethod : "flat";
  let stake: number;
  switch (method) {
    case "percent_bank":
      stake = Math.max(0, opts.bank) * (s.stakeValue / 100);
      break;
    case "fixed_percent":
      stake = s.simBank * (s.stakeValue / 100);
      break;
    case "custom":
      stake = s.customStakes[opts.strategyKey] ?? s.stakeValue;
      break;
    case "strategy":
      stake = opts.houseStake ?? s.stakeValue;
      break;
    default:
      stake = s.stakeValue;
  }
  return { stake: r2(stake), method };
}

export interface RiskInput {
  stake: number;
  odds: number;
  /** The bank now: simulation bank, or the Betfair balance for live. */
  bank: number;
  /** The bank the member started from (for the stop loss). */
  startBank: number;
  /** Stake already at risk on unsettled bets. */
  openExposure: number;
  /** Today's (UK day) totals for this member and mode. */
  todayStaked: number;
  todayProfit: number;
  todayBets: number;
  /** Betfair's smallest stake for live bets; 0.01 for simulation. */
  minimumStake: number;
}

export type RiskResult = { ok: true; stake: number; capped: boolean } | { ok: false; reason: string; kind: string };

const money = (n: number) => `£${n.toFixed(2)}`;

export function checkRisk(limits: RiskLimits, i: RiskInput): RiskResult {
  let stake = r2(i.stake);
  let capped = false;
  if (limits.maxStake !== null && stake > limits.maxStake) {
    stake = r2(limits.maxStake);
    capped = true;
  }
  const no = (kind: string, reason: string): RiskResult => ({ ok: false, kind, reason });
  if (!(stake > 0)) return no("stake", "The stake works out at nothing (check your staking settings and bank).");
  if (stake < i.minimumStake) return no("stake", `The stake ${money(stake)} is below the smallest allowed (${money(i.minimumStake)}).`);
  if (limits.minStake !== null && stake < limits.minStake) return no("min_stake", `The stake ${money(stake)} is below your minimum stake (${money(limits.minStake)}).`);
  if (limits.minOdds !== null && i.odds < limits.minOdds) return no("min_odds", `Odds ${i.odds.toFixed(2)} are below your minimum (${limits.minOdds.toFixed(2)}).`);
  if (limits.maxOdds !== null && i.odds > limits.maxOdds) return no("max_odds", `Odds ${i.odds.toFixed(2)} are above your maximum (${limits.maxOdds.toFixed(2)}).`);
  if (limits.maxBetsPerDay !== null && i.todayBets >= limits.maxBetsPerDay) return no("max_bets", `Daily bet limit reached (${limits.maxBetsPerDay} bets).`);
  if (limits.maxDailyStake !== null && i.todayStaked + stake > limits.maxDailyStake + 1e-9)
    return no("daily_stake", `Daily stake limit reached (${money(i.todayStaked)} of ${money(limits.maxDailyStake)} staked today).`);
  if (limits.maxDailyLoss !== null && -i.todayProfit >= limits.maxDailyLoss - 1e-9)
    return no("daily_loss", `Daily loss limit reached (${money(-i.todayProfit)} lost today, limit ${money(limits.maxDailyLoss)}).`);
  if (limits.maxExposure !== null && i.openExposure + stake > limits.maxExposure + 1e-9)
    return no("exposure", `Maximum exposure reached (${money(i.openExposure)} already at risk, limit ${money(limits.maxExposure)}).`);
  if (limits.stopLossPct !== null && i.bank <= i.startBank * (1 - limits.stopLossPct / 100) + 1e-9)
    return no("stop_loss", `Stop loss reached: the bank (${money(i.bank)}) is ${limits.stopLossPct}% or more below where it started (${money(i.startBank)}).`);
  if (limits.minBank !== null && i.bank - i.openExposure - stake < limits.minBank - 1e-9)
    return no("min_bank", `This bet would take the bank below your minimum (${money(limits.minBank)}).`);
  if (stake > i.bank - i.openExposure + 1e-9) return no("bank", `Not enough in the bank: ${money(Math.max(0, i.bank - i.openExposure))} free, stake ${money(stake)}.`);
  return { ok: true, stake, capped };
}

/** Cleans risk limits sent by the website. Without advanced risk only the basic three can be changed. */
export function cleanRisk(raw: unknown, current: RiskLimits, advanced: boolean): RiskLimits {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const basic: Array<keyof RiskLimits> = ["maxStake", "minOdds", "maxDailyLoss"];
  const out = { ...current };
  for (const k of Object.keys(current) as Array<keyof RiskLimits>) {
    if (!(k in r)) continue;
    if (!advanced && !basic.includes(k)) continue;
    const v = r[k];
    if (k === "priceTolerancePct") {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0 && n <= 20) out.priceTolerancePct = r2(n);
      continue;
    }
    if (v === null || v === "") {
      (out as Record<string, number | null>)[k] = null;
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new Error(`${k}: enter a positive number, or leave it empty for no limit.`);
    if ((k === "minOdds" || k === "maxOdds") && n !== 0 && n < 1.01) throw new Error("Odds limits must be 1.01 or more.");
    if (k === "stopLossPct" && n > 100) throw new Error("The stop loss is a percentage, 1 to 100.");
    (out as Record<string, number | null>)[k] = r2(n);
  }
  if (out.minOdds !== null && out.maxOdds !== null && out.minOdds > out.maxOdds) throw new Error("The minimum odds are above the maximum.");
  if (out.minStake !== null && out.maxStake !== null && out.minStake > out.maxStake) throw new Error("The minimum stake is above the maximum.");
  return out;
}
