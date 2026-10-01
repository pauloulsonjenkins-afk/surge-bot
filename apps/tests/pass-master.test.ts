/**
 * "Pass Master 1st half": the favourite (the shorter live price in the alert) to score again before full time, i.e.
 * the favourite's own goals Over (its goals at the alert + 0.5). Until 1 Oct 2026 it was wrongly a Match Odds bet on
 * the favourite to win. The alert text here is made up to match the usual layout.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computeStrategyReturns } from "../src/server/winloss";
import { teamGoalsRunner } from "../src/betfair/exchange";

const alert = (opts: { live?: string; goals?: string; extra?: string[] } = {}) =>
  [
    "🔔 Pass Master 1st half",
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    "Lens vs CD Lille",
    "",
    "Timer: 28'",
    `Goals: ${opts.goals ?? "0 - 0"}`,
    "1X2 Pre-Match Odds:",
    "3.60 3.20 2.10",
    "1X2 Live Odds:",
    opts.live ?? "2.40 3.10 3.00",
    "Over/Under 0.50 Odds:",
    "1.85 1.95",
    ...(opts.extra ?? []),
  ].join("\n");

const done = (ft: string, opts: { live?: string; goals?: string; tick?: string } = {}) =>
  alert({ ...opts, extra: ["", "⸻⸻ Match Summary ⸻⸻", "", "Half-Time Score: 0-0", `Full-Time Score: ${ft}`, "", opts.tick ?? "✅ Hit"] });

test("Pass Master 1st half is the favourite to score again, not the favourite to win", () => {
  const p = parseAlert(alert());
  assert.equal(p.market, "FAVOURITE_TO_SCORE");
  assert.equal(p.favourite, "home", "2.40 is shorter than 3.00 on the live line");
  assert.equal(p.targetLine, 0.5, "no goals yet: the favourite needs one");
  assert.equal(p.selection, "Favourite to score (over 0.5)");
  assert.equal(p.sendable, true);
  assert.deepEqual(p.flags, []);
});

test("the line is the favourite's own goals at the alert + 0.5, whichever side it is", () => {
  // Away favourite (1.50) already on 2 goals: it needs a 3rd.
  const p = parseAlert(alert({ live: "5.50 3.40 1.50", goals: "1 - 2" }));
  assert.equal(p.favourite, "away");
  assert.equal(p.targetLine, 2.5);
});

test("no favourite is picked when it can't be told, and the pick is held back", () => {
  const equal = parseAlert(alert({ live: "2.50 3.10 2.50" }));
  assert.equal(equal.favourite, null);
  assert.equal(equal.sendable, false);
});

test("graded on the favourite scoring again by full time; a win without a new goal is a miss", () => {
  // Home favourite, 0-0 at the alert.
  assert.equal(parseAlert(done("1-1")).result, "hit", "the favourite scored: a draw doesn't matter");
  assert.equal(parseAlert(done("0-1")).result, "miss");
  // Away favourite on 2 at the alert (1-2): it needs a 3rd.
  assert.equal(parseAlert(done("1-3", { live: "5.50 3.40 1.50", goals: "1 - 2" })).result, "hit");
  const noNew = parseAlert(done("1-2", { live: "5.50 3.40 1.50", goals: "1 - 2", tick: "✅ Hit" }));
  assert.equal(noNew.result, "miss", "it won, but didn't score again");
  assert.equal(noNew.resultSource, "score");
});

function feedFor(text: string, tweak?: Parameters<typeof saveSendingSettings>[1]) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "pass master 1st half": 2 }, strategies: { "pass master 1st half": true }, ...tweak });
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date(Date.now() - 60_000).toISOString());
  return buildFeed(db, { markSent: false });
}

test("never sent as Match Odds: held back until the favourite-to-score market codes are set", () => {
  const feed = feedFor(alert());
  assert.equal(feed.rows.length, 0);
  assert.match(feed.skipped[0]!.reason, /favourite-to-score market codes/);
});

test("once the codes are set, sent as the favourite's own goals Over its line, for the right side", () => {
  const codes = { favouriteScoresHomeMarketType: "TEAM_A_OVER_UNDER_{line10}", favouriteScoresAwayMarketType: "TEAM_B_OVER_UNDER_{line10}", favouriteScoresSelection: "Over {line} Goals" };
  const home = feedFor(alert(), codes);
  assert.equal(home.rows[0]?.marketType, "TEAM_A_OVER_UNDER_05");
  assert.equal(home.rows[0]?.selectionName, "Over 0.5 Goals");
  assert.equal(home.rows[0]?.provider, "Pass Master 1st half");
  const away = feedFor(alert({ live: "5.50 3.40 1.50", goals: "1 - 2" }), { ...codes, aliases: "CD Lille = Lille" });
  assert.equal(away.rows[0]?.marketType, "TEAM_B_OVER_UNDER_25");
  assert.equal(away.rows[0]?.selectionName, "Over 2.5 Goals");
  assert.equal(away.rows[0]?.eventName, "Lens v Lille");
});

test("the favourite's goals market is found on Betfair by name, to price it", () => {
  const markets = [
    { name: "Over/Under 2.5 Goals", runners: [{ selectionId: 1, runnerName: "Over 2.5 Goals" }] },
    { name: "Lens Over/Under 0.5 Goals", runners: [{ selectionId: 2, runnerName: "Under 0.5 Goals" }, { selectionId: 3, runnerName: "Over 0.5 Goals" }] },
    { name: "CD Lille Over/Under 0.5 Goals", runners: [{ selectionId: 4, runnerName: "Over 0.5 Goals" }] },
  ];
  assert.equal(teamGoalsRunner(markets, "Lens", 0.5)?.selectionId, 3);
  assert.equal(teamGoalsRunner(markets, "CD Lille", 0.5)?.selectionId, 4);
  assert.equal(teamGoalsRunner(markets, "Lens", 1.5), null);
});

test("with no price in the alert, Win/Loss uses the assumed odds until Betfair prices come in", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { stakes: { "pass master 1st half": 10 } });
  const text = done("1-1");
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date().toISOString());
  const before = computeStrategyReturns(db)["pass master 1st half"]!.sim;
  assert.equal(before.counted, 0, "unpriced: the 1X2 price is for winning, not scoring");
});
