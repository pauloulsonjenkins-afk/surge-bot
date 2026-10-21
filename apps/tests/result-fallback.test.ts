/**
 * Results from API-Football (fixtures/result-fallback.ts): an alert InPlayGuru never sent a full-time result for is
 * settled from its match's final score, four hours after kick-off. The alert's text is kept, a re-read of the unchanged
 * alert keeps the result, and InPlayGuru's own full-time edit still replaces it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { fetchGoalTimes, linkPicks } from "../src/fixtures/goal-times";
import { halfTimeFrom, settleFromApiFootball } from "../src/fixtures/result-fallback";
import { ukDateOf } from "../src/fixtures/daily-pull";

function alert(goals: [number, number]): string {
  return ["🔔 Late goal hunter", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", "Lens vs Lille", "", "Timer: 60'", `Goals: ${goals[0]} - ${goals[1]}`, "Over/Under 0.50 Odds:", "2.00 1.80"].join("\n");
}

/** One alert linked to fixture 777, with API-Football's final score fetched. */
async function setup(alertGoals: [number, number], final: [number, number]) {
  const db = new EngineDb(":memory:", () => {});
  const now = new Date();
  const alertAt = new Date(now.getTime() - 4 * 3_600_000);
  const ko = alertAt.getTime() - 75 * 60_000;
  db.replaceScheduleDay(ukDateOf(new Date(ko)), [
    { id: 777, kickoff: new Date(ko).toISOString(), timestamp: Math.floor(ko / 1000), status: "NS", statusLong: "", leagueId: 61, league: "Ligue 1", country: "France", round: null, home: "Lens", away: "Lille", venue: null },
  ], now.toISOString());
  const text = alert(alertGoals);
  db.upsertLivePick("c", 1, text, parseAlert(text), alertAt.toISOString(), alertAt.toISOString());
  linkPicks(db, now);
  const events = Array.from({ length: final[0] }, (_, i) => ({ type: "Goal", detail: "Normal Goal", time: { elapsed: 30 + i * 30 }, team: { id: 1 } }));
  const fake = (async () =>
    new Response(JSON.stringify({ response: [{ fixture: { id: 777, status: { short: "FT" } }, teams: { home: { id: 1 } }, goals: { home: final[0], away: final[1] }, events }] }), {
      headers: { "x-ratelimit-requests-remaining": "90" },
    })) as typeof fetch;
  await fetchGoalTimes(db, "k", now, fake);
  return { db, now, ko, text };
}

test("an alert left without a result is settled from API-Football's final score, its text kept as sent", async () => {
  const { db, now, ko, text } = await setup([0, 0], [1, 0]);
  // Not before four hours from kick-off.
  assert.equal(settleFromApiFootball(db, new Date(ko + 3 * 3_600_000)), 0);
  assert.equal(settleFromApiFootball(db, now), 1);
  const p = db.listLivePicks(5)[0]!;
  assert.equal(p.ftScore, "1-0");
  assert.equal(p.result, "hit");
  assert.equal(p.rawText, text);
  // Not again.
  assert.equal(settleFromApiFootball(db, now), 0);
});

test("re-reading the unchanged alert keeps the result; InPlayGuru's own full-time edit replaces it", async () => {
  const { db, now, text } = await setup([0, 0], [1, 0]);
  settleFromApiFootball(db, now);
  db.upsertLivePick("c", 1, text, parseAlert(text));
  assert.equal(db.listLivePicks(5)[0]!.result, "hit", "a catch-up re-read doesn't wipe it");
  const edited = `${text}\n\nMatch Summary\nHalf-Time Score: 0 - 0\nFull-Time Score: 0 - 0\n❌`;
  db.upsertLivePick("c", 1, edited, parseAlert(edited));
  const p = db.listLivePicks(5)[0]!;
  assert.equal(p.ftScore, "0-0");
  assert.equal(p.result, "miss");
  // The alert's own score stays through a later re-read too.
  db.upsertLivePick("c", 1, edited, parseAlert(edited));
  assert.equal(db.listLivePicks(5)[0]!.result, "miss");
});

test("a final score below the alert's own score is another match: left alone", async () => {
  const { db, now } = await setup([2, 0], [1, 0]);
  assert.equal(settleFromApiFootball(db, now), 0);
  assert.equal(db.listLivePicks(5)[0]!.result, null);
});

test("half-time score from the goal minutes, only when they add up to the final score", () => {
  const g = (minute: number, side: "home" | "away") => ({ minute, extra: null, side, kind: "goal" as const });
  assert.equal(halfTimeFrom([g(10, "home"), g(45, "away"), g(80, "home")], [2, 1]), "1-1");
  assert.equal(halfTimeFrom([g(10, "home")], [2, 1]), null);
});
