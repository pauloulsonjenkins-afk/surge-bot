import { test } from "node:test";
import assert from "node:assert/strict";
import { currentPredictions } from "../src/server/footballbin";
import { predictionFor } from "../src/lib/predictions";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const match = (home: string, away: string, kickoff: string, status = "scheduled") => ({
  home_team: home,
  away_team: away,
  kickoff_time: kickoff,
  status,
  predictions: [
    { type: "Full Time Result", value: "2:1", confidence: 75 },
    { type: "Half Time Result", value: "1:0", confidence: 75 },
    { type: "Next Goal", value: "Home,Saka", confidence: 75 },
    { type: "Corner Count", value: "6:4", confidence: 75 },
  ],
});

test("only a match that has not finished and is close to kick-off is current", () => {
  const list = currentPredictions(
    "premier_league",
    [
      match("Arsenal", "Leeds", "2026-10-10T11:30:00Z", "finished"),
      match("Chelsea", "Bournemouth", "2026-10-10T14:00:00Z"),
      match("Liverpool", "Man City", "2026-11-15T15:30:00Z"),
      match("Spurs", "Villa", "2026-11-19T15:30:00Z"),
      match("Everton", "Fulham", "2026-11-15T10:00:00Z"),
    ],
    NOW,
  );
  assert.deepEqual(list.map((p) => p.home), ["Liverpool", "Everton"], "old and finished and far-off matches are left out; one that kicked off 2 hours ago still counts");
  assert.equal(list[0]!.fullTime, "2:1");
  assert.equal(list[0]!.nextGoal, "Home,Saka");
  assert.equal(currentPredictions("premier_league", [{ home_team: "A" }], NOW).length, 0, "a match with no kick-off is left out");
});

test("a prediction is found by team names even when they are spelt a little differently", () => {
  const list = currentPredictions("premier_league", [match("Man Utd", "Tottenham", "2026-11-15T16:30:00Z")], NOW);
  assert.ok(predictionFor(list, "Man Utd", "Tottenham"), "the same names");
  assert.ok(predictionFor(list, "Man Utd FC", "Tottenham"), "one name with an extra word");
  assert.equal(predictionFor(list, "Brighton", "Wolves"), null);
  assert.equal(predictionFor(list, null, "Tottenham"), null);
});
