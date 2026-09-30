/**
 * "First Half Goal": a PRE-MATCH alert ("Kickoff: In 1 hour", no timer, no score) backing Over 0.5 goals in the first half.
 * The alert text below is a real one (Bolivia Copa Division Profesional).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";

const ALERT = [
  "🔔 First Half Goal",
  "",
  "🇧🇴 Bolivia Copa Division Profesional ",
  "Real Tomayapo vs Nacional Potosi",
  "🟩🟥🟥🟥🟩 - 🟩🟥🟨🟥🟩",
  "",
  "⌛ Kickoff: In 1 hour",
  "",
  "",
  "Goals Scored Avg. (Last 5): 1.2 - 2.8",
  "Corners For Avg. (Last 5): 5.6 - 4.2",
  "",
  "1X2 Pre-Match Odds:",
  "2.45 3.60 2.30",
  "Over/Under 0.50 Odds:",
  "1.03 17.00",
  "",
  "🎯 Strike Rate: 60%",
].join("\n");

const settled = (ht: string, ft: string, tick = "✅ Hit") =>
  [ALERT, "", "⸻⸻ Match Summary ⸻⸻", "", `Half-Time Score: ${ht}`, `Full-Time Score: ${ft}`, "", tick].join("\n");

test("the real alert is read as a pre-match First Half Goal bet and is sendable", () => {
  const p = parseAlert(ALERT);
  assert.equal(p.strategyRaw, "First Half Goal");
  assert.equal(p.market, "FIRST_HALF_GOALS");
  assert.equal(p.selection, "Over 0.5 first-half goals");
  assert.equal(p.targetLine, 0.5);
  assert.equal(p.kickoffRaw, "In 1 hour");
  assert.equal(p.home, "Real Tomayapo");
  assert.equal(p.away, "Nacional Potosi");
  assert.equal(p.competition, "Bolivia Copa Division Profesional");
  assert.equal(p.country, "Bolivia");
  assert.equal(p.strikeRate, 60);
  assert.deepEqual(p.flags, []);
  assert.equal(p.sendable, true);
});

test("other strategies are unaffected, and still need a timer and a score", () => {
  assert.equal(parseAlert(ALERT.replace("First Half Goal", "Blistering Momentum")).market, "NEXT_GOAL");
  assert.ok(parseAlert(ALERT.replace("First Half Goal", "Blistering Momentum")).flags.length > 0);
  assert.equal(parseAlert(ALERT.replace("First Half Goal", "Pass Master 1st half")).market, "FAVOURITE_TO_WIN");
});

test("the full-match Over/Under 0.5 price in the alert is not mistaken for the first-half price", () => {
  const p = parseAlert(ALERT);
  assert.equal(p.odds.over, 1.03);
  assert.equal(p.odds.overUnderLine, 0.5);
  // nothing in the pick claims a first-half price
  assert.equal(p.selection?.includes("1.03"), false);
});

test("a pick that has already started, or has a goal, or no kickoff line, is held back", () => {
  const live = parseAlert(ALERT.replace("⌛ Kickoff: In 1 hour", "Timer: 12'\nGoals: 0 - 0"));
  assert.equal(live.sendable, false);
  assert.ok(live.flags.some((f) => /already under way/i.test(f)));
  const goal = parseAlert(ALERT.replace("⌛ Kickoff: In 1 hour", "Timer: 12'\nGoals: 1 - 0"));
  assert.equal(goal.sendable, false);
  assert.ok(goal.flags.some((f) => /goal has already been scored/i.test(f)));
  const noKick = parseAlert(ALERT.replace("⌛ Kickoff: In 1 hour\n", ""));
  assert.equal(noKick.sendable, false);
  assert.ok(noKick.flags.some((f) => /Kickoff/i.test(f)));
});

test("it is graded on the half-time score: a goal before the break wins, 0-0 at the break loses", () => {
  assert.equal(parseAlert(settled("1-0", "1-0")).result, "hit");
  assert.equal(parseAlert(settled("0-1", "0-3")).result, "hit");
  // goals only in the second half: the bet lost, whatever the alert's own tick says
  const late = parseAlert(settled("0-0", "2-1", "✅ Hit"));
  assert.equal(late.result, "miss");
  assert.equal(late.resultSource, "score");
  assert.equal(parseAlert(settled("0-0", "0-0", "❌ Miss")).result, "miss");
  assert.equal(parseAlert(settled("0-0", "0-0")).sendable, false, "settled picks are never sent");
});

test("it is handed to the betting software as Over 0.5 first-half goals under its own name", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "first half goal": 2 }, strategies: { "first half goal": true } });
  db.upsertLivePick("chat", 1, ALERT, parseAlert(ALERT), new Date(Date.now() - 60_000).toISOString());
  const feed = buildFeed(db, { markSent: false });
  assert.equal(feed.rows.length, 1);
  assert.equal(feed.rows[0]?.provider, "First Half Goal");
  assert.equal(feed.rows[0]?.marketType, "FIRST_HALF_GOALS_05");
  assert.equal(feed.rows[0]?.selectionName, "Over 0.5 Goals");
  assert.equal(feed.rows[0]?.eventName, "Real Tomayapo v Nacional Potosi");
  assert.equal(feed.rows[0]?.stake, 2);
});

test("the market code and wording can be changed, and team-name fixes apply", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, {
    enabled: true,
    stakes: { "first half goal": 2 },
    strategies: { "first half goal": true },
    firstHalfGoalsMarketType: "FIRST_HALF_GOALS_0_5",
    firstHalfGoalsSelection: "Over 0.5 Goals",
    aliases: "Nacional Potosi = Nacional Potosí",
  });
  db.upsertLivePick("chat", 1, ALERT, parseAlert(ALERT), new Date(Date.now() - 60_000).toISOString());
  const feed = buildFeed(db, { markSent: false });
  assert.equal(feed.rows[0]?.marketType, "FIRST_HALF_GOALS_0_5");
  assert.equal(feed.rows[0]?.eventName, "Real Tomayapo v Nacional Potosí");
  // a bad value is ignored and the safe default kept
  saveSendingSettings(db, { firstHalfGoalsSelection: "Over; drop table" });
  assert.equal(getSendingSettings(db).firstHalfGoalsSelection, "Over 0.5 Goals");
});

test("an alert that has gone stale before it is fetched is not sent", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "first half goal": 2 }, strategies: { "first half goal": true } });
  db.upsertLivePick("chat", 1, ALERT, parseAlert(ALERT), new Date(Date.now() - 30 * 60_000).toISOString());
  assert.equal(buildFeed(db, { markSent: false }).rows.length, 0);
});
