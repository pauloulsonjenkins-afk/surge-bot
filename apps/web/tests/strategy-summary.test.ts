/** The Strategies overview's trimmed data (src/lib/strategy-summary.ts) keeps every figure the page uses. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { liveSlices, summariseStrategy } from "../src/lib/strategy-summary";
import type { AdminStrategy, GoldenSlice, StrategyReturn } from "../src/server/engine-client";

const ret = (counted: number, profit: number, staked: number) => ({ counted, profit, staked, roi: profit / staked, verdict: "too early", hits: 1 }) as unknown as StrategyReturn;

test("a strategy keeps its mode, status and real / trial / combined money, and nothing heavy", () => {
  const full = {
    label: "OG 2 SHG",
    market: "OVER_0_5",
    mode: "live",
    mergedInto: null,
    sendingOn: true,
    lastAlertAt: "2026-11-28T10:00:00Z",
    returns: { live: ret(20, -12.69, 30), sim: ret(50, 59.18, 70), all: ret(70, 46.49, 100), segments: [{ id: "x" }] },
    form: { recent: {} },
    spark: [1, 2, 3],
  } as unknown as AdminStrategy;
  const s = summariseStrategy(full);
  assert.deepEqual(s.returns, { live: { counted: 20, profit: -12.69, staked: 30 }, sim: { counted: 50, profit: 59.18, staked: 70 }, all: { counted: 70, profit: 46.49, staked: 100 } });
  assert.equal(s.mode, "live");
  assert.equal(s.sendingOn, true);
  assert.equal("form" in s || "spark" in s, false);
});

test("only Golden slices betting real money are kept, on their own real bets when they have them", () => {
  const slice = (id: string, live: boolean, ownLive: GoldenSlice["ownLive"]) =>
    ({ id, label: `Golden: ${id}`, strategy: "Second Pour", strategyKey: "second pour", bet: { live, stakePct: null, stake: 1 }, ownLive, slice: { live: ret(9, 4, 9), sim: ret(1, 1, 1), all: ret(10, 5, 10) } }) as unknown as GoldenSlice;
  const kept = liveSlices([slice("a", true, { n: 3, won: 2, staked: 3, profit: 1.5, roi: 0.5 }), slice("b", false, null), slice("c", true, null)]);
  assert.deepEqual(kept.map((s) => s.id), ["a", "c"]);
  assert.deepEqual(kept[0]!.own, { counted: 3, profit: 1.5, staked: 3 });
  assert.deepEqual(kept[1]!.own, { counted: 9, profit: 4, staked: 9 }, "no own bets yet: the slice's Live record");
});
