/** Auto-adjust (server/auto-adjust.ts): which suggestions it applies, which it holds back, and when it runs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, dueSlot, figuresFromReport, DEFAULT_PROTECTED, type Figures } from "../src/server/auto-adjust";
import type { Advice } from "../src/server/strategy-advice";

const adv = (key: string, kind: Advice["kind"], extra: Partial<Advice> = {}): Advice => ({ key, kind, reason: "r", action: kind, ...extra });
const fig = (f: Partial<Figures>): Figures => ({ liveProfit: null, liveWorstDay: null, allProfit: null, allWorstDay: null, weekLiveRoi: null, weekAllRoi: null, ...f });

test("one bad day doesn't take a strategy off Live; a strategy losing and still losing does go", () => {
  const figures: Record<string, Figures> = {
    unlucky: fig({ liveProfit: -20, liveWorstDay: -24, weekLiveRoi: 0.07 }),
    sliding: fig({ liveProfit: -20, liveWorstDay: -5, weekLiveRoi: -0.1 }),
    "bad-week": fig({ liveProfit: -20, liveWorstDay: -24, weekLiveRoi: -0.05 }),
  };
  const out = decide([adv("unlucky", "back-to-sim"), adv("sliding", "back-to-sim"), adv("bad-week", "back-to-sim")], (k) => figures[k] ?? null, []);
  assert.deepEqual(out.map((d) => [d.advice.key, d.apply]), [["unlucky", false], ["sliding", true], ["bad-week", true]]);
  assert.match(out[0]!.held!, /one bad day/);
});

test("try Live needs a profit overall and a last week that isn't losing", () => {
  const figures: Record<string, Figures> = {
    good: fig({ allProfit: 30, allWorstDay: -5, weekAllRoi: 0.2 }),
    losing: fig({ allProfit: -2, allWorstDay: -10, weekAllRoi: 0.3 }),
    cold: fig({ allProfit: 12, allWorstDay: -3, weekAllRoi: -0.1 }),
  };
  const out = decide([adv("good", "try-live"), adv("losing", "try-live"), adv("cold", "try-live"), adv("unknown", "try-live")], (k) => figures[k] ?? null, []);
  assert.deepEqual(out.map((d) => d.apply), [true, false, false, false]);
});

test("cuts go first, at most four changes, never a stake step or league stop, and protected strategies are left alone", () => {
  const ok = fig({ allProfit: 10, weekAllRoi: 0.1, liveProfit: -10, liveWorstDay: -2, weekLiveRoi: -0.2 });
  const list = [
    adv("a", "try-live"),
    adv("b", "try-live"),
    adv("c", "back-to-sim"),
    adv("d#s1", "slice-sim", { slice: { strategyKey: "d", id: "s1" } }),
    adv("e#s2", "slice-live", { slice: { strategyKey: "e", id: "s2" } }),
    adv("f", "stake-up"),
    adv("g", "league-block"),
    adv("og 2 shg", "back-to-sim"),
    adv("favourite pressure 2nd half#x", "slice-sim", { slice: { strategyKey: "favourite pressure 2nd half", id: "x" } }),
  ];
  const out = decide(list, () => ok, DEFAULT_PROTECTED);
  const applied = out.filter((d) => d.apply).map((d) => d.advice.key);
  assert.deepEqual(applied, ["c", "d#s1", "a", "b"], "the two cuts first, then two of the three Live moves");
  assert.ok(!out.some((d) => ["f", "g"].includes(d.advice.key)), "stake steps and league stops aren't its job");
  assert.ok(out.find((d) => d.advice.key === "og 2 shg")?.held?.includes("keep"));
  assert.ok(out.find((d) => d.advice.key === "favourite pressure 2nd half#x")?.held?.includes("keep"), "a protected strategy's slices too");
  assert.match(out.find((d) => d.advice.key === "e#s2")!.held!, /4 changes/);
});

test("figures are read from the Strategies report", () => {
  const f = figuresFromReport({
    strategies: [{ label: "OG 2 SHG", returns: { live: { counted: 113, profit: -32.87, roi: -0.15, worstDay: { profit: -23.83 } }, all: { counted: 329, profit: 5.61, roi: 0.008, worstDay: { profit: -23.83 } } }, form: { week: { live: { counted: 42, roi: 0.073 }, all: { counted: 79, roi: 0.082 } } } }],
  });
  assert.deepEqual(f("og 2 shg"), { liveProfit: -32.87, liveWorstDay: -23.83, allProfit: 5.61, allWorstDay: -23.83, weekLiveRoi: 0.073, weekAllRoi: 0.082 });
  assert.equal(f("nope"), null);
});

test("it runs at 22:00 UK every night and at 13:00 UK on Saturday and Sunday only", () => {
  assert.equal(dueSlot(new Date("2026-11-20T22:10:00Z")), "2026-11-20 22", "Friday night (UK is on GMT in November)");
  assert.equal(dueSlot(new Date("2026-11-21T13:05:00Z")), "2026-11-21 13", "Saturday midday");
  assert.equal(dueSlot(new Date("2026-11-22T13:05:00Z")), "2026-11-22 13", "Sunday midday");
  assert.equal(dueSlot(new Date("2026-11-20T13:05:00Z")), null, "not Friday midday");
  assert.equal(dueSlot(new Date("2026-11-21T15:00:00Z")), null);
  assert.equal(dueSlot(new Date("2026-07-04T21:10:00Z")), "2026-07-04 22", "in summer 22:00 UK is 21:00 UTC");
});
