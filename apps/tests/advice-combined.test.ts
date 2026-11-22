/** "Move to combined" (22 Nov 2026): a strategy isn't put back to Sim for a bad real run when real and trial together are fine. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { combinedHoldsUp, COMBINED_FROM } from "../src/server/strategy-advice";

const fine = { all: { counted: 90, roi: 0.02 } };

const r = (live: { counted: number; profit: number; staked: number }, simProfit: number, all: { counted: number; roi: number | null }) => ({ live, sim: { profit: simProfit }, all });

test("OG 2 SHG: real -£34 over 144 bets, trial +£37 over 216, together about break-even: it holds", () => {
  assert.equal(combinedHoldsUp(r({ counted: 144, profit: -34.22, staked: 264 }, 36.79, { counted: 360, roi: 4.26 / 753 }), fine), true);
});

test("Fav Pressure 2nd half: losing real and trial together (-3.1% over 231 bets): not held, the cut stands", () => {
  assert.equal(combinedHoldsUp(r({ counted: 139, profit: -9.42, staked: 432.77 }, -8.8, { counted: 231, roi: -18.71 / 597.55 }), fine), false);
});

test("a strategy right at the edge: -1% is still break-even, -1.5% is not", () => {
  assert.equal(combinedHoldsUp(r({ counted: 100, profit: -5, staked: 100 }, 0, { counted: 200, roi: -0.0099 }), fine), true);
  assert.equal(combinedHoldsUp(r({ counted: 100, profit: -5, staked: 100 }, 0, { counted: 200, roi: -0.015 }), fine), false);
});

test("too few combined bets, or no figure, can't hold it", () => {
  assert.equal(combinedHoldsUp(r({ counted: 30, profit: -1, staked: 30 }, 5, { counted: COMBINED_FROM - 1, roi: 0.1 }), fine), false);
  assert.equal(combinedHoldsUp(r({ counted: 100, profit: -1, staked: 100 }, 5, { counted: 150, roi: null }), fine), false);
});

test("real bets far worse than a trial in profit: the combined figure isn't trusted (LAY Comeback Roast)", () => {
  // Real 0 from 7: -11.27 on 11.25 laid; trial +59.18 over 50; together +47.91 over 57 (+43%).
  assert.equal(combinedHoldsUp(r({ counted: 7, profit: -11.27, staked: 11.25 }, 59.18, { counted: 57, roi: 47.91 / 111.25 }), fine), false);
  // The same real loss rate over 4 bets is too few to be suspicious.
  assert.equal(combinedHoldsUp(r({ counted: 4, profit: -4, staked: 4 }, 59.18, { counted: 54, roi: 0.4 }), fine), true);
});

test("a strong overall record doesn't hold a strategy that has turned: the last 30 days must be fine too", () => {
  const strong = r({ counted: 144, profit: -34, staked: 264 }, 36, { counted: 360, roi: 0.05 });
  assert.equal(combinedHoldsUp(strong, { all: { counted: 60, roi: -0.12 } }), false, "last 30 days clearly negative");
  assert.equal(combinedHoldsUp(strong, { all: { counted: 20, roi: 0.3 } }), false, "too few bets in the last 30 days to vouch for it");
  assert.equal(combinedHoldsUp(strong, null), false);
  assert.equal(combinedHoldsUp(strong, { all: { counted: 60, roi: -0.005 } }), true);
});
