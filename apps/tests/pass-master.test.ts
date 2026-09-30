/**
 * "Pass Master 1st half": back the favourite (the shorter live price in the alert) in Match Odds.
 * The alert text here is made up to match the usual layout; no real Pass Master alert was available.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computeWinLoss } from "../src/server/winloss";

const alert = (opts: { live?: string; pre?: string; extra?: string[] } = {}) =>
  [
    "🔔 Pass Master 1st half",
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    "Lens vs CD Lille",
    "",
    "Timer: 28'",
    "Goals: 0 - 0",
    "1X2 Pre-Match Odds:",
    opts.pre ?? "3.60 3.20 2.10",
    "1X2 Live Odds:",
    opts.live ?? "2.40 3.10 3.00",
    "Over/Under 0.50 Odds:",
    "1.85 1.95",
    ...(opts.extra ?? []),
  ].join("\n");

test("Pass Master 1st half is a favourite-to-win bet, not Over goals", () => {
  const p = parseAlert(alert());
  assert.equal(p.market, "FAVOURITE_TO_WIN");
  assert.equal(p.favourite, "home", "2.40 is shorter than 3.00 on the live line");
  assert.equal(p.sendable, true);
  assert.deepEqual(p.flags, []);
});

test("the favourite comes from the LIVE price, not the pre-match one, and can be either side", () => {
  // pre-match the away side was shorter (2.10), but live the home side is (1.80)
  assert.equal(parseAlert(alert({ live: "1.80 3.40 4.50" })).favourite, "home");
  assert.equal(parseAlert(alert({ live: "5.50 3.40 1.50" })).favourite, "away");
});

test("no favourite is picked when it can't be told, and the pick is held back", () => {
  const equal = parseAlert(alert({ live: "2.50 3.10 2.50" }));
  assert.equal(equal.favourite, null);
  assert.equal(equal.sendable, false);
  const none = parseAlert(alert().replace(/1X2 Live Odds:\n[^\n]*\n/, ""));
  assert.equal(none.favourite, null);
  assert.equal(none.sendable, false);
});

const done = (ft: string, live?: string) =>
  alert({ live, extra: ["", "⸻⸻ Match Summary ⸻⸻", "", "Half-Time Score: 0-0", `Full-Time Score: ${ft}`, "", "✅ Hit"] });

test("it is graded on the real bet: a hit only if the favourite wins, a draw loses", () => {
  // home favourite (live 2.40 v 3.00)
  assert.equal(parseAlert(done("2-1")).result, "hit");
  assert.equal(parseAlert(done("1-1")).result, "miss", "a draw loses a Match Odds bet");
  assert.equal(parseAlert(done("0-1")).result, "miss");
  // away favourite (live 5.50 v 1.50), and the alert's own tick is ignored
  const away = parseAlert(done("0-2", "5.50 3.40 1.50"));
  assert.equal(away.result, "hit");
  assert.equal(away.resultSource, "score");
  assert.equal(parseAlert(done("1-0", "5.50 3.40 1.50")).result, "miss");
});

function feedFor(text: string, tweak?: Parameters<typeof saveSendingSettings>[1]) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "pass master 1st half": 2 }, strategies: { "pass master 1st half": true }, ...tweak });
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date(Date.now() - 60_000).toISOString());
  return buildFeed(db, { markSent: false });
}

test("sent as a Match Odds bet on the favourite's team, under its own name", () => {
  const home = feedFor(alert());
  assert.equal(home.rows[0]?.provider, "Pass Master 1st half");
  assert.equal(home.rows[0]?.marketType, "MATCH_ODDS");
  assert.equal(home.rows[0]?.selectionName, "Lens");
  assert.equal(home.rows[0]?.eventName, "Lens v CD Lille");
  const away = feedFor(alert({ live: "5.50 3.40 1.50" }));
  assert.equal(away.rows[0]?.selectionName, "CD Lille");
});

test("the market code and wording can be changed, and team-name fixes apply", () => {
  const feed = feedFor(alert({ live: "5.50 3.40 1.50" }), {
    favouriteMarketType: "MATCH_ODDS_2",
    favouriteAwaySelection: "{away} to score",
    aliases: "CD Lille = Lille",
  });
  assert.equal(feed.rows[0]?.marketType, "MATCH_ODDS_2");
  assert.equal(feed.rows[0]?.selectionName, "Lille to score");
  assert.equal(feed.rows[0]?.eventName, "Lens v Lille");
});

test("an alert that can't name the favourite is skipped, not sent", () => {
  const feed = feedFor(alert({ live: "2.50 3.10 2.50" }));
  assert.equal(feed.rows.length, 0);
});

test("an earlier saved market code of NEXT_GOAL is never used", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { favouriteMarketType: "NEXT_GOAL" });
  assert.equal(getSendingSettings(db).favouriteMarketType, "MATCH_ODDS");
});

test("Win/Loss uses the favourite's live price from the alert as the odds", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { stakes: { "pass master 1st half": 10 } });
  const text = done("2-1"); // home favourite at 2.40
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date().toISOString());
  const id = db.listLivePicks(10)[0]!.id;
  db.markSent([{ id, rowJson: JSON.stringify({ stake: 10 }) }]);
  const wl = computeWinLoss(db);
  const line = wl.reported.find((l) => l.key === "pass master 1st half")!;
  assert.ok(line, "the strategy appears");
  // £10 at 2.40 = £14 profit before commission
  assert.ok(wl.periods.d1.strategies["pass master 1st half"]! > 10, String(wl.periods.d1.strategies["pass master 1st half"]));
});
