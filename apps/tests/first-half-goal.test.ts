/**
 * "First Half Goal": a PRE-MATCH alert ("Kickoff: In 1 hour", no timer, no score) backing Over 0.5 goals in the first half.
 * The alert text below is a real one (Bolivia Copa Division Profesional).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { isRealAlert, kickoffMinutes, parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { pickPlacements } from "../src/betfair/exchange";

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

test("a pre-match pick stays in the feed until kick-off, not just for the 10-minute maximum age", () => {
  // The cause of First Half Goal bets never being placed: the row left the feed 10 minutes after the alert, about 50
  // minutes before kick-off, so betting software placing it any later (nearer the start, or in-play) never saw it.
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "first half goal": 2 }, strategies: { "first half goal": true }, maxAgeMinutes: 10 });
  const now = Date.now();
  // "Kickoff: In 1 hour", posted 30 minutes ago: kick-off is 30 minutes away, so it is still sent.
  db.upsertLivePick("chat", 1, ALERT, parseAlert(ALERT), new Date(now - 30 * 60_000).toISOString());
  const first = buildFeed(db, { markSent: true, now: new Date(now) });
  assert.equal(first.rows.length, 1);
  assert.equal(first.newlySent, 1);
  // Once sent it is repeated, unchanged, right up to kick-off...
  const atKickoff = buildFeed(db, { markSent: true, now: new Date(now + 29 * 60_000) });
  assert.equal(atKickoff.rows.length, 1);
  assert.equal(atKickoff.newlySent, 0);
  // ...and drops out a few minutes after it.
  assert.equal(buildFeed(db, { markSent: true, now: new Date(now + 40 * 60_000) }).rows.length, 0);
});

test("a pre-match alert that arrives after kick-off is not sent", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "first half goal": 2 }, strategies: { "first half goal": true } });
  db.upsertLivePick("chat", 1, ALERT, parseAlert(ALERT), new Date(Date.now() - 70 * 60_000).toISOString());
  assert.equal(buildFeed(db, { markSent: false }).rows.length, 0);
});

test("kick-off wording", () => {
  assert.equal(kickoffMinutes("In 1 hour"), 60);
  assert.equal(kickoffMinutes("In 2 hours"), 120);
  assert.equal(kickoffMinutes("In 45 mins"), 45);
  assert.equal(kickoffMinutes("In 1h 30m"), 90);
  assert.equal(kickoffMinutes("In half an hour"), 30);
  assert.equal(kickoffMinutes("In an hour"), 60);
  assert.equal(kickoffMinutes("Now"), 0);
  assert.equal(kickoffMinutes("Tomorrow"), null);
});

test("the Telegram listener treats it as an alert, though it has no match timer", () => {
  // The listener and its catch-up sync only store messages that pass this check. Before pre-match alerts
  // were allowed, every First Half Goal alert was dropped here as "not an alert" and never became a pick.
  assert.equal(isRealAlert(parseAlert(ALERT)), true);
  assert.equal(isRealAlert(parseAlert(settled("1-0", "1-0"))), true);
  // in-play alerts still count; messages with no teams, or with neither a timer nor a kickoff line, still don't
  assert.equal(isRealAlert(parseAlert(ALERT.replace("⌛ Kickoff: In 1 hour", "Timer: 12'\nGoals: 0 - 0"))), true);
  assert.equal(isRealAlert(parseAlert("Welcome to the channel! New alerts start tomorrow.")), false);
  assert.equal(isRealAlert(parseAlert(ALERT.replace("⌛ Kickoff: In 1 hour\n", ""))), false);
});

test("once stored it appears in the strategy lists, and a recovered alert is dated when it was posted", () => {
  const db = new EngineDb(":memory:", () => {});
  const posted = new Date(Date.now() - 2 * 24 * 3_600_000).toISOString();
  db.upsertLivePick("chat", 1, settled("1-0", "2-0"), parseAlert(settled("1-0", "2-0")), posted, posted);
  assert.deepEqual(db.listStrategiesSeen().map((s) => s.label), ["First Half Goal"]);
  assert.equal(db.listStrategiesForAdmin()[0]?.hits, 1);
  assert.equal(db.listLivePicks(10)[0]?.firstSeenAt, posted);
});

test("on Live, a sent pre-match pick isn't called 'not placed' until kick-off has passed", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "first half goal": 2 }, strategies: { "first half goal": true } });
  const now = Date.now();
  db.upsertLivePick("chat", 1, ALERT, parseAlert(ALERT), new Date(now - 60_000).toISOString());
  buildFeed(db, { markSent: true, now: new Date(now) });
  const id = db.listSentPicks()[0]!.id;
  const link = (at: number) => ({ configured: true, missing: [], lastOkAt: new Date(at).toISOString(), lastErrorAt: null, lastError: null, lastCount: 0 });
  // 20 minutes after sending, Betfair checked, no bet yet: still before kick-off.
  assert.equal(pickPlacements(db, link(now + 20 * 60_000), new Date(now + 20 * 60_000))[id]!.state, "beforeKickoff");
  // Kick-off (about an hour after the alert) and five minutes more, still nothing: not placed.
  assert.equal(pickPlacements(db, link(now + 70 * 60_000), new Date(now + 70 * 60_000))[id]!.state, "notPlaced");
});
