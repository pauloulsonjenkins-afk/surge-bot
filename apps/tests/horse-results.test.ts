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

test("each result is looked for from 5 minutes after its race's off until it's in; a bet not found is tried again 10 minutes on", async () => {
  const db = new EngineDb(":memory:", () => {});
  const now = new Date();
  const today = ukDateOf(now);
  const at = (min: number) => new Date(now.getTime() + min * 60_000);
  saveHorseDay(db, today, [
    { rank: 1, horse: "Frankel", course: "Newmarket", stake: 5, odds: "5/2" },
    { rank: 2, horse: "Dancing Brave", course: "Newmarket", stake: 2, odds: "4/1" },
  ]);
  const asked: string[] = [];
  let listed = 0;
  let result: "WINNER" | null = null;
  const runners = [{ selectionId: 1, runnerName: "Frankel" }];
  const r: HorseResultsReader = {
    horseMarkets: async () => {
      listed++;
      return [{ marketId: "W1", marketType: "WIN", venue: "Newmarket", start: at(30).toISOString(), runners }];
    },
    runnerResult: async (m, s) => {
      asked.push(`${m}:${s}`);
      return result;
    },
  };
  // Race off in 30 minutes: linked now, its result not asked for.
  assert.equal(await logHorseResults(db, r, now), 0);
  assert.deepEqual(asked, []);
  // Dancing Brave isn't in Betfair's list: not looked up again within 10 minutes.
  await logHorseResults(db, r, at(5));
  assert.equal(listed, 1);
  await logHorseResults(db, r, at(11));
  assert.equal(listed, 2);
  // Off at +30; asked from 5 minutes after, and again on each pass until Betfair has the result.
  assert.equal(await logHorseResults(db, r, at(34)), 0);
  assert.deepEqual(asked, []);
  result = null;
  assert.equal(await logHorseResults(db, r, at(36)), 0);
  assert.equal(await logHorseResults(db, r, at(39)), 0);
  result = "WINNER";
  assert.equal(await logHorseResults(db, r, at(42)), 1);
  assert.deepEqual(asked, ["W1:1", "W1:1", "W1:1"]);
  assert.equal(listHorseBets(db).find((b) => b.horse === "Frankel")!.result, "won");
});
