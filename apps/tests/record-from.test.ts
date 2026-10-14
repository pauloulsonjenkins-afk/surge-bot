import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb, RECORD_FROM } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";

test("a strategy whose bet changed counts its record only from the change", () => {
  const db = new EngineDb(":memory:", () => {});
  const from = Date.parse(RECORD_FROM["pass master 1st half"]!);
  const text = (n: number) =>
    [`🔔 Pass Master 1st half`, "", "🇫🇷 France Ligue 1", `Home ${n} vs Away ${n}`, "", "Timer: 25'", "Goals: 0 - 0", "1X2 Live Odds:", "1.40 4.00 7.00", "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", "Full-Time Score: 1-0", "", "✅ Hit"].join("\n");
  db.upsertLivePick("c", 1, text(1), parseAlert(text(1)), null, new Date(from - 3_600_000).toISOString());
  db.upsertLivePick("c", 2, text(2), parseAlert(text(2)), null, new Date(from + 3_600_000).toISOString());
  const row = db.listStrategiesForAdmin().find((r) => r.label === "Pass Master 1st half")!;
  assert.equal(row.recordFrom, RECORD_FROM["pass master 1st half"]);
  assert.equal(row.alertsSince, 2);
  assert.equal(row.hits + row.misses, 1, "only the alert after the change counts");
});

test("Strategies money can count from the rule change too, with the figures from before kept apart", async () => {
  const { computeStrategyReturns } = await import("../src/server/winloss");
  const db = new EngineDb(":memory:", () => {});
  const from = Date.parse(RECORD_FROM["pass master 1st half"]!);
  const text = (n: number, hit: boolean) =>
    [`🔔 Pass Master 1st half`, "", "🇫🇷 France Ligue 1", `Home ${n} vs Away ${n}`, "", "Timer: 25'", "Goals: 0 - 0", "1X2 Live Odds:", "1.40 4.00 7.00", "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${hit ? "1-0" : "0-0"}`, "", hit ? "✅ Hit" : "❌ Miss"].join("\n");
  db.upsertLivePick("c", 1, text(1, false), parseAlert(text(1, false)), null, new Date(from - 7_200_000).toISOString());
  db.upsertLivePick("c", 2, text(2, false), parseAlert(text(2, false)), null, new Date(from - 3_600_000).toISOString());
  db.upsertLivePick("c", 3, text(3, true), parseAlert(text(3, true)), null, new Date(from + 3_600_000).toISOString());
  const plain = computeStrategyReturns(db)["pass master 1st half"]!;
  assert.equal(plain.all.settled, 3);
  assert.equal(plain.before, undefined);
  const split = computeStrategyReturns(db, null, { fromRuleChange: true })["pass master 1st half"]!;
  assert.equal(split.all.settled, 1, "money counts from the change");
  assert.equal(split.before?.all.settled, 2, "the two from before are kept apart");
});
