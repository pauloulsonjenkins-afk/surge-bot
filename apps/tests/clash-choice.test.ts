/** Clash choice (inplayguru/clash-choice.ts): which of a back bet and a cancelling LAY has the better record. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseClash, recordBefore } from "../src/inplayguru/clash-choice";

test("the better record wins; thin or close records leave the first to arrive", () => {
  assert.equal(chooseClash({ bets: 100, roi: 0.05 }, { bets: 100, roi: -0.02 }).side, "back");
  assert.equal(chooseClash({ bets: 100, roi: -0.08 }, { bets: 100, roi: 0.01 }).side, "lay");
  assert.equal(chooseClash({ bets: 100, roi: 0.01 }, { bets: 100, roi: 0.02 }).side, "first", "within noise");
  assert.equal(chooseClash({ bets: 5, roi: 0.5 }, { bets: 5, roi: -0.5 }).side, "first", "too few bets");
  assert.equal(chooseClash(null, { bets: 50, roi: 0 }).side, "lay", "only the LAY has a record");
  assert.equal(chooseClash({ bets: 50, roi: 0 }, null).side, "back", "only the back bet has a record");
  assert.equal(chooseClash(null, null).side, "first");
});

test("a record only counts bets settled before the clash", () => {
  const bets = [
    { at: 1, ret: 1 },
    { at: 2, ret: -1 },
    { at: 3, ret: 1 },
    { at: 9, ret: -1 },
  ];
  assert.deepEqual(recordBefore(bets, 4), { bets: 3, roi: 1 / 3 });
  assert.equal(recordBefore(bets, 1), null);
});
