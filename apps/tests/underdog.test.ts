/**
 * The underdog strategy ("Underdog taking charge action") backs the underdog to win or draw.
 * It used to be read as an Over goals bet because its name contains "action".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";

// The alert as it arrives live (before the Match Summary is added), and the same alert after full time.
function alert(opts: { pre?: string; goals?: string; ft?: string; header?: string } = {}): string {
  const ft = opts.ft;
  return [
    `🔔 ${opts.header ?? "Underdog taking charge action"}`,
    "",
    "🇸🇻 El Salvador Apertura (8th vs 11th)",
    "Atletico Balboa vs CD Cacahuatique",
    "",
    "Timer: 63'",
    `Goals: ${opts.goals ?? "0 - 1"}`,
    "Corners: 2 - 1",
    "Momentum: 26 - 60",
    "",
    "1X2 Pre-Match Odds:",
    opts.pre ?? "2.15 3.10 3.00",
    "1X2 Live Odds:",
    "8.50 3.60 1.44",
    "Over/Under 1.50 Odds:",
    "1.62 2.20",
    ...(ft ? ["", "⸻⸻ Match Summary ⸻⸻", "", "Half-Time Score: 0-1", `Full-Time Score: ${ft}`, "", "✅ Hit"] : []),
  ].join("\n");
}

test("the underdog strategy is its own bet type, not Over goals", () => {
  const p = parseAlert(alert());
  assert.equal(p.market, "UNDERDOG_DOUBLE_CHANCE");
  assert.equal(p.underdog, "away", "the away side has the longer pre-match price (3.00 v 2.15)");
  assert.equal(p.sendable, true);
  assert.deepEqual(p.flags, []);
  // a strategy that really is Over goals is unchanged
  assert.equal(parseAlert(alert({ header: "Blistering Momentum" })).market, "NEXT_GOAL");
  assert.equal(parseAlert(alert({ header: "Action-packed OJ" })).market, "NEXT_GOAL");
});

test("the underdog is the longer price, home or away, and is flagged when it can't be told", () => {
  assert.equal(parseAlert(alert({ pre: "4.50 3.30 1.80" })).underdog, "home");
  const equal = parseAlert(alert({ pre: "2.50 3.10 2.50" }));
  assert.equal(equal.underdog, null);
  assert.equal(equal.sendable, false);
  const none = parseAlert(alert().replace(/1X2 Pre-Match Odds:\n[^\n]*\n/, ""));
  assert.equal(none.underdog, null);
  assert.equal(none.sendable, false);
  assert.ok(none.flags.some((f) => /underdog/i.test(f)));
});

test("settled: a hit unless the underdog lost", () => {
  // away underdog (your example): finished 0-2 is a win for it
  assert.equal(parseAlert(alert({ ft: "0-2" })).result, "hit");
  assert.equal(parseAlert(alert({ ft: "1-1" })).result, "hit", "a draw counts");
  const lost = parseAlert(alert({ ft: "2-1" }));
  assert.equal(lost.result, "miss");
  assert.equal(lost.resultSource, "score");
  // home underdog
  const home = { pre: "4.50 3.30 1.80" };
  assert.equal(parseAlert(alert({ ...home, ft: "1-0" })).result, "hit");
  assert.equal(parseAlert(alert({ ...home, ft: "0-1" })).result, "miss");
});

function setupFeed(text: string) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, {
    enabled: true,
    stakes: { "underdog taking charge action": 3 },
    strategies: { "underdog taking charge action": true },
  });
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date(Date.now() - 60_000).toISOString());
  return db;
}

test("sent to the betting software as a Double Chance bet on the underdog", () => {
  const away = buildFeed(setupFeed(alert()), { markSent: false });
  assert.equal(away.rows.length, 1);
  assert.equal(away.rows[0]?.marketType, "DOUBLE_CHANCE");
  assert.equal(away.rows[0]?.selectionName, "Draw or CD Cacahuatique");
  assert.equal(away.rows[0]?.eventName, "Atletico Balboa v CD Cacahuatique");
  assert.equal(away.rows[0]?.stake, 3);

  const home = buildFeed(setupFeed(alert({ pre: "4.50 3.30 1.80" })), { markSent: false });
  assert.equal(home.rows[0]?.selectionName, "Atletico Balboa or Draw");
});

test("the wording can be changed on the Sending page, and team-name fixes apply to it", () => {
  const db = setupFeed(alert());
  saveSendingSettings(db, {
    underdogAwaySelection: "{away} or Draw",
    aliases: "CD Cacahuatique = Cacahuatique",
    underdogMarketType: "DOUBLE_CHANCE",
  });
  const feed = buildFeed(db, { markSent: false });
  assert.equal(feed.rows[0]?.selectionName, "Cacahuatique or Draw");
  assert.equal(feed.rows[0]?.eventName, "Atletico Balboa v Cacahuatique");
  saveSendingSettings(db, { underdogAwaySelection: "bad;wording" }); // rejected, keeps the last good value
  assert.equal(buildFeed(db, { markSent: false }).rows[0]?.selectionName, "Cacahuatique or Draw");
});

test("stored underdog results saved as Over goals are corrected at start-up", () => {
  const db = new EngineDb(":memory:", () => {});
  const text = alert({ ft: "0-2" });
  const old = { ...parseAlert(text), market: "NEXT_GOAL" as const, selection: "Over 1.5", result: "hit" as const };
  db.upsertLivePick("chat", 1, text, old, new Date().toISOString());
  db.recomputeSettledResults(parseAlert);
  const [pick] = db.listLivePicks(10);
  assert.equal(pick?.market, "UNDERDOG_DOUBLE_CHANCE");
  assert.equal(pick?.selection, "Underdog to win or draw");
});
