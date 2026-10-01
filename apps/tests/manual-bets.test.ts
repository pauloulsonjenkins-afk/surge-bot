/**
 * A bet the admin placed by hand (logged on Live) counts as a live bet at its own stake and price, and results the
 * alert's own tick disagrees with stay listed for review until they're dealt with.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computeStrategyReturns, computeWinLoss } from "../src/server/winloss";
import { pickPlacements } from "../src/betfair/exchange";
import { computeReconcile } from "../src/betfair/reconcile";
import { checkLeague } from "../src/betfair/competitions";

const S = "Blistering Momentum";
const KEY = S.toLowerCase();
const alert = (result?: "hit" | "miss", ft?: string) =>
  [
    `🔔 ${S}`, "", "🇫🇷 France Ligue 1", "Lyon vs Nantes", "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${ft ?? (result === "hit" ? "1-0" : "0-0")}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");
const link = { configured: true, missing: [], lastOkAt: new Date().toISOString(), lastErrorAt: null, lastError: null, lastCount: 0 };

test("a Sim pick placed by hand becomes a live bet at its own stake and price", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { stakes: { [KEY]: 2 } }); // sending off: the pick is Sim
  const posted = new Date(Date.now() - 60_000).toISOString();
  db.upsertLivePick("chat", 1, alert(), parseAlert(alert()), posted);
  const id = db.listLivePicks(5)[0]!.id;
  assert.equal(db.setManualBet(id, { stake: 10, odds: 2.5 }), true);
  db.upsertLivePick("chat", 1, alert("hit"), parseAlert(alert("hit")), posted);

  const live = computeStrategyReturns(db)[KEY]!.live;
  assert.equal(live.settled, 1);
  assert.equal(live.staked, 10);
  assert.equal(live.profit, 15); // £10 at 2.5, no commission
  assert.equal(computeStrategyReturns(db)[KEY]!.sim.settled, 0);
  assert.equal(computeWinLoss(db, new Date(), "live").periods.d1.total, 15);
  assert.equal(db.listStrategiesForAdmin()[0]!.liveHits, 1);

  // Live shows it as won by hand; Reconcile doesn't count it as a missed feed bet.
  const p = pickPlacements(db, link)[id]!;
  assert.equal(p.state, "won");
  assert.deepEqual(p.manual, { stake: 10, odds: 2.5 });
  assert.equal(computeReconcile(db).totals.sent, 0);

  // Undo puts it back to Sim.
  db.setManualBet(id, null);
  assert.equal(computeStrategyReturns(db)[KEY]!.live.settled, 0);
});

test("a sent pick the betting software missed, placed by hand, is priced at the price taken", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 2 }, strategies: { [KEY]: true } });
  const now = new Date();
  const posted = new Date(now.getTime() - 60_000).toISOString();
  db.upsertLivePick("chat", 1, alert(), parseAlert(alert()), posted);
  buildFeed(db, { markSent: true, now });
  const id = db.listLivePicks(5)[0]!.id;
  db.setManualBet(id, { stake: 2, odds: 3 });
  db.upsertLivePick("chat", 1, alert("miss"), parseAlert(alert("miss")), posted);
  const live = computeStrategyReturns(db)[KEY]!.live;
  assert.equal(live.profit, -2);
  assert.equal(live.avgOdds, 3); // the price actually taken comes first
  assert.equal(pickPlacements(db, link)[id]!.state, "lost");
});

test("a result the alert's own tick disagrees with stays listed until it's reviewed", () => {
  const db = new EngineDb(":memory:", () => {});
  // The alert says Hit, but 0-0 at full time makes Over 0.5 a Miss.
  const text = alert("hit", "0-0");
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date().toISOString());
  const list = db.listResultDiscrepancies();
  assert.equal(list.length, 1);
  assert.equal(list[0]!.result, "miss");
  db.setResultReviewed(list[0]!.id, true);
  assert.equal(db.listResultDiscrepancies().length, 0);
  db.setResultReviewed(list[0]!.id, false);
  assert.equal(db.listResultDiscrepancies().length, 1);
});

test("coverage shows countries with capitals", () => {
  assert.equal(checkLeague("Northern Ireland Premiership", []).country, "Northern Ireland");
});
