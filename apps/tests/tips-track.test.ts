/** Telegram tips as a strategy (tips/track.ts): the bet is read, priced on Betfair, recorded in Sim and settled. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { readTipBet, trackTips, tipsStrategy } from "../src/tips/track";
import { recordTip } from "../src/tips/reader";
import { settleValuePicks } from "../src/edge/value-strategy";

test("goals, both teams to score and a team to win are read; the rest are not tracked", () => {
  assert.deepEqual(readTipBet("Over 2.5 goals", "", "Ajax", "PSV"), { marketType: "OVER_UNDER_25", selectionName: "Over 2.5 Goals", words: "Over 2.5 goals" });
  assert.equal((readTipBet("BTTS - No", "", "Ajax", "PSV") as { selectionName: string }).selectionName, "No");
  assert.equal((readTipBet("Ajax to win", "", "Ajax", "PSV") as { selectionName: string }).selectionName, "home");
  assert.equal((readTipBet("PSV to win", "", "Ajax", "PSV") as { selectionName: string }).selectionName, "away");
  assert.ok("reason" in readTipBet("Over 9.5 corners", "", "Ajax", "PSV"));
  assert.ok("reason" in readTipBet("Ajax or draw", "", "Ajax", "PSV"));
  assert.ok("reason" in readTipBet("Something odd", "", "Ajax", "PSV"));
});

const kickoff = new Date(Date.now() + 3 * 3_600_000).toISOString();
const reader = (price: number | null = 1.9) => ({
  searchEvents: async () => [{ id: "e1", name: "Ajax v PSV", openDate: kickoff }],
  checkBet: async () => ({ status: "ok" as const, price, runners: [], marketId: "1.23", selectionId: 55 }),
});

function seed(db: EngineDb) {
  recordTip(db, { chatKey: "-1001", messageId: 5, date: Math.floor(Date.now() / 1000), text: "Tip: Over 2.5 goals\nAjax vs PSV @ 1.80", channel: "Free tips" });
}

test("a tip is recorded once as a Sim pick, at Betfair's price, and settles from Betfair's result", async () => {
  const db = new EngineDb(":memory:", () => {});
  seed(db);
  assert.equal(await trackTips(db, reader()), 1);
  assert.equal(await trackTips(db, reader()), 0, "not added twice");
  const open = db.listOpenEdgePicks();
  assert.equal(open.length, 1);
  assert.equal(open[0]!.detail.strategyRaw, "Telegram: Free tips");
  assert.equal(tipsStrategy("CVPICKS 🟢💰 Free Betting Club"), "Telegram: CVPICKS Free Betting Club", "emoji dropped from the name");
  assert.equal(db.listChannelTips("1970-01-01T00:00:00.000Z")[0]!.tracked, "done");
  const later = new Date(Date.parse(kickoff) + 3 * 3_600_000);
  assert.equal(await settleValuePicks(db, { runnerResult: async () => "WINNER" }, later), 1);
  assert.equal(db.listOpenEdgePicks().length, 0);
});

test("a tip with no price yet is tried again; one that can't be tracked says why", async () => {
  const db = new EngineDb(":memory:", () => {});
  seed(db);
  assert.equal(await trackTips(db, reader(null)), 0);
  assert.equal(db.listChannelTips("1970-01-01T00:00:00.000Z")[0]!.tracked, null, "still waiting");
  const db2 = new EngineDb(":memory:", () => {});
  recordTip(db2, { chatKey: "-1001", messageId: 6, date: Math.floor(Date.now() / 1000), text: "Tip: Over 9.5 corners\nAjax vs PSV @ 1.80", channel: "Free tips" });
  db2.setChannelTipReview("-1001", 6, "tip");
  await trackTips(db2, reader());
  assert.match(db2.listChannelTips("1970-01-01T00:00:00.000Z")[0]!.tracked ?? "", /^no: Only match goals/);
});
