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

test("an in-play tip is recorded in Sim at the live price when read at once, but not when read late or after the match", async () => {
  const live = (openedAgoMin: number) => ({
    searchEvents: async () => [{ id: "e1", name: "Ajax v PSV", openDate: new Date(Date.now() - openedAgoMin * 60_000).toISOString() }],
    checkBet: async () => ({ status: "ok" as const, price: 1.6, runners: [], marketId: "1.23", selectionId: 55 }),
  });
  const post = (id: number, minutesAgo: number) =>
    recordTip(db, { chatKey: "-1001", messageId: id, date: Math.floor((Date.now() - minutesAgo * 60_000) / 1000), text: "Tip: Over 2.5 goals\nAjax vs PSV @ 1.80\n4th minute", channel: "Free tips" });
  const db = new EngineDb(":memory:", () => {});
  post(1, 1); // posted a minute ago, match 30 minutes in
  assert.equal(await trackTips(db, live(30)), 1);
  assert.match(db.listOpenEdgePicks()[0]!.detail.selection ?? "", /Over 2.5/);
  post(2, 20); // posted 20 minutes ago: Betfair's price by now isn't the tip's
  await trackTips(db, live(60));
  const status = (id: number) => db.listChannelTips("1970-01-01T00:00:00.000Z").find((r) => r.messageId === id)!.tracked ?? "";
  assert.match(status(2), /^no: In-play tip read more than 10 minutes/);
  post(3, 1); // posted a minute ago, but the match kicked off 5 hours ago: over
  await trackTips(db, live(300));
  assert.match(status(3), /^no: The match was already over/);
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
