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

test("a horse the tipster spelled a little differently is found in its own race only", async () => {
  const { closeRunner, editDistance } = await import("../src/server/horse-results");
  const { saveHorseSuggestions } = await import("../src/server/horses");
  assert.equal(editDistance("buccaybay", "buccabay"), 1);
  assert.equal(editDistance("mottazen", "motazzen"), 2);
  const db = new EngineDb(":memory:", () => {});
  const now = new Date();
  const today = ukDateOf(now);
  // 19:30 UK today as an ISO time (whatever the clocks are doing).
  const at = (hhmm: string) => {
    for (let m = -26 * 60; m <= 26 * 60; m++) {
      const d = new Date(Date.parse(`${today}T12:00:00Z`) + m * 60_000);
      const uk = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
      if (uk === hhmm && ukDateOf(d) === today) return d.toISOString();
    }
    throw new Error("no such time");
  };
  const markets = [
    { marketId: "W1", marketType: "WIN", venue: "Kempton", start: at("19:30"), runners: [{ selectionId: 1, runnerName: "Buccabay" }, { selectionId: 2, runnerName: "Other One" }] },
    { marketId: "P1", marketType: "PLACE", venue: "Kempton", start: at("19:30"), runners: [{ selectionId: 1, runnerName: "Buccabay" }, { selectionId: 2, runnerName: "Other One" }] },
    // Another race at the same course with a name as close: not the tip's race, so not taken.
    { marketId: "W2", marketType: "WIN", venue: "Kempton", start: at("20:00"), runners: [{ selectionId: 9, runnerName: "Buccaybey" }] },
  ];
  assert.equal(closeRunner(markets, "Buccaybay", "Kempton", "19:30")?.runner.runnerName, "Buccabay");
  assert.equal(closeRunner(markets, "Buccaybay", "Kempton", null), null, "without the race time two races are as close: left alone");
  assert.equal(closeRunner(markets, "Something Else", "Kempton", "19:30"), null);

  saveHorseSuggestions(db, today, [{ horse: "Buccaybay", course: "Kempton", raceTime: "19:30", odds: "5/1", betType: "ew", ewPlaces: 3 }]);
  saveHorseDay(db, today, [{ rank: 1, horse: "Buccaybay", course: "Kempton", stake: 2, odds: "5/1", betType: "ew", ewFraction: 4, ewPlaces: 3 }]);
  const r: HorseResultsReader = {
    horseMarkets: async () => markets,
    runnerResult: async (m, s) => (m === "W1" && s === 1 ? "LOSER" : m === "P1" && s === 1 ? "WINNER" : null),
  };
  assert.equal(await logHorseResults(db, r, new Date(Date.parse(at("19:30")) + 10 * 60_000)), 1);
  assert.equal(listHorseBets(db)[0]!.result, "placed");
});

test("a win bet whose horse placed is logged as placed (its single still loses; a Yankee's place part counts it)", async () => {
  const db = new EngineDb(":memory:", () => {});
  const today = ukDateOf(new Date());
  saveHorseDay(db, today, [
    { rank: 1, horse: "Frankel", course: "Newmarket", stake: 5, odds: "5/2", ewFraction: 4 },
    { rank: 2, horse: "Sea the stars", course: "Newmarket", stake: 2, odds: "4/1", ewFraction: 4 },
  ]);
  await logHorseResults(db, reader({}));
  assert.equal(await logHorseResults(db, reader({ "W1:1": "LOSER", "P1:1": "WINNER", "W1:2": "LOSER", "P1:2": "LOSER" })), 2);
  const bets = listHorseBets(db).sort((a, b) => a.rank - b.rank);
  assert.deepEqual(bets.map((b) => [b.betType, b.result]), [["win", "placed"], ["win", "lost"]]);
});
