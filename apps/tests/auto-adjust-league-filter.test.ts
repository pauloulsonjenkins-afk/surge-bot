/** A slice put on real money gets a skip-red-leagues filter only when the walk-forward backtest says it has paid (auto-adjust.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { leagueFilterFor, LEAGUE_FILTER } from "../src/server/auto-adjust";

const bt = (off: number | null, notRed: number | null, n: number, greenOnly: number | null = null) => ({ off: { n: 200, roi: off }, notRed: { n, roi: notRed }, greenOnly: { n: 60, roi: greenOnly } });

test("notRed is set when it beat no filter by a point or more over enough picks", () => {
  assert.equal(leagueFilterFor(bt(-0.02, 0.01, 150)), "notRed");
  assert.equal(leagueFilterFor(bt(0.03, 0.04, LEAGUE_FILTER.minPicks)), "notRed");
});

test("not set when the gain is too small, the picks too few, or there is no backtest", () => {
  assert.equal(leagueFilterFor(bt(0.03, 0.035, 150)), null, "half a point is noise");
  assert.equal(leagueFilterFor(bt(-0.05, 0.1, LEAGUE_FILTER.minPicks - 1)), null, "too few picks");
  assert.equal(leagueFilterFor(bt(null, 0.1, 150)), null);
  assert.equal(leagueFilterFor(bt(0.01, null, 150)), null);
  assert.equal(leagueFilterFor(null), null);
  assert.equal(leagueFilterFor(undefined), null);
});

test("greenOnly is never chosen automatically, however well it did", () => {
  assert.equal(leagueFilterFor(bt(-0.1, -0.1, 150, 0.5)), null);
});
