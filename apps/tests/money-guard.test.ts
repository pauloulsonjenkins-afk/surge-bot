/** money-guard.ts: a loss limit that cannot bind, or a very large stake, needs the figure typed again. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { moneyProblems, unconfirmed } from "../src/server/money-guard";

test("a £45 daily loss limit on a £73 balance is refused until the figure is confirmed", () => {
  const p = moneyProblems({ dailyLossLimit: 45 }, 73.61);
  assert.equal(p.length, 1);
  assert.match(p[0]!.reason, /61%/);
  assert.equal(unconfirmed(p, undefined).length, 1);
  assert.equal(unconfirmed(p, "44").length, 1, "a different figure does not confirm");
  assert.equal(unconfirmed(p, "45").length, 0);
  assert.equal(unconfirmed(p, ["45"]).length, 0);
});

test("a limit within 20% of the balance, no limit, and an unknown balance are all accepted", () => {
  assert.deepEqual(moneyProblems({ dailyLossLimit: 14 }, 73.61), []);
  assert.deepEqual(moneyProblems({ dailyLossLimit: 0 }, 73.61), []);
  assert.deepEqual(moneyProblems({ dailyLossLimit: 500 }, null), []);
});

test("a stake above 5% of the balance, on a strategy or a slice, needs confirming; 5% itself does not", () => {
  assert.deepEqual(moneyProblems({ stakePct: { "time to fight": 5 }, segmentBets: { "ttf#a": { stakePct: 4 } } }, 70), []);
  const p = moneyProblems({ stakePct: { "time to fight": 6 }, segmentBets: { "ttf#a": { live: true, stakePct: 7.5 } } }, 70);
  assert.deepEqual(p.map((x) => x.figure), ["6", "7.5"]);
  assert.equal(unconfirmed(p, ["6"]).length, 1);
  assert.equal(unconfirmed(p, ["6", "7.5"]).length, 0);
});
