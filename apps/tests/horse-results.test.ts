/**
 * Horses: results logged from Betfair after the races (server/horse-results.ts). Only the result is set; odds and
 * stakes stay as typed, and results marked by hand are never touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { listHorseBets, saveHorseDay, setHorseResult } from "../src/server/horses";
import { logHorseResults, type HorseResultsReader } from "../src/server/horse-results";
import { ukDateOf } from "../src/server/uk-time";

function reader(results: Record<string, "WINNER" | "LOSER" | "REMOVED" | null>): HorseResultsReader {
  const runners = [
    { selectionId: 1, runnerName: "Frankel" },
    { selectionId: 2, runnerName: "Sea The Stars" },
    { selectionId: 3, runnerName: "Enable" },
  ];
  return {
    horseMarkets: async () => [
      { marketId: "W1", marketType: "WIN", venue: "Newmarket", start: "s1", runners },
      { marketId: "P1", marketType: "PLACE", venue: "Newmarket", start: "s1", runners },
    ],
    runnerResult: async (m, s) => results[`${m}:${s}`] ?? null,
  };
}

test("won, placed (each-way), lost and void are logged once the race is settled; odds stay as typed", async () => {
  const db = new EngineDb(":memory:", () => {});
  const today = ukDateOf(new Date());
  saveHorseDay(db, today, [
    { rank: 1, horse: "Frankel", course: "Newmarket", stake: 5, odds: "5/2" },
    { rank: 2, horse: "Sea the stars", course: "Newmarket", stake: 2, odds: "4/1", betType: "ew", ewFraction: 4, ewPlaces: 3 },
    { rank: 3, horse: "Enable", course: "Newmarket", stake: 2, odds: "3/1" },
  ]);
  // Before the race: linked, nothing set.
  assert.equal(await logHorseResults(db, reader({})), 0);
  const after = reader({ "W1:1": "WINNER", "W1:2": "LOSER", "P1:2": "WINNER", "W1:3": "REMOVED" });
  assert.equal(await logHorseResults(db, after), 3);
  const bets = listHorseBets(db).sort((a, b) => a.rank - b.rank);
  assert.deepEqual(bets.map((b) => b.result), ["won", "placed", "void"]);
  assert.equal(bets[0]!.oddsText, "5/2");
  assert.equal(bets[0]!.odds, 3.5);
});

test("a result marked by hand is never overwritten", async () => {
  const db = new EngineDb(":memory:", () => {});
  const today = ukDateOf(new Date());
  saveHorseDay(db, today, [{ rank: 1, horse: "Frankel", course: "Newmarket", stake: 5, odds: "5/2" }]);
  await logHorseResults(db, reader({}));
  setHorseResult(db, listHorseBets(db)[0]!.id, "lost");
  assert.equal(await logHorseResults(db, reader({ "W1:1": "WINNER" })), 0);
  assert.equal(listHorseBets(db)[0]!.result, "lost");
});
