/**
 * Checks the fixes from the code audit: the Dashboard's figures from an explicit start (Today = UK midnight) with the
 * money over the same picks, the write counter the engine reuses answers by, and a feed field that can't break a row.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { saveSendingSettings, toCsv } from "../src/inplayguru/bet-feed";
import { computeHitRateContext } from "../src/server/winloss";

const STRATEGY = "Blistering Momentum / Action-packed";

function alert(n: number, result: "hit" | "miss"): string {
  return [
    `🔔 ${STRATEGY}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "3.00 1.40",
    "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-1" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss",
  ].join("\n");
}

function setup() {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { stakes: { [STRATEGY.toLowerCase()]: 2 } });
  const raw = db as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } };
  const add = (n: number, result: "hit" | "miss", hoursAgo: number) => {
    const text = alert(n, result);
    const at = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
    db.upsertLivePick("chat", n, text, parseAlert(text), at);
    raw.db.prepare(`UPDATE live_picks SET first_seen_at = ? WHERE message_id = ?`).run(at, n);
  };
  return { db, add, raw };
}

test("an explicit start counts only picks from then on, with the money over the same picks", () => {
  const { db, add } = setup();
  add(1, "hit", 1);
  add(2, "miss", 2);
  add(3, "hit", 30);
  const since = new Date(Date.now() - 5 * 3_600_000).toISOString();

  const stats = db.hitRateStats(null, null, "all", since);
  assert.equal(stats.totals.hits, 1);
  assert.equal(stats.totals.misses, 1);
  assert.equal(db.hitRateStats(1).totals.hits + db.hitRateStats(1).totals.misses, 2, "days back still works");
  assert.equal(db.hitRateStats(null).totals.hits, 2);

  const ids = db.statsSettledIds(null, null, "all", since);
  assert.equal(ids.size, 2);
  const c = computeHitRateContext(db, ids, since);
  assert.equal(typeof c.profit, "number");
  assert.equal(typeof c.staked, "number");
  if (c.counted > 0) assert.equal(Math.round((c.profit / c.staked) * 1000) / 1000, Math.round((c.roi ?? 0) * 1000) / 1000, "profit / staked is the return");

  const cells = db.performanceCells(null, "all", since);
  assert.equal(cells.reduce((n, x) => n + x.hits + x.misses, 0), 2);
});

test("the write counter moves with every write, however it is made", () => {
  const { db, add, raw } = setup();
  const start = db.changeCount();
  add(1, "hit", 1);
  const afterPick = db.changeCount();
  assert.ok(afterPick > start);
  db.setSetting("anything", "1");
  const afterSetting = db.changeCount();
  assert.ok(afterSetting > afterPick);
  raw.db.prepare(`UPDATE live_picks SET minute = 61`).run();
  assert.ok(db.changeCount() > afterSetting, "even a raw update counts");
  const still = db.changeCount();
  db.hitRateStats(null);
  assert.equal(db.changeCount(), still, "reading doesn't move it");
});

test("a line break in a value can't split a feed row", () => {
  const csv = toCsv([
    { provider: "Time to fight", marketType: "OVER_UNDER_15", selectionName: "Over 1.5 Goals", eventName: "Lyon\r\nv Nantes", betType: "BACK", stake: 2, minPrice: null } as never,
  ]);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 2, "header and one row");
  assert.match(lines[1]!, /"Lyon v Nantes"/);
});
