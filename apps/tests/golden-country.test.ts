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
