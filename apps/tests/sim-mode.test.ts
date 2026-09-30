/**
 * Live and simulation: a pick is live when it was handed to the bet feed, and a simulation pick when it
 * wasn't. Checks that Win/Loss, the hit-rate stats, the breakdown and the Strategies list can be split
 * that way, and that "all" still gives exactly what it did before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb, parsePickMode } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computeWinLoss } from "../src/server/winloss";

const LIVE = "Blistering Momentum / Action-packed";
const SIM = "Blistering Momentum / Action-packed OJ";

function alert(strategy: string, n: number, result: "hit" | "miss"): string {
  return [
    `🔔 ${strategy}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0",
    "Over/Under 0.50 Odds:", "3.00 1.40",                                                   // Over 0.5 at 3.00
    "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-1" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss",
  ].join("\n");
}

function setup() {
  const db = new EngineDb(":memory:", () => {});
  // The strategy's stake today is £2 for both; the live picks were sent at £4, which is what they must be priced at.
  saveSendingSettings(db, { stakes: { [LIVE.toLowerCase()]: 2, [SIM.toLowerCase()]: 2 } });
  let n = 1;
  const add = (strategy: string, result: "hit" | "miss", sentStake: number | null) => {
    const text = alert(strategy, n, result);
    db.upsertLivePick("chat", n, text, parseAlert(text), new Date().toISOString());
    const pick = db.listLivePicks(200).find((p) => p.messageId === n)!;
    if (sentStake !== null) db.markSent([{ id: pick.id, rowJson: JSON.stringify({ stake: sentStake }) }]);
    n++;
  };
  return { db, add };
}

test("the mode parameter only accepts live and sim; anything else means all", () => {
  assert.equal(parsePickMode("live"), "live");
  assert.equal(parsePickMode("sim"), "sim");
  assert.equal(parsePickMode("LIVE"), "all");
  assert.equal(parsePickMode(null), "all");
});

test("Win/Loss splits into live (sent) and simulation (not sent) picks", () => {
  const { db, add } = setup();
  add(LIVE, "hit", 4);   // live: +£8 (4 at 3.00)
  add(LIVE, "miss", 4);  // live: -£4
  add(SIM, "hit", null); // sim:  +£4 (2 at 3.00)
  add(SIM, "miss", null); // sim: -£2

  const all = computeWinLoss(db, new Date(), "all");
  const live = computeWinLoss(db, new Date(), "live");
  const sim = computeWinLoss(db, new Date(), "sim");

  assert.equal(live.mode, "live");
  assert.equal(live.periods.d1.total, 4);
  assert.equal(sim.periods.d1.total, 2);
  assert.equal(all.periods.d1.total, 6);                                          // live + sim
  assert.equal(computeWinLoss(db).periods.d1.total, all.periods.d1.total);        // the default is unchanged

  // Each view only has lines for strategies that have picks in it...
  assert.deepEqual(live.reported.map((l) => l.label), [LIVE]);
  assert.deepEqual(sim.reported.map((l) => l.label), [SIM]);
  // ...but the stake and odds settings list always has every strategy, so none can be hidden from editing.
  assert.deepEqual(live.strategies.map((s) => s.label).sort(), [LIVE, SIM].sort());
});

test("a live strategy's picks that were never sent count as simulation", () => {
  const { db, add } = setup();
  add(LIVE, "hit", 4);    // sent
  add(LIVE, "miss", null); // e.g. held back by the stop loss: no bet was placed
  assert.equal(computeWinLoss(db, new Date(), "live").periods.d1.total, 8);
  assert.equal(computeWinLoss(db, new Date(), "sim").periods.d1.total, -2);
});

test("hit rates, the breakdown and the Strategies list split the same way", () => {
  const { db, add } = setup();
  add(LIVE, "hit", 4);
  add(LIVE, "miss", 4);
  add(SIM, "hit", null);

  assert.equal(db.hitRateStats(null, null, "live").totals.alerts, 2);
  assert.equal(db.hitRateStats(null, null, "sim").totals.alerts, 1);
  assert.equal(db.hitRateStats(null).totals.alerts, 3);

  const cellAlerts = (mode: "live" | "sim" | "all") => db.performanceCells(null, mode).reduce((sum, c) => sum + c.alerts, 0);
  assert.equal(cellAlerts("live"), 2);
  assert.equal(cellAlerts("sim"), 1);
  assert.equal(cellAlerts("all"), 3);

  const rows = Object.fromEntries(db.listStrategiesForAdmin().map((r) => [r.label, r]));
  assert.deepEqual([rows[LIVE]?.liveHits, rows[LIVE]?.liveMisses, rows[LIVE]?.simHits], [1, 1, 0]);
  assert.deepEqual([rows[SIM]?.simHits, rows[SIM]?.liveHits], [1, 0]);
  assert.equal(rows[LIVE]?.hits, 1); // the combined figures are unchanged
});
