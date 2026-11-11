/** money-guard.ts: a loss limit that cannot bind, or a big stake on thin evidence, needs the figure typed again. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { moneyProblems, stakeCapFor, unconfirmed, type GuardInputs } from "../src/server/money-guard";

const inputs = (o: Partial<GuardInputs> & { bets?: Record<string, number> } = {}): GuardInputs => ({
  current: o.current ?? { dailyLossLimit: 10, stakePct: {}, stakes: {}, segmentBets: {} },
  balance: o.balance === undefined ? 73.61 : o.balance,
  liveBets: o.liveBets ?? ((k) => o.bets?.[k] ?? 0),
});

test("a £45 daily loss limit on a £73 balance is refused until the figure is confirmed", () => {
  const p = moneyProblems({ dailyLossLimit: 45 }, inputs());
  assert.equal(p.length, 1);
  assert.match(p[0]!.reason, /61%/);
  assert.equal(unconfirmed(p, undefined).length, 1);
  assert.equal(unconfirmed(p, "44").length, 1, "a different figure does not confirm");
  assert.equal(unconfirmed(p, "45").length, 0);
  assert.equal(unconfirmed(p, ["£45"]).length, 0, "typed with its pound sign");
});

test("a limit within 20% of the balance, no limit, an unknown balance, and the limit as it already is are accepted", () => {
  assert.deepEqual(moneyProblems({ dailyLossLimit: 14 }, inputs()), []);
  assert.deepEqual(moneyProblems({ dailyLossLimit: 0 }, inputs()), []);
  assert.deepEqual(moneyProblems({ dailyLossLimit: 500 }, inputs({ balance: null })), []);
  assert.deepEqual(moneyProblems({ dailyLossLimit: 45 }, inputs({ current: { dailyLossLimit: 45, stakePct: {}, stakes: {}, segmentBets: {} } })), [], "a page saving the old figure again");
});

test("the cap follows the evidence: 2% under 150 Live bets, 3% under 300, 5% after", () => {
  assert.equal(stakeCapFor(0), 2);
  assert.equal(stakeCapFor(149), 2);
  assert.equal(stakeCapFor(150), 3);
  assert.equal(stakeCapFor(299), 3);
  assert.equal(stakeCapFor(300), 5);
  assert.equal(stakeCapFor(null), 5);
});

test("raising a stake past its cap needs confirming; the same raise with enough bets does not", () => {
  const p = moneyProblems({ stakePct: { "Time to fight": 4 } }, inputs({ bets: { "time to fight": 19 } }));
  assert.deepEqual(p.map((x) => x.figure), ["4"]);
  assert.match(p[0]!.reason, /19 settled Live bets/);
  assert.deepEqual(moneyProblems({ stakePct: { "Time to fight": 2 } }, inputs({ bets: { "time to fight": 19 } })), []);
  assert.deepEqual(moneyProblems({ stakePct: { "Time to fight": 4 } }, inputs({ bets: { "time to fight": 320 } })), []);
  assert.deepEqual(moneyProblems({ stakePct: { "Time to fight": 6 } }, inputs({ bets: { "time to fight": 320 } })).map((x) => x.figure), ["6"]);
});

test("lowering a stake, or saving it unchanged, never asks, even when it is above the cap", () => {
  const current = { dailyLossLimit: 10, stakePct: { "time to fight": 4 }, stakes: {}, segmentBets: { "time to fight#a": { live: true, stakePct: 4, stake: null, liveSince: "2026-11-01T00:00:00Z" } } };
  assert.deepEqual(moneyProblems({ stakePct: { "time to fight": 4 } }, inputs({ current })), []);
  assert.deepEqual(moneyProblems({ stakePct: { "time to fight": 3 } }, inputs({ current })), []);
  assert.deepEqual(moneyProblems({ segmentBets: { "time to fight#a": { stakePct: 2 } } }, inputs({ current })), []);
  assert.deepEqual(moneyProblems({ segmentBets: { "time to fight#a": { stakePct: 5 } } }, inputs({ current })).map((x) => x.figure), ["5"]);
});

test("a flat stake is judged as a share of the balance", () => {
  const bets = { "time to fight": 400 };
  assert.deepEqual(moneyProblems({ stakes: { "time to fight": 5 } }, inputs({ balance: 100, bets })), [], "£5 of £100 is 5%");
  assert.equal(moneyProblems({ stakes: { "time to fight": 8 } }, inputs({ balance: 100, bets })).length, 1);
});
