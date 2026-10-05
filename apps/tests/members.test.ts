/**
 * The Members platform: who sees what (enforced in what the engine sends, not hidden in the page), the 7-day trial and
 * its three-strategy limit, simulation, risk limits, duplicate protection, live safety, Stripe and community strategies.
 * No real Betfair or Stripe is touched: a fake Trading object stands in for Betfair.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { memberContext, startTrial, adminUpdateMember, runMembershipNotices } from "../src/members/service";
import { saveMembersConfig } from "../src/members/config";
import { membersStore } from "../src/members/store";
import { strategiesView, strategyView, upcomingView, historyView, performanceView } from "../src/members/views";
import { runMembers, simulateManually } from "../src/members/runner";
import { emailKey, isDisposableEmail } from "../src/members/email";
import { accessFor, effectiveTier, rulesFor, strategyAllowed } from "../src/members/permissions";
import { checkRisk, computeStake } from "../src/members/staking";
import { DEFAULT_RISK } from "../src/members/store";
import { memberKillSwitch, setBalanceForTest, setMemberLive, LIVE_CONFIRMATION, globalKillSwitch, type LiveDeps } from "../src/members/live";
import { handleStripeEvent, verifyStripeSignature } from "../src/members/stripe";
import { adjustedRoi, createStrategy, deleteStrategy, ownStrategyView, updateStrategy } from "../src/members/community";
import { decryptSecret, encryptSecret } from "../src/members/secrets";
import type { Trading } from "../src/betfair/direct";

const STRATS = ["Action-packed", "Home pressure", "Late goal hunter", "Losing team pushing hard"];

function alert(strategy: string, n: number, result: "hit" | "miss" | null): string {
  const lines = [
    `🔔 ${strategy}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0",
    "Over/Under 0.50 Odds:", "3.00 1.40",
  ];
  if (result) lines.push("", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-1" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss");
  return lines.join("\n");
}

let db: EngineDb;
let n = 1;
function addAlert(strategy: string, result: "hit" | "miss" | null, at = new Date()) {
  const id = n++;
  const text = alert(strategy, id, result);
  db.upsertLivePick("chat", id, text, parseAlert(text), at.toISOString());
  return db.listLivePicks(200).find((p) => p.messageId === id)!;
}
function settle(messageId: number, strategy: string, result: "hit" | "miss") {
  const text = alert(strategy, messageId, result);
  db.upsertLivePick("chat", messageId, text, parseAlert(text), new Date().toISOString());
}
function user(email: string): number {
  return db.createAppUser(email, "Test Member", "x")!.id;
}

beforeEach(() => {
  db = new EngineDb(":memory:", () => {});
  n = 1;
  // One settled alert per strategy, so each is in the catalogue.
  for (const s of STRATS) addAlert(s, "hit", new Date(Date.now() - 3 * 3_600_000));
  setBalanceForTest(null);
});

test("tiers come from dates and overrides; expired is free again; suspended has nothing", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const base = { tierOverride: null, trialStartedAt: null, trialEndsAt: null, paidUntil: null } as const;
  assert.equal(effectiveTier(base, now), "free");
  assert.equal(effectiveTier({ ...base, trialEndsAt: "2026-10-06T00:00:00Z" }, now), "trial");
  assert.equal(effectiveTier({ ...base, trialEndsAt: "2026-10-01T00:00:00Z" }, now), "expired");
  assert.equal(effectiveTier({ ...base, paidUntil: "2026-11-01T00:00:00Z", trialEndsAt: "2026-10-01T00:00:00Z" }, now), "paid");
  assert.equal(effectiveTier({ ...base, tierOverride: "suspended", paidUntil: "2026-11-01T00:00:00Z" }, now), "suspended");
  const expired = rulesFor("expired");
  assert.equal(expired.caps.viewSelections, false);
  assert.equal(expired.caps.useSimulation, true);
  assert.ok(Object.values(rulesFor("suspended", { suspended: { caps: { viewSelections: true } } }).caps).every((v) => v === false));
  // Live betting can be offered to paid, never to trial, and the flag switches it off for all.
  assert.equal(rulesFor("trial").caps.enableLiveBetting, false);
  assert.equal(rulesFor("paid").caps.enableLiveBetting, false); // live flag off by default
  assert.equal(rulesFor("paid", {}, { ...rulesFor("paid").caps, trial: true, community: false, strategyCreation: true, strategySharing: false, betfairConnections: true, liveBetting: true, advancedAnalytics: true } as never).caps.enableLiveBetting, true);
});

test("free members get names and results only: no description, rules, selections or money in what is sent", () => {
  const id = user("free@example.com");
  addAlert("Action-packed", null); // live now
  const ctx = memberContext(db, id)!;
  assert.equal(ctx.tier, "free");
  const list = strategiesView(db, ctx);
  assert.ok(list.length >= 4);
  for (const s of list) {
    assert.equal(s.locked, true);
    assert.equal("description" in s, false);
    assert.equal("trigger" in s, false);
    assert.equal(s.money, null);
    assert.ok(typeof s.results.today.wins === "number");
  }
  const one = strategyView(db, ctx, "action-packed")!;
  assert.equal(one.recent, null);
  const up = upcomingView(db, ctx, null);
  assert.equal(up.open.length, 0);
  assert.equal(up.locked.find((l) => l.strategyKey === "action-packed")?.live, 1);
  const json = JSON.stringify({ list, one, up });
  assert.ok(!json.includes("Home 5"), "no team names reach a free member");
  // Manual simulation of a pick they can't see is answered as if it didn't exist.
  const pick = db.listLivePicks(1)[0]!;
  assert.deepEqual(simulateManually(db, ctx, pick.id), { ok: false, error: "That opportunity no longer exists." });
});

test("trial: exactly 3 strategies, chosen once; the 4th is never reachable; one trial per email", () => {
  const id = user("Jo.Smith+gb@gmail.com");
  const ctx = memberContext(db, id)!;
  assert.equal(startTrial(db, ctx, ["action-packed", "home pressure"]).ok, false); // too few
  assert.equal(startTrial(db, ctx, ["action-packed", "home pressure", "late goal hunter", "losing team pushing hard"]).ok, false); // too many
  assert.equal(startTrial(db, ctx, ["action-packed", "action-packed", "home pressure"]).ok, false); // repeated
  assert.equal(startTrial(db, ctx, ["action-packed", "home pressure", "made up"]).ok, false); // unknown
  const r = startTrial(db, ctx, ["action-packed", "home pressure", "late goal hunter"]);
  assert.equal(r.ok, true);
  const t = memberContext(db, id)!;
  assert.equal(t.tier, "trial");
  assert.equal(strategyAllowed(t.access, "viewSelections", "action-packed"), true);
  assert.equal(strategyAllowed(t.access, "viewSelections", "losing team pushing hard"), false);
  assert.equal(strategyView(db, t, "losing team pushing hard")!.recent, null);
  assert.ok(strategyView(db, t, "action-packed")!.recent);
  // No second start, no changing the strategies.
  assert.equal(startTrial(db, t, ["losing team pushing hard", "home pressure", "late goal hunter"]).ok, false);
  assert.deepEqual(membersStore(db).trialStrategies(id).sort(), ["action-packed", "home pressure", "late goal hunter"]);
  // The chosen strategies are followed in simulation.
  assert.equal(membersStore(db).listFollows(id).length, 3);
  // A new account with the same Gmail address (dots, +tag, googlemail) can't trial again.
  const again = user("josmith@googlemail.com");
  const r2 = startTrial(db, memberContext(db, again)!, ["action-packed", "home pressure", "late goal hunter"]);
  assert.equal(r2.ok, false);
  assert.equal(emailKey("Jo.Smith+gb@gmail.com"), emailKey("josmith@googlemail.com"));
});

test("throwaway email addresses can be Free but can't start a trial", () => {
  assert.equal(isDisposableEmail("a@mailinator.com"), true);
  assert.equal(isDisposableEmail("a@gmail.com"), false);
  const id = user("someone@mailinator.com");
  const r = startTrial(db, memberContext(db, id)!, ["action-packed", "home pressure", "late goal hunter"]);
  assert.equal(r.ok, false);
});

test("trial expiry: back to free, premium locks again, nothing deleted, told once", () => {
  const id = user("expire@example.com");
  const start = new Date(Date.now() - 8 * 86_400_000);
  assert.equal(startTrial(db, memberContext(db, id, start)!, ["action-packed", "home pressure", "late goal hunter"], start).ok, true);
  const ctx = memberContext(db, id)!;
  assert.equal(ctx.tier, "expired");
  assert.equal(strategyAllowed(ctx.access, "viewSelections", "action-packed"), false);
  assert.equal(membersStore(db).listFollows(id).length, 3); // kept
  runMembershipNotices(db);
  runMembershipNotices(db);
  assert.equal(membersStore(db).listNotifications(id).filter((x) => x.kind === "trial_expired").length, 1);
  // The admin can allow one more trial.
  adminUpdateMember(db, id, { action: "reset_trial" });
  assert.equal(memberContext(db, id)!.tier, "free");
});

test("simulation: a followed alert becomes one matched bet, settled with commission; never twice", async () => {
  const id = user("sim@example.com");
  const ctx = memberContext(db, id)!;
  membersStore(db).setFollow(id, "action-packed", { mode: "sim", auto: true }, new Date(Date.now() - 60_000).toISOString());
  const p = addAlert("Action-packed", null);
  await runMembers(db);
  await runMembers(db);
  const bets = membersStore(db).listBets(id, { mode: "sim" });
  assert.equal(bets.length, 1);
  assert.equal(bets[0]!.status, "matched");
  assert.equal(bets[0]!.requestedPrice, 3);
  assert.equal(bets[0]!.stake, 2); // default flat £2 on a £100 bank
  settle(p.messageId, "Action-packed", "hit");
  await runMembers(db);
  const won = membersStore(db).listBets(id, { mode: "sim" })[0]!;
  assert.equal(won.status, "won");
  assert.equal(won.profit, 3.8); // 2 x (3 - 1) x 0.95
  const perf = performanceView(db, ctx, "sim", "all");
  assert.equal(perf.bank!.now, 103.8);
  assert.equal(perf.summary.roi, 190);
  // A free member sees the settled bet, but not the match.
  const h = historyView(db, ctx, {});
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0]!.pick, null);
});

test("an alert withdrawn after a simulated bet voids it (stake back)", async () => {
  const id = user("void@example.com");
  membersStore(db).setFollow(id, "action-packed", { mode: "sim", auto: true }, new Date(Date.now() - 60_000).toISOString());
  const p = addAlert("Action-packed", null);
  await runMembers(db);
  db.setPickExcluded(p.id, true);
  await runMembers(db);
  const b = membersStore(db).listBets(id)[0]!;
  assert.equal(b.status, "void");
  assert.equal(b.profit, 0);
});

test("alerts from before a member followed are never bet", async () => {
  const id = user("late@example.com");
  addAlert("Action-packed", null);
  membersStore(db).setFollow(id, "action-packed", { mode: "sim", auto: true }, new Date(Date.now() + 1000).toISOString());
  await runMembers(db);
  assert.equal(membersStore(db).listBets(id).length, 0);
});

test("risk limits: stake capped by max stake; daily bets, odds and stop loss refuse with a reason", () => {
  const base = { stake: 5, odds: 2, bank: 100, startBank: 100, openExposure: 0, todayStaked: 0, todayProfit: 0, todayBets: 0, minimumStake: 0.01 };
  const capped = checkRisk({ ...DEFAULT_RISK, maxStake: 3 }, base);
  assert.deepEqual(capped, { ok: true, stake: 3, capped: true });
  assert.equal(checkRisk({ ...DEFAULT_RISK, maxBetsPerDay: 2 }, { ...base, todayBets: 2 }).ok, false);
  assert.equal(checkRisk({ ...DEFAULT_RISK, minOdds: 2.5 }, base).ok, false);
  assert.equal(checkRisk({ ...DEFAULT_RISK, stopLossPct: 20 }, { ...base, bank: 79 }).ok, false);
  assert.equal(checkRisk({ ...DEFAULT_RISK, maxDailyLoss: 10 }, { ...base, todayProfit: -10 }).ok, false);
  assert.equal(checkRisk(DEFAULT_RISK, { ...base, bank: 4 }).ok, false); // not enough in the bank
  assert.equal(checkRisk(DEFAULT_RISK, { ...base, minimumStake: 10 }).ok, false); // below Betfair's minimum
  const s = { stakingMethod: "percent_bank" as const, stakeValue: 2, customStakes: {}, simBank: 100 };
  assert.equal(computeStake(s, { strategyKey: "x", bank: 250, houseStake: null, advanced: true }).stake, 5);
  assert.deepEqual(computeStake(s, { strategyKey: "x", bank: 250, houseStake: null, advanced: false }), { stake: 2, method: "flat" });
});

/** A Betfair stand-in that records every order. */
function fakeBetfair() {
  const placed: Array<{ ref: string; size: number; price: number }> = [];
  const trading: Trading = {
    market: async () => ({ marketId: "1.1", runners: [{ selectionId: 7, runnerName: "Over 0.5 Goals" }, { selectionId: 8, runnerName: "Under 0.5 Goals" }] }),
    book: async () => ({ status: "OPEN", inplay: true, runners: [{ selectionId: 7, status: "ACTIVE", back: 3, lay: 3.1 }, { selectionId: 8, status: "ACTIVE", back: 1.5, lay: 1.52 }] }),
    ordersByRef: async () => [],
    ordersById: async () => [],
    place: async (o) => {
      placed.push({ ref: o.ref, size: o.size, price: o.price });
      return { ok: true, betId: `B${placed.length}`, sizeMatched: o.size, avgPrice: 3 };
    },
    cancel: async () => 0,
  };
  const deps: LiveDeps = { trading, account: async () => ({ available: 500, exposure: 0, delayedKey: false }) };
  return { placed, deps };
}

function liveAdmin() {
  const id = user("admin@example.com");
  adminUpdateMember(db, id, { action: "set_override", value: "admin" });
  saveMembersConfig(db, { flags: { liveBetting: true }, liveApprovedStrategies: ["action-packed"] });
  const at = new Date().toISOString();
  membersStore(db).saveConnection({ userId: id, kind: "house", status: "connected", tokenEnc: null, lastTestAt: at, lastOkAt: at, lastError: null }, at);
  const env = { ...process.env, MEMBERS_LIVE_BETTING: "allow", BF_APP_KEY: "k", BF_USERNAME: "u", BF_PASSWORD: "p", BF_CERT_B64: "Yw==", BF_KEY_B64: "aw==" };
  return { id, env };
}

test("live is off by default: a paid member's live follow is recorded as rejected and Betfair is never called", async () => {
  const id = user("paid@example.com");
  adminUpdateMember(db, id, { action: "grant_paid", until: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  const ctx = memberContext(db, id)!;
  assert.equal(setMemberLive(db, ctx, true, LIVE_CONFIRMATION).ok, false); // master switch off
  membersStore(db).setFollow(id, "action-packed", { mode: "live", auto: true }, new Date(Date.now() - 60_000).toISOString());
  const { placed, deps } = fakeBetfair();
  addAlert("Action-packed", null);
  await runMembers(db, new Date(), deps);
  // The follow was moved back to simulation (live isn't allowed), so no live bet at all.
  assert.equal(placed.length, 0);
  assert.equal(membersStore(db).listBets(id, { mode: "live" }).filter((b) => b.status !== "rejected").length, 0);
});

test("live for the admin needs every switch; then one order per alert, with its own reference; kill switch stops it", async () => {
  const { id, env } = liveAdmin();
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const ctx = memberContext(db, id)!;
    assert.equal(setMemberLive(db, ctx, true, "yes").ok, false); // wrong words
    assert.equal(setMemberLive(db, ctx, true, LIVE_CONFIRMATION).ok, true);
    membersStore(db).setFollow(id, "action-packed", { mode: "live", auto: true }, new Date(Date.now() - 60_000).toISOString());
    const { placed, deps } = fakeBetfair();
    setBalanceForTest(500);
    const p = addAlert("Action-packed", null);
    db.setPickExchange(p.id, "on", "Home v Away", 3, null, "E1");
    await runMembers(db, new Date(), deps);
    await runMembers(db, new Date(), deps);
    assert.equal(placed.length, 1);
    const bet = membersStore(db).listBets(id, { mode: "live" })[0]!;
    assert.equal(placed[0]!.ref, `GM${bet.id}`);
    assert.equal(bet.status, "matched");
    // An alert the bet feed already sent on the same account is never bet again.
    const q = addAlert("Action-packed", null);
    db.markSent([{ id: q.id, rowJson: JSON.stringify({ stake: 2 }) }]);
    db.setPickExchange(q.id, "on", "Home v Away", 3, null, "E2");
    await runMembers(db, new Date(), deps);
    assert.equal(placed.length, 1);
    assert.match(membersStore(db).listBets(id, { mode: "live" }).find((b) => b.pickId === q.id)!.reason!, /already sent/);
    // The member's STOP: nothing more is placed.
    memberKillSwitch(db, id);
    const r = addAlert("Action-packed", null);
    db.setPickExchange(r.id, "on", "Home v Away", 3, null, "E3");
    await runMembers(db, new Date(), deps);
    assert.equal(placed.length, 1);
  } finally {
    process.env = saved;
  }
});

test("the admin's STOP ALL turns live off for everyone and cancels waiting live bets", () => {
  const { id } = liveAdmin();
  const store = membersStore(db);
  store.insertBet({ userId: id, pickId: 999, strategyKey: "action-packed", mode: "live", execution: "auto", simEpoch: 1, stakingMethod: "flat", stake: 2, requestedPrice: 3, status: "pending", reason: null }, new Date().toISOString());
  assert.equal(globalKillSwitch(db), 1);
  assert.equal(memberContext(db, id)!.config.flags.liveBetting, false);
  assert.equal(store.listBets(id)[0]!.status, "rejected");
});

test("a bet can only exist once per member, alert and mode", () => {
  const id = user("dup@example.com");
  const store = membersStore(db);
  const b = { userId: id, pickId: 5, strategyKey: "x", mode: "sim" as const, execution: "auto" as const, simEpoch: 1, stakingMethod: "flat" as const, stake: 2, requestedPrice: 2, status: "matched" as const, reason: null };
  assert.ok(store.insertBet(b, new Date().toISOString()));
  assert.equal(store.insertBet(b, new Date().toISOString()), null);
  assert.ok(store.insertBet({ ...b, mode: "live" }, new Date().toISOString()));
});

test("Stripe: only a correctly signed event counts; a subscription makes the member paid; repeats are ignored", () => {
  const raw = Buffer.from(JSON.stringify({ id: "evt_1" }));
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", "whsec_test").update(`${t}.`).update(raw).digest("hex");
  assert.equal(verifyStripeSignature(raw, `t=${t},v1=${sig}`, "whsec_test"), true);
  assert.equal(verifyStripeSignature(raw, `t=${t},v1=${sig}`, "whsec_other"), false);
  assert.equal(verifyStripeSignature(raw, `t=${t - 1000},v1=${sig}`, "whsec_test"), false);

  const id = user("payer@example.com");
  const end = Math.floor(Date.now() / 1000) + 30 * 86_400;
  const event = { id: "evt_sub", type: "customer.subscription.created", data: { object: { id: "sub_1", customer: "cus_1", status: "active", current_period_end: end, metadata: { user_id: String(id) } } } };
  assert.match(handleStripeEvent(db, event), /active/);
  assert.equal(memberContext(db, id)!.tier, "paid");
  assert.equal(handleStripeEvent(db, event), "already handled");
  handleStripeEvent(db, { id: "evt_del", type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1", status: "canceled" } } });
  assert.equal(memberContext(db, id, new Date(Date.now() + 1000))!.tier, "expired");
});

test("community: only the owner can see or change a strategy; versions are kept; ranking accounts for sample size", () => {
  const owner = user("owner@example.com");
  const other = user("other@example.com");
  adminUpdateMember(db, owner, { action: "grant_paid", until: new Date(Date.now() + 86_400_000).toISOString() });
  adminUpdateMember(db, other, { action: "grant_paid", until: new Date(Date.now() + 86_400_000).toISOString() });
  const free = user("nopaid@example.com");
  assert.throws(() => createStrategy(db, memberContext(db, free)!, { name: "X", rules: { base: ["action-packed"] } }), /paid members/);
  const s = createStrategy(db, memberContext(db, owner)!, { name: "Late push", rules: { base: ["action-packed"], minuteMin: 50 } });
  assert.throws(() => ownStrategyView(db, memberContext(db, other)!, s.id), /No such strategy/);
  assert.throws(() => updateStrategy(db, memberContext(db, other)!, s.id, { name: "Mine now" }), /No such strategy/);
  assert.throws(() => deleteStrategy(db, memberContext(db, other)!, s.id), /No such strategy/);
  updateStrategy(db, memberContext(db, owner)!, s.id, { rules: { base: ["action-packed", "home pressure"] } });
  assert.equal(ownStrategyView(db, memberContext(db, owner)!, s.id).versions.length, 2);
  // Sharing is off until the admin switches the community on.
  assert.throws(() => updateStrategy(db, memberContext(db, owner)!, s.id, { visibility: "shared" }), /isn't available/);
  // 20 bets at +100% doesn't outrank 2,000 bets at +25%.
  assert.ok(adjustedRoi(100, 20)! < adjustedRoi(25, 2000)!);
});

test("secrets are encrypted with the engine key and can't be read without it", () => {
  const env = { MEMBERS_SECRET_KEY: "a-long-random-key-for-testing-only-123" } as NodeJS.ProcessEnv;
  const sealed = encryptSecret("token-abc", env);
  assert.ok(!sealed.includes("token-abc"));
  assert.equal(decryptSecret(sealed, env), "token-abc");
  assert.equal(decryptSecret(sealed, { MEMBERS_SECRET_KEY: "another-long-random-key-xxxxxxxx" } as NodeJS.ProcessEnv), null);
});

test("permission helpers: a trial's scope covers only its chosen strategies", () => {
  const a = accessFor("trial", ["a", "b", "c"]);
  assert.equal(strategyAllowed(a, "viewStrategyDetails", "a"), true);
  assert.equal(strategyAllowed(a, "viewStrategyDetails", "d"), false);
  assert.equal(strategyAllowed(accessFor("paid", []), "viewSelections", "d"), true);
  assert.equal(strategyAllowed(accessFor("free", []), "viewSelections", "a"), false);
});
