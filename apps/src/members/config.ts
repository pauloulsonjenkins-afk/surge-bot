/**
 * The Members platform's commercial rules, changed from the admin Members page (stored in the setting `members_config`).
 * Anything missing or unreadable falls back to the defaults, and a fault can only make things stricter (live betting
 * stays off).
 */
import type { EngineDb } from "../storage/engine-db";
import { CAPABILITIES, DEFAULT_FLAGS, TIERS, type Capability, type FeatureFlags, type StrategyScope, type Tier, type TierOverrides } from "./permissions";

export interface MembersConfig {
  flags: FeatureFlags;
  /** Changes to the default permission matrix (see permissions.ts). */
  tierOverrides: TierOverrides;
  trialDays: number;
  /** How many strategies a trial covers. Chosen when the trial starts, and fixed until it ends. */
  trialStrategyLimit: number;
  /** Free members' history reaches this many days back (results, personal performance). */
  freeHistoryDays: number;
  /** Starting bank offered for a new simulation. */
  defaultSimBank: number;
  /**
   * Simulation's assumed slippage in percent: a simulated bet is matched this much below the price recorded for the
   * alert. 0 = matched at the price recorded. Shown to members with the other assumptions.
   */
  simSlippagePct: number;
  /** Betfair commission on winnings (percent) used for house figures and simulated bets. */
  commissionPct: number;
  /**
   * Strategies offered to members (lower-case keys). Empty = every named strategy. A strategy left out is invisible on
   * the platform: no results, no picks.
   */
  publishedStrategies: string[];
  /** Strategies approved for real-money member bets (lower-case keys). Empty = none. */
  liveApprovedStrategies: string[];
  /** Upgrade wording on the platform. The price itself lives in Stripe. */
  paidPriceLabel: string;
}

export const DEFAULT_MEMBERS_CONFIG: MembersConfig = {
  flags: DEFAULT_FLAGS,
  tierOverrides: {},
  trialDays: 7,
  trialStrategyLimit: 3,
  freeHistoryDays: 30,
  defaultSimBank: 100,
  simSlippagePct: 0,
  commissionPct: 5,
  publishedStrategies: [],
  liveApprovedStrategies: [],
  paidPriceLabel: "",
};

const KEY = "members_config";

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : fallback;
}

function keys(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().toLowerCase().slice(0, 120)))];
}

function flagsOf(v: unknown): FeatureFlags {
  const r = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out = { ...DEFAULT_FLAGS };
  for (const k of Object.keys(DEFAULT_FLAGS) as Array<keyof FeatureFlags>) if (typeof r[k] === "boolean") out[k] = r[k] as boolean;
  return out;
}

function overridesOf(v: unknown): TierOverrides {
  const out: TierOverrides = {};
  if (!v || typeof v !== "object") return out;
  for (const tier of TIERS) {
    const raw = (v as Record<string, unknown>)[tier];
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const caps: Partial<Record<Capability, boolean>> = {};
    if (r.caps && typeof r.caps === "object") {
      for (const c of CAPABILITIES) {
        const x = (r.caps as Record<string, unknown>)[c];
        if (typeof x === "boolean") caps[c] = x;
      }
    }
    const scope = r.strategyScope === "all" || r.strategyScope === "selected" || r.strategyScope === "none" ? (r.strategyScope as StrategyScope) : undefined;
    if (Object.keys(caps).length || scope) out[tier as Tier] = { ...(Object.keys(caps).length ? { caps } : {}), ...(scope ? { strategyScope: scope } : {}) };
  }
  return out;
}

export function getMembersConfig(db: EngineDb): MembersConfig {
  let raw: Record<string, unknown> = {};
  try {
    const saved = db.getSetting(KEY);
    if (saved) raw = JSON.parse(saved) as Record<string, unknown>;
  } catch {
    // Unreadable: the defaults, with live betting off.
    return { ...DEFAULT_MEMBERS_CONFIG, flags: { ...DEFAULT_FLAGS, liveBetting: false } };
  }
  const d = DEFAULT_MEMBERS_CONFIG;
  return {
    flags: flagsOf(raw.flags),
    tierOverrides: overridesOf(raw.tierOverrides),
    trialDays: num(raw.trialDays, 1, 60, d.trialDays),
    trialStrategyLimit: Math.round(num(raw.trialStrategyLimit, 1, 20, d.trialStrategyLimit)),
    freeHistoryDays: Math.round(num(raw.freeHistoryDays, 1, 3650, d.freeHistoryDays)),
    defaultSimBank: num(raw.defaultSimBank, 10, 1_000_000, d.defaultSimBank),
    simSlippagePct: num(raw.simSlippagePct, 0, 20, d.simSlippagePct),
    commissionPct: num(raw.commissionPct, 0, 20, d.commissionPct),
    publishedStrategies: keys(raw.publishedStrategies),
    liveApprovedStrategies: keys(raw.liveApprovedStrategies),
    paidPriceLabel: typeof raw.paidPriceLabel === "string" ? raw.paidPriceLabel.trim().slice(0, 60) : d.paidPriceLabel,
  };
}

/** Saves any subset of the fields, cleaned. Returns the config now in force. */
export function saveMembersConfig(db: EngineDb, patch: Record<string, unknown>): MembersConfig {
  const before = getMembersConfig(db);
  const merged: Record<string, unknown> = { ...before };
  for (const k of Object.keys(DEFAULT_MEMBERS_CONFIG) as Array<keyof MembersConfig>) {
    if (patch[k] === undefined) continue;
    merged[k] = k === "flags" && patch.flags && typeof patch.flags === "object" ? { ...before.flags, ...(patch.flags as object) } : patch[k];
  }
  db.setSetting(KEY, JSON.stringify(merged));
  return getMembersConfig(db);
}

/** True when the engine itself allows real-money member bets (MEMBERS_LIVE_BETTING=allow in DigitalOcean). */
export function memberLiveAllowedByEngine(env = process.env): boolean {
  return env.MEMBERS_LIVE_BETTING?.trim().toLowerCase() === "allow";
}
