/** Which list each Golden slice goes in on the Strategies page (components/admin/strategies/GoldenSlicesSection.tsx). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupSlices } from "@/components/admin/strategies/GoldenSlicesSection";
import { bestSlicesFirst } from "@/components/ui/SegmentLabel";
import type { GoldenSlice } from "@/queries/use-golden";

const ret = (units: number) => ({ settled: 20, counted: 20, staked: 20, profit: units, units, roi: units / 20 });
const slice = (id: string, strategyKey: string, status: GoldenSlice["status"], units: number, strategyLive = false): GoldenSlice =>
  ({ id, strategyKey, strategy: strategyKey, strategyLive, label: `Golden: ${id}`, since: "2026-10-01", custom: false, status, slice: { live: ret(0), sim: ret(units), all: ret(units) }, rest: { live: ret(0), sim: ret(0), all: ret(0) }, bet: null }) as unknown as GoldenSlice;

test("slices bet Live on their own come first, the proving ones next (best first), the rest last", () => {
  const slices = [
    slice("a", "time to fight", "full", 5),
    slice("b", "action-packed", "trial", 9),
    slice("c", "blistering momentum", "candidate", 3),
    slice("d", "dominant momentum 0-0", "not holding up", -2),
    slice("e", "action-packed", "full", 1),
  ];
  const g = groupSlices(slices, { "action-packed#e": { live: true, stakePct: 1 } });
  assert.deepEqual(g.liveOwn.map((s) => s.id), ["e"], "its own Live switch is on");
  assert.deepEqual(g.proving.map((s) => s.id), ["a", "b"], "full or trial, not Live: full stake earned before a trial");
  assert.deepEqual(g.others.map((s) => s.id), ["c", "d"], "candidates and the ones not holding up");
});

test("a slice set to Sim on its own is not Live, and one following a Live strategy is left out", () => {
  const slices = [slice("a", "time to fight", "full", 5), slice("b", "underdog taking charge", "full", 4, true), slice("c", "time to fight", "full", 3, true)];
  const g = groupSlices(slices, { "time to fight#a": { live: false }, "time to fight#c": { live: false, stakePct: null } });
  assert.deepEqual(g.liveOwn, []);
  assert.deepEqual(g.proving.map((s) => s.id), ["a", "c"], "b follows its Live strategy; c was set to Sim on its own, so it is listed");
  assert.deepEqual(g.others, []);
});

test("best slices first: Golden stage, then return after allowing for luck (a lucky few don't jump the queue)", () => {
  const r = (roi: number, counted: number) => ({ roi, counted });
  const items = [
    { id: "lucky", status: "candidate" as const, r: r(0.9, 4) }, // +90% on 4: adjusted +6.7%
    { id: "steady", status: "candidate" as const, r: r(0.15, 120) }, // +15% on 120: adjusted +10.6%
    { id: "slipped", status: "not holding up" as const, r: r(0.5, 200) },
    { id: "watched", status: null, r: r(0.3, 100) },
    { id: "gold", status: "full" as const, r: r(0.05, 60) },
    { id: "empty", status: "candidate" as const, r: null },
  ];
  assert.deepEqual(
    bestSlicesFirst(items, (i) => i.status, (i) => i.r).map((i) => i.id),
    ["gold", "steady", "lucky", "empty", "watched", "slipped"],
  );
});
