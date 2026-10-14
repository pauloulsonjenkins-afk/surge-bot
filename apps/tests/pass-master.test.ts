/**
 * "Pass Master 1st half" from 14 Oct 2026: two more goals in the match, Over (goals at the alert + 1.5), any team. The
 * Over/Under market is on Betfair for practically every match, unlike the favourite's own goals market it used before.
 * The alert text here is made up to match the usual layout.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb, RECORD_FROM } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";

const alert = (opts: { goals?: string; extra?: string[] } = {}) =>
  [
    "🔔 Pass Master 1st half",
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    "Lens vs Lille",
    "",
    "Timer: 28'",
    `Goals: ${opts.goals ?? "0 - 0"}`,
    "1X2 Live Odds:",
    "1.40 4.50 8.00",
    ...(opts.extra ?? []),
  ].join("\n");

const done = (ft: string, goals?: string) =>
  alert({ goals, extra: ["", "⸻⸻ Match Summary ⸻⸻", "", "Half-Time Score: 0-0", `Full-Time Score: ${ft}`, "", "✅ Hit"] });

test("Pass Master is two more goals: Over the goals at the alert + 1.5", () => {
  const p = parseAlert(alert());
  assert.equal(p.market, "TWO_MORE_GOALS");
  assert.equal(p.targetLine, 1.5);
  assert.equal(p.selection, "Over 1.5");
  assert.equal(p.sendable, true);
  assert.equal(parseAlert(alert({ goals: "1 - 0" })).targetLine, 2.5);
});

test("graded from the final score: two more goals by anyone wins, one is a miss whatever the alert's tick says", () => {
  assert.equal(parseAlert(done("1-1")).result, "hit", "either side's goals count");
  assert.equal(parseAlert(done("2-0")).result, "hit");
  const one = parseAlert(done("1-0"));
  assert.equal(one.result, "miss", "the favourite scored again, but only once");
  assert.equal(one.resultSource, "score");
  assert.equal(parseAlert(done("2-1", "1 - 0")).result, "hit");
  assert.equal(parseAlert(done("2-0", "1 - 0")).result, "miss");
});

test("sent as the match's Over/Under market at its line, which Betfair lists for practically every match", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "pass master 1st half": 1 }, strategies: { "pass master 1st half": true } });
  const text = alert({ goals: "1 - 0" });
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date(Date.now() - 60_000).toISOString());
  const feed = buildFeed(db, { markSent: false });
  assert.equal(feed.rows[0]?.marketType, "OVER_UNDER_25");
  assert.equal(feed.rows[0]?.selectionName, "Over 2.5 Goals");
});

test("its record starts again from the change of bet", () => {
  assert.ok(RECORD_FROM["pass master 1st half"]! >= "2026-10-14T00:00:00.000Z");
});
