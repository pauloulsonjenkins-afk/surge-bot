/** The Strategies page's plain answer: making or losing money, real and trial never mixed (src/lib/money-verdict.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { byMoney, disagrees, ENOUGH, realTotalOf, signedGbp, sliceLine, strategyLine, verdictOf, type MoneyLine } from "../src/lib/money-verdict";

test("making or losing needs enough bets; under that it is too early, whatever the £ says", () => {
  assert.equal(verdictOf(0, 0), "none");
  assert.equal(verdictOf(-8.16, 7), "early", "a lay that lost its first 7 real bets is too early, not +59%");
  assert.equal(verdictOf(59, ENOUGH - 1), "early");
  assert.equal(verdictOf(9.72, 99), "making");
  assert.equal(verdictOf(-32.87, 113), "losing");
  assert.equal(verdictOf(0, 60), "losing", "break-even after costs is not making money");
  assert.equal(verdictOf(-0.39, 66, 66), "level", "a 1p swing around zero can't flip making and losing (GS Match Odds Fave, 21 Nov)");
  assert.equal(verdictOf(0.61, 66, 66), "level");
  assert.equal(verdictOf(5.22, 108, 150), "making", "3.5% of the money staked is clear of the band");
  assert.equal(verdictOf(-9.42, 139, 380), "losing", "Fav Pressure 2H: -2.5% of the money staked has lost real money, not break-even");
});

test("money reads with its sign, and lists run best first", () => {
  assert.equal(signedGbp(5.237), "+£5.24");
  assert.equal(signedGbp(-19.5), "−£19.50");
  assert.equal(signedGbp(0), "£0.00");
  const l = (key: string, profit: number, bets: number): MoneyLine => ({ key, name: key, profit, bets, verdict: verdictOf(profit, bets), real: { profit, bets } });
  const sorted = [l("loser", -30, 140), l("early", 3, 20), l("winner", 9, 99), l("none", 0, 0), l("winner2", 20, 60)].sort(byMoney);
  assert.deepEqual(sorted.map((x) => x.key), ["winner2", "winner", "early", "none", "loser"]);
  assert.deepEqual(realTotalOf(sorted), { profit: 2, bets: 319 });
});

test("real and trial disagree only when each is clearly one side of zero and they differ", () => {
  assert.equal(disagrees(36.79, -36.97), true, "OG 2 SHG");
  assert.equal(disagrees(-41, 6.5), true, "Dominant 0-0");
  assert.equal(disagrees(3, 4), false);
  assert.equal(disagrees(0, -5), false);
});

test("a strategy's headline is its real and trial bets together, with the split kept", () => {
  // OG 2 SHG on 21 Nov: real -36.97 over 142, trial +36.79 over 216, together +1.51 over 358.
  const og = strategyLine({ key: "OG 2 SHG", name: "OG 2 SHG" }, { live: { counted: 142, profit: -36.97, staked: 260 }, sim: { counted: 216, profit: 36.79, staked: 300 }, all: { counted: 358, profit: 1.51, staked: 560 } });
  assert.equal(og.profit, 1.51);
  assert.equal(og.bets, 358);
  assert.equal(og.verdict, "level", "about break-even on the bigger sample, not the -£37 or the +£37");
  assert.deepEqual(og.real, { profit: -36.97, bets: 142 });
  assert.deepEqual(og.trial, { profit: 36.79, bets: 216 });
  assert.equal(og.disagree, true);
  // Time to Fight: clearly losing on every measure.
  const ttf = strategyLine({ key: "t", name: "t" }, { live: { counted: 135, profit: -6.1, staked: 220 }, sim: { counted: 266, profit: -61.98, staked: 400 }, all: { counted: 419, profit: -66.96, staked: 600 } });
  assert.equal(ttf.verdict, "losing");
  assert.equal(ttf.disagree, false);
  // Without the engine's combined figure (an older engine) the two sides are added; a side with no bets is null.
  const added = strategyLine({ key: "x", name: "x" }, { live: { counted: 0, profit: 0 }, sim: { counted: 60, profit: 9, staked: 100 } });
  assert.deepEqual([added.bets, added.profit, added.real, added.verdict], [60, 9, null, "making"]);
  // The label rests on the combined bets: 7 real losses are not enough to call it, and 57 together are.
  assert.equal(strategyLine({ key: "n", name: "n" }, { live: { counted: 7, profit: -8.16 }, sim: { counted: 50, profit: 59.18 }, all: { counted: 57, profit: 51.02, staked: 100 } }).verdict, "making");
  assert.equal(strategyLine({ key: "n", name: "n" }, { live: { counted: 7, profit: -8.16 }, all: { counted: 7, profit: -8.16 } }).verdict, "early");
});

test("real bets far worse than a trial in profit are flagged, not hidden in the combined figure", () => {
  // LAY Comeback Roast on 21 Nov: real -11.27 on 11.25 laid over 7 bets, trial +59.18 over 50, combined +47.91.
  const roast = strategyLine({ key: "r", name: "r", lay: true }, { live: { counted: 7, profit: -11.27, staked: 11.25 }, sim: { counted: 50, profit: 59.18, staked: 100 }, all: { counted: 57, profit: 47.91, staked: 111.25 } });
  assert.equal(roast.realWorse, true);
  assert.equal(roast.disagree, false, "7 real bets is too few to call it a disagreement: the real-worse flag is the one that speaks");
  // OG 2 SHG's real loss is -13% of its stake over 144 bets: luck can explain that, so no flag.
  assert.equal(strategyLine({ key: "o", name: "o" }, { live: { counted: 144, profit: -34.22, staked: 264 }, sim: { counted: 216, profit: 36.79, staked: 490.5 }, all: { counted: 360, profit: 4.26, staked: 753 } }).realWorse, false);
  // A trial that isn't in profit is nothing to be suspicious of.
  assert.equal(strategyLine({ key: "t", name: "t" }, { live: { counted: 8, profit: -6, staked: 8 }, sim: { counted: 40, profit: -3, staked: 40 } }).realWorse, false);
});

test("a Golden slice betting real money shows its own real bets and nothing combined", () => {
  const s = sliceLine({ key: "Losing Team Pushing Hard#x", name: "Losing Team Push", detail: "Only: home team 1 down" }, { counted: 37, profit: 5.64, staked: 60 });
  assert.deepEqual([s.bets, s.profit, s.verdict, s.trial], [37, 5.64, "early", null]);
});
