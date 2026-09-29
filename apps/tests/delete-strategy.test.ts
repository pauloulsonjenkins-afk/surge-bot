/**
 * Checks that deleting a strategy is complete: unsent alerts are deleted, old sent ones leave every figure
 * (but are kept as records), recent sent ones are left alone, merges and limits are forgotten, and, if asked,
 * new alerts with that name are ignored.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { saveStopLossRule, getStopLossRules, forgetStopLoss } from "../src/inplayguru/stop-loss";
import { computeWinLoss } from "../src/server/winloss";

const KEEP = "Blistering Momentum / Action-packed";
const OJ = "Blistering Momentum / Action-packed OJ";

function alert(strategy: string, n: number, result: "hit" | "miss"): string {
  return [
    `🔔 ${strategy}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "3.00 1.40",
    "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-1" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss",
  ].join("\n");
}

function setup() {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEEP.toLowerCase()]: 2, [OJ.toLowerCase()]: 5 }, strategies: { [KEEP.toLowerCase()]: true, [OJ.toLowerCase()]: true } });
  let id = 1;
  const raw = db as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } };
  /** A settled pick. `sentHoursAgo` makes it a pick that was handed to the betting software that long ago. */
  const add = (strategy: string, result: "hit" | "miss", sentHoursAgo: number | null = null) => {
    const n = id++;
    const done = alert(strategy, n, result);
    db.upsertLivePick("chat", n, done, parseAlert(done), new Date().toISOString());
    if (sentHoursAgo !== null) {
      const sentAt = new Date(Date.now() - sentHoursAgo * 3_600_000).toISOString();
      raw.db
        .prepare(`UPDATE live_picks SET sent_at = ?, sent_row = ? WHERE message_id = ?`)
        .run(sentAt, JSON.stringify({ provider: strategy, marketType: "OVER_UNDER_05", selectionName: "Over 0.5 Goals", eventName: "A v B", stake: 5 }), n);
    }
  };
  /** What the Strategies page's delete does on the engine. */
  const deleteCompletely = (label: string, ignoreFuture: boolean) => {
    const result = db.removeStrategyPicks(label);
    const hidden = db.excludeSentPicks(label, new Date(Date.now() - 2 * 3_600_000).toISOString());
    if (ignoreFuture) db.setStrategyIgnored(label, true);
    db.forgetStrategyMerges(label);
    return { ...result, hidden };
  };
  return { db, add, deleteCompletely };
}

test("deleting removes unsent alerts, takes old sent ones out of every figure, and leaves recent sent ones", () => {
  const { db, add, deleteCompletely } = setup();
  add(KEEP, "hit");                 // the strategy that stays
  add(OJ, "hit"); add(OJ, "miss");  // never sent
  add(OJ, "miss", 6);               // sent 6 hours ago: old
  add(OJ, "hit", 0.5);              // sent 30 minutes ago: recent
  const r = deleteCompletely(OJ, false);
  assert.equal(r.removed, 2);
  assert.equal(r.keptBecauseSent, 2);
  assert.equal(r.hidden, 1);        // only the old sent one leaves the figures

  const stats = db.hitRateStats(null);
  assert.deepEqual(stats.byStrategy.map((s) => s.label).sort(), [KEEP, OJ].sort()); // the recent sent pick still counts
  assert.equal(stats.byStrategy.find((s) => s.label === OJ)?.alerts, 1);

  // the old sent pick is kept as a record and can be put back
  const kept = db.listStrategiesForAdmin().find((s) => s.label === OJ);
  assert.equal(kept?.alerts, 2);
});

test("a fully deleted strategy no longer shows in Win/Loss or the dashboard breakdown", () => {
  const { db, add, deleteCompletely } = setup();
  add(KEEP, "hit");
  add(OJ, "hit"); add(OJ, "miss", 6);
  deleteCompletely(OJ, false);
  const wl = computeWinLoss(db);
  assert.deepEqual(wl.reported.map((l) => l.label), [KEEP]);
  assert.deepEqual(wl.strategies.map((s) => s.label), [KEEP]);
  assert.deepEqual([...new Set(db.performanceCells(null).map((c) => c.strategy))], [KEEP]);
  assert.equal(wl.periods.d1.total, 4);     // only the KEEP hit: 2 at 3.00 is +£4
});

test("deleting the strategy you merged into un-merges the other one", () => {
  const { db, add, deleteCompletely } = setup();
  add(KEEP, "hit"); add(OJ, "hit");
  db.setStrategyMerge(KEEP, OJ);
  assert.deepEqual(db.hitRateStats(null).byStrategy.map((s) => s.label), [OJ]);
  deleteCompletely(OJ, false);
  assert.deepEqual(db.hitRateStats(null).byStrategy.map((s) => s.label), [KEEP]);   // back under its own name
  assert.equal(db.listStrategiesForAdmin().find((s) => s.label === KEEP)?.mergedInto, null);
});

test("ignoring: matches the name however the alert words its bracket note, and can be turned off", () => {
  const { db, deleteCompletely } = setup();
  assert.equal(db.isStrategyIgnored(OJ), false);
  deleteCompletely(OJ, true);
  assert.equal(db.isStrategyIgnored(OJ), true);
  assert.equal(db.isStrategyIgnored(`${OJ} (Favorite conceded first)`), true);
  assert.equal(db.isStrategyIgnored(KEEP), false);                                  // the plain name is a different strategy
  assert.deepEqual(Object.values(db.getIgnoredStrategies()), [OJ]);
  db.setStrategyIgnored(OJ, false);
  assert.equal(db.isStrategyIgnored(OJ), false);
});

test("deleting forgets the strategy's stop loss and stops it being sent", () => {
  const { db, add } = setup();
  saveStopLossRule(db, OJ, { dailyLoss: 10 });
  add(OJ, "miss");
  db.removeStrategyPicks(OJ);
  // the engine route also clears the switch, stake and limits
  saveSendingSettings(db, { strategies: { [OJ.toLowerCase()]: false }, stakes: { [OJ.toLowerCase()]: null } });
  forgetStopLoss(db, OJ);
  assert.equal(buildFeed(db, { markSent: false }).rows.length, 0);
  assert.deepEqual(getStopLossRules(db), {});
});
