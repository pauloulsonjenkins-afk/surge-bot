/**
 * The members' bet runner: HOUSE ALERT -> FOLLOWING MEMBERS -> SIMULATION or LIVE -> RISK CHECK -> DUPLICATE CHECK ->
 * PRICE CHECK -> BET -> CONFIRMATION -> SETTLEMENT -> P/L.
 *
 * Every pass (every few seconds, and straight away when an alert arrives):
 *   1. New alerts of followed strategies become bets for each member following them automatically. Only alerts that
 *      arrived after the member started following count. A bet the checks refuse is still recorded (status rejected,
 *      with the reason), never silently dropped.
 *   2. Live bets are placed and confirmed (live.ts).
 *   3. Bets whose alert has a result are settled; an alert removed, or cleared as postponed, voids its bets.
 *
 * SIMULATION never places anything on Betfair: this file has no Betfair access at all. A simulated bet is matched in
 * full at the price recorded for the alert (less the assumed slippage), and settled from the alert's result, with
 * commission taken off winnings.
 *
 * DUPLICATES: one bet per member + alert + mode is enforced by the database (a unique key), so an alert processed twice,
 * or two passes at once, can never make a second bet.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { getSendingSettings } from "../inplayguru/bet-feed";
import { log } from "../server/log";
import { ukDateOf } from "../server/uk-time";
import { listCatalogue, memberStrategyKey, pickPrice, pickState, maxAgeMinutes, type CatalogueEntry } from "./catalogue";
import { can, strategyAllowed } from "./permissions";
import { memberContext, runMembershipNotices, type MemberContext } from "./service";
import { checkRisk, computeStake } from "./staking";
import { membersStore, type MemberBet, type MemberSettings } from "./store";
import { getMembersConfig } from "./config";
import { openExposure, todayTotals } from "./stats";
import { createLiveBet, executeLiveBets, settleLiveBet, type LiveDeps } from "./live";

/** How long to wait for a price before a simulated bet is given up (the Betfair price is read about a minute after the alert). */
const PRICE_WAIT_MS = 10 * 60_000;
/** How far back a pass looks for alerts. */
const LOOKBACK_MS = 6 * 3_600_000;

const r2 = (n: number) => Math.round(n * 100) / 100;

export function memberSettingsFor(db: EngineDb, ctx: MemberContext, at: string): MemberSettings {
  return membersStore(db).getSettings(ctx.user.id, { simBank: ctx.config.defaultSimBank, stakeValue: Math.max(1, r2(ctx.config.defaultSimBank / 50)) }, at);
}

/** The simulation bank now: the starting bank plus the current simulation's settled profit. */
export function simBank(db: EngineDb, userId: number, s: MemberSettings): number {
  const bets = membersStore(db).listBets(userId, { mode: "sim", simEpoch: s.simEpoch, status: ["won", "lost", "void"], limit: 5000 });
  return r2(s.simBank + bets.reduce((t, b) => t + (b.profit ?? 0), 0));
}

/** Simulated profit of a settled bet: stake x (price - 1) less commission when won, minus the stake when lost. */
export function simProfit(stake: number, price: number, won: boolean, commissionPct: number): number {
  return r2(won ? stake * (price - 1) * (1 - commissionPct / 100) : -stake);
}

export function simulatedPrice(price: number, slippagePct: number): number {
  return Math.max(1.01, r2(price * (1 - slippagePct / 100)));
}

interface PassCache {
  ctx: Map<number, MemberContext | null>;
  catalogue: Map<string, CatalogueEntry>;
}

function ctxOf(db: EngineDb, cache: PassCache, userId: number, now: Date): MemberContext | null {
  if (!cache.ctx.has(userId)) cache.ctx.set(userId, memberContext(db, userId, now));
  return cache.ctx.get(userId)!;
}

/**
 * Places one simulated bet for a member on an alert, after the checks. Returns the bet recorded (matched or rejected),
 * or null when nothing was recorded (already bet, or the price isn't known yet and it's worth waiting).
 */
export function placeSimBet(db: EngineDb, ctx: MemberContext, p: LivePick, strategyKey: string, execution: "auto" | "manual", now: Date): MemberBet | null {
  const store = membersStore(db);
  const at = now.toISOString();
  if (store.hasBet(ctx.user.id, p.id, "sim")) return null;
  const s = memberSettingsFor(db, ctx, at);
  const base = { userId: ctx.user.id, pickId: p.id, strategyKey, mode: "sim" as const, execution, simEpoch: s.simEpoch };
  const reject = (reason: string, stake = 0, method: MemberBet["stakingMethod"] = s.stakingMethod, price: number | null = null) =>
    store.insertBet({ ...base, stakingMethod: method, stake, requestedPrice: price, status: "rejected", reason }, at);

  const state = pickState(p, now, maxAgeMinutes(db));
  if (state === "void") return reject("The alert was withdrawn.");
  if (state !== "live") return reject("The alert arrived too late to bet.");
  const price = pickPrice(p);
  if (price === null) {
    if (now.getTime() - Date.parse(p.messageAt ?? p.firstSeenAt) < PRICE_WAIT_MS) return null;
    return reject("No price was available for this bet.");
  }
  const matched = simulatedPrice(price, ctx.config.simSlippagePct);
  const bank = simBank(db, ctx.user.id, s);
  const house = getSendingSettings(db).stakes[strategyKey] ?? null;
  const { stake, method } = computeStake(s, { strategyKey, bank, houseStake: house, advanced: can(ctx.access, "advancedStaking") });
  const current = store.listBets(ctx.user.id, { mode: "sim", simEpoch: s.simEpoch, limit: 5000, from: new Date(now.getTime() - 3 * 86_400_000).toISOString() });
  const today = todayTotals(current, "sim", now);
  const risk = checkRisk(s.risk, {
    stake,
    odds: matched,
    bank,
    startBank: s.simBank,
    openExposure: openExposure(current),
    todayStaked: today.staked,
    todayProfit: today.profit,
    todayBets: today.bets,
    minimumStake: 0.01,
  });
  if (!risk.ok) {
    const bet = reject(risk.reason, stake, method, price);
    if (bet && (risk.kind === "daily_loss" || risk.kind === "stop_loss")) notifyRiskOnce(db, ctx.user.id, risk.kind, risk.reason, now);
    return bet;
  }
  return store.insertBet(
    {
      ...base,
      stakingMethod: method,
      stake: risk.stake,
      requestedPrice: price,
      matchedPrice: matched,
      matchedStake: risk.stake,
      status: "matched",
      reason: risk.capped ? "Stake capped at your maximum stake." : null,
      placedAt: at,
    },
    at,
  );
}

function notifyRiskOnce(db: EngineDb, userId: number, kind: string, reason: string, now: Date): void {
  const store = membersStore(db);
  const key = `risk:${kind}:${ukDateOf(now)}`;
  if (store.hasNotification(userId, "risk_limit", key)) return;
  store.notify({ userId, at: now.toISOString(), kind: "risk_limit", title: kind === "stop_loss" ? "Stop loss reached" : "Daily loss limit reached", body: `${reason} No more bets will be placed until it clears.`, link: key });
  store.audit({ at: now.toISOString(), userId, actor: "system", action: "risk_limit", object: kind, result: "refused", detail: reason });
}

/** A member simulating an alert by hand (from Upcoming). Needs the right to see that strategy's selections. */
export function simulateManually(db: EngineDb, ctx: MemberContext, pickId: unknown, now = new Date()): { ok: true; bet: MemberBet } | { ok: false; error: string } {
  if (!can(ctx.access, "useSimulation")) return { ok: false, error: "Simulation isn't part of your membership." };
  const id = Number(pickId);
  const p = Number.isInteger(id) ? db.getLivePick(id) : null;
  if (!p) return { ok: false, error: "That opportunity no longer exists." };
  const key = memberStrategyKey(db.getStrategyMerges(), p.strategy);
  if (!listCatalogue(db, ctx.config).some((c) => c.key === key)) return { ok: false, error: "That opportunity no longer exists." };
  // Not allowed to see it: answered exactly as if it didn't exist, so the request reveals nothing.
  if (!strategyAllowed(ctx.access, "viewSelections", key)) return { ok: false, error: "That opportunity no longer exists." };
  if (membersStore(db).hasBet(ctx.user.id, p.id, "sim")) return { ok: false, error: "You've already simulated this one." };
  const bet = placeSimBet(db, ctx, p, key, "manual", now);
  if (!bet) return { ok: false, error: "The price isn't known yet. Try again in a minute." };
  membersStore(db).event(ctx.user.id, "simulation_used", { manual: true }, now.toISOString());
  if (bet.status === "rejected") return { ok: false, error: bet.reason ?? "The bet was refused." };
  return { ok: true, bet };
}

/** Settles open simulated bets whose alert has a result (or voids them when it was withdrawn). */
function settleSimBets(db: EngineDb, now: Date): number {
  const store = membersStore(db);
  const at = now.toISOString();
  let n = 0;
  const commission = new Map<number, number>();
  for (const b of store.listOpenBets()) {
    if (b.mode !== "sim" || b.status !== "matched") continue;
    const p = db.getLivePick(b.pickId);
    if (!p || p.excluded || p.waitingClearedAt) {
      store.updateBet(b.id, { status: "void", profit: 0, settledAt: at, reason: "The alert was withdrawn (removed or postponed): stake returned." }, at);
      n++;
      continue;
    }
    if (!p.result) continue;
    if (!commission.has(b.userId)) commission.set(b.userId, memberContext(db, b.userId, now)?.config.commissionPct ?? 5);
    const won = p.result === "hit";
    store.updateBet(b.id, { status: won ? "won" : "lost", profit: simProfit(b.matchedStake ?? b.stake, b.matchedPrice ?? b.requestedPrice ?? 1, won, commission.get(b.userId)!), settledAt: at }, at);
    n++;
  }
  return n;
}

/** Strategy alerts for followers allowed to see the selection (in-app). */
function alertFollowers(db: EngineDb, ctx: MemberContext, p: LivePick, entry: CatalogueEntry, now: Date): void {
  if (!strategyAllowed(ctx.access, "viewSelections", entry.key)) return;
  const store = membersStore(db);
  const link = `/members/upcoming#pick-${p.id}`;
  if (store.hasNotification(ctx.user.id, "strategy_alert", link)) return;
  store.notify({ userId: ctx.user.id, at: now.toISOString(), kind: "strategy_alert", title: `New ${entry.name} pick`, body: `${p.home ?? "?"} v ${p.away ?? "?"}${p.competition ? ` (${p.competition})` : ""}`, link });
}

/** One pass. `live` is null when real-money member betting can't run on this engine (no Betfair link). */
export async function runMembers(db: EngineDb, now = new Date(), live: LiveDeps | null = null): Promise<void> {
  const store = membersStore(db);
  const follows = store.listAutoFollows();
  const cache: PassCache = { ctx: new Map(), catalogue: new Map() };
  if (follows.length > 0) {
    for (const c of listCatalogue(db, getMembersConfig(db))) cache.catalogue.set(c.key, c);
    const merges = db.getStrategyMerges();
    const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
    const picks = db.listLivePicks(500, { from: since, to: new Date(now.getTime() + 60_000).toISOString() }).sort((a, b) => a.id - b.id);
    const byStrategy = new Map<string, Array<(typeof follows)[number]>>();
    for (const f of follows) (byStrategy.get(f.strategyKey) ?? byStrategy.set(f.strategyKey, []).get(f.strategyKey)!).push(f);
    for (const p of picks) {
      if (p.excluded) continue;
      const key = memberStrategyKey(merges, p.strategy);
      const entry = cache.catalogue.get(key);
      const followers = byStrategy.get(key);
      if (!entry || !followers) continue;
      const pickAt = p.messageAt ?? p.firstSeenAt;
      for (const f of followers) {
        // Only alerts that arrived after the member started following.
        if (pickAt < f.createdAt) continue;
        const ctx = ctxOf(db, cache, f.userId, now);
        if (!ctx || (ctx.member.automationPaused && f.mode === "live")) continue;
        try {
          if (f.mode === "sim") {
            if (!can(ctx.access, "useSimulation") || !can(ctx.access, "simAutomation")) continue;
            const s = memberSettingsFor(db, ctx, now.toISOString());
            // After a simulation reset, only alerts from the new start count.
            if (s.simEpoch > 1 && pickAt < s.simStartedAt) continue;
            const bet = placeSimBet(db, ctx, p, key, "auto", now);
            if (bet) alertFollowers(db, ctx, p, entry, now);
          } else if (!store.hasBet(ctx.user.id, p.id, "live")) {
            createLiveBet(db, ctx, p, entry, now, live);
            alertFollowers(db, ctx, p, entry, now);
          }
        } catch (err) {
          log.warn(`Members: alert ${p.id} for member ${f.userId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  settleSimBets(db, now);
  if (live) await executeLiveBets(db, live, now);
  for (const b of store.listOpenBets()) if (b.mode === "live" && (b.status === "matched" || b.status === "partially_matched")) settleLiveBet(db, b, now);
}

// ---- scheduling ---------------------------------------------------------------------------------------------------

let wakeNow: (() => void) | null = null;
let liveDeps: LiveDeps | null = null;

/** The Betfair link members' live bets use (null when it isn't set up), for the routes. */
export function membersLiveDeps(): LiveDeps | null {
  return liveDeps;
}

/** Runs a pass straight away (a new alert). */
export function wakeMembers(): void {
  wakeNow?.();
}

const PASS_MS = 15_000;
const NOTICES_EVERY = 20; // passes (about every 5 minutes)

export function startMembers(db: EngineDb, live: LiveDeps | null): () => void {
  liveDeps = live;
  let running = false;
  let again = false;
  let passes = 0;
  const pass = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await runMembers(db, new Date(), live).catch((err: unknown) => log.warn(`Members pass failed: ${err instanceof Error ? err.message : String(err)}`));
        if (passes++ % NOTICES_EVERY === 0) {
          try {
            runMembershipNotices(db);
          } catch (err) {
            log.warn(`Members notices failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } while (again);
    } finally {
      running = false;
    }
  };
  wakeNow = () => void pass();
  const timer = setInterval(() => void pass(), PASS_MS);
  timer.unref();
  void pass();
  return () => {
    clearInterval(timer);
    wakeNow = null;
  };
}
