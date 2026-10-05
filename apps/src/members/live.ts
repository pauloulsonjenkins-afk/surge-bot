/**
 * LIVE member bets: real money on Betfair. Off unless every one of these holds, checked when the bet is created AND
 * again immediately before it is sent (so a kill switch pressed in between still stops it):
 *
 *   1. the admin's master switch (members config: flags.liveBetting)
 *   2. the engine setting MEMBERS_LIVE_BETTING=allow (DigitalOcean, out of the website's reach)
 *   3. the member's membership includes live betting (permissions.ts: enableLiveBetting)
 *   4. the member switched live on themselves, with explicit confirmation, and hasn't pressed Stop
 *   5. a working Betfair connection. Today only the "house" connection exists: the GoalBrew Betfair account set up on
 *      the engine, for admin members only. Members' own accounts need Betfair's Software Vendor approval and Betfair's
 *      own login (OAuth); see betfair-connection.ts. Members' passwords are never taken.
 *   6. the strategy is approved for live by the admin
 *   7. the member's risk limits (staking.ts), with the Betfair balance as the bank
 *   8. no other bet on this alert on the same Betfair account: not the bet feed (BF Bot Manager), not Direct betting,
 *      not another member's house bet
 *   9. the price on Betfair now is within the member's tolerance of the price recorded for the alert
 * Any doubt means no bet: the bet is recorded as rejected or failed with the reason, never silently dropped.
 *
 * Placing works like Direct betting (betfair/direct.ts): each order carries customerOrderRef "GM<bet id>", Betfair is
 * asked for that reference before placing and whenever an answer is lost, so a bet is never sent twice. Unmatched stake
 * is cancelled after two minutes. Settlement uses Betfair's own result when the bet appears in the account's settled
 * bets, otherwise the alert's result on the matched stake and price, less commission.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { betableUntil, exchangeNamer, feedMarket, getSendingSettings } from "../inplayguru/bet-feed";
import { findRunner, readCredentials } from "../betfair/exchange";
import { askPrice, FRIENDLY, RETRY, type Trading } from "../betfair/direct";
import { log } from "../server/log";
import { memberLiveAllowedByEngine, saveMembersConfig } from "./config";
import { pickPrice, pickState, maxAgeMinutes, type CatalogueEntry } from "./catalogue";
import { can } from "./permissions";
import { memberContext, type MemberContext } from "./service";
import { checkRisk, computeStake } from "./staking";
import { membersStore, type MemberBet } from "./store";
import { openExposure, todayTotals } from "./stats";

export interface LiveDeps {
  trading: Trading;
  /** The Betfair account's money (read only). */
  account: () => Promise<{ available: number | null; exposure: number | null; delayedKey: boolean | null }>;
}

/** Betfair's smallest back stake in pounds. */
const MIN_STAKE = 1;
const CANCEL_UNMATCHED_MS = 120_000;
const PRICE_WAIT_MS = 10 * 60_000;
const BALANCE_MAX_AGE_MS = 60_000;

let balance: { available: number | null; at: number } | null = null;

/** The Betfair balance last read (for stakes and risk checks), refreshed at most once a minute. */
export async function refreshBalance(deps: LiveDeps, now = Date.now()): Promise<number | null> {
  if (balance && now - balance.at < BALANCE_MAX_AGE_MS) return balance.available;
  try {
    const a = await deps.account();
    balance = { available: a.available, at: now };
  } catch (err) {
    log.warn(`Members live: couldn't read the Betfair balance: ${err instanceof Error ? err.message : String(err)}`);
    balance = { available: null, at: now };
  }
  return balance.available;
}

/** For tests. */
export function setBalanceForTest(v: number | null): void {
  balance = v === null ? null : { available: v, at: Date.now() };
}

export function orderRefFor(betId: number): string {
  return `GM${betId}`;
}

/** Why live betting can't run for this member at all right now (null = it can), in words for the member. */
export function liveBlock(db: EngineDb, ctx: MemberContext, deps: LiveDeps | null, env = process.env): string | null {
  if (!ctx.config.flags.liveBetting) return "Live betting is switched off for all members at the moment.";
  if (!memberLiveAllowedByEngine(env)) return "Live betting isn't enabled on the server yet.";
  if (!can(ctx.access, "enableLiveBetting")) return "Live betting isn't part of your membership.";
  if (ctx.member.automationPaused) return "You've stopped all live betting. Switch it back on in Betfair Automation.";
  if (!ctx.member.liveEnabled) return "You haven't switched live betting on.";
  const c = membersStore(db).getConnection(ctx.user.id);
  if (c.kind === "none") return "No Betfair account is connected.";
  if (c.kind === "vendor") return "Connecting your own Betfair account needs Betfair's approval, which GoalBrew doesn't have yet.";
  if (ctx.tier !== "admin") return "Only the administrator can use the GoalBrew Betfair account.";
  if (c.status !== "connected") return "The Betfair connection isn't working: test it in Betfair Automation.";
  if (!deps || readCredentials(env) === null) return "The Betfair link isn't set up on the server.";
  return null;
}

/** Another bet on this alert already on the house Betfair account, by any route. */
function houseAlreadyBet(db: EngineDb, p: LivePick, userId: number): string | null {
  if (p.sentAt) return "This alert was already sent to the betting software for the same Betfair account.";
  if (db.getDirectBet(p.id)?.mode === "live") return "Direct betting already bet this alert on the same Betfair account.";
  const other = membersStore(db)
    .listAllBets({ mode: "live", since: new Date(Date.parse(p.firstSeenAt) - 60_000).toISOString(), limit: 5000 })
    .find((b) => b.pickId === p.id && b.userId !== userId && b.status !== "rejected" && b.status !== "failed");
  if (other) return "Another member already bet this alert on the same Betfair account.";
  return null;
}

/** Live profit settled since live was switched on: the stop loss compares the balance with where it started. */
function liveProfitSince(db: EngineDb, userId: number, since: string | null): number {
  const bets = membersStore(db).listBets(userId, { mode: "live", from: since ?? undefined, status: ["won", "lost", "void"], limit: 5000 });
  return bets.reduce((t, b) => t + (b.profit ?? 0), 0);
}

/**
 * Records a live bet for an alert (pending, to be placed by executeLiveBets), or a rejected one with the reason.
 * Returns null when nothing was recorded yet (waiting for a price).
 */
export function createLiveBet(db: EngineDb, ctx: MemberContext, p: LivePick, entry: CatalogueEntry, now: Date, deps: LiveDeps | null, env = process.env): MemberBet | null {
  const store = membersStore(db);
  const at = now.toISOString();
  if (store.hasBet(ctx.user.id, p.id, "live")) return null;
  const settings = store.getSettings(ctx.user.id, { simBank: ctx.config.defaultSimBank, stakeValue: 2 }, at);
  const base = { userId: ctx.user.id, pickId: p.id, strategyKey: entry.key, mode: "live" as const, execution: "auto" as const, simEpoch: settings.simEpoch, stakingMethod: settings.stakingMethod };
  const reject = (reason: string, stake = 0, price: number | null = null) => {
    const bet = store.insertBet({ ...base, stake, requestedPrice: price, status: "rejected", reason }, at);
    if (bet) store.audit({ at, userId: ctx.user.id, actor: "system", action: "bet_rejection", object: `alert ${p.id}`, result: "refused", detail: reason });
    return bet;
  };

  const blocked = liveBlock(db, ctx, deps, env);
  if (blocked) return reject(`No bet placed. ${blocked}`);
  if (!entry.liveApproved) return reject("No bet placed. This strategy isn't approved for live betting.");
  const dup = houseAlreadyBet(db, p, ctx.user.id);
  if (dup) return reject(`No bet placed. ${dup}`);
  if (pickState(p, now, maxAgeMinutes(db)) !== "live") return reject("No bet placed. The alert arrived too late to bet.");
  const market = feedMarket(p, getSendingSettings(db), exchangeNamer(db));
  if ("error" in market) return reject(`No bet placed. ${market.error}`);
  const price = pickPrice(p);
  if (price === null) {
    if (now.getTime() - Date.parse(p.messageAt ?? p.firstSeenAt) < PRICE_WAIT_MS) return null;
    return reject("No bet placed. No price was available for this bet.");
  }
  const bank = balance?.available ?? null;
  if (bank === null) return reject("No bet placed. The Betfair balance couldn't be read.", 0, price);
  const { stake, method } = computeStake(settings, { strategyKey: entry.key, bank, houseStake: getSendingSettings(db).stakes[entry.key] ?? null, advanced: can(ctx.access, "advancedStaking") });
  const recent = store.listBets(ctx.user.id, { mode: "live", limit: 5000, from: new Date(now.getTime() - 3 * 86_400_000).toISOString() });
  const today = todayTotals(recent, "live", now);
  const risk = checkRisk(settings.risk, {
    stake,
    odds: price,
    bank,
    startBank: bank - liveProfitSince(db, ctx.user.id, ctx.member.liveEnabledAt),
    openExposure: openExposure(recent),
    todayStaked: today.staked,
    todayProfit: today.profit,
    todayBets: today.bets,
    minimumStake: MIN_STAKE,
  });
  if (!risk.ok) return reject(`No bet placed. ${risk.reason}`, stake, price);
  const bet = store.insertBet(
    { ...base, stakingMethod: method, stake: risk.stake, requestedPrice: price, status: "pending", reason: "Checking the price on Betfair.", marketType: market.marketType, selectionName: market.selectionName },
    at,
  );
  if (bet) store.audit({ at, userId: ctx.user.id, actor: "system", action: "bet_attempt", object: `alert ${p.id}`, result: "ok", detail: `£${risk.stake.toFixed(2)} at ${price.toFixed(2)} or better (${market.marketType} / ${market.selectionName}).` });
  return bet;
}

/** Places, confirms and tidies every open live bet. */
export async function executeLiveBets(db: EngineDb, deps: LiveDeps, now = new Date(), env = process.env): Promise<void> {
  const store = membersStore(db);
  const open = store.listOpenBets().filter((b) => b.mode === "live" && (b.status === "pending" || b.status === "placing" || b.status === "partially_matched"));
  if (open.length === 0) return;
  await refreshBalance(deps, now.getTime());
  for (const b of open) {
    try {
      await work(db, deps.trading, b, now, deps, env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Members live bet ${b.id}: ${message}`);
      // A bet being placed stays "placing": its outcome is read from Betfair next time, never guessed.
      if (b.status === "pending") store.updateBet(b.id, { reason: `Waiting: ${message}` }, now.toISOString());
    }
  }
}

async function work(db: EngineDb, t: Trading, b: MemberBet, now: Date, deps: LiveDeps, env: NodeJS.ProcessEnv): Promise<void> {
  const store = membersStore(db);
  const at = now.toISOString();
  const ref = orderRefFor(b.id);
  const fill = (o: { betId: string; sizeMatched?: number; sizeRemaining?: number; averagePriceMatched?: number; status?: string }) => {
    const matched = o.sizeMatched ?? 0;
    const remaining = o.sizeRemaining ?? Math.max(0, b.stake - matched);
    store.updateBet(
      b.id,
      {
        status: remaining > 0 && o.status !== "EXECUTION_COMPLETE" ? "partially_matched" : matched > 0 ? "matched" : "cancelled",
        betfairBetId: o.betId,
        matchedStake: matched,
        matchedPrice: o.averagePriceMatched ?? null,
        bfStatus: o.status ?? null,
        placedAt: b.placedAt ?? at,
        reason: remaining > 0 ? `£${matched.toFixed(2)} matched, £${remaining.toFixed(2)} waiting.` : null,
      },
      at,
    );
  };

  if (b.status === "placing") {
    const found = (await t.ordersByRef([ref]))[0];
    if (found) fill(found);
    else if (b.attempts >= 3) store.updateBet(b.id, { status: "failed", reason: "No bet placed. Betfair didn't confirm the bet and has no order for it." }, at);
    else store.updateBet(b.id, { attempts: b.attempts + 1 }, at);
    return;
  }

  if (b.status === "partially_matched") {
    if (!b.betfairBetId) return;
    const o = (await t.ordersById([b.betfairBetId]))[0];
    const remaining = o?.sizeRemaining ?? 0;
    if (!o || remaining <= 0 || o.status === "EXECUTION_COMPLETE") {
      const matched = o?.sizeMatched ?? b.matchedStake ?? 0;
      store.updateBet(b.id, { status: matched > 0 ? "matched" : "cancelled", matchedStake: matched, matchedPrice: o?.averagePriceMatched ?? b.matchedPrice, bfStatus: o?.status ?? b.bfStatus, reason: null }, at);
      return;
    }
    if (now.getTime() - Date.parse(b.placedAt ?? b.createdAt) >= CANCEL_UNMATCHED_MS && b.marketId) {
      await t.cancel(b.marketId, b.betfairBetId);
      const matched = o.sizeMatched ?? 0;
      store.updateBet(b.id, { status: matched > 0 ? "matched" : "cancelled", matchedStake: matched, matchedPrice: o.averagePriceMatched ?? b.matchedPrice, reason: `£${remaining.toFixed(2)} not matched within 2 minutes, so cancelled.` }, at);
    } else fill(o);
    return;
  }

  // Pending: every check again, right before sending.
  const ctx = memberContext(db, b.userId, now);
  const fail = (reason: string, status: "rejected" | "failed" = "rejected") => {
    store.updateBet(b.id, { status, reason: `No bet placed. ${reason}` }, at);
    store.audit({ at, userId: b.userId, actor: "system", action: "bet_rejection", object: `bet ${b.id}`, result: "refused", detail: reason });
    store.notify({ userId: b.userId, at, kind: "bet_rejected", title: "Bet not placed", body: reason, link: "/members/history" });
  };
  if (!ctx) return fail("The account is no longer active.");
  const blocked = liveBlock(db, ctx, deps, env);
  if (blocked) return fail(blocked);
  if (!ctx.config.liveApprovedStrategies.includes(b.strategyKey)) return fail("This strategy is no longer approved for live betting.");
  const p = db.getLivePick(b.pickId);
  if (!p || p.excluded) return fail("The alert was withdrawn.");
  const dup = houseAlreadyBet(db, p, b.userId);
  if (dup) return fail(dup);
  if (now.getTime() > betableUntil(p, maxAgeMinutes(db))) return fail(`Too late to bet. ${b.reason ?? ""}`.trim());
  if (!p.exchangeEventId) {
    if (p.exchange === "off") return fail("The match isn't on Betfair.", "failed");
    store.updateBet(b.id, { reason: "Finding the match on Betfair." }, at);
    return;
  }
  if (!b.marketType || !b.selectionName) return fail("The bet's market isn't known.", "failed");

  let marketId = b.marketId;
  let selectionId = b.selectionId;
  if (!marketId || selectionId === null) {
    const m = await t.market(p.exchangeEventId, b.marketType);
    if (!m) return fail(`Betfair has no ${b.marketType} market for this match.`, "failed");
    const runner = findRunner(m.runners, b.selectionName);
    if (!runner) return fail(`Betfair's market has no selection called "${b.selectionName}".`, "failed");
    marketId = m.marketId;
    selectionId = runner.selectionId;
    store.updateBet(b.id, { marketId, selectionId }, at);
  }
  const book = await t.book(marketId);
  const wait = (reason: string) => store.updateBet(b.id, { reason }, at);
  if (!book) return wait("No prices from Betfair yet.");
  if (book.status === "CLOSED") return fail("The market has closed.", "failed");
  if (book.status !== "OPEN") return wait("The market is suspended.");
  const me = book.runners.find((r) => r.selectionId === selectionId);
  if (!me || me.status !== "ACTIVE") return fail("The selection is no longer in the market.", "failed");
  if (me.back === null) return wait("Nothing on offer to back yet.");

  const settings = membersStore(db).getSettings(b.userId, { simBank: ctx.config.defaultSimBank, stakeValue: 2 }, at);
  const tol = settings.risk.priceTolerancePct;
  const requested = b.requestedPrice ?? me.back;
  const floor = Math.max(requested * (1 - tol / 100), settings.risk.minOdds ?? 1.01);
  if (me.back < floor) return wait(`Price ${me.back.toFixed(2)} is below your limit (${floor.toFixed(2)}); waiting in case it comes back.`);
  if (settings.risk.maxOdds !== null && me.back > settings.risk.maxOdds) return wait(`Price ${me.back.toFixed(2)} is above your maximum odds.`);

  const existing = (await t.ordersByRef([ref]))[0];
  if (existing) return fill(existing);
  const ask = askPrice(me.back, floor, tol);
  const attempt = b.attempts + 1;
  store.updateBet(b.id, { status: "placing", attempts: attempt, reason: `Asking ${ask.toFixed(2)} or better (shown ${me.back.toFixed(2)}).` }, at);
  let result;
  try {
    result = await t.place({ marketId, selectionId, price: ask, size: b.stake, ref, attempt });
  } catch (err) {
    // No answer: it may or may not have been placed. The next pass asks Betfair by the reference.
    store.updateBet(b.id, { attempts: 0, reason: `No answer from Betfair (${err instanceof Error ? err.message : String(err)}); checking.` }, at);
    return;
  }
  if (result.ok) {
    fill({ betId: result.betId, sizeMatched: result.sizeMatched, sizeRemaining: Math.max(0, b.stake - result.sizeMatched), averagePriceMatched: result.avgPrice ?? undefined, status: result.sizeMatched >= b.stake ? "EXECUTION_COMPLETE" : "EXECUTABLE" });
    store.audit({ at, userId: b.userId, actor: "system", action: "bet_placement", object: `bet ${b.id}`, result: "ok", detail: `Betfair bet ${result.betId}, £${result.sizeMatched.toFixed(2)} matched.` });
    store.notify({ userId: b.userId, at, kind: "live_bet", title: "Live bet placed", body: `£${b.stake.toFixed(2)} at ${(result.avgPrice ?? ask).toFixed(2)} on Betfair.`, link: "/members/history" });
    return;
  }
  if (RETRY.has(result.code)) {
    store.updateBet(b.id, { status: "pending", reason: `Betfair said ${result.code}; trying again.` }, at);
    return;
  }
  fail(FRIENDLY[result.code] ?? `Betfair refused the bet (${result.code}).`, "failed");
}

/** Settles a matched live bet once its alert has a result: Betfair's own figure when known, else worked out. */
export function settleLiveBet(db: EngineDb, b: MemberBet, now = new Date()): void {
  const store = membersStore(db);
  const at = now.toISOString();
  const matched = b.matchedStake ?? 0;
  if (matched <= 0) return;
  const real = b.betfairBetId
    ? (db.sqlite.prepare(`SELECT status, profit FROM betfair_bets WHERE bet_id = ?`).get(b.betfairBetId) as { status: string; profit: number | null } | undefined)
    : undefined;
  const ctx = memberContext(db, b.userId, now);
  const commission = (ctx?.config.commissionPct ?? 5) / 100;
  if (real && (real.status === "won" || real.status === "lost") && typeof real.profit === "number") {
    const profit = real.profit > 0 ? real.profit * (1 - commission) : real.profit;
    store.updateBet(b.id, { status: real.status === "won" ? "won" : "lost", profit: Math.round(profit * 100) / 100, bfStatus: "SETTLED", settledAt: at }, at);
    return;
  }
  if (real && real.status === "void") {
    store.updateBet(b.id, { status: "void", profit: 0, bfStatus: "VOIDED", settledAt: at }, at);
    return;
  }
  const p = db.getLivePick(b.pickId);
  if (!p?.result) return;
  const won = p.result === "hit";
  const price = b.matchedPrice ?? b.requestedPrice ?? 1;
  const profit = won ? matched * (price - 1) * (1 - commission) : -matched;
  store.updateBet(b.id, { status: won ? "won" : "lost", profit: Math.round(profit * 100) / 100, settledAt: at, reason: "Settled from the alert's result; Betfair's own figure replaces it when it arrives." }, at);
}

// ---- switching live on and off ---------------------------------------------------------------------------------

export const LIVE_CONFIRMATION = "I understand real money will be bet";

/** The member switches live betting on (with the exact confirmation words) or off. */
export function setMemberLive(db: EngineDb, ctx: MemberContext, on: boolean, confirmation: unknown, now = new Date()): { ok: true } | { ok: false; error: string } {
  const store = membersStore(db);
  const at = now.toISOString();
  if (!on) {
    store.updateMember(ctx.user.id, { liveEnabled: false }, at);
    store.liveFollowsToSim(ctx.user.id, at);
    store.audit({ at, userId: ctx.user.id, actor: "member", action: "automation_disabled", object: "live betting", result: "ok", detail: null });
    return { ok: true };
  }
  if (confirmation !== LIVE_CONFIRMATION) return { ok: false, error: `Type "${LIVE_CONFIRMATION}" to confirm.` };
  if (!can(ctx.access, "enableLiveBetting")) return { ok: false, error: "Live betting isn't part of your membership." };
  if (!ctx.config.flags.liveBetting) return { ok: false, error: "Live betting is switched off for all members at the moment." };
  const c = store.getConnection(ctx.user.id);
  if (c.kind === "none" || c.status !== "connected") return { ok: false, error: "Connect and test a Betfair account first." };
  store.updateMember(ctx.user.id, { liveEnabled: true, liveEnabledAt: at, automationPaused: false }, at);
  store.audit({ at, userId: ctx.user.id, actor: "member", action: "automation_enabled", object: "live betting", result: "ok", detail: null });
  store.event(ctx.user.id, "automation_enabled", { mode: "live" }, at);
  return { ok: true };
}

/** The member's own STOP: no more live bets, open unplaced ones are cancelled, follows go back to simulation. */
export function memberKillSwitch(db: EngineDb, userId: number, now = new Date()): number {
  const store = membersStore(db);
  const at = now.toISOString();
  store.updateMember(userId, { liveEnabled: false, automationPaused: true }, at);
  store.liveFollowsToSim(userId, at);
  let n = 0;
  for (const b of store.listOpenBets()) {
    if (b.userId === userId && b.mode === "live" && b.status === "pending") {
      store.updateBet(b.id, { status: "rejected", reason: "No bet placed. You stopped all live betting." }, at);
      n++;
    }
  }
  store.audit({ at, userId, actor: "member", action: "kill_switch", object: "live betting", result: "ok", detail: `${n} waiting bet(s) cancelled.` });
  store.notify({ userId, at, kind: "kill_switch", title: "All live betting stopped", body: "No further real bets will be placed. Your strategies are back in simulation.", link: "/members/automation" });
  return n;
}

/** The admin's STOP ALL: live betting off for every member, and every waiting live bet cancelled. */
export function globalKillSwitch(db: EngineDb, now = new Date()): number {
  const store = membersStore(db);
  const at = now.toISOString();
  saveMembersConfig(db, { flags: { liveBetting: false } });
  store.liveFollowsToSim(null, at);
  let n = 0;
  for (const b of store.listOpenBets()) {
    if (b.mode === "live" && b.status === "pending") {
      store.updateBet(b.id, { status: "rejected", reason: "No bet placed. The administrator stopped all live betting." }, at);
      n++;
    }
  }
  for (const m of store.listMembers()) if (m.liveEnabled) store.updateMember(m.userId, { liveEnabled: false }, at);
  store.audit({ at, userId: null, actor: "admin", action: "kill_switch", object: "all members", result: "ok", detail: `${n} waiting bet(s) cancelled.` });
  log.warn(`Members: the admin stopped ALL live betting (${n} waiting bet(s) cancelled).`);
  return n;
}
