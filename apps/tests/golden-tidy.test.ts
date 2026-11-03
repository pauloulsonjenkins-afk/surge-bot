/** Golden page tidying: slices that are empty, duplicated, lost or losing are shelved (never deleted); Live ones are flagged instead. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tidySlices } from "../src/server/golden";

const NOW = new Date("2026-11-03T12:00:00Z");
const slice = (id: string, over: Record<string, unknown> = {}) => ({
  strategyKey: "time to fight",
  id,
  label: `Golden: ${id}`,
  since: "2026-10-01T00:00:00.000Z",
  status: "quiet" as const,
  why: null as string | null,
  notify: false,
  custom: false,
  bet: null as { live: boolean } | null,
  ownLive: null as { n: number; units: number; roi: number | null } | null,
  slice: { all: { counted: 20, roi: 0.02, units: 0.4 } },
  ...over,
});
const by = (list: ReturnType<typeof tidySlices>, id: string) => list.find((s) => s.id === id)!;

test("empty for two weeks, not holding up and clearly losing are shelved with a reason; a working one is not", () => {
  const r = tidySlices(
    [
      slice("empty", { slice: { all: { counted: 0, roi: null } } }),
      slice("fresh-empty", { since: "2026-11-01T00:00:00.000Z", slice: { all: { counted: 0, roi: null } } }),
      slice("lost", { status: "not holding up", why: "-3% per £1 since it started" }),
      slice("losing", { slice: { all: { counted: 43, roi: -0.2 } } }),
      slice("small-loss", { slice: { all: { counted: 21, roi: -0.25 } } }),
      slice("working", { slice: { all: { counted: 52, roi: 0.1 } } }),
    ],
    new Map(),
    NOW,
  );
  assert.match(by(r, "empty").shelved!, /No picks in 33 days/);
  assert.equal(by(r, "fresh-empty").shelved, null, "only just started");
  assert.match(by(r, "lost").shelved!, /Not holding up: -3%/);
  assert.match(by(r, "losing").shelved!, /Losing over 43/);
  assert.equal(by(r, "small-loss").shelved, null, "too few picks to call it");
  assert.equal(by(r, "working").shelved, null);
});

test("the same picks worded twice: one is kept, a used or built-in one first, then the shortest", () => {
  const sigs = new Map([
    ["time to fight#a-long-name", "1:2|3:4"],
    ["time to fight#short", "1:2|3:4"],
    ["time to fight#liked", "1:2|3:4"],
    ["time to fight#other", "9:9"],
  ]);
  const list = [slice("a-long-name", { custom: true }), slice("short", { custom: true }), slice("other")];
  const r = tidySlices(list, sigs, NOW);
  assert.equal(by(r, "short").shelved, null);
  assert.match(by(r, "a-long-name").shelved!, /Same picks as “short”/);
  assert.equal(by(r, "other").shelved, null);
  const r2 = tidySlices([...list, slice("liked", { custom: true, notify: true })], sigs, NOW);
  assert.equal(by(r2, "liked").shelved, null, "the one with notifications on stays");
  assert.match(by(r2, "short").shelved!, /Same picks as “liked”/);
});

test("a Live or notifying slice is never shelved for losing, but a Live one that is losing is flagged", () => {
  const r = tidySlices(
    [
      slice("live-losing", { bet: { live: true }, slice: { all: { counted: 40, roi: -0.1 } } }),
      slice("live-lost", { bet: { live: true }, status: "not holding up", why: "its last 30 picks are -8%" }),
      slice("live-own", { bet: { live: true }, ownLive: { n: 20, units: -3, roi: -0.15 } }),
      slice("live-fine", { bet: { live: true } }),
      slice("notify-empty", { notify: true, slice: { all: { counted: 0, roi: null } } }),
    ],
    new Map(),
    NOW,
  );
  for (const id of ["live-losing", "live-lost", "live-own", "live-fine", "notify-empty"]) assert.equal(by(r, id).shelved, null, id);
  assert.match(by(r, "live-losing").watchOut!, /Live, and losing over 40/);
  assert.match(by(r, "live-lost").watchOut!, /no longer holding up: its last 30/);
  assert.match(by(r, "live-own").watchOut!, /own Live bets are losing over 20/);
  assert.equal(by(r, "live-fine").watchOut, null);
});
