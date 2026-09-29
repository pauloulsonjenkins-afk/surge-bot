/**
 * Checks strategy merging and deleting: merges only change how the Dashboard and stats group
 * alerts, never what the bet feed sends, and deleting keeps anything already sent to bet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";

const A = "Blistering Momentum / Action-packed";
const B = "Blistering Momentum / Action-packed OJ";
const C = "Both Teams to Score";

function alert(strategy: string, n: number, result?: "hit" | "miss"): string {
  return [
    `🔔 ${strategy}`,
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    `Home ${n} vs Away ${n}`,
    "",
    "Timer: 60'",
    "Goals: 0 - 0",
    "Over/Under 0.50 Odds:",
    "1.80 2.00",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");
}

function setup() {
  const db = new EngineDb(":memory:", () => {});
  let id = 1;
  const add = (strategy: string, result?: "hit" | "miss", postedAt = new Date().toISOString()) => {
    const text = alert(strategy, id);
    db.upsertLivePick("chat", id, text, parseAlert(text), postedAt);
    // a result arrives later as an edit of the same message
    if (result) {
      const done = alert(strategy, id, result);
      db.upsertLivePick("chat", id, done, parseAlert(done), postedAt);
    }
    id++;
  };
  return { db, add };
}

// { "strategy name": "hits/misses" }, so the order of the list doesn't matter.
const strategyRows = (db: EngineDb) => Object.fromEntries(db.hitRateStats(null).byStrategy.map((s) => [s.label, `${s.hits}/${s.misses}`]));

test("before merging, the two names are separate strategies", () => {
  const { db, add } = setup();
  add(A, "hit"); add(A, "miss"); add(B, "hit");
  assert.deepEqual(strategyRows(db), { [A]: "1/1", [B]: "1/0" });
});

test("merging counts both under the chosen name in stats, the breakdown and the strategy filter", () => {
  const { db, add } = setup();
  add(A, "hit"); add(A, "miss"); add(B, "hit"); add(B, "miss");
  assert.deepEqual(db.setStrategyMerge(A, B), { ok: true });
  assert.deepEqual(strategyRows(db), { [B]: "2/2" });
  assert.deepEqual([...new Set(db.performanceCells(null).map((c) => c.strategy))], [B]);
  assert.equal(db.hitRateStats(null, B).totals.alerts, 4);       // filtering by the merged name finds both
  assert.equal(db.hitRateStats(null, A).totals.alerts, 0);       // the old name no longer exists in stats
  assert.equal(db.hitRateStats(null).totals.alerts, 4);          // overall totals unchanged
});

test("undoing a merge separates them again", () => {
  const { db, add } = setup();
  add(A, "hit"); add(B, "miss");
  db.setStrategyMerge(A, B);
  assert.deepEqual(db.setStrategyMerge(A, null), { ok: true });
  assert.deepEqual(strategyRows(db), { [A]: "1/0", [B]: "0/1" });
});

test("merges can't loop or point at themselves, and follow the final name", () => {
  const { db, add } = setup();
  add(A, "hit"); add(B, "hit"); add(C, "hit");
  assert.equal(db.setStrategyMerge(A, A).ok, false);
  assert.equal(db.setStrategyMerge(A, "Not a strategy").ok, false);
  assert.equal(db.setStrategyMerge("Not a strategy", A).ok, false);
  db.setStrategyMerge(A, B);
  assert.equal(db.setStrategyMerge(B, A).ok, false);              // B into A would loop
  db.setStrategyMerge(B, C);                                      // B into C: A now follows to C
  // all three alerts are now one strategy (the Both Teams to Score one is scored from the final score, so it is not a hit)
  assert.deepEqual(Object.keys(strategyRows(db)), [C]);
  assert.equal(db.hitRateStats(null, C).totals.alerts, 3);
});

test("merging changes reporting only: the bet feed keeps each strategy's own switch and stake", () => {
  const { db, add } = setup();
  saveSendingSettings(db, { enabled: true, stakes: { [A.toLowerCase()]: 2 }, strategies: { [A.toLowerCase()]: true } });
  db.setStrategyMerge(A, B);                                      // A is now reported under B, and B has no stake
  add(A);
  add(B);
  const feed = buildFeed(db, { markSent: false });
  assert.equal(feed.rows.length, 1);                              // only A's pick is sent
  assert.equal(feed.rows[0]?.provider, A);                        // still under its own name
  assert.ok(feed.skipped.some((s) => s.strategy === B));          // B stays switched off
});

test("the admin list shows raw strategies with counts and what each is merged into", () => {
  const { db, add } = setup();
  add(A, "hit"); add(A, "miss"); add(B, "hit");
  db.setStrategyMerge(A, B);
  const list = db.listStrategiesForAdmin();
  const a = list.find((r) => r.label === A);
  assert.equal(a?.alerts, 2);
  assert.equal(a?.hits, 1);
  assert.equal(a?.misses, 1);
  assert.equal(a?.mergedInto, B);
  assert.equal(list.find((r) => r.label === B)?.mergedInto, null);
});

test("deleting removes unsent alerts, keeps sent ones, and drops the merges it was part of", () => {
  const { db, add } = setup();
  saveSendingSettings(db, { enabled: true, stakes: { [A.toLowerCase()]: 2 }, strategies: { [A.toLowerCase()]: true } });
  add(A); add(A, "hit"); add(A, "miss");
  buildFeed(db, { markSent: true });                              // the one still-open A pick is handed over
  add(B, "hit");
  db.setStrategyMerge(A, B);
  const result = db.removeStrategyPicks(A);
  db.forgetStrategyMerges(A);
  assert.equal(result.keptBecauseSent, 1);
  assert.equal(result.removed, 2);
  assert.equal(db.listStrategiesForAdmin().find((r) => r.label === A)?.mergedInto, null);
  assert.equal(db.listStrategiesForAdmin().find((r) => r.label === A)?.alerts, 1);  // only the sent one remains
});

test("a welcome message that got stored as a pick can be deleted like any strategy", () => {
  const { db } = setup();
  const text = "🔔 Your first Premium pick, many more to come!\n\nWelcome!\nHome vs Away\nTimer: 10'\nGoals: 0 - 0\n\n⸻⸻ Match Summary ⸻⸻\n✅ Hit";
  db.upsertLivePick("chat", 99, text, parseAlert(text), new Date().toISOString());
  const label = "Your first Premium pick, many more to come!";
  assert.equal(db.listStrategiesForAdmin().some((r) => r.label === label), true);
  assert.equal(db.removeStrategyPicks(label).removed, 1);
  assert.equal(db.listStrategiesForAdmin().some((r) => r.label === label), false);
  assert.equal(db.hitRateStats(null).totals.alerts, 0);
});
