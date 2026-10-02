/**
 * Checks clearing a pick from Live's "Waiting for a result": it leaves the Dashboard's "awaiting result" count, counts
 * as neither hit nor miss, can be put back, and a hand-set result settles it instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";

/** An alert still waiting for its result: no match summary, no Hit/Miss tick. */
function waitingAlert(n: number): string {
  return [`🔔 Time to fight`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.40"].join("\n");
}

function setup() {
  const db = new EngineDb(":memory:", () => {});
  const ids: number[] = [];
  for (const n of [1, 2, 3]) {
    const text = waitingAlert(n);
    db.upsertLivePick("chat", n, text, parseAlert(text), new Date().toISOString());
  }
  for (const p of db.listLivePicks(10)) ids.push(p.id);
  return { db, ids };
}

test("a cleared pick leaves the awaiting count, is marked, and can be put back", () => {
  const { db, ids } = setup();
  assert.equal(db.hitRateStats(null).totals.pending, 3);

  assert.equal(db.setWaitingCleared(ids[0]!, true), true);
  assert.equal(db.hitRateStats(null).totals.pending, 2);
  assert.ok(db.getLivePick(ids[0]!)?.waitingClearedAt, "the pick says when it was cleared");
  const totals = db.hitRateStats(null).totals;
  assert.equal(totals.hits + totals.misses, 0, "cleared is neither a hit nor a miss");
  assert.equal(totals.alerts, 3, "the alert itself still counts");

  assert.equal(db.setWaitingCleared(ids[0]!, false), true);
  assert.equal(db.hitRateStats(null).totals.pending, 3);
  assert.equal(db.getLivePick(ids[0]!)?.waitingClearedAt, null);
  assert.equal(db.setWaitingCleared(999_999, true), false, "no such pick");
});

test("giving a waiting pick a result settles it", () => {
  const { db, ids } = setup();
  db.setResultOverride(ids[1]!, "hit");
  const p = db.getLivePick(ids[1]!);
  assert.equal(p?.status, "settled");
  assert.equal(p?.result, "hit");
  const totals = db.hitRateStats(null).totals;
  assert.equal(totals.pending, 2);
  assert.equal(totals.hits, 1);
});
