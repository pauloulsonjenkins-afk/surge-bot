/**
 * The Golden safety check: a slice bet Live on its own goes back to Sim when its own Live bets lose more than 5% per
 * £1 over 30+ bets (or it stops being Golden). Turning it back on is the admin's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { monitorGoldenBets } from "../src/server/golden";

const alert = (n: number, result?: "hit" | "miss") =>
  [
    "🔔 Time to fight", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 2 - 0",
    "Over/Under 2.50 Odds:", "2.00 1.80",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 1-0", `Full-Time Score: ${result === "hit" ? "3-0" : "2-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

function setup(results: Array<"hit" | "miss">) {
  const db = new EngineDb(":memory:", () => {});
  // Wake-up Call in Sim; its Golden slice (2+ goals apart) Live at £1.
  saveSendingSettings(db, { enabled: true, stakes: { "time to fight": 1 }, strategies: { "time to fight": false }, dailyCap: 1000 });
  saveSendingSettings(db, { segmentBets: { "time to fight#two-apart": { live: true } } });
  results.forEach((r, i) => {
    const n = i + 1;
    const at = new Date(Date.now() + 1000).toISOString();
    db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), at);
    buildFeed(db, { markSent: true });
    db.upsertLivePick("chat", n, alert(n, r), parseAlert(alert(n, r)), at);
  });
  return db;
}

test("switched back to Sim when its own Live bets lose more than 5% over 30+", async () => {
  const db = setup(Array.from({ length: 32 }, (_, i) => (i % 3 === 0 ? "hit" : "miss")));
  assert.ok(getSendingSettings(db).segmentBets["time to fight#two-apart"]!.liveSince);
  const off = await monitorGoldenBets(db);
  assert.equal(off.length, 1);
  assert.equal(getSendingSettings(db).segmentBets["time to fight#two-apart"]!.live, false);
});

test("left Live while it's winning, or before 30 bets", async () => {
  assert.deepEqual(await monitorGoldenBets(setup(Array.from({ length: 32 }, (_, i) => (i % 3 === 0 ? "miss" : "hit")))), []);
  assert.deepEqual(await monitorGoldenBets(setup(Array.from({ length: 10 }, () => "miss"))), []);
});
