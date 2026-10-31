/** The day's horses filled from the tips and saved by the engine (horses.ts: autoFillHorseDay / autoFillHorsesOnce). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { autoFillHorseDay, autoFillHorsesOnce, saveHorseDay, saveHorseSuggestions, setHorseImportStatus, getHorseImportStatus } from "../src/server/horses";

const four = (stake: string) => [1, 2, 3, 4].map((rank) => ({ rank, horse: `Old ${rank}`, course: "Ascot", stake, odds: "2/1", betType: "win" as const }));
const tips = [
  { horse: "Red Rum", course: "Ayr", odds: "5/2", betType: "win" },
  { horse: "Arkle", course: "Kempton", odds: "evens", betType: "ew", ewPlaces: 3 },
  { horse: "Desert Orchid", course: "Ascot", odds: "7/1", betType: "win" },
  { horse: "Shergar", course: "Ayr", odds: "3.5", betType: "win" },
];

test("a day with tips is filled and saved with the last day's stakes and the tips' horses, prices and bet types", () => {
  const db = new EngineDb(":memory:", () => {});
  saveHorseDay(db, "2026-10-30", [{ rank: 1, horse: "A", course: "Ascot", stake: "5", odds: "2/1" }, { rank: 2, horse: "B", course: "Ascot", stake: "3", odds: "2/1" }, { rank: 3, horse: "C", course: "Ascot", stake: "2", odds: "2/1" }, { rank: 4, horse: "D", course: "Ascot", stake: "1", odds: "2/1" }]);
  saveHorseSuggestions(db, "2026-10-31", tips, "tips");
  const r = autoFillHorseDay(db, "2026-10-31");
  assert.equal(r.saved, 4, r.note);
  const day = db.listHorseBets().filter((b) => b.day === "2026-10-31");
  assert.deepEqual(day.map((b) => [b.rank, b.horse, b.stake, b.oddsText, b.betType]), [
    [1, "Red Rum", 5, "5/2", "win"],
    [2, "Arkle", 3, "evens", "ew"],
    [3, "Desert Orchid", 2, "7/1", "win"],
    [4, "Shergar", 1, "3.5", "win"],
  ]);
  assert.equal(day[1]!.ewPlaces, 3);
  assert.equal(day[1]!.result, "pending");
});

test("the EW Yankee is carried over only when all four selections are filled", () => {
  const db = new EngineDb(":memory:", () => {});
  saveHorseDay(db, "2026-10-30", four("2").map((e) => ({ ...e, ewFraction: 4 })), "1");
  saveHorseSuggestions(db, "2026-10-31", tips, "tips");
  autoFillHorseDay(db, "2026-10-31");
  assert.equal(db.listHorseDays().find((d) => d.day === "2026-10-31")?.yankeeStake, 1);
  const db2 = new EngineDb(":memory:", () => {});
  saveHorseDay(db2, "2026-10-30", four("2").map((e) => ({ ...e, ewFraction: 4 })), "1");
  saveHorseSuggestions(db2, "2026-10-31", tips.slice(0, 3), "tips");
  assert.equal(autoFillHorseDay(db2, "2026-10-31").saved, 3);
  assert.equal(db2.listHorseDays().find((d) => d.day === "2026-10-31")?.yankeeStake ?? null, null);
});

test("a day already started, a first-ever day, and a tip with no price are left alone or partly filled", () => {
  const db = new EngineDb(":memory:", () => {});
  saveHorseSuggestions(db, "2026-10-31", tips, "tips");
  assert.match(autoFillHorseDay(db, "2026-10-31").note, /save one day by hand first/, "nothing to copy stakes from");
  saveHorseDay(db, "2026-10-30", four("2"));
  saveHorseDay(db, "2026-10-31", [{ rank: 1, horse: "Mine", course: "Ayr", stake: "9", odds: "3/1" }]);
  assert.equal(autoFillHorseDay(db, "2026-10-31").saved, 0, "the admin's own bet is never touched");
  assert.equal(db.listHorseBets().filter((b) => b.day === "2026-10-31").length, 1);
  const db2 = new EngineDb(":memory:", () => {});
  saveHorseDay(db2, "2026-10-30", four("2"));
  saveHorseSuggestions(db2, "2026-10-31", [{ horse: "NoPrice" }, ...tips.slice(1, 3)], "tips");
  assert.equal(autoFillHorseDay(db2, "2026-10-31").saved, 2, "the tip with no price is skipped, the rest are saved");
});

test("it runs once a day and reports in the import status", () => {
  const db = new EngineDb(":memory:", () => {});
  saveHorseDay(db, "2026-10-30", four("2"));
  saveHorseSuggestions(db, "2026-10-31", tips, "tips");
  setHorseImportStatus(db, { at: new Date().toISOString(), ok: true, message: "4 tips in", day: "2026-10-31", count: 4 });
  autoFillHorsesOnce(db, "2026-10-31");
  assert.match(getHorseImportStatus(db)!.message, /4 bets saved from the tips/);
  // The admin clears a bet by hand: the engine does not put it back the same day.
  saveHorseDay(db, "2026-10-31", [{ rank: 4, stake: "", odds: "" }]);
  autoFillHorsesOnce(db, "2026-10-31");
  assert.equal(db.listHorseBets().filter((b) => b.day === "2026-10-31").length, 3);
});
