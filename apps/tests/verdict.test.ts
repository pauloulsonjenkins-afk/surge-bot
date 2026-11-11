/** verdict.ts: what a set of bets can and can't say, from the likely range of its hit rate against break-even. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { roiRange, verdictOf, VERDICT_FROM } from "../src/server/verdict";
import { hitRateRange } from "../src/server/pricing";

const bets = (won: number, n: number, breakeven: number, breakevenEffective: number | null = null) => ({ counted: n, pricedRange: hitRateRange(won, n), breakeven, breakevenEffective });

test("under 100 bets is too early, whatever the figure says", () => {
  assert.equal(verdictOf(bets(20, 20, 65)), "too early", "20 wins from 20");
  assert.equal(verdictOf(bets(0, 99, 65)), "too early", "99 losses from 99");
  assert.equal(VERDICT_FROM, 100);
});

test("the whole range above break-even is probably winning; the whole range below is probably losing", () => {
  // 240 of 300 = 80%, range about 75 to 84: clear of a 65% break-even.
  assert.equal(verdictOf(bets(240, 300, 65)), "probably winning");
  // 150 of 300 = 50%, range about 44 to 56.
  assert.equal(verdictOf(bets(150, 300, 65)), "probably losing");
});

test("break-even inside the range is no clear edge: the usual answer for a small sample", () => {
  // 70 of 100 = 70%, range about 60 to 78, break-even 65: a +7% return that could be luck.
  assert.equal(verdictOf(bets(70, 100, 65)), "no clear edge");
  // The same hit rate over 1,000 bets (range about 67 to 73) is an edge.
  assert.equal(verdictOf(bets(700, 1000, 65)), "probably winning");
});

test("the break-even from what winners paid is used when known, and nothing known is no clear edge", () => {
  assert.equal(verdictOf(bets(240, 300, 65, 86)), "probably losing", "winners at short prices, losers at long ones");
  assert.equal(verdictOf({ counted: 300, pricedRange: null, breakeven: 65 }), "no clear edge");
  assert.equal(verdictOf({ counted: 300, pricedRange: { low: 70, high: 80 }, breakeven: null }), "no clear edge");
});

test("the range of the return follows the range of the hit rate", () => {
  const r = roiRange({ counted: 100, pricedRange: { low: 60, high: 78 }, breakeven: 65 });
  assert.deepEqual(r, { low: -0.077, high: 0.2 });
  assert.equal(roiRange({ counted: 100, pricedRange: null, breakeven: 65 }), null);
  assert.equal(roiRange({ counted: 100, pricedRange: { low: 60, high: 78 }, breakeven: null }), null);
});
