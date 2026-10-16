/**
 * Betfair's settlement is the final word on a pick GoalBrew bet itself. Livorno v Grosseto, 16 Oct 2026: InPlayGuru's
 * final score was 3-4 (7 goals, so Over 7.5 a Miss) but Betfair settled the Over 7.5 bet as won.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";

const alert = (ft?: string) =>
  [
    "🔔 Time to fight",
    "",
    "🇮🇹 Italy Serie C Group B (4th vs 3rd)",
    "Livorno vs Grosseto",
    "",
    "Timer: 74'",
    "Goals: 3 - 4",
    "Over/Under 7.50 Odds:",
    "1.83 1.83",
    ...(ft ? ["", "⸻⸻ Match Summary ⸻⸻", "", "Half-Time Score: 2-2", `Full-Time Score: ${ft}`, "", "❌ Miss"] : []),
  ].join("\n");

function setup(status: "won" | "lost" | "matched") {
  const db = new EngineDb(":memory:", () => {});
  const at = new Date(Date.now() - 3 * 3_600_000).toISOString();
  db.upsertLivePick("chat", 1, alert(), parseAlert(alert()), at);
  db.upsertLivePick("chat", 1, alert("3-4"), parseAlert(alert("3-4")), at);
  const id = db.listResultsForWinLoss("1970-01-01T00:00:00.000Z")[0]!.id;
  db.claimDirectBet(id, "live", { strategy: "Time to fight", eventName: "Livorno v Grosseto", marketType: "OVER_UNDER_75", selectionName: "Over 7.5 Goals", stake: 1.13, minPrice: 1.45 }, at);
  db.updateDirectBet(id, { state: "placed", betId: "B1", sizeMatched: 1.13, avgPrice: 1.98 }, at);
  db.saveBetfairBets(
    [{ betId: "B1", placedAt: at, settledAt: status === "matched" ? null : at, event: "Livorno v Grosseto", market: "Over/Under 7.5 Goals", selection: "Over 7.5 Goals", side: "back", provider: null, status, stake: 1.13, matched: 1.13, odds: 1.98, profit: status === "won" ? 1.11 : status === "lost" ? -1.13 : null }],
    at,
  );
  db.linkDirectBets();
  return { db, id };
}

const resultOf = (db: EngineDb, id: number) => db.listResultsForWinLoss("1970-01-01T00:00:00.000Z").find((r) => r.id === id)!.result;

test("a settled Betfair bet that won turns the score's Miss into a Hit", () => {
  const { db, id } = setup("won");
  assert.equal(resultOf(db, id), "miss");
  assert.deepEqual(db.applyBetfairResults(), [{ id, from: "miss", to: "hit" }]);
  assert.equal(resultOf(db, id), "hit");
  assert.deepEqual(db.applyBetfairResults(), [], "done once");
});

test("nothing changes while the bet is still open, or when Betfair agrees", () => {
  assert.deepEqual(setup("matched").db.applyBetfairResults(), []);
  assert.deepEqual(setup("lost").db.applyBetfairResults(), []);
});

test("a result amended by hand is never touched", () => {
  const { db, id } = setup("won");
  db.setResultOverride(id, "miss");
  assert.deepEqual(db.applyBetfairResults(), []);
  assert.equal(resultOf(db, id), "miss");
});
