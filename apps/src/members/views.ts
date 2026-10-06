/**
 * What each Members page is sent. Every function takes the member's context and builds only what their access allows:
 * a locked part is left out of the response altogether (and replaced by a "locked" flag), never sent and hidden.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { listCatalogue, maxAgeMinutes, memberStrategyKey, pickState, toCard, toDetail, toPickFull, type CatalogueEntry, type PickFull } from "./catalogue";
import { emptyHouseStats, houseStats, type HouseStrategyStats } from "./house";
import { can, CAPABILITIES, CAPABILITY_LABEL, rulesFor, strategyAllowed } from "./permissions";
import { trialStatus, type MemberContext } from "./service";
import { memberSettingsFor, simBank } from "./runner";
import { membersStore, type BetMode, type BetStatus, type MemberBet } from "./store";
import { byStrategy, equityCurve, summarise } from "./stats";
import { STAKING_LABEL } from "./staking";
import { stripeConfigured } from "./stripe";
import { connectionView } from "./betfair-connection";
import { liveBlock, LIVE_CONFIRMATION, type LiveDeps } from "./live";
import { memberLiveAllowedByEngine } from "./config";
import { ukDateOf, ukDayBounds } from "../server/uk-time";
import { addDaysUk } from "./time";

const r2 = (n: number) => Math.round(n * 100) / 100;

function catalogueMap(db: EngineDb, ctx: MemberContext): Map<string, CatalogueEntry> {
  return new Map(listCatalogue(db, ctx.config).map((c) => [c.key, c]));
}

/** Who the member is and what they may do: drives the navigation, locks and prompts. */
export function meView(db: EngineDb, ctx: MemberContext) {
  const store = membersStore(db);
  const s = memberSettingsFor(db, ctx, new Date().toISOString());
  return {
    user: { name: ctx.user.name, email: ctx.user.email },
    tier: ctx.tier,
    caps: ctx.access.caps,
    strategyScope: ctx.access.strategyScope,
    trial: trialStatus(db, ctx),
    paid: { until: ctx.member.paidUntil, source: ctx.member.paidSource, status: ctx.member.subscriptionStatus, canManage: Boolean(ctx.member.stripeCustomerId) },
    billing: { available: stripeConfigured(), priceLabel: ctx.config.paidPriceLabel },
    flags: { community: ctx.config.flags.community, trial: ctx.config.flags.trial, strategyCreation: ctx.config.flags.strategyCreation, strategySharing: ctx.config.flags.strategySharing },
    live: { enabled: ctx.member.liveEnabled, paused: ctx.member.automationPaused },
    sim: { bank: simBank(db, ctx.user.id, s), startBank: s.simBank, startedAt: s.simStartedAt },
    unread: store.unreadCount(ctx.user.id),
  };
}

/** The permission matrix for the comparison table (the configured one, not just the defaults). */
export function plansView(db: EngineDb, ctx: MemberContext) {
  const tiers = (["free", "trial", "paid"] as const).map((t) => ({ tier: t, ...rulesFor(t, ctx.config.tierOverrides, ctx.config.flags) }));
  return {
    capabilities: CAPABILITIES.map((c) => ({ key: c, label: CAPABILITY_LABEL[c] })),
    tiers,
    trialDays: ctx.config.trialDays,
    trialStrategyLimit: ctx.config.trialStrategyLimit,
    priceLabel: ctx.config.paidPriceLabel,
  };
}

function wl(h: HouseStrategyStats) {
  return { today: h.today, week: h.week, last30: h.last30, perWeek: h.perWeek };
}

/**
 * House strategies. Everyone: name, type, today / this week / 30 days wins, losses and hit rate.
 * Detail (description, rules, bet) only where the member's access covers that strategy; money figures, history chart
 * and drawdown also need advanced analytics.
 */
export function strategiesView(db: EngineDb, ctx: MemberContext) {
  const house = houseStats(db, ctx.config.commissionPct);
  const follows = new Map(membersStore(db).listFollows(ctx.user.id).map((f) => [f.strategyKey, f]));
  return listCatalogue(db, ctx.config).map((c) => {
    const h = house.get(c.key) ?? emptyHouseStats(c.key);
    const detail = strategyAllowed(ctx.access, "viewStrategyDetails", c.key);
    const analytics = detail && can(ctx.access, "viewAdvancedAnalytics");
    const f = follows.get(c.key);
    return {
      ...(detail ? toDetail(c) : toCard(c)),
      locked: !detail,
      results: wl(h),
      money: analytics ? { all: h.all, last30: h.last30Money } : null,
      daily: analytics ? h.daily : h.daily.map((d) => ({ date: d.date, wins: d.wins, losses: d.losses })),
      lastAlertAt: detail ? h.lastAlertAt : null,
      following: f ? { mode: f.mode, auto: f.auto } : null,
      trialSelected: ctx.access.selected.includes(c.key),
    };
  });
}

/** One house strategy in depth, with its recent picks in full (when allowed). */
export function strategyView(db: EngineDb, ctx: MemberContext, key: string) {
  const c = catalogueMap(db, ctx).get(key.toLowerCase());
  if (!c) return null;
  const list = strategiesView(db, ctx).find((s) => s.key === c.key)!;
  let recent: PickFull[] | null = null;
  if (strategyAllowed(ctx.access, "viewSelections", c.key)) {
    const merges = db.getStrategyMerges();
    const now = new Date();
    const age = maxAgeMinutes(db);
    const window = { from: new Date(now.getTime() - 14 * 86_400_000).toISOString(), to: new Date(now.getTime() + 60_000).toISOString() };
    recent = db
      .listLivePicks(1000, window)
      .filter((p) => !p.excluded && memberStrategyKey(merges, p.strategy) === c.key)
      .slice(0, 50)
      .map((p) => toPickFull(p, c.key, c.name, now, age));
  }
  membersStore(db).event(ctx.user.id, "strategy_viewed", { strategy: c.key }, new Date().toISOString());
  return { ...list, recent, selectionsLocked: recent === null };
}

/**
 * Upcoming opportunities: alerts that can still be bet (in-play ones for a few minutes, pre-match ones until kick-off),
 * plus the last few hours' alerts still waiting for a result. In full for strategies the member may see; otherwise
 * only how many there are per strategy name.
 */
export function upcomingView(db: EngineDb, ctx: MemberContext, deps: LiveDeps | null) {
  const cat = catalogueMap(db, ctx);
  const merges = db.getStrategyMerges();
  const now = new Date();
  const age = maxAgeMinutes(db);
  const picks = db.listLivePicks(500, { from: new Date(now.getTime() - 6 * 3_600_000).toISOString(), to: new Date(now.getTime() + 60_000).toISOString() });
  const store = membersStore(db);
  const mine = new Map(store.listBets(ctx.user.id, { from: new Date(now.getTime() - 7 * 3_600_000).toISOString(), limit: 2000 }).map((b) => [`${b.pickId}:${b.mode}`, b]));
  const open: Array<PickFull & { simulated: boolean; live: string | null; canSimulate: boolean }> = [];
  const locked = new Map<string, { strategyKey: string; strategyName: string; live: number; waiting: number }>();
  for (const p of picks) {
    if (p.excluded) continue;
    const key = memberStrategyKey(merges, p.strategy);
    const c = cat.get(key);
    if (!c) continue;
    const state = pickState(p, now, age);
    if (state !== "live" && state !== "waiting") continue;
    if (strategyAllowed(ctx.access, "viewSchedules", key) && strategyAllowed(ctx.access, "viewSelections", key)) {
      const sim = mine.get(`${p.id}:sim`);
      const live = mine.get(`${p.id}:live`);
      open.push({
        ...toPickFull(p, key, c.name, now, age),
        simulated: Boolean(sim && sim.status !== "rejected"),
        live: live ? live.status : null,
        canSimulate: state === "live" && can(ctx.access, "useSimulation") && !sim,
      });
    } else {
      const l = locked.get(key) ?? { strategyKey: key, strategyName: c.name, live: 0, waiting: 0 };
      if (state === "live") l.live++;
      else l.waiting++;
      locked.set(key, l);
    }
  }
  const automation = automationSummary(db, ctx, deps);
  return { open, locked: [...locked.values()], automation };
}

function automationSummary(db: EngineDb, ctx: MemberContext, deps: LiveDeps | null) {
  const follows = membersStore(db).listFollows(ctx.user.id);
  return {
    following: follows.length,
    sim: follows.filter((f) => f.mode === "sim" && f.auto).length,
    live: follows.filter((f) => f.mode === "live" && f.auto).length,
    liveBlockedReason: liveBlock(db, ctx, deps),
  };
}

// ---- bets ------------------------------------------------------------------------------------------------------

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
  /** Null when the member's access doesn't cover this strategy's selections. */
  pick: { home: string | null; away: string | null; competition: string | null; minute: number | null; score: string | null; market: string | null; selection: string | null; ftScore: string | null } | null;
}

function betView(b: MemberBet, p: LivePick | null, name: string, full: boolean): BetView {
  const settled = b.status === "won" || b.status === "lost" || b.status === "void";
  const odds = b.matchedPrice ?? b.requestedPrice;
  const stakeAtRisk = b.mode === "live" ? (b.matchedStake ?? 0) : b.stake;
  return {
    id: b.id,
    at: b.createdAt,
    settledAt: b.settledAt,
    strategyKey: b.strategyKey,
    strategyName: name,
    mode: b.mode,
    execution: b.execution,
    status: b.status,
    stake: b.stake,
    stakingMethod: STAKING_LABEL[b.stakingMethod] ?? b.stakingMethod,
    odds,
    requestedPrice: full ? b.requestedPrice : null,
    matchedStake: b.matchedStake,
    returns: settled && b.profit !== null ? r2(stakeAtRisk + b.profit) : null,
    profit: settled ? b.profit : null,
    reason: b.reason,
    betfairBetId: b.betfairBetId,
    bfStatus: b.bfStatus,
    pick:
      full && p
        ? {
            home: p.home,
            away: p.away,
            competition: p.competition,
            minute: p.minute,
            score: p.goalsHome !== null && p.goalsAway !== null ? `${p.goalsHome}-${p.goalsAway}` : null,
            market: toPickFull(p, b.strategyKey, name, new Date(), 10).market,
            selection: p.selection,
            ftScore: p.ftScore,
          }
        : null,
  };
}

export interface BetFilters {
  mode?: BetMode;
  strategy?: string;
  from?: string;
  to?: string;
  result?: "won" | "lost" | "void" | "open" | "notPlaced";
  execution?: "auto" | "manual";
  page?: number;
}

/**
 * Bet history. A bet on a strategy the member may not see in full is shown without the match, market or minute, and
 * only once settled (so it can't be used to bet the alert).
 */
export function historyView(db: EngineDb, ctx: MemberContext, f: BetFilters) {
  const store = membersStore(db);
  const cat = catalogueMap(db, ctx);
  const status: BetStatus[] | undefined =
    f.result === "won" ? ["won"] : f.result === "lost" ? ["lost"] : f.result === "void" ? ["void"] : f.result === "open" ? ["pending", "placing", "matched", "partially_matched"] : f.result === "notPlaced" ? ["rejected", "failed", "cancelled"] : undefined;
  let from = f.from;
  if (!can(ctx.access, "viewFullHistory")) {
    const floor = new Date(Date.now() - ctx.config.freeHistoryDays * 86_400_000).toISOString();
    if (!from || from < floor) from = floor;
  }
  const page = Math.max(0, Math.min(f.page ?? 0, 500));
  const bets = store.listBets(ctx.user.id, { mode: f.mode, strategyKey: f.strategy, from, to: f.to, status, execution: f.execution, limit: 51, offset: page * 50 });
  const rows: BetView[] = [];
  for (const b of bets.slice(0, 50)) {
    const full = strategyAllowed(ctx.access, "viewSelections", b.strategyKey);
    const settled = b.status === "won" || b.status === "lost" || b.status === "void" || b.status === "rejected" || b.status === "failed" || b.status === "cancelled";
    if (!full && !settled) continue;
    rows.push(betView(b, full ? db.getLivePick(b.pickId) : null, cat.get(b.strategyKey)?.name ?? "Strategy", full));
  }
  return { rows, page, more: bets.length > 50, limitedToDays: can(ctx.access, "viewFullHistory") ? null : ctx.config.freeHistoryDays };
}

/** The member's own performance in one mode (never mixed): summary, by strategy, and the bank or profit over time. */
export function performanceView(db: EngineDb, ctx: MemberContext, mode: BetMode, range: "all" | "30d" | "7d" | "today") {
  const store = membersStore(db);
  const s = memberSettingsFor(db, ctx, new Date().toISOString());
  const today = ukDateOf(new Date());
  let from: string | undefined =
    range === "today" ? ukDayBounds(today).from : range === "7d" ? ukDayBounds(addDaysUk(today, -6)).from : range === "30d" ? ukDayBounds(addDaysUk(today, -29)).from : undefined;
  if (!can(ctx.access, "personalTracking")) {
    const floor = new Date(Date.now() - ctx.config.freeHistoryDays * 86_400_000).toISOString();
    if (!from || from < floor) from = floor;
  }
  const bets = store.listBets(ctx.user.id, { mode, from, simEpoch: mode === "sim" ? s.simEpoch : undefined, limit: 5000 });
  const cat = catalogueMap(db, ctx);
  const sum = summarise(bets);
  return {
    mode,
    range,
    summary: sum,
    bank: mode === "sim" ? { start: s.simBank, now: simBank(db, ctx.user.id, s), startedAt: s.simStartedAt } : null,
    byStrategy: byStrategy(bets).map((x) => ({ ...x, strategyName: cat.get(x.strategyKey)?.name ?? "Strategy" })),
    curve: equityCurve(bets, mode === "sim" ? s.simBank : 0),
    staking: { method: STAKING_LABEL[s.stakingMethod], value: s.stakeValue },
    limitedToDays: can(ctx.access, "personalTracking") ? null : ctx.config.freeHistoryDays,
    assumptions:
      mode === "sim"
        ? `Simulated bets are matched in full at the price recorded for the alert${ctx.config.simSlippagePct > 0 ? `, less ${ctx.config.simSlippagePct}% slippage` : ""}, and settled from the alert's result with ${ctx.config.commissionPct}% commission taken off winnings. Real prices can move and part of a bet may not match.`
        : null,
  };
}

/** The dashboard: membership, mode, the simulation bank, recent activity, house performance and automation. */
export function dashboardView(db: EngineDb, ctx: MemberContext, deps: LiveDeps | null) {
  const me = meView(db, ctx);
  const sim = performanceView(db, ctx, "sim", "all");
  const hasLive = membersStore(db).listBets(ctx.user.id, { mode: "live", limit: 1 }).length > 0;
  const upcoming = upcomingView(db, ctx, deps);
  return {
    me,
    sim: { summary: sim.summary, bank: sim.bank, curve: sim.curve },
    live: hasLive ? performanceView(db, ctx, "live", "all").summary : null,
    recent: historyView(db, ctx, {}).rows.slice(0, 8),
    house: strategiesView(db, ctx).map((s) => ({ key: s.key, name: s.name, locked: s.locked, today: s.results.today, week: s.results.week, last30: s.results.last30, following: s.following })),
    upcoming: { open: upcoming.open.slice(0, 5), openCount: upcoming.open.length, locked: upcoming.locked },
    automation: upcoming.automation,
  };
}

/** Betfair Automation page: connection, live status and why it's blocked, the confirmation words, follows. */
export function automationView(db: EngineDb, ctx: MemberContext, deps: LiveDeps | null) {
  const cat = catalogueMap(db, ctx);
  return {
    connection: connectionView(db, ctx),
    live: {
      enabled: ctx.member.liveEnabled,
      paused: ctx.member.automationPaused,
      allowedByMembership: can(ctx.access, "enableLiveBetting"),
      globalOn: ctx.config.flags.liveBetting && memberLiveAllowedByEngine(),
      blockedReason: liveBlock(db, ctx, deps),
      confirmation: LIVE_CONFIRMATION,
    },
    follows: membersStore(db)
      .listFollows(ctx.user.id)
      .map((f) => ({ ...f, strategyName: cat.get(f.strategyKey)?.name ?? f.strategyKey, liveApproved: cat.get(f.strategyKey)?.liveApproved ?? false })),
    strategies: [...cat.values()].map((c) => ({ key: c.key, name: c.name, liveApproved: c.liveApproved })),
  };
}

export function settingsView(db: EngineDb, ctx: MemberContext) {
  const s = memberSettingsFor(db, ctx, new Date().toISOString());
  return {
    stakingMethod: s.stakingMethod,
    stakeValue: s.stakeValue,
    customStakes: s.customStakes,
    risk: s.risk,
    simBank: s.simBank,
    simStartedAt: s.simStartedAt,
    advancedStaking: can(ctx.access, "advancedStaking"),
    advancedRisk: can(ctx.access, "advancedRisk"),
    defaultSimBank: ctx.config.defaultSimBank,
    stakingMethods: Object.entries(STAKING_LABEL).map(([value, label]) => ({ value, label })),
  };
}
