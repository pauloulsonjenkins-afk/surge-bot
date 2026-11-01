/** Suggestions for Golden slices and the early warning (strategy-advice.ts), the cases from the 1 Nov 2026 review. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { applyAllAdvice, BEST_SLICE_PCT, sliceAdviceFrom, visibleAdvice } from "../src/server/strategy-advice";

const ret = (counted: number, roi: number, units: number) => ({ settled: counted, counted, staked: counted, profit: roi * counted, units, roi });
interface Opt {
  status?: string;
  strategyLive?: boolean;
  all?: ReturnType<typeof ret>;
  rest?: ReturnType<typeof ret>;
  recent?: { n: number; won: number; roi: number | null };
  own?: { n: number; roi: number; units: number } | null;
}
const slice = (strategyKey: string, id: string, o: Opt = {}) =>
  ({
    strategyKey,
    strategy: strategyKey,
    strategyLive: o.strategyLive ?? false,
    id,
    label: `Golden: ${id}`,
    since: "2026-10-01",
    custom: false,
    status: o.status ?? "candidate",
    recent: o.recent,
    slice: { live: ret(0, 0, 0), sim: o.all ?? ret(65, 0.03, 1.56), all: o.all ?? ret(65, 0.03, 1.56) },
    rest: { live: ret(0, 0, 0), sim: ret(0, 0, 0), all: o.rest ?? ret(154, -0.018, -3.21) },
    bet: null,
    ownLive: o.own ?? null,
  }) as unknown as Parameters<typeof sliceAdviceFrom>[0][number];

const settingsWith = (segmentBets: Record<string, unknown> = {}) => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { segmentBets });
  return getSendingSettings(db);
};

test("a candidate slice that is in profit is suggested for a Live trial at 1%, with how the rest of the strategy is doing", () => {
  const a = sliceAdviceFrom([slice("dominant momentum 0-0", "f-fav")], settingsWith());
  assert.equal(a.length, 1);
  assert.equal(a[0]!.kind, "slice-live");
  assert.deepEqual(a[0]!.to, { pct: 1 });
  assert.equal(a[0]!.key, "dominant momentum 0-0#f-fav");
  assert.match(a[0]!.reason, /over 65 priced picks, against -1\.8% over 154 for the rest/);
});

test("no trial for a slice that is quiet, not holding up, thin, losing, already Live on its own, or following a Live strategy", () => {
  const s = settingsWith({ "x#already": { live: true, stakePct: 1 } });
  const list = [
    slice("x", "quiet", { status: "quiet" }),
    slice("x", "notholding", { status: "not holding up" }),
    slice("x", "thin", { all: ret(30, 0.2, 5) }),
    slice("x", "losing", { all: ret(80, -0.02, -1.6) }),
    slice("x", "already"),
    slice("x", "follows", { strategyLive: true }),
  ];
  assert.deepEqual(sliceAdviceFrom(list, s).filter((a) => a.kind === "slice-live"), []);
});

test("a Live slice whose own Live bets are losing 10% over 15+ bets is suggested back to Sim", () => {
  const s = settingsWith({ "x#a": { live: true, stakePct: 2 } });
  const a = sliceAdviceFrom([slice("x", "a", { status: "full", own: { n: 18, roi: -0.14, units: -2.5 } })], s);
  assert.deepEqual(a.map((x) => x.kind), ["slice-sim"]);
  const mild = sliceAdviceFrom([slice("x", "a", { status: "full", all: ret(20, 0.02, 0.4), own: { n: 18, roi: -0.04, units: -0.7 } })], s);
  assert.deepEqual(mild.map((x) => x.kind), ["slice-stake-down"], "mildly losing: one step down the ladder, from 2% to 1.5%");
  assert.equal((mild[0]!.to as { pct: number }).pct, 1.5);
});

test("the best earning Live slice goes straight to 4%, the next one a step up, and ones that are not earning stay put", () => {
  const s = settingsWith({
    "ttf#top": { live: true, stakePct: 1 },
    "ttf#second": { live: true, stakePct: 1 },
    "ttf#flat": { live: true, stakePct: 2 },
    "ttf#recentbad": { live: true, stakePct: 1 },
  });
  const a = sliceAdviceFrom(
    [
      slice("ttf", "second", { status: "full", all: ret(26, 0.149, 3.27) }),
      slice("ttf", "top", { status: "full", all: ret(23, 0.275, 6.27) }),
      slice("ttf", "flat", { status: "full", all: ret(25, 0.04, 1) }),
      slice("ttf", "recentbad", { status: "full", all: ret(30, 0.2, 6), recent: { n: 30, won: 12, roi: -0.04 } }),
    ],
    s,
  );
  const ups = a.filter((x) => x.kind === "slice-stake-up");
  assert.deepEqual(ups.map((x) => [x.key, (x.to as { pct: number }).pct]), [
    ["ttf#top", BEST_SLICE_PCT],
    ["ttf#second", 1.5],
  ]);
  assert.match(ups[0]!.action, /your best performer/);
});

test("a slice already at the best-performer stake is not raised again", () => {
  const s = settingsWith({ "ttf#top": { live: true, stakePct: 4 } });
  assert.deepEqual(sliceAdviceFrom([slice("ttf", "top", { status: "full", all: ret(23, 0.275, 6.27) })], s).filter((x) => x.kind === "slice-stake-up"), []);
});

test("applying every suggestion on a database with nothing to suggest does nothing and says so", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.deepEqual(visibleAdvice(db), []);
  assert.deepEqual(applyAllAdvice(db), { applied: [], failed: [] });
});
