import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { fetchGoalTimes, goalTimesUsage, goalsForPick, goalsFrom, linkPicks, MAX_CALLS_PER_DAY } from "../src/fixtures/goal-times";
import { pickDetail } from "../src/server/pick-detail";
import { ukDateOf } from "../src/fixtures/daily-pull";

test("goals: sides from the team, own goals put right by the final score, missed penalties left out", () => {
  const g = goalsFrom(
    [
      { type: "Goal", detail: "Normal Goal", time: { elapsed: 12 }, team: { id: 1 } },
      { type: "Goal", detail: "Missed Penalty", time: { elapsed: 30 }, team: { id: 2 } },
      { type: "Goal", detail: "Own Goal", time: { elapsed: 70 }, team: { id: 1 } },
      { type: "Card", detail: "Yellow Card", time: { elapsed: 40 }, team: { id: 2 } },
    ],
    1,
    { home: 1, away: 1 },
  );
  assert.deepEqual(g.map((x) => [x.minute, x.side, x.kind]), [[12, "home", "goal"], [70, "away", "own goal"]]);
});

function alert(n: number): string {
  return ["🔔 Late goal hunter", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Lens vs Lille`, "", "Timer: 60'", "Goals: 0 - 0", "Momentum: 70 - 30", "Shots On Target: 4 - 1", "Over/Under 0.50 Odds:", "2.00 1.80"].join("\n") + "\n".repeat(n % 2);
}

test("alerts link to their fixture, goals are fetched within the daily cap, and the detail shows goals after the alert", async () => {
  const db = new EngineDb(":memory:", () => {});
  const now = new Date();
  const alertAt = new Date(now.getTime() - 4 * 3_600_000);
  const ko = alertAt.getTime() - 75 * 60_000;
  db.replaceScheduleDay(ukDateOf(new Date(ko)), [
    { id: 777, kickoff: new Date(ko).toISOString(), timestamp: Math.floor(ko / 1000), status: "NS", statusLong: "", leagueId: 61, league: "Ligue 1", country: "France", round: null, home: "Lens", away: "Lille", venue: null },
  ], now.toISOString());
  db.upsertLivePick("c", 1, alert(1), parseAlert(alert(1)), alertAt.toISOString(), alertAt.toISOString());
  const id = db.listLivePicks(5)[0]!.id;
  assert.equal(linkPicks(db, now), 1);

  let calls = 0;
  const fake = (async () => {
    calls++;
    return new Response(
      JSON.stringify({ response: [{ fixture: { id: 777, status: { short: "FT" } }, teams: { home: { id: 1 } }, goals: { home: 1, away: 0 }, events: [{ type: "Goal", detail: "Normal Goal", time: { elapsed: 71 }, team: { id: 1 } }] }] }),
      { headers: { "x-ratelimit-requests-remaining": "90" } },
    );
  }) as typeof fetch;
  assert.equal(await fetchGoalTimes(db, "k", now, fake), 1);
  assert.equal(await fetchGoalTimes(db, "k", now, fake), 0, "a finished match isn't fetched again");
  assert.equal(goalsForPick(db, id).goals?.[0]?.minute, 71);
  const d = pickDetail(db, id, now)!;
  assert.equal(d.goals?.[0]?.afterAlert, true);
  assert.ok(d.stats.some((s) => s.label === "Momentum" && s.home === 70));

  // The cap: once the day's calls are used, nothing more is fetched.
  db.setSetting("goal_times_usage", JSON.stringify({ day: ukDateOf(now), calls: MAX_CALLS_PER_DAY, remaining: 90 }));
  db.sqlite.exec(`DELETE FROM fixture_goals`);
  assert.equal(await fetchGoalTimes(db, "k", now, fake), 0);
  // And none when API-Football says few calls are left today.
  db.setSetting("goal_times_usage", JSON.stringify({ day: ukDateOf(now), calls: 0, remaining: 39 }));
  assert.equal(await fetchGoalTimes(db, "k", now, fake), 0);
  assert.equal(calls, 1);
  assert.equal(goalTimesUsage(db, now).calls, 0);
});
