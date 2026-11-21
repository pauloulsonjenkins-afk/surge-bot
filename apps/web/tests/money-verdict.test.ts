/** The Strategies page's plain answer: making or losing money, real and trial never mixed (src/lib/money-verdict.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { byMoney, ENOUGH, signedGbp, totalOf, verdictOf, type MoneyLine } from "../src/lib/money-verdict";

test("making or losing needs enough bets; under that it is too early, whatever the £ says", () => {
  assert.equal(verdictOf(0, 0), "none");
  assert.equal(verdictOf(-8.16, 7), "early", "a lay that lost its first 7 real bets is too early, not +59%");
  assert.equal(verdictOf(59, ENOUGH - 1), "early");
  assert.equal(verdictOf(9.72, 99), "making");
  assert.equal(verdictOf(-32.87, 113), "losing");
  assert.equal(verdictOf(0, 60), "losing", "break-even after costs is not making money");
});

test("money reads with its sign, and lists run best first", () => {
  assert.equal(signedGbp(5.237), "+£5.24");
  assert.equal(signedGbp(-19.5), "−£19.50");
  assert.equal(signedGbp(0), "£0.00");
  const l = (key: string, profit: number, bets: number): MoneyLine => ({ key, name: key, profit, bets, verdict: verdictOf(profit, bets) });
  const sorted = [l("loser", -30, 140), l("early", 3, 20), l("winner", 9, 99), l("none", 0, 0), l("winner2", 20, 60)].sort(byMoney);
  assert.deepEqual(sorted.map((x) => x.key), ["winner2", "winner", "early", "none", "loser"]);
  assert.deepEqual(totalOf(sorted), { profit: 2, bets: 319 });
});
