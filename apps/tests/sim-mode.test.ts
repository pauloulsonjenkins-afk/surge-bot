/**
 * Live and simulation: a pick is live when it was handed to the bet feed, and a simulation pick when it
 * wasn't. Checks that Win/Loss, the hit-rate stats, the breakdown and the Strategies list can be split
 * that way, and that "all" still gives exactly what it did before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb, parsePickMode } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { recordSimBets, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computeStrategyReturns, computeWinLoss, saveWinLossSettings } from "../src/server/winloss";

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

// ---- simulated bets recorded on arrival ----

/** Like setup(), but with recording switched on from the start, and settling done separately. */
function recording() {
  const db = new EngineDb(":memory:", () => {});
  db.setSetting("sim_recording_since", "2000-01-01T00:00:00.000Z");
  saveSendingSettings(db, { stakes: { [SIM.toLowerCase()]: 2 } });
  let n = 1;
  /** An alert arrives (in play), a simulated bet is recorded, then the result comes in. */
  const play = (result: "hit" | "miss", beforeSettle?: () => void) => {
    const inPlay = alert(SIM, n, result).split("\n⸻⸻")[0]!;
    db.upsertLivePick("chat", n, inPlay, parseAlert(inPlay), new Date().toISOString());
    recordSimBets(db);
    beforeSettle?.();
    const done = alert(SIM, n, result);
    db.upsertLivePick("chat", n, done, parseAlert(done), new Date().toISOString());
    n++;
  };
  return { db, play };
}

test("a Sim pick keeps the stake it was recorded with, even if the stake changes later", () => {
  const { db, play } = recording();
  play("hit");                                                           // recorded at £2: +£4 at 3.00
  saveSendingSettings(db, { stakes: { [SIM.toLowerCase()]: 10 } });
  assert.equal(computeWinLoss(db, new Date(), "sim").periods.d1.total, 4);
});

test("a Sim pick below the strategy's minimum odds is recorded as not placed and not priced", () => {
  const { db, play } = recording();
  saveSendingSettings(db, { minOdds: { [SIM.toLowerCase()]: 3.5 } });  // the alert price is 3.00
  play("hit");
  const wl = computeWinLoss(db, new Date(), "sim");
  assert.equal(wl.periods.d1.total, 0);
  assert.equal(wl.strategies.find((s) => s.label === SIM)?.notPlaced, 1);
});

test("the daily limit counts simulated bets too", () => {
  const { db, play } = recording();
  saveSendingSettings(db, { dailyCap: 1 });
  play("hit"); // placed: +£4
  play("hit"); // over the limit: not placed
  assert.equal(computeWinLoss(db, new Date(), "sim").periods.d1.total, 4);
});

test("the stop loss runs on a Sim strategy's own simulated results", () => {
  const { db, play } = recording();
  db.setSetting("stop_loss", JSON.stringify({ [SIM.toLowerCase()]: { lossRun: 2 } }));
  play("miss");
  play("miss"); // two losses in a row: the strategy stops for the day
  play("hit");  // would not have been placed
  assert.equal(computeWinLoss(db, new Date(), "sim").periods.d1.total, -4);
});

test("a pick from a Live strategy is left to the bet feed while it can still be sent", () => {
  const { db } = recording();
  saveSendingSettings(db, { enabled: true, stakes: { [LIVE.toLowerCase()]: 2 }, strategies: { [LIVE.toLowerCase()]: true } });
  const text = alert(LIVE, 99, "hit").split("\n⸻⸻")[0]!;
  db.upsertLivePick("chat", 99, text, parseAlert(text), new Date().toISOString());
  assert.equal(recordSimBets(db), 0);
});

test("the monthly cost comes off Live and All, but not Sim", () => {
  const { db, play } = recording();
  play("hit");
  saveWinLossSettings(db, { expenditure: { enabled: true, monthly: 50 } });
  assert.equal(computeWinLoss(db, new Date(), "sim").periods.mtd.expenditure, 0);
  assert.equal(computeWinLoss(db, new Date(), "all").periods.mtd.expenditure, 50);
});

test("strategy returns give profit per pound staked, split into live and sim", () => {
  const { db, play } = recording();
  play("hit");  // +£4 on £2
  play("miss"); // -£2 on £2
  const r = computeStrategyReturns(db)[SIM.toLowerCase()]!;
  assert.deepEqual([r.sim.staked, r.sim.profit, r.sim.roi], [4, 2, 0.5]);
  assert.equal(r.live.settled, 0);
});
