/**
 * The Members platform's tables, kept in the engine's SQLite file (so they are backed up with everything else) but in
 * their own module, apart from the alert tables. Members are the website's existing accounts (app_users): one row in
 * `members` per account, made the first time it opens the platform.
 *
 *   members                     tier override (admin/suspended), trial dates, paid-until, Stripe ids, live switch
 *   trial_claims                one trial per normalised email, ever (a new account with the same email can't trial again)
 *   member_trial_strategies     the strategies chosen when the trial started; never changed by the member
 *   member_settings             simulation bank, staking method, risk limits
 *   member_follows              strategies a member follows, in simulation or live, automatically or not
 *   member_bets                 every member bet, simulation or live, one per member + pick + mode (no duplicates)
 *   member_betfair              each member's Betfair connection (status only, and an encrypted token if any)
 *   member_audit                important actions: who, what, on what, the result
 *   member_notifications        the in-app notifications
 *   member_events               product analytics (sign-up, trial started, upgrade clicked...)
 *   stripe_events               Stripe webhook events already handled (each is handled once)
 *   community_strategies        member-created strategies, private to their owner unless shared
 *   community_strategy_versions their rules, one row per version (results stay with the version they came from)
 *   community_followers         who follows a shared strategy
 */
import type Database from "better-sqlite3";
import type { EngineDb } from "../storage/engine-db";
import type { MemberState } from "./permissions";

export type BetMode = "sim" | "live";
export type Execution = "auto" | "manual";
export type BetStatus = "pending" | "placing" | "matched" | "partially_matched" | "rejected" | "failed" | "cancelled" | "won" | "lost" | "void";
/** Statuses with stake still at risk (not settled, not refused). */
export const OPEN_STATUSES: BetStatus[] = ["pending", "placing", "matched", "partially_matched"];
export type StakingMethod = "flat" | "percent_bank" | "fixed_percent" | "custom" | "strategy";

export interface MemberRow extends MemberState {
  userId: number;
  paidSource: "stripe" | "admin" | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  liveEnabled: boolean;
  liveEnabledAt: string | null;
  automationPaused: boolean;
  trialNotices: string[];
  createdAt: string;
  updatedAt: string;
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
  /** Stop when the bank has fallen this far below its starting point (percent). */
  stopLossPct: number | null;
  /** Stop when the bank is below this. */
  minBank: number | null;
  /** Live only: how far under the price shown a bet may match (percent). */
  priceTolerancePct: number;
}

export const DEFAULT_RISK: RiskLimits = {
  minStake: null,
  maxStake: null,
  maxDailyStake: null,
  maxDailyLoss: null,
  maxBetsPerDay: null,
  maxExposure: null,
  minOdds: null,
  maxOdds: null,
  stopLossPct: null,
  minBank: null,
  priceTolerancePct: 5,
};

export interface MemberSettings {
  userId: number;
  simBank: number;
  simStartedAt: string;
  /** Goes up by one on each simulation reset; only bets of the current epoch count towards the bank. */
  simEpoch: number;
  stakingMethod: StakingMethod;
  /** Pounds for flat/custom, percent for percent_bank/fixed_percent, unused for strategy. */
  stakeValue: number;
  /** Per-strategy stakes for "custom" (lower-case key to pounds). */
  customStakes: Record<string, number>;
  risk: RiskLimits;
  updatedAt: string;
}

export interface Follow {
  strategyKey: string;
  mode: BetMode;
  auto: boolean;
  createdAt: string;
}

export interface MemberBet {
  id: number;
  userId: number;
  pickId: number;
  strategyKey: string;
  mode: BetMode;
  execution: Execution;
  simEpoch: number;
  stakingMethod: StakingMethod;
  stake: number;
  requestedPrice: number | null;
  matchedPrice: number | null;
  matchedStake: number | null;
  status: BetStatus;
  profit: number | null;
  reason: string | null;
  betfairBetId: string | null;
  marketId: string | null;
  selectionId: number | null;
  marketType: string | null;
  selectionName: string | null;
  bfStatus: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  placedAt: string | null;
  settledAt: string | null;
}

export interface BetfairConnection {
  userId: number;
  /** none; house = the GoalBrew Betfair account set up on the engine (admin only); vendor = a member's own account via Betfair's login (needs Software Vendor approval). */
  kind: "none" | "house" | "vendor";
  status: "disconnected" | "connected" | "error";
  lastTestAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  /** Encrypted with MEMBERS_SECRET_KEY (see secrets.ts); never sent to the website. */
  tokenEnc: string | null;
  updatedAt: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  userId: number | null;
  actor: "member" | "admin" | "system" | "stripe";
  action: string;
  object: string | null;
  result: "ok" | "refused" | "error";
  detail: string | null;
}

export interface Notification {
  id: number;
  userId: number;
  at: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
}

export interface CommunityStrategy {
  id: number;
  ownerId: number;
  name: string;
  description: string;
  status: "active" | "paused" | "archived";
  visibility: "private" | "shared";
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyVersion {
  strategyId: number;
  version: number;
  rules: unknown;
  createdAt: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS members (
    user_id                 INTEGER PRIMARY KEY,
    tier_override           TEXT,
    trial_started_at        TEXT,
    trial_ends_at           TEXT,
    paid_until              TEXT,
    paid_source             TEXT,
    stripe_customer_id      TEXT,
    stripe_subscription_id  TEXT,
    subscription_status     TEXT,
    live_enabled            INTEGER NOT NULL DEFAULT 0,
    live_enabled_at         TEXT,
    automation_paused       INTEGER NOT NULL DEFAULT 0,
    trial_notices           TEXT NOT NULL DEFAULT '',
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS members_stripe_customer ON members (stripe_customer_id);

  CREATE TABLE IF NOT EXISTS trial_claims (
    email_key   TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    claimed_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS member_trial_strategies (
    user_id       INTEGER NOT NULL,
    strategy_key  TEXT NOT NULL,
    chosen_at     TEXT NOT NULL,
    PRIMARY KEY (user_id, strategy_key)
  );

  CREATE TABLE IF NOT EXISTS member_settings (
    user_id         INTEGER PRIMARY KEY,
    sim_bank        REAL NOT NULL,
    sim_started_at  TEXT NOT NULL,
    sim_epoch       INTEGER NOT NULL DEFAULT 1,
    staking_method  TEXT NOT NULL DEFAULT 'flat',
    stake_value     REAL NOT NULL DEFAULT 2,
    custom_stakes   TEXT NOT NULL DEFAULT '{}',
    risk_json       TEXT NOT NULL DEFAULT '{}',
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS member_follows (
    user_id       INTEGER NOT NULL,
    strategy_key  TEXT NOT NULL,
    mode          TEXT NOT NULL DEFAULT 'sim',
    auto          INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (user_id, strategy_key)
  );
  CREATE INDEX IF NOT EXISTS member_follows_strategy ON member_follows (strategy_key);

  CREATE TABLE IF NOT EXISTS member_bets (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL,
    pick_id          INTEGER NOT NULL,
    strategy_key     TEXT NOT NULL,
    mode             TEXT NOT NULL,
    execution        TEXT NOT NULL,
    sim_epoch        INTEGER NOT NULL DEFAULT 1,
    staking_method   TEXT NOT NULL,
    stake            REAL NOT NULL,
    requested_price  REAL,
    matched_price    REAL,
    matched_stake    REAL,
    status           TEXT NOT NULL,
    profit           REAL,
    reason           TEXT,
    betfair_bet_id   TEXT,
    market_id        TEXT,
    selection_id     INTEGER,
    market_type      TEXT,
    selection_name   TEXT,
    bf_status        TEXT,
    attempts         INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    placed_at        TEXT,
    settled_at       TEXT,
    UNIQUE (user_id, pick_id, mode)
  );
  CREATE INDEX IF NOT EXISTS member_bets_user ON member_bets (user_id, created_at);
  CREATE INDEX IF NOT EXISTS member_bets_status ON member_bets (status);
  CREATE INDEX IF NOT EXISTS member_bets_pick ON member_bets (pick_id);

  CREATE TABLE IF NOT EXISTS member_betfair (
    user_id       INTEGER PRIMARY KEY,
    kind          TEXT NOT NULL DEFAULT 'none',
    status        TEXT NOT NULL DEFAULT 'disconnected',
    token_enc     TEXT,
    last_test_at  TEXT,
    last_ok_at    TEXT,
    last_error    TEXT,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS member_audit (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    at       TEXT NOT NULL,
    user_id  INTEGER,
    actor    TEXT NOT NULL,
    action   TEXT NOT NULL,
    object   TEXT,
    result   TEXT NOT NULL,
    detail   TEXT
  );
  CREATE INDEX IF NOT EXISTS member_audit_user ON member_audit (user_id, id);

  CREATE TABLE IF NOT EXISTS member_notifications (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER NOT NULL,
    at       TEXT NOT NULL,
    kind     TEXT NOT NULL,
    title    TEXT NOT NULL,
    body     TEXT NOT NULL,
    link     TEXT,
    read_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS member_notifications_user ON member_notifications (user_id, id);

  CREATE TABLE IF NOT EXISTS member_events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    at       TEXT NOT NULL,
    user_id  INTEGER,
    event    TEXT NOT NULL,
    props    TEXT
  );
  CREATE INDEX IF NOT EXISTS member_events_event ON member_events (event, at);

  CREATE TABLE IF NOT EXISTS stripe_events (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    received_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS community_strategies (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id         INTEGER NOT NULL,
    name             TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'active',
    visibility       TEXT NOT NULL DEFAULT 'private',
    current_version  INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    deleted_at       TEXT
  );
  CREATE INDEX IF NOT EXISTS community_strategies_owner ON community_strategies (owner_id);

  CREATE TABLE IF NOT EXISTS community_strategy_versions (
    strategy_id  INTEGER NOT NULL,
    version      INTEGER NOT NULL,
    rules_json   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (strategy_id, version)
  );

  CREATE TABLE IF NOT EXISTS community_followers (
    strategy_id  INTEGER NOT NULL,
    user_id      INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (strategy_id, user_id)
  );
`;

const stores = new WeakMap<EngineDb, MembersStore>();

/** The members store for this database (its tables are made the first time). */
export function membersStore(db: EngineDb): MembersStore {
  let s = stores.get(db);
  if (!s) stores.set(db, (s = new MembersStore(db)));
  return s;
}

type R = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function riskOf(raw: unknown): RiskLimits {
  const r = parseJson<Record<string, unknown>>(raw, {});
  const out = { ...DEFAULT_RISK };
  for (const k of Object.keys(DEFAULT_RISK) as Array<keyof RiskLimits>) {
    const v = r[k];
    if (k === "priceTolerancePct") {
      if (typeof v === "number" && v >= 0 && v <= 20) out.priceTolerancePct = v;
    } else if (typeof v === "number" && Number.isFinite(v) && v >= 0) (out as Record<string, number | null>)[k] = v;
  }
  return out;
}

export class MembersStore {
  private readonly sql: Database.Database;

  constructor(private readonly db: EngineDb) {
    this.sql = db.sqlite;
    this.sql.exec(SCHEMA);
  }

  private changed(): void {
    this.db.changed();
  }

  /** Runs `fn` in one transaction (all of it is written, or none). */
  tx<T>(fn: () => T): T {
    return this.sql.transaction(fn)();
  }

  // ---- members -------------------------------------------------------------------------------------------------

  private toMember(r: R): MemberRow {
    return {
      userId: Number(r.user_id),
      tierOverride: r.tier_override === "admin" || r.tier_override === "suspended" ? r.tier_override : null,
      trialStartedAt: str(r.trial_started_at),
      trialEndsAt: str(r.trial_ends_at),
      paidUntil: str(r.paid_until),
      paidSource: r.paid_source === "stripe" || r.paid_source === "admin" ? r.paid_source : null,
      stripeCustomerId: str(r.stripe_customer_id),
      stripeSubscriptionId: str(r.stripe_subscription_id),
      subscriptionStatus: str(r.subscription_status),
      liveEnabled: r.live_enabled === 1,
      liveEnabledAt: str(r.live_enabled_at),
      automationPaused: r.automation_paused === 1,
      trialNotices: String(r.trial_notices ?? "").split(",").filter(Boolean),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  getMember(userId: number): MemberRow | null {
    const r = this.sql.prepare(`SELECT * FROM members WHERE user_id = ?`).get(userId) as R | undefined;
    return r ? this.toMember(r) : null;
  }

  /** The member's row, made (as a free member) if this is their first visit. */
  ensureMember(userId: number, at: string): { member: MemberRow; created: boolean } {
    const info = this.sql.prepare(`INSERT OR IGNORE INTO members (user_id, created_at, updated_at) VALUES (?, ?, ?)`).run(userId, at, at);
    if (info.changes > 0) this.changed();
    return { member: this.getMember(userId)!, created: info.changes > 0 };
  }

  listMembers(): MemberRow[] {
    return (this.sql.prepare(`SELECT * FROM members ORDER BY created_at DESC`).all() as R[]).map((r) => this.toMember(r));
  }

  getMemberByStripeCustomer(customerId: string): MemberRow | null {
    const r = this.sql.prepare(`SELECT * FROM members WHERE stripe_customer_id = ?`).get(customerId) as R | undefined;
    return r ? this.toMember(r) : null;
  }

  updateMember(
    userId: number,
    patch: Partial<{
      tierOverride: "admin" | "suspended" | null;
      trialStartedAt: string | null;
      trialEndsAt: string | null;
      paidUntil: string | null;
      paidSource: "stripe" | "admin" | null;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      subscriptionStatus: string | null;
      liveEnabled: boolean;
      liveEnabledAt: string | null;
      automationPaused: boolean;
      trialNotices: string[];
    }>,
    at: string,
  ): void {
    const cols: Record<string, string> = {
      tierOverride: "tier_override",
      trialStartedAt: "trial_started_at",
      trialEndsAt: "trial_ends_at",
      paidUntil: "paid_until",
      paidSource: "paid_source",
      stripeCustomerId: "stripe_customer_id",
      stripeSubscriptionId: "stripe_subscription_id",
      subscriptionStatus: "subscription_status",
      liveEnabled: "live_enabled",
      liveEnabledAt: "live_enabled_at",
      automationPaused: "automation_paused",
      trialNotices: "trial_notices",
    };
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    for (const [k, v] of Object.entries(patch)) {
      const col = cols[k];
      if (!col || v === undefined) continue;
      sets.push(`${col} = ?`);
      values.push(typeof v === "boolean" ? (v ? 1 : 0) : Array.isArray(v) ? v.join(",") : (v as string | null));
    }
    if (sets.length === 0) return;
    this.sql.prepare(`UPDATE members SET ${sets.join(", ")}, updated_at = ? WHERE user_id = ?`).run(...values, at, userId);
    this.changed();
  }

  // ---- trial ---------------------------------------------------------------------------------------------------

  /** Who already claimed a trial with this (normalised) email, or null. */
  trialClaim(emailKey: string): { userId: number; claimedAt: string } | null {
    const r = this.sql.prepare(`SELECT user_id, claimed_at FROM trial_claims WHERE email_key = ?`).get(emailKey) as R | undefined;
    return r ? { userId: Number(r.user_id), claimedAt: String(r.claimed_at) } : null;
  }

  /**
   * Starts a trial in one transaction: claims the email, records the strategies, sets the dates. Returns false (and
   * writes nothing) when the email has a claim already or the member already has trial strategies.
   */
  startTrial(userId: number, emailKey: string, strategies: string[], startedAt: string, endsAt: string): boolean {
    const ok = this.tx(() => {
      if (this.trialClaim(emailKey)) return false;
      const already = this.sql.prepare(`SELECT COUNT(*) AS n FROM member_trial_strategies WHERE user_id = ?`).get(userId) as { n: number };
      if (already.n > 0) return false;
      this.sql.prepare(`INSERT INTO trial_claims (email_key, user_id, claimed_at) VALUES (?, ?, ?)`).run(emailKey, userId, startedAt);
      const ins = this.sql.prepare(`INSERT INTO member_trial_strategies (user_id, strategy_key, chosen_at) VALUES (?, ?, ?)`);
      for (const s of strategies) ins.run(userId, s, startedAt);
      this.sql
        .prepare(`UPDATE members SET trial_started_at = ?, trial_ends_at = ?, trial_notices = '', updated_at = ? WHERE user_id = ?`)
        .run(startedAt, endsAt, startedAt, userId);
      return true;
    });
    if (ok) this.changed();
    return ok;
  }

  trialStrategies(userId: number): string[] {
    return (this.sql.prepare(`SELECT strategy_key FROM member_trial_strategies WHERE user_id = ? ORDER BY chosen_at, strategy_key`).all(userId) as R[]).map((r) =>
      String(r.strategy_key),
    );
  }

  /** The admin's reset: the member may start one more trial (their email claim and chosen strategies are cleared). */
  resetTrial(userId: number, at: string): void {
    this.tx(() => {
      this.sql.prepare(`DELETE FROM trial_claims WHERE user_id = ?`).run(userId);
      this.sql.prepare(`DELETE FROM member_trial_strategies WHERE user_id = ?`).run(userId);
      this.sql.prepare(`UPDATE members SET trial_started_at = NULL, trial_ends_at = NULL, trial_notices = '', updated_at = ? WHERE user_id = ?`).run(at, userId);
    });
    this.changed();
  }

  // ---- settings ------------------------------------------------------------------------------------------------

  private toSettings(r: R): MemberSettings {
    const method = String(r.staking_method);
    return {
      userId: Number(r.user_id),
      simBank: Number(r.sim_bank),
      simStartedAt: String(r.sim_started_at),
      simEpoch: Number(r.sim_epoch),
      stakingMethod: (["flat", "percent_bank", "fixed_percent", "custom", "strategy"].includes(method) ? method : "flat") as StakingMethod,
      stakeValue: Number(r.stake_value),
      customStakes: parseJson<Record<string, number>>(r.custom_stakes, {}),
      risk: riskOf(r.risk_json),
      updatedAt: String(r.updated_at),
    };
  }

  /** The member's settings, made with the defaults the first time. */
  getSettings(userId: number, defaults: { simBank: number; stakeValue: number }, at: string): MemberSettings {
    const r = this.sql.prepare(`SELECT * FROM member_settings WHERE user_id = ?`).get(userId) as R | undefined;
    if (r) return this.toSettings(r);
    this.sql
      .prepare(`INSERT OR IGNORE INTO member_settings (user_id, sim_bank, sim_started_at, stake_value, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(userId, defaults.simBank, at, defaults.stakeValue, at);
    this.changed();
    return this.toSettings(this.sql.prepare(`SELECT * FROM member_settings WHERE user_id = ?`).get(userId) as R);
  }

  saveSettings(userId: number, s: Pick<MemberSettings, "stakingMethod" | "stakeValue" | "customStakes" | "risk">, at: string): void {
    this.sql
      .prepare(`UPDATE member_settings SET staking_method = ?, stake_value = ?, custom_stakes = ?, risk_json = ?, updated_at = ? WHERE user_id = ?`)
      .run(s.stakingMethod, s.stakeValue, JSON.stringify(s.customStakes), JSON.stringify(s.risk), at, userId);
    this.changed();
  }

  /** Starts a new simulation: a new bank and epoch. Earlier simulated bets are kept (history), but no longer count. */
  resetSimulation(userId: number, bank: number, at: string): void {
    this.sql.prepare(`UPDATE member_settings SET sim_bank = ?, sim_started_at = ?, sim_epoch = sim_epoch + 1, updated_at = ? WHERE user_id = ?`).run(bank, at, at, userId);
    // Open simulated bets of the old epoch are settled as void: they belong to a bank that no longer runs.
    this.sql
      .prepare(`UPDATE member_bets SET status = 'void', profit = 0, reason = 'Simulation reset.', settled_at = ?, updated_at = ? WHERE user_id = ? AND mode = 'sim' AND status IN ('pending', 'matched')`)
      .run(at, at, userId);
    this.changed();
  }

  // ---- follows -------------------------------------------------------------------------------------------------

  listFollows(userId: number): Follow[] {
    return (this.sql.prepare(`SELECT * FROM member_follows WHERE user_id = ? ORDER BY strategy_key`).all(userId) as R[]).map((r) => ({
      strategyKey: String(r.strategy_key),
      mode: r.mode === "live" ? "live" : "sim",
      auto: r.auto === 1,
      createdAt: String(r.created_at),
    }));
  }

  /** Every follow with automation on, for the bet runner. */
  listAutoFollows(): Array<Follow & { userId: number }> {
    return (this.sql.prepare(`SELECT * FROM member_follows WHERE auto = 1`).all() as R[]).map((r) => ({
      userId: Number(r.user_id),
      strategyKey: String(r.strategy_key),
      mode: r.mode === "live" ? "live" : "sim",
      auto: true,
      createdAt: String(r.created_at),
    }));
  }

  setFollow(userId: number, strategyKey: string, f: { mode: BetMode; auto: boolean } | null, at: string): void {
    if (f === null) this.sql.prepare(`DELETE FROM member_follows WHERE user_id = ? AND strategy_key = ?`).run(userId, strategyKey);
    else
      this.sql
        .prepare(
          `INSERT INTO member_follows (user_id, strategy_key, mode, auto, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, strategy_key) DO UPDATE SET mode = excluded.mode, auto = excluded.auto, updated_at = excluded.updated_at`,
        )
        .run(userId, strategyKey, f.mode, f.auto ? 1 : 0, at, at);
    this.changed();
  }

  /** Moves every live follow of a member (or of everyone) back to simulation: the kill switch and lost permissions. */
  liveFollowsToSim(userId: number | null, at: string): number {
    const info =
      userId === null
        ? this.sql.prepare(`UPDATE member_follows SET mode = 'sim', updated_at = ? WHERE mode = 'live'`).run(at)
        : this.sql.prepare(`UPDATE member_follows SET mode = 'sim', updated_at = ? WHERE mode = 'live' AND user_id = ?`).run(at, userId);
    if (info.changes > 0) this.changed();
    return info.changes;
  }

  // ---- bets ----------------------------------------------------------------------------------------------------

  private toBet(r: R): MemberBet {
    return {
      id: Number(r.id),
      userId: Number(r.user_id),
      pickId: Number(r.pick_id),
      strategyKey: String(r.strategy_key),
      mode: r.mode === "live" ? "live" : "sim",
      execution: r.execution === "manual" ? "manual" : "auto",
      simEpoch: Number(r.sim_epoch),
      stakingMethod: String(r.staking_method) as StakingMethod,
      stake: Number(r.stake),
      requestedPrice: numOrNull(r.requested_price),
      matchedPrice: numOrNull(r.matched_price),
      matchedStake: numOrNull(r.matched_stake),
      status: String(r.status) as BetStatus,
      profit: numOrNull(r.profit),
      reason: str(r.reason),
      betfairBetId: str(r.betfair_bet_id),
      marketId: str(r.market_id),
      selectionId: numOrNull(r.selection_id),
      marketType: str(r.market_type),
      selectionName: str(r.selection_name),
      bfStatus: str(r.bf_status),
      attempts: Number(r.attempts ?? 0),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      placedAt: str(r.placed_at),
      settledAt: str(r.settled_at),
    };
  }

  /**
   * Records a bet, once: the (member, pick, mode) key is unique, so the same alert processed twice can never make a
   * second bet. Returns the new bet, or null when one already exists.
   */
  insertBet(
    b: Pick<MemberBet, "userId" | "pickId" | "strategyKey" | "mode" | "execution" | "simEpoch" | "stakingMethod" | "stake" | "requestedPrice" | "status" | "reason"> &
      Partial<Pick<MemberBet, "matchedPrice" | "matchedStake" | "placedAt" | "marketType" | "selectionName">>,
    at: string,
  ): MemberBet | null {
    const info = this.sql
      .prepare(
        `INSERT OR IGNORE INTO member_bets (user_id, pick_id, strategy_key, mode, execution, sim_epoch, staking_method, stake, requested_price,
           matched_price, matched_stake, status, reason, market_type, selection_name, created_at, updated_at, placed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        b.userId,
        b.pickId,
        b.strategyKey,
        b.mode,
        b.execution,
        b.simEpoch,
        b.stakingMethod,
        b.stake,
        b.requestedPrice,
        b.matchedPrice ?? null,
        b.matchedStake ?? null,
        b.status,
        b.reason,
        b.marketType ?? null,
        b.selectionName ?? null,
        at,
        at,
        b.placedAt ?? null,
      );
    if (info.changes === 0) return null;
    this.changed();
    return this.getBet(Number(info.lastInsertRowid));
  }

  getBet(id: number): MemberBet | null {
    const r = this.sql.prepare(`SELECT * FROM member_bets WHERE id = ?`).get(id) as R | undefined;
    return r ? this.toBet(r) : null;
  }

  hasBet(userId: number, pickId: number, mode: BetMode): boolean {
    return this.sql.prepare(`SELECT 1 FROM member_bets WHERE user_id = ? AND pick_id = ? AND mode = ?`).get(userId, pickId, mode) !== undefined;
  }

  updateBet(
    id: number,
    patch: Partial<Pick<MemberBet, "status" | "profit" | "reason" | "matchedPrice" | "matchedStake" | "requestedPrice" | "betfairBetId" | "marketId" | "selectionId" | "marketType" | "selectionName" | "bfStatus" | "attempts" | "placedAt" | "settledAt">>,
    at: string,
  ): void {
    const cols: Record<string, string> = {
      status: "status",
      profit: "profit",
      reason: "reason",
      matchedPrice: "matched_price",
      matchedStake: "matched_stake",
      requestedPrice: "requested_price",
      betfairBetId: "betfair_bet_id",
      marketId: "market_id",
      selectionId: "selection_id",
      marketType: "market_type",
      selectionName: "selection_name",
      bfStatus: "bf_status",
      attempts: "attempts",
      placedAt: "placed_at",
      settledAt: "settled_at",
    };
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    for (const [k, v] of Object.entries(patch)) {
      const col = cols[k];
      if (!col || v === undefined) continue;
      sets.push(`${col} = ?`);
      values.push(v as string | number | null);
    }
    if (sets.length === 0) return;
    this.sql.prepare(`UPDATE member_bets SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...values, at, id);
    this.changed();
  }

  /** Bets still open (to settle, or for live: to place or confirm). */
  listOpenBets(): MemberBet[] {
    return (this.sql.prepare(`SELECT * FROM member_bets WHERE status IN ('pending', 'placing', 'matched', 'partially_matched') ORDER BY id`).all() as R[]).map((r) =>
      this.toBet(r),
    );
  }

  /** A member's bets, newest first, with optional filters. */
  listBets(
    userId: number,
    f: { mode?: BetMode; strategyKey?: string; from?: string; to?: string; status?: BetStatus[]; execution?: Execution; simEpoch?: number; limit?: number; offset?: number } = {},
  ): MemberBet[] {
    const where = ["user_id = ?"];
    const args: Array<string | number> = [userId];
    if (f.mode) (where.push("mode = ?"), args.push(f.mode));
    if (f.strategyKey) (where.push("strategy_key = ?"), args.push(f.strategyKey));
    if (f.from) (where.push("created_at >= ?"), args.push(f.from));
    if (f.to) (where.push("created_at < ?"), args.push(f.to));
    if (f.execution) (where.push("execution = ?"), args.push(f.execution));
    if (f.simEpoch !== undefined) (where.push("(mode = 'live' OR sim_epoch = ?)"), args.push(f.simEpoch));
    if (f.status?.length) (where.push(`status IN (${f.status.map(() => "?").join(", ")})`), args.push(...f.status));
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 5000);
    const offset = Math.max(f.offset ?? 0, 0);
    return (this.sql.prepare(`SELECT * FROM member_bets WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as R[]).map(
      (r) => this.toBet(r),
    );
  }

  /** Every bet of every member in a mode since a time (admin overview). */
  listAllBets(f: { mode?: BetMode; since?: string; limit?: number } = {}): MemberBet[] {
    const where = ["1 = 1"];
    const args: Array<string | number> = [];
    if (f.mode) (where.push("mode = ?"), args.push(f.mode));
    if (f.since) (where.push("created_at >= ?"), args.push(f.since));
    return (this.sql.prepare(`SELECT * FROM member_bets WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(f.limit ?? 200, 5000)) as R[]).map((r) =>
      this.toBet(r),
    );
  }

  // ---- Betfair connection --------------------------------------------------------------------------------------

  getConnection(userId: number): BetfairConnection {
    const r = this.sql.prepare(`SELECT * FROM member_betfair WHERE user_id = ?`).get(userId) as R | undefined;
    if (!r) return { userId, kind: "none", status: "disconnected", lastTestAt: null, lastOkAt: null, lastError: null, tokenEnc: null, updatedAt: new Date(0).toISOString() };
    return {
      userId,
      kind: r.kind === "house" || r.kind === "vendor" ? r.kind : "none",
      status: r.status === "connected" || r.status === "error" ? r.status : "disconnected",
      lastTestAt: str(r.last_test_at),
      lastOkAt: str(r.last_ok_at),
      lastError: str(r.last_error),
      tokenEnc: str(r.token_enc),
      updatedAt: String(r.updated_at),
    };
  }

  saveConnection(c: Omit<BetfairConnection, "updatedAt">, at: string): void {
    this.sql
      .prepare(
        `INSERT INTO member_betfair (user_id, kind, status, token_enc, last_test_at, last_ok_at, last_error, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET kind = excluded.kind, status = excluded.status, token_enc = excluded.token_enc,
           last_test_at = excluded.last_test_at, last_ok_at = excluded.last_ok_at, last_error = excluded.last_error, updated_at = excluded.updated_at`,
      )
      .run(c.userId, c.kind, c.status, c.tokenEnc, c.lastTestAt, c.lastOkAt, c.lastError, at);
    this.changed();
  }

  listConnections(): BetfairConnection[] {
    return (this.sql.prepare(`SELECT user_id FROM member_betfair`).all() as R[]).map((r) => this.getConnection(Number(r.user_id)));
  }

  // ---- audit, notifications, events ---------------------------------------------------------------------------

  audit(e: Omit<AuditEntry, "id">): void {
    this.sql
      .prepare(`INSERT INTO member_audit (at, user_id, actor, action, object, result, detail) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(e.at, e.userId, e.actor, e.action, e.object, e.result, e.detail);
    this.changed();
  }

  listAudit(f: { userId?: number; limit?: number; actions?: string[] } = {}): AuditEntry[] {
    const where = ["1 = 1"];
    const args: Array<string | number> = [];
    if (f.userId !== undefined) (where.push("user_id = ?"), args.push(f.userId));
    if (f.actions?.length) (where.push(`action IN (${f.actions.map(() => "?").join(", ")})`), args.push(...f.actions));
    return (this.sql.prepare(`SELECT * FROM member_audit WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(f.limit ?? 100, 1000)) as R[]).map((r) => ({
      id: Number(r.id),
      at: String(r.at),
      userId: numOrNull(r.user_id),
      actor: String(r.actor) as AuditEntry["actor"],
      action: String(r.action),
      object: str(r.object),
      result: String(r.result) as AuditEntry["result"],
      detail: str(r.detail),
    }));
  }

  notify(n: Omit<Notification, "id" | "readAt">): void {
    this.sql
      .prepare(`INSERT INTO member_notifications (user_id, at, kind, title, body, link) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(n.userId, n.at, n.kind, n.title, n.body, n.link);
    this.changed();
  }

  listNotifications(userId: number, limit = 30): Notification[] {
    return (this.sql.prepare(`SELECT * FROM member_notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?`).all(userId, Math.min(limit, 200)) as R[]).map((r) => ({
      id: Number(r.id),
      userId: Number(r.user_id),
      at: String(r.at),
      kind: String(r.kind),
      title: String(r.title),
      body: String(r.body),
      link: str(r.link),
      readAt: str(r.read_at),
    }));
  }

  unreadCount(userId: number): number {
    return (this.sql.prepare(`SELECT COUNT(*) AS n FROM member_notifications WHERE user_id = ? AND read_at IS NULL`).get(userId) as { n: number }).n;
  }

  markNotificationsRead(userId: number, at: string): void {
    const info = this.sql.prepare(`UPDATE member_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`).run(at, userId);
    if (info.changes > 0) this.changed();
  }

  /** Whether this member already has a notification of this kind for this key (stops repeats). */
  hasNotification(userId: number, kind: string, link: string | null): boolean {
    return (
      this.sql.prepare(`SELECT 1 FROM member_notifications WHERE user_id = ? AND kind = ? AND COALESCE(link, '') = ?`).get(userId, kind, link ?? "") !== undefined
    );
  }

  event(userId: number | null, event: string, props: Record<string, unknown> | null, at: string): void {
    this.sql.prepare(`INSERT INTO member_events (at, user_id, event, props) VALUES (?, ?, ?, ?)`).run(at, userId, event, props ? JSON.stringify(props) : null);
    this.changed();
  }

  /** Count of each event (and distinct members) since a time, for the admin funnel. */
  eventCounts(sinceIso: string): Array<{ event: string; count: number; members: number }> {
    return (
      this.sql
        .prepare(`SELECT event, COUNT(*) AS n, COUNT(DISTINCT user_id) AS m FROM member_events WHERE at >= ? GROUP BY event ORDER BY n DESC`)
        .all(sinceIso) as Array<{ event: string; n: number; m: number }>
    ).map((r) => ({ event: r.event, count: r.n, members: r.m }));
  }

  /** True the first time an event id is seen (Stripe sends some events more than once). */
  claimStripeEvent(id: string, type: string, at: string): boolean {
    const info = this.sql.prepare(`INSERT OR IGNORE INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)`).run(id, type, at);
    if (info.changes > 0) this.changed();
    return info.changes > 0;
  }

  // ---- community strategies ------------------------------------------------------------------------------------

  private toCommunity(r: R): CommunityStrategy {
    return {
      id: Number(r.id),
      ownerId: Number(r.owner_id),
      name: String(r.name),
      description: String(r.description),
      status: r.status === "paused" || r.status === "archived" ? r.status : "active",
      visibility: r.visibility === "shared" ? "shared" : "private",
      currentVersion: Number(r.current_version),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  createCommunityStrategy(ownerId: number, name: string, description: string, rules: unknown, at: string): CommunityStrategy {
    const id = this.tx(() => {
      const info = this.sql
        .prepare(`INSERT INTO community_strategies (owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
        .run(ownerId, name, description, at, at);
      const sid = Number(info.lastInsertRowid);
      this.sql.prepare(`INSERT INTO community_strategy_versions (strategy_id, version, rules_json, created_at) VALUES (?, 1, ?, ?)`).run(sid, JSON.stringify(rules), at);
      return sid;
    });
    this.changed();
    return this.getCommunityStrategy(id)!;
  }

  getCommunityStrategy(id: number): CommunityStrategy | null {
    const r = this.sql.prepare(`SELECT * FROM community_strategies WHERE id = ? AND deleted_at IS NULL`).get(id) as R | undefined;
    return r ? this.toCommunity(r) : null;
  }

  listCommunityStrategies(f: { ownerId?: number; shared?: boolean }): CommunityStrategy[] {
    const where = ["deleted_at IS NULL"];
    const args: Array<string | number> = [];
    if (f.ownerId !== undefined) (where.push("owner_id = ?"), args.push(f.ownerId));
    if (f.shared) where.push("visibility = 'shared' AND status != 'archived'");
    return (this.sql.prepare(`SELECT * FROM community_strategies WHERE ${where.join(" AND ")} ORDER BY updated_at DESC`).all(...args) as R[]).map((r) => this.toCommunity(r));
  }

  updateCommunityStrategy(id: number, patch: Partial<Pick<CommunityStrategy, "name" | "description" | "status" | "visibility">>, at: string): void {
    const cols: Record<string, string> = { name: "name", description: "description", status: "status", visibility: "visibility" };
    const sets: string[] = [];
    const values: string[] = [];
    for (const [k, v] of Object.entries(patch)) if (cols[k] && typeof v === "string") (sets.push(`${cols[k]} = ?`), values.push(v));
    if (sets.length === 0) return;
    this.sql.prepare(`UPDATE community_strategies SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...values, at, id);
    this.changed();
  }

  /** A new version of the rules; earlier versions (and the results that came from them) are kept. */
  addCommunityVersion(id: number, rules: unknown, at: string): number {
    const v = this.tx(() => {
      const cur = this.sql.prepare(`SELECT current_version FROM community_strategies WHERE id = ?`).get(id) as { current_version: number };
      const next = cur.current_version + 1;
      this.sql.prepare(`INSERT INTO community_strategy_versions (strategy_id, version, rules_json, created_at) VALUES (?, ?, ?, ?)`).run(id, next, JSON.stringify(rules), at);
      this.sql.prepare(`UPDATE community_strategies SET current_version = ?, updated_at = ? WHERE id = ?`).run(next, at, id);
      return next;
    });
    this.changed();
    return v;
  }

  listCommunityVersions(id: number): StrategyVersion[] {
    return (this.sql.prepare(`SELECT * FROM community_strategy_versions WHERE strategy_id = ? ORDER BY version`).all(id) as R[]).map((r) => ({
      strategyId: Number(r.strategy_id),
      version: Number(r.version),
      rules: parseJson<unknown>(r.rules_json, {}),
      createdAt: String(r.created_at),
    }));
  }

  /** Deleting keeps the row (hidden) so its id is never reused and any audit trail still points somewhere. */
  deleteCommunityStrategy(id: number, at: string): void {
    this.sql.prepare(`UPDATE community_strategies SET deleted_at = ?, visibility = 'private', updated_at = ? WHERE id = ?`).run(at, at, id);
    this.sql.prepare(`DELETE FROM community_followers WHERE strategy_id = ?`).run(id);
    this.changed();
  }

  followerCount(id: number): number {
    return (this.sql.prepare(`SELECT COUNT(*) AS n FROM community_followers WHERE strategy_id = ?`).get(id) as { n: number }).n;
  }

  setCommunityFollow(id: number, userId: number, on: boolean, at: string): void {
    if (on) this.sql.prepare(`INSERT OR IGNORE INTO community_followers (strategy_id, user_id, created_at) VALUES (?, ?, ?)`).run(id, userId, at);
    else this.sql.prepare(`DELETE FROM community_followers WHERE strategy_id = ? AND user_id = ?`).run(id, userId);
    this.changed();
  }
}
