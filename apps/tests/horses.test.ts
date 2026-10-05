/**
 * Horses: the admin's daily NAP / Next best / 3rd / 4th choice bets, entered by hand. Checks odds parsing, saving a day,
 * results, and that a changed bet starts again as pending.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { cleanCourse, listHorseBets, listHorseCourses, listHorseDays, parseOdds, saveHorseDay, setHorseResult } from "../src/server/horses";

test("odds as fractions, evens or decimals", () => {
  assert.equal(parseOdds("5/2"), 3.5);
  assert.equal(parseOdds("11-10"), 2.1);
  assert.equal(parseOdds("100/30"), 4.333);
  assert.equal(parseOdds("Evens"), 2);
  assert.equal(parseOdds("evs"), 2);
  assert.equal(parseOdds("3.5"), 3.5);
  assert.equal(parseOdds("1"), null);
  assert.equal(parseOdds("abc"), null);
  assert.equal(parseOdds(""), null);
});

test("a day is saved, results are marked, and a blank row removes that choice", () => {
  const db = new EngineDb(":memory:", () => {});
  saveHorseDay(db, "2026-10-01", [
    { rank: 1, horse: "Frankel", stake: "5", odds: "5/2" },
    { rank: 2, horse: "", stake: "£2.50", odds: "evens" },
    { rank: 3, stake: "", odds: "" },
  ]);
  let bets = listHorseBets(db);
  assert.equal(bets.length, 2);
  assert.deepEqual(
    bets.map((b) => [b.rank, b.horse, b.stake, b.odds, b.oddsText, b.result]),
    [
      [1, "Frankel", 5, 3.5, "5/2", "pending"],
      [2, null, 2.5, 2, "evens", "pending"],
    ],
  );

  setHorseResult(db, bets[0]!.id, "won");
  // Saving the day again unchanged keeps the result; changing the price makes it a new, pending bet.
  saveHorseDay(db, "2026-10-01", [{ rank: 1, horse: "Frankel", stake: 5, odds: "5/2" }]);
  assert.equal(listHorseBets(db)[0]!.result, "won");
  saveHorseDay(db, "2026-10-01", [{ rank: 1, horse: "Frankel", stake: 5, odds: "3/1" }]);
  assert.equal(listHorseBets(db)[0]!.result, "pending");

  saveHorseDay(db, "2026-10-01", [{ rank: 2, stake: "", odds: "" }]);
  bets = listHorseBets(db);
  assert.deepEqual(bets.map((b) => b.rank), [1]);
});

test("each-way: terms are kept, a placed result is allowed, and changing the terms makes it a new bet", () => {
  const db = new EngineDb(":memory:", () => {});
  saveHorseDay(db, "2026-10-02", [{ rank: 1, horse: "Galopin", stake: "5", odds: "8/1", betType: "ew", ewFraction: 5, ewPlaces: "3" }]);
  const b = listHorseBets(db)[0]!;
  assert.deepEqual([b.betType, b.ewFraction, b.ewPlaces, b.odds], ["ew", 5, 3, 9]);
  setHorseResult(db, b.id, "placed");
  assert.equal(listHorseBets(db)[0]!.result, "placed");
  saveHorseDay(db, "2026-10-02", [{ rank: 1, horse: "Galopin", stake: "5", odds: "8/1", betType: "ew", ewFraction: 4, ewPlaces: 3 }]);
  assert.equal(listHorseBets(db)[0]!.result, "pending");
  assert.throws(() => saveHorseDay(db, "2026-10-02", [{ rank: 2, stake: "5", odds: "8/1", betType: "ew" }]), /each-way terms/);
});

test("an EW Yankee is saved with the day, needs all four selections, and terms on each", () => {
  const db = new EngineDb(":memory:", () => {});
  const four = [1, 2, 3, 4].map((rank) => ({ rank, stake: "2", odds: "3/1", betType: "win" as const, ewFraction: 4 }));
  saveHorseDay(db, "2026-10-03", four, "1");
  assert.deepEqual(listHorseDays(db), [{ day: "2026-10-03", yankeeStake: 1 }]);
  // A win single keeps its terms on a Yankee day (the Yankee's place part uses them).
  assert.equal(listHorseBets(db)[0]!.ewFraction, 4);
  saveHorseDay(db, "2026-10-03", four, null);
  assert.deepEqual(listHorseDays(db), []);
  assert.throws(() => saveHorseDay(db, "2026-10-04", four.slice(0, 3), "1"), /needs all four/);
  assert.throws(() => saveHorseDay(db, "2026-10-04", [{ rank: 1, stake: "2", odds: "3/1" }, ...four.slice(1)], "1"), /NAP: choose the each-way terms/);
  assert.throws(() => saveHorseDay(db, "2026-10-04", four, "abc"), /unit stake/);
});

test("mistakes are refused with a reason naming the choice", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.throws(() => saveHorseDay(db, "2026-10-01", [{ rank: 1, stake: "5", odds: "fast" }]), /NAP: enter the odds/);
  assert.throws(() => saveHorseDay(db, "2026-10-01", [{ rank: 3, stake: "x", odds: "2/1" }]), /3rd choice: enter a bet amount/);
  assert.throws(() => saveHorseDay(db, "yesterday", []), /Choose a date/);
  assert.throws(() => setHorseResult(db, 999, "won"), /No such bet/);
});

test("racecourses: tidied so one course always groups together, remembered most used first, and changing one keeps the result", () => {
  assert.equal(cleanCourse("  newton   abbot "), "Newton Abbot");
  assert.equal(cleanCourse("KEMPTON"), "Kempton");
  assert.equal(cleanCourse("bangor on dee"), "Bangor-on-Dee");
  assert.equal(cleanCourse("my local track"), "My Local Track");
  assert.equal(cleanCourse("my local TRACK", ["My Local Track"]), "My Local Track");
  assert.equal(cleanCourse(""), null);

  const db = new EngineDb(":memory:", () => {});
  saveHorseDay(db, "2026-10-01", [
    { rank: 1, course: "ascot", stake: 5, odds: "5/2" },
    { rank: 2, course: "Kempton", stake: 5, odds: "3/1" },
  ]);
  saveHorseDay(db, "2026-10-02", [{ rank: 1, course: "ASCOT", stake: 5, odds: "2/1" }]);
  assert.deepEqual(listHorseCourses(db), ["Ascot", "Kempton"]);

  const nap = listHorseBets(db).find((b) => b.day === "2026-10-02")!;
  assert.equal(nap.course, "Ascot");
  setHorseResult(db, nap.id, "won");
  saveHorseDay(db, "2026-10-02", [{ rank: 1, course: "Sandown", stake: 5, odds: "2/1" }]);
  const after = listHorseBets(db).find((b) => b.day === "2026-10-02")!;
  assert.equal(after.course, "Sandown");
  assert.equal(after.result, "won", "only a changed stake or price resets the result");
});
