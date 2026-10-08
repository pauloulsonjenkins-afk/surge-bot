import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { saveHorseSuggestions } from "../src/server/horses";

const db = () => new EngineDb(":memory:", () => {});

test("imported picks are stored as suggestions only, never as bets", () => {
  const d = db();
  const out = saveHorseSuggestions(d, "2026-10-08", [{ horse: "  Red   Rum ", course: "ascot", odds: "5/2", raceTime: "14:35" }, { horse: "Arkle", odds: "evens" }], "test");
  assert.equal(out.length, 2);
  assert.equal(out[0]?.horse, "Red Rum");
  assert.equal(out[0]?.course, "Ascot");
  assert.equal(d.listHorseSuggestions().length, 2);
  assert.equal(d.listHorseBets().length, 0);
});

test("a re-run replaces the day's suggestions", () => {
  const d = db();
  saveHorseSuggestions(d, "2026-10-08", [{ horse: "A" }, { horse: "B" }]);
  saveHorseSuggestions(d, "2026-10-08", [{ horse: "C" }]);
  assert.deepEqual(d.listHorseSuggestions().map((s) => s.horse), ["C"]);
});

test("bad input is refused with a reason", () => {
  const d = db();
  assert.throws(() => saveHorseSuggestions(d, "tomorrow", [{ horse: "A" }]), /date/);
  assert.throws(() => saveHorseSuggestions(d, "2026-10-08", []), /No picks/);
  assert.throws(() => saveHorseSuggestions(d, "2026-10-08", [{ horse: "" }]), /no horse name/);
  assert.throws(() => saveHorseSuggestions(d, "2026-10-08", [{ horse: "A", odds: "banana" }]), /odds/);
  assert.throws(() => saveHorseSuggestions(d, "2026-10-08", Array.from({ length: 5 }, () => ({ horse: "A" }))), /four/);
});

test("every fetched pick is kept in the permanent log, and a re-run replaces only that day", () => {
  const d = db();
  saveHorseSuggestions(d, "2026-10-08", [{ horse: "A", betType: "ew", ewPlaces: 4 }, { horse: "B" }]);
  saveHorseSuggestions(d, "2026-10-09", [{ horse: "C" }]);
  saveHorseSuggestions(d, "2026-10-08", [{ horse: "D" }]);
  assert.deepEqual(d.listHorseTipLog().map((t) => `${t.day} ${t.horse}`), ["2026-10-09 C", "2026-10-08 D"]);
});

test("the log outlives the week-long suggestions", () => {
  const d = db();
  saveHorseSuggestions(d, "2026-09-01", [{ horse: "Old" }]);
  saveHorseSuggestions(d, "2026-10-08", [{ horse: "New" }]);
  assert.deepEqual(d.listHorseSuggestions().map((s) => s.horse), ["New"]);
  assert.equal(d.listHorseTipLog().length, 2);
});
