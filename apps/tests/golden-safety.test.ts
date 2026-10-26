/**
 * The Golden safety check: a slice bet Live on its own goes back to Sim when its own Live bets lose more than 5% per
 * £1 over 30+ bets (or it stops holding up). Turning it back on is the admin's.
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

test("a watched slice has to keep earning its stage: a bad last 30 loses it at once, and only 30 good picks after win it back", async () => {
  const { goldenReport } = await import("../src/server/golden");
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "time to fight": 1 }, strategies: { "time to fight": false }, dailyCap: 1000, maxAgeMinutes: 60 });
  const T = Date.now();
  let n = 0;
  const add = (results: Array<"hit" | "miss">, fromSecsAgo: number) =>
    results.forEach((r, i) => {
      n++;
      const at = new Date(T - (fromSecsAgo - i) * 1000).toISOString();
      db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), at, at);
      buildFeed(db, { markSent: true });
      db.upsertLivePick("chat", n, alert(n, r), parseAlert(alert(n, r)), at, at);
    });
  const status = () => goldenReport(db, new Date(), { skipFinder: true }).slices.find((s) => s.id === "two-apart")!;
  // 60 picks, two wins in three at 2.00: in profit, so a candidate (50+, under the 150 needed for a Live trial).
  add(Array.from({ length: 60 }, (_, i) => (i % 3 === 2 ? "miss" : "hit")), 900);
  assert.equal(status().status, "candidate");
  await monitorGoldenBets(db, new Date(T - 700_000)); // first run: records it, says nothing
  // The next 30 lose badly: still well up overall (+10%), but the stage goes.
  add(Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? "hit" : "miss")), 600);
  assert.equal(status().status, "not holding up");
  assert.match(status().why!, /last 30 picks/);
  await monitorGoldenBets(db, new Date(T - 400_000)); // notes when it lost it
  // 20 good picks after: the last 30 look fine again, but it hasn't re-proved itself yet.
  add(Array.from({ length: 20 }, () => "hit"), 300);
  assert.equal(status().status, "not holding up");
  assert.match(status().why!, /re-proving/);
  // 30 good picks after the loss: a candidate again.
  add(Array.from({ length: 10 }, (_, i) => (i % 3 === 2 ? "miss" : "hit")), 100);
  assert.equal(status().status, "candidate");
});
