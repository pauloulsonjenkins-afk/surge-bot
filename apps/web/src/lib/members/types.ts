/**
 * What the Members API returns (mirrors apps/src/members/views.ts). Fields a member isn't allowed are simply absent or
 * null in the response: the engine never sends them.
 */

export type Tier = "free" | "trial" | "paid" | "expired" | "suspended" | "admin";
export type BetMode = "sim" | "live";
export type BetStatus = "pending" | "placing" | "matched" | "partially_matched" | "rejected" | "failed" | "cancelled" | "won" | "lost" | "void";

export interface WinLoss {
  wins: number;
  losses: number;
  hitRate: number | null;
}

export interface Money {
  priced: number;
  staked: number;
  returns: number;
  profit: number;
  roi: number | null;
  avgOdds: number | null;
  maxDrawdown: number;
  longestLosingRun: number;
}

export interface TrialStatus {
  state: "available" | "active" | "used" | "unavailable";
  reason: string | null;
  startedAt: string | null;
  endsAt: string | null;
  daysLeft: number | null;
  hoursLeft: number | null;
  strategies: string[];
  days: number;
  strategyLimit: number;
}

export interface MembersMe {
  user: { name: string; email: string };
  tier: Tier;
  caps: Record<string, boolean>;
  strategyScope: "all" | "selected" | "none";
  trial: TrialStatus;
  paid: { until: string | null; source: string | null; status: string | null; canManage: boolean };
  billing: { available: boolean; priceLabel: string };
  flags: { community: boolean; trial: boolean; strategyCreation: boolean; strategySharing: boolean };
  live: { enabled: boolean; paused: boolean };
  sim: { bank: number; startBank: number; startedAt: string };
  unread: number;
}

export interface StrategyItem {
  key: string;
  name: string;
  type: "in-play" | "pre-match";
  locked: boolean;
  description?: string;
  trigger?: string;
  bet?: string;
  liveApproved?: boolean;
  results: { today: WinLoss; week: WinLoss; last30: WinLoss; perWeek: number };
  money: { all: WinLoss & Money; last30: Money } | null;
  daily: Array<{ date: string; wins: number; losses: number; profit?: number }>;
  lastAlertAt: string | null;
  following: { mode: BetMode; auto: boolean } | null;
  trialSelected: boolean;
}

export interface PickFull {
  id: number;
  strategyKey: string;
  strategyName: string;
  at: string;
  competition: string | null;
  home: string | null;
  away: string | null;
  minute: number | null;
  score: string | null;
  market: string | null;
  selection: string | null;
  odds: number | null;
  state: "live" | "waiting" | "settled" | "void";
  result: "hit" | "miss" | null;
  ftScore: string | null;
  kickoffAt: string | null;
  betableUntil: string;
}

export interface BetView {
  id: number;
  at: string;
  settledAt: string | null;
  strategyKey: string;
  strategyName: string;
  mode: BetMode;
  execution: "auto" | "manual";
  status: BetStatus;
  stake: number;
  stakingMethod: string;
  odds: number | null;
  requestedPrice: number | null;
  matchedStake: number | null;
  returns: number | null;
  profit: number | null;
  reason: string | null;
  betfairBetId: string | null;
  bfStatus: string | null;
  pick: { home: string | null; away: string | null; competition: string | null; minute: number | null; score: string | null; market: string | null; selection: string | null; ftScore: string | null } | null;
}

export interface PerformanceSummary {
  bets: number;
  settled: number;
  wins: number;
  losses: number;
  voids: number;
  open: number;
  openExposure: number;
  notPlaced: number;
  hitRate: number | null;
  staked: number;
  returns: number;
  profit: number;
  roi: number | null;
  avgOdds: number | null;
  maxDrawdown: number;
  longestWinningRun: number;
  longestLosingRun: number;
  currentStreak: string | null;
}

export interface Performance {
  mode: BetMode;
  range: string;
  summary: PerformanceSummary;
  bank: { start: number; now: number; startedAt: string } | null;
  byStrategy: Array<PerformanceSummary & { strategyKey: string; strategyName: string }>;
  curve: Array<{ date: string; value: number }>;
  staking: { method: string; value: number };
  limitedToDays: number | null;
  assumptions: string | null;
}

export interface Upcoming {
  open: Array<PickFull & { simulated: boolean; live: string | null; canSimulate: boolean }>;
  locked: Array<{ strategyKey: string; strategyName: string; live: number; waiting: number }>;
  automation: { following: number; sim: number; live: number; liveBlockedReason: string | null };
}

export interface Dashboard {
  me: MembersMe;
  sim: { summary: PerformanceSummary; bank: Performance["bank"]; curve: Performance["curve"] };
  live: PerformanceSummary | null;
  recent: BetView[];
  house: Array<{ key: string; name: string; locked: boolean; today: WinLoss; week: WinLoss; last30: WinLoss; following: { mode: BetMode; auto: boolean } | null }>;
  upcoming: { open: Upcoming["open"]; openCount: number; locked: Upcoming["locked"] };
  automation: Upcoming["automation"];
}

export interface RiskLimits {
  minStake: number | null;
  maxStake: number | null;
  maxDailyStake: number | null;
  maxDailyLoss: number | null;
  maxBetsPerDay: number | null;
  maxExposure: number | null;
  minOdds: number | null;
  maxOdds: number | null;
  stopLossPct: number | null;
  minBank: number | null;
  priceTolerancePct: number;
}

export interface MemberSettings {
  stakingMethod: string;
  stakeValue: number;
  customStakes: Record<string, number>;
  risk: RiskLimits;
  simBank: number;
  simStartedAt: string;
  advancedStaking: boolean;
  advancedRisk: boolean;
  defaultSimBank: number;
  stakingMethods: Array<{ value: string; label: string }>;
}

export interface Automation {
  connection: {
    kind: "none" | "house" | "vendor";
    status: "disconnected" | "connected" | "error";
    lastTestAt: string | null;
    lastOkAt: string | null;
    lastError: string | null;
    options: { house: { available: boolean; reason: string | null }; vendor: { available: boolean; reason: string } };
    account: { available: number | null; delayedKey: boolean | null } | null;
  };
  live: { enabled: boolean; paused: boolean; allowedByMembership: boolean; globalOn: boolean; blockedReason: string | null; confirmation: string };
  follows: Array<{ strategyKey: string; strategyName: string; mode: BetMode; auto: boolean; liveApproved: boolean }>;
  strategies: Array<{ key: string; name: string; liveApproved: boolean }>;
}

export interface Notification {
  id: number;
  at: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
}

export interface Plans {
  capabilities: Array<{ key: string; label: string }>;
  tiers: Array<{ tier: "free" | "trial" | "paid"; caps: Record<string, boolean>; strategyScope: "all" | "selected" | "none" }>;
  trialDays: number;
  trialStrategyLimit: number;
  priceLabel: string;
}

export interface CommunityRecord extends Money {
  bets: number;
  wins: number;
  losses: number;
  hitRate: number | null;
}

export interface CommunityStrategy {
  id: number;
  name: string;
  description: string;
  status: "active" | "paused" | "archived";
  visibility: "private" | "shared";
  currentVersion: number;
  createdAt: string;
}

export interface Community {
  own: Array<{ strategy: CommunityStrategy; record: { tracked: CommunityRecord; backtest: CommunityRecord } }>;
  leaderboard: { enabled: boolean; rows: Array<{ id: number; name: string; description: string; creator: string; record: CommunityRecord; adjustedRoi: number | null; ranked: boolean; followers: number; verification: string }> };
  canCreate: boolean;
  catalogue: Array<{ key: string; name: string }>;
}
