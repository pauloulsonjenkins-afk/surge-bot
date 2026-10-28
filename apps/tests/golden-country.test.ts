/**
 * Golden slices can leave out countries: "not Japan or Brazil" (added by hand only, never tried by the finder), and a
 * slice set up by hand may have three rule parts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { FEATURES, ruleTest, segmentsOf } from "../src/server/segments";
import { watchSegment } from "../src/server/golden";

const facts = (country: string | null) => ({
  goalsHome: 1,
  goalsAway: 1,
  stats: { "Dangerous Attacks": [40, 12] as [number, number] },
  preMatch1x2: [1.6, 3.8, 5.5] as [number, number, number],
  live1x2: null,
  minute: 60,
  country,
});

test("not Japan or Brazil: those two are out, everything else (and no country) is in", () => {
  const t = FEATURES.notJapanBrazil.test;
  assert.equal(t(facts("Japan")), false);
  assert.equal(t(facts("brazil")), false);
  assert.equal(t(facts("England")), true);
  assert.equal(t(facts(null)), true);
});

test("a hand-made slice can have three parts: level, favourite 2x dangerous attacks, not Japan or Brazil", () => {
  const db = new EngineDb(":memory:", () => {});
  watchSegment(db, "time to fight", ["favLevel", "favDa2x", "notJapanBrazil"]);
  const seg = segmentsOf("time to fight").find((s) => s.rule?.length === 3)!;
  assert.match(seg.label, /favourite level, favourite with 2× the dangerous attacks, not Japan or Brazil/);
  assert.equal(seg.test(facts("England")), true);
  assert.equal(seg.test(facts("Japan")), false);
  assert.equal(ruleTest(["favLevel", "favDa2x"])(facts("Japan")), true, "without the country part, Japan is in");
  assert.throws(() => watchSegment(db, "time to fight", ["favLevel", "favDa2x", "notJapanBrazil", "min70"]), /isn't a rule/);
});

test("the finder's new facts: the alert's price, minutes since the last goal, youth", async () => {
  const { extraFacts } = await import("../src/server/segments");
  const odds = { over: 1.72, overUnderLine: 1.5 };
  assert.deepEqual(extraFacts({ lastGoal: "Home at 66' (13 minutes ago)", minute: 79, targetLine: 1.5, odds, competition: "Spain La Liga", home: "Celta", away: "Getafe" }), { price: 1.72, sinceGoal: 13, youth: false });
  assert.deepEqual(extraFacts({ lastGoal: "None", minute: 55, targetLine: 0.5, odds, competition: "England Premier League U21", home: "A", away: "B" }), { price: null, sinceGoal: 55, youth: true });
  const f = { ...facts("England"), price: 1.25, sinceGoal: 25, youth: false, stats: { "Red Cards": [0, 1] as [number, number], xG: [1.1, 0.6] as [number, number] } };
  assert.ok(FEATURES.priceUnder130.test(f) && !FEATURES.price130to149.test(f));
  assert.ok(FEATURES.quiet20.test(f) && !FEATURES.goalLast10.test(f));
  assert.ok(FEATURES.redCard.test(f) && FEATURES.xgHigh.test(f) && FEATURES.seniorMen.test(f) && !FEATURES.youthWomen.test(f));
});

test("the 28 Oct 2026 review's rules: before 60' / 70', 0-2 goals, priced under 1.50 / 2.10+ - added by hand, never by the finder", () => {
  const at = (minute: number, goalsHome: number, goalsAway: number, price: number | null) => ({ ...facts("England"), minute, goalsHome, goalsAway, price });
  assert.equal(FEATURES.before60.test(at(59, 0, 0, 1.4)), true);
  assert.equal(FEATURES.before60.test(at(60, 0, 0, 1.4)), false);
  assert.equal(FEATURES.before70.test(at(69, 0, 0, 1.4)), true);
  assert.equal(FEATURES.before70.test(at(70, 0, 0, 1.4)), false);
  assert.equal(FEATURES.goals02.test(at(50, 1, 1, 1.4)), true);
  assert.equal(FEATURES.goals02.test(at(50, 2, 1, 1.4)), false);
  assert.equal(FEATURES.priceUnder150.test(at(50, 0, 0, 1.49)), true);
  assert.equal(FEATURES.priceUnder150.test(at(50, 0, 0, 1.5)), false);
  assert.equal(FEATURES.price210plus.test(at(50, 0, 0, 2.1)), true);
  assert.equal(FEATURES.price210plus.test(at(50, 0, 0, null)), false, "no price, not in");
  for (const f of ["before60", "before70", "goals02", "priceUnder150", "price210plus"] as const) assert.ok("manual" in FEATURES[f], `${f} is manual`);
  assert.equal(ruleTest(["before70", "goals02"])(at(65, 1, 1, 1.6)), true, "Blistering's slice");
});
