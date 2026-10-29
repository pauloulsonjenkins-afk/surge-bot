/**
 * Bets placed by hand against bets GoalBrew placed itself (server/by-method.ts): real money only, in £ and in units.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { computeByMethod, methodOf } from "../src/server/by-method";

const alert = (n: number, result?: "hit" | "miss") =>
  [
    "🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0",
    "Over/Under 0.50 Odds:", "2.00 1.80",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

/** A settled alert logged as bet by hand: `stake` at `odds`. */
function handBet(db: EngineDb, n: number, result: "hit" | "miss", stake: number, odds: number) {
  const at = new Date(Date.now() - 3600_000).toISOString();
  db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), at);
  db.setManualBet(db.getLivePickByMessage("chat", n)!.id, { stake, odds });
  db.upsertLivePick("chat", n, alert(n, result), parseAlert(alert(n, result)), at);
}

test("how a bet counts: logged by hand or Bet this for real is by hand, a Betfair bet is automatic, the rest neither", () => {
  assert.equal(methodOf("manual", false), "hand");
  assert.equal(methodOf("sim", true), "hand", "a Sim pick bet for real with its button");
  assert.equal(methodOf("betfair", false), "auto");
  assert.equal(methodOf("legacy", false), null, "from the old betting software");
  assert.equal(methodOf("sim", false), null);
  assert.equal(methodOf("notPlaced", false), null);
});

test("hand bets are totalled in £ and units, and fall into the right periods", () => {
  const db = new EngineDb(":memory:", () => {});
  handBet(db, 1, "hit", 2, 2.1); // +£2.20 (commission defaults to 0)
  handBet(db, 2, "miss", 4, 1.8); // -£4.00, but -1.0 unit
  const r = computeByMethod(db);
  const t = r.periods.today.hand;
  assert.equal(t.bets, 2);
  assert.equal(t.won, 1);
  assert.equal(t.staked, 6);
  assert.ok(Math.abs(t.profit - (2 * 1.1 - 4)) < 0.02, `profit ${t.profit}`);
  assert.ok(Math.abs(t.units - (1.1 - 1)) < 0.02, `units ${t.units}: each bet counted as 1 unit, not by its stake`);
  assert.equal(r.periods.all.hand.bets, 2);
  assert.equal(r.periods.d7.hand.bets, 2);
  assert.equal(r.periods.today.auto.bets, 0);
});
