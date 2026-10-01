/**
 * Live means real money: a pick counts as a live bet only when a Betfair bet on it was matched (priced at the amount
 * matched, the price matched and Betfair's profit) or it was placed by hand. A pick sent but never placed staked
 * nothing: it's in neither Live nor Sim, and has no profit. Picks sent before any Betfair bets were known still count.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computePickProfits, computeStrategyReturns, computeWinLoss, saveWinLossSettings } from "../src/server/winloss";
import { computeReconcile, matchBets } from "../src/betfair/reconcile";

const S = "Blistering Momentum";
const KEY = S.toLowerCase();
const alert = (n: number, result?: "hit" | "miss") =>
  [
    `🔔 ${S}`, "", "🇫🇷 France Ligue 1", `Lyon${n} vs Nantes${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

/** Three picks sent through the feed, then settled as hits. */
function setup() {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 2 }, strategies: { [KEY]: true }, dailyCap: 100 });
  const now = new Date();
  const posted = new Date(now.getTime() - 60_000).toISOString();
  for (const n of [1, 2, 3]) {
    db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), posted);
    buildFeed(db, { markSent: true, now });
  }
  const sent = db.listSentPicks();
  for (const n of [1, 2, 3]) db.upsertLivePick("chat", n, alert(n, "hit"), parseAlert(alert(n, "hit")), posted);
  return { db, sent };
}

test("before any Betfair bets are known, sent picks still count as live, priced as sent", () => {
  const { db } = setup();
  const live = computeStrategyReturns(db)[KEY]!.live;
  assert.equal(live.settled, 3);
  assert.equal(live.staked, 6); // £2 each, as sent
  assert.equal(live.profit, 6); // at the alert's 2.00
  assert.equal(db.listStrategiesForAdmin()[0]!.liveHits, 3);
});

test("with Betfair bets known, only the matched one is live, at its real stake, price and profit", () => {
  const { db, sent } = setup();
  const at = new Date(Date.parse(sent[0]!.sentAt) + 20_000).toISOString();
  // Matched £1.50 at 2.20 (not the £2 sent, nor the alert's 2.00), settled won £1.80 before commission.
  db.saveBetfairBets(
    [{ betId: "A", placedAt: at, settledAt: at, event: sent[0]!.sentRow!.eventName!, market: null, selection: "Over 0.5 Goals", side: "back", provider: null, status: "won", stake: 1.5, matched: 1.5, odds: 2.2, profit: 1.8 }],
    "t",
  );
  matchBets(db);

  const r = computeStrategyReturns(db)[KEY]!;
  assert.equal(r.live.settled, 1);
  assert.equal(r.live.staked, 1.5);
  assert.equal(r.live.profit, 1.8);
  assert.equal(r.live.avgOdds, 2.2);
  // The two never placed are neither live nor sim, but still count for the strategy's hit rate under All.
  assert.equal(r.sim.settled, 0);
  assert.equal(r.all.settled, 3);
  assert.equal(r.all.counted, 1, "no money on the unplaced picks");
  assert.equal(db.listStrategiesForAdmin()[0]!.liveHits, 1);
  assert.equal(computeWinLoss(db, new Date(), "live").periods.d1.total, 1.8);

  // The Trade Log: real figure for the matched one, "not placed" with nothing at stake for the others.
  const profits = computePickProfits(db, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(profits[sent[0]!.id], { stake: 1.5, profit: 1.8, placement: "betfair", real: true, assumed: false });
  assert.deepEqual(profits[sent[1]!.id], { stake: 0, profit: 0, placement: "notPlaced", real: false, assumed: false });

  // Reconcile still compares the app's estimate (£2 at 2.00 = £2) with the real £1.80.
  const rec = computeReconcile(db).strategies.find((s) => s.label === S)!;
  assert.equal(rec.estimatedProfit, 2);
  assert.equal(rec.actualProfit, 1.8);
});

test("commission comes off a real Betfair win", () => {
  const { db, sent } = setup();
  saveWinLossSettings(db, { commission: 5 });
  const at = new Date(Date.parse(sent[0]!.sentAt) + 20_000).toISOString();
  db.saveBetfairBets(
    [{ betId: "A", placedAt: at, settledAt: at, event: sent[0]!.sentRow!.eventName!, market: null, selection: "Over 0.5 Goals", side: "back", provider: null, status: "won", stake: 2, matched: 2, odds: 2, profit: 2 }],
    "t",
  );
  matchBets(db);
  assert.equal(computeStrategyReturns(db)[KEY]!.live.profit, 1.9);
});

test("a bet placed by hand on a sent pick counts at the stake placed, not the stake sent", () => {
  const { db, sent } = setup();
  db.setManualBet(sent[0]!.id, { stake: 1, odds: 1.73 });
  const profits = computePickProfits(db, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(profits[sent[0]!.id], { stake: 1, profit: 0.73, placement: "manual", real: false, assumed: false });
});
