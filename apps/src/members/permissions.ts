/**
 * Who may do what on the Members platform. Every gate on the platform asks this module, never `tier === "paid"`.
 *
 * A member has a TIER (what they are: free, on trial, paid, expired, suspended, admin) and from it a set of
 * CAPABILITIES (what they may do). Commercial rules live in the matrix below and can be changed from the admin
 * Members page (config.tierOverrides), and switched off as a whole by feature flags (config.flags), without a rebuild.
 *
 * Two kinds of capability:
 *   - plain yes/no ones (use simulation, connect Betfair...);
 *   - per-strategy ones (details, selections, schedules), which have a SCOPE: every strategy, only the strategies chosen
 *     for the trial, or none. strategyAllowed() answers for one strategy.
 *
 * Membership and live betting are separate on purpose: `enableLiveBetting` only says the tier MAY be offered it. A real
 * bet still needs the global switch, the engine setting, a Betfair connection, the member's own explicit switch-on, a
 * strategy approved for live and every risk check (see live.ts).
 */

export const TIERS = ["free", "trial", "paid", "expired", "suspended", "admin"] as const;
export type Tier = (typeof TIERS)[number];

export const CAPABILITIES = [
  "viewStrategyNames",
  "viewResults",
  "useSimulation",
  "simAutomation",
  "viewStrategyDetails",
  "viewSelections",
  "viewSchedules",
  "viewAdvancedAnalytics",
  "viewFullHistory",
  "personalTracking",
  "advancedStaking",
  "advancedRisk",
  "viewCommunity",
  "createStrategy",
  "shareStrategy",
  "connectBetfair",
  "enableLiveBetting",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Which strategies the per-strategy capabilities (details, selections, schedules) cover. */
export type StrategyScope = "all" | "selected" | "none";

export interface TierRules {
  caps: Record<Capability, boolean>;
  strategyScope: StrategyScope;
}

/** Plain-English description of each capability, for the admin matrix and the comparison table. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  viewStrategyNames: "Strategy names",
  viewResults: "Daily and weekly results",
  useSimulation: "Simulation bank",
  simAutomation: "Follow strategies automatically (simulation)",
  viewStrategyDetails: "Detailed strategy information",
  viewSelections: "Qualifying selections (match, market, odds)",
  viewSchedules: "Upcoming opportunities",
  viewAdvancedAnalytics: "Advanced analytics",
  viewFullHistory: "Full strategy history",
  personalTracking: "Full personal performance",
  advancedStaking: "Advanced staking",
  advancedRisk: "Advanced risk controls",
  viewCommunity: "Community",
  createStrategy: "Create strategies",
  shareStrategy: "Share strategies",
  connectBetfair: "Betfair connection",
  enableLiveBetting: "Live betting",
};

const all = (on: boolean): Record<Capability, boolean> => Object.fromEntries(CAPABILITIES.map((c) => [c, on])) as Record<Capability, boolean>;

/**
 * The default matrix. FREE sees results and can simulate; TRIAL gets the premium view for its chosen strategies (never
 * live betting); PAID gets everything; ADMIN everything; SUSPENDED nothing. EXPIRED (a trial or subscription that ran
 * out) is FREE again: nothing is deleted, the premium parts lock.
 */
export const DEFAULT_TIER_RULES: Record<Tier, TierRules> = {
  free: {
    caps: { ...all(false), viewStrategyNames: true, viewResults: true, useSimulation: true, simAutomation: true, viewCommunity: true },
    strategyScope: "none",
  },
  trial: {
    caps: {
      ...all(true),
      createStrategy: false,
      shareStrategy: false,
      connectBetfair: false,
      enableLiveBetting: false,
    },
    strategyScope: "selected",
  },
  paid: { caps: all(true), strategyScope: "all" },
  expired: {
    caps: { ...all(false), viewStrategyNames: true, viewResults: true, useSimulation: true, simAutomation: true, viewCommunity: true },
    strategyScope: "none",
  },
  suspended: { caps: all(false), strategyScope: "none" },
  admin: { caps: all(true), strategyScope: "all" },
};

/** Feature flags: a switched-off feature is off for every tier, whatever the matrix says. */
export interface FeatureFlags {
  trial: boolean;
  /** Community browsing (off = the Coming soon page). */
  community: boolean;
  strategyCreation: boolean;
  strategySharing: boolean;
  betfairConnections: boolean;
  /** Real-money member bets, for everyone. The admin's master switch; the engine setting MEMBERS_LIVE_BETTING=allow is also needed. */
  liveBetting: boolean;
  advancedAnalytics: boolean;
}

export const DEFAULT_FLAGS: FeatureFlags = {
  trial: true,
  community: false,
  strategyCreation: true,
  strategySharing: false,
  betfairConnections: true,
  liveBetting: false,
  advancedAnalytics: true,
};

/** Which capabilities each flag switches off. */
const FLAG_CAPS: Record<keyof FeatureFlags, Capability[]> = {
  trial: [],
  community: [],
  strategyCreation: ["createStrategy"],
  strategySharing: ["shareStrategy"],
  betfairConnections: ["connectBetfair", "enableLiveBetting"],
  liveBetting: ["enableLiveBetting"],
  advancedAnalytics: ["viewAdvancedAnalytics"],
};

export type TierOverrides = Partial<Record<Tier, { caps?: Partial<Record<Capability, boolean>>; strategyScope?: StrategyScope }>>;

/** The rules for a tier: the default matrix, the admin's overrides on top, then the flags. */
export function rulesFor(tier: Tier, overrides: TierOverrides = {}, flags: FeatureFlags = DEFAULT_FLAGS): TierRules {
  const base = DEFAULT_TIER_RULES[tier];
  const o = overrides[tier] ?? {};
  const caps = { ...base.caps };
  // Suspended stays all-off whatever the overrides say: it is the admin's way of stopping an account.
  if (tier !== "suspended") for (const c of CAPABILITIES) if (typeof o.caps?.[c] === "boolean") caps[c] = o.caps[c]!;
  for (const [flag, list] of Object.entries(FLAG_CAPS) as Array<[keyof FeatureFlags, Capability[]]>) {
    if (!flags[flag]) for (const c of list) caps[c] = false;
  }
  const scope = tier === "suspended" ? "none" : o.strategyScope ?? base.strategyScope;
  return { caps, strategyScope: scope };
}

/** What the platform needs to know about a member to work out their tier. */
export interface MemberState {
  /** Set by the admin: always admin, or suspended. */
  tierOverride: "admin" | "suspended" | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  /** Paid access runs until this time (a Stripe subscription's period end, or a date the admin gave). */
  paidUntil: string | null;
}

/** The tier in force at `now`: suspended, admin, paid, trial, expired (a trial or paid period has ended) or free. */
export function effectiveTier(m: MemberState, now: Date): Tier {
  if (m.tierOverride === "suspended") return "suspended";
  if (m.tierOverride === "admin") return "admin";
  const t = now.getTime();
  if (m.paidUntil && Date.parse(m.paidUntil) > t) return "paid";
  if (m.trialEndsAt && Date.parse(m.trialEndsAt) > t) return "trial";
  if (m.trialEndsAt || m.paidUntil) return "expired";
  return "free";
}

/** A member's permissions, ready to check: their tier, its capabilities, and the strategies its scope covers. */
export interface Access {
  tier: Tier;
  caps: Record<Capability, boolean>;
  strategyScope: StrategyScope;
  /** For the "selected" scope: the strategies chosen for the trial (lower-case keys). */
  selected: string[];
}

export function accessFor(tier: Tier, selected: string[], overrides: TierOverrides = {}, flags: FeatureFlags = DEFAULT_FLAGS): Access {
  const r = rulesFor(tier, overrides, flags);
  return { tier, caps: r.caps, strategyScope: r.strategyScope, selected };
}

export function can(a: Access, cap: Capability): boolean {
  return a.caps[cap] === true;
}

/**
 * Whether a per-strategy capability (details, selections, schedules) holds for one strategy. False when the tier
 * lacks the capability, or its scope doesn't cover the strategy (a trial member's fourth strategy).
 */
export function strategyAllowed(a: Access, cap: "viewStrategyDetails" | "viewSelections" | "viewSchedules", strategyKey: string): boolean {
  if (!can(a, cap)) return false;
  if (a.strategyScope === "all") return true;
  if (a.strategyScope === "selected") return a.selected.includes(strategyKey.toLowerCase());
  return false;
}
