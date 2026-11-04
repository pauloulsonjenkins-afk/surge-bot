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

import { applyMyBet, myBetWords, recordTipByHand } from "../src/tips/track";
import { computeStrategyReturns } from "../src/server/winloss";

const unclear = (db: EngineDb, id = 7) =>
  recordTip(db, { chatKey: "-1001", messageId: id, date: Math.floor(Date.now() / 1000), text: "FREEBIE IS LIVE\nAjax vs PSV\nBig one today, 1st half goals!", channel: "Free tips" });

test("the owner's bet words: teams, draw, both teams to score and goal lines; a team needs a match", () => {
  assert.deepEqual(myBetWords("Ajax v PSV", { kind: "home" }), { words: "Ajax to win", tracked: true });
  assert.deepEqual(myBetWords("Ajax v PSV", { kind: "away" }), { words: "PSV to win", tracked: true });
  assert.deepEqual(myBetWords("Ajax v PSV", { kind: "over", line: 2.5 }), { words: "Over 2.5 goals", tracked: true });
  assert.deepEqual(myBetWords(null, { kind: "btts-no" }), { words: "Both teams to score: No", tracked: true });
  assert.deepEqual(myBetWords("Ajax v PSV", { kind: "other", text: " 1st half over 0.5 " }), { words: "1st half over 0.5", tracked: false });
  assert.ok("error" in myBetWords(null, { kind: "home" }));
  assert.ok("error" in myBetWords("Ajax v PSV", { kind: "over", line: 2 }));
  // What it says reads back as the bet it means.
  for (const [bet, name] of [[{ kind: "home" }, "home"], [{ kind: "away" }, "away"], [{ kind: "draw" }, "draw"]] as const) {
    const w = myBetWords("Ajax v PSV", bet) as { words: string };
    assert.equal((readTipBet(w.words, "", "Ajax", "PSV") as { selectionName: string }).selectionName, name);
  }
});

test("saying the bet puts the tip back in the queue to be priced from Betfair, read on its own, not with the post's wording", async () => {
  const db = new EngineDb(":memory:", () => {});
  unclear(db);
  db.setChannelTipReview("-1001", 7, "tip"); // taken as a tip, but its wording (1st half) can't be tracked
  assert.equal(await trackTips(db, reader()), 0);
  assert.match(db.listChannelTips("1970-01-01T00:00:00.000Z")[0]!.tracked ?? "", /^no:/);
  assert.equal(applyMyBet(db, { chatKey: "-1001", messageId: 7, bet: { kind: "over", line: 0.5 } }), null);
  const t = db.listChannelTips("1970-01-01T00:00:00.000Z")[0]!;
  assert.equal(t.myBet, "Over 0.5 goals");
  assert.equal(t.review, "tip");
  assert.equal(t.tracked, null);
  assert.equal(await trackTips(db, reader()), 1, "now priced and recorded");
  assert.equal(db.listOpenEdgePicks()[0]!.detail.selection, "Over 0.5 goals");
  assert.match(applyMyBet(db, { chatKey: "-1001", messageId: 7, bet: { kind: "under", line: 0.5 } })!, /already recorded/);
});

test("a bet the system can't price is recorded by hand: counts in the channel's Sim record at the odds given; no double entry", () => {
  const db = new EngineDb(":memory:", () => {});
  unclear(db);
  assert.match(applyMyBet(db, { chatKey: "-1001", messageId: 7, bet: { kind: "other", text: "1st half over 0.5" }, odds: 1.8 })!, /how it ended/);
  assert.match(applyMyBet(db, { chatKey: "-1001", messageId: 7, bet: { kind: "other", text: "1st half over 0.5" }, result: "won", odds: 1 })!, /decimal/);
  assert.equal(applyMyBet(db, { chatKey: "-1001", messageId: 7, bet: { kind: "other", text: "1st half over 0.5" }, result: "won", odds: 1.8 }), null);
  const t = db.listChannelTips("1970-01-01T00:00:00.000Z")[0]!;
  assert.equal(t.tracked, "done");
  assert.equal(t.review, "tip");
  const sim = computeStrategyReturns(db)["telegram: free tips"]!.sim;
  assert.equal(sim.counted, 1);
  assert.equal(sim.hits, 1);
  assert.ok(sim.profit > 0, "a win at 1.8 makes money");
  assert.match(applyMyBet(db, { chatKey: "-1001", messageId: 7, bet: { kind: "other", text: "x" }, result: "lost", odds: 2 })!, /already recorded/);
  // A tip that is a loss by hand.
  unclear(db, 8);
  assert.equal(recordTipByHand(db, { chatKey: "-1001", messageId: 8, channel: "Free tips", postedAt: new Date().toISOString(), match: "Ajax v PSV" }, { words: "Corners", odds: 2, result: "lost" }).ok, true);
  assert.equal(computeStrategyReturns(db)["telegram: free tips"]!.sim.counted, 2);
});
