/** The dates the agents' weekly review reads (strategy-advice.ts agentDates): Live/Sim switches, slices, rule changes, locks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { agentDates, LOCK_MS } from "../src/server/strategy-advice";

test("each strategy's switch, its last flip, rule change, stake and lock; each slice with when it went Live", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, strategies: { "favourite pressure 2nd half": true, "time to fight": false }, stakePct: { "favourite pressure 2nd half": 2 } });
  const s = getSendingSettings(db);
  const now = new Date("2026-11-07T23:00:00Z");
  const lockAt = "2026-11-03T22:32:00.000Z";
  db.setSetting("strategy_advice_locks", JSON.stringify({ "favourite pressure 2nd half": { kind: "try-live", at: lockAt } }));
  const d = agentDates(db, now);
  const fav = d.strategies.find((x) => x.key === "favourite pressure 2nd half")!;
  assert.equal(fav.mode, "live");
  assert.deepEqual(fav.stake, { pct: 2 });
  assert.equal(fav.ruleChangedAt, null, "no rule change on record");
  assert.equal(fav.modeSince, s.modeSince["favourite pressure 2nd half"] ?? null);
  assert.deepEqual(fav.lock, { kind: "try-live", at: lockAt, until: new Date(Date.parse(lockAt) + LOCK_MS).toISOString(), active: true });
  const ttf = d.strategies.find((x) => x.key === "time to fight")!;
  assert.equal(ttf.mode, "sim");
  assert.equal(ttf.ruleChangedAt, "2026-10-12T20:00:00.000Z");
  assert.deepEqual(d.slices, []);
  assert.deepEqual(d.autoStakeQueue, []);
});

test("a slice bet on its own shows its switch and when it went Live", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, segmentBets: { "time to fight#f-goals01+min45to59": { live: true, stakePct: 1.5 } } } as never);
  const sl = agentDates(db).slices.find((x) => x.key === "time to fight#f-goals01+min45to59");
  assert.ok(sl, "listed");
  assert.equal(sl!.mode, "live");
  assert.deepEqual(sl!.stake, { pct: 1.5 });
  assert.equal(typeof sl!.liveSince, "string", "switching it Live records when");
});
