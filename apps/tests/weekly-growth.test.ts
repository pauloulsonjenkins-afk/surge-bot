/** The weekly pass: suggestions that raise risk are taken up once a week; ones that lower it are never held. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { isGrowthAdvice, weeklyGrowth, type Advice } from "../src/server/strategy-advice";

const a = (key: string, kind: Advice["kind"]): Advice => ({ key, kind, reason: "r", action: "a" });
const kinds = (list: Advice[]) => list.map((x) => `${x.key}:${x.kind}`);
// Monday 9 Nov 2026 is the start of a UK week; Monday 16 Nov starts the next.
const MON = new Date("2026-11-09T09:00:00Z");
const WED = new Date("2026-11-11T15:00:00Z");
const SUN = new Date("2026-11-15T22:00:00Z");
const NEXT_MON = new Date("2026-11-16T00:30:00Z");

test("going Live and raising a stake are growth; cutting, Sim and league stops are not", () => {
  assert.deepEqual(
    (["try-live", "stake-up", "slice-live", "slice-stake-up", "back-to-sim", "stake-down", "slice-sim", "slice-stake-down", "league-block"] as const).map((k) => isGrowthAdvice({ kind: k })),
    [true, true, true, true, false, false, false, false, false],
  );
});

test("the week's first look takes the pass: what stands then shows all week", () => {
  const db = new EngineDb(":memory:", () => {});
  const monday = [a("alpha", "stake-up"), a("beta", "try-live")];
  assert.deepEqual(kinds(weeklyGrowth(db, monday, MON)), ["alpha:stake-up", "beta:try-live"]);
  assert.deepEqual(kinds(weeklyGrowth(db, monday, WED)), ["alpha:stake-up", "beta:try-live"]);
});

test("a raise that first appears mid-week waits for next week's pass; a cut shows at once", () => {
  const db = new EngineDb(":memory:", () => {});
  weeklyGrowth(db, [a("alpha", "stake-up")], MON);
  const wednesday = [a("alpha", "stake-up"), a("gamma", "stake-up"), a("gamma#s", "slice-live"), a("delta", "stake-down"), a("eps", "back-to-sim")];
  assert.deepEqual(kinds(weeklyGrowth(db, wednesday, WED)), ["alpha:stake-up", "delta:stake-down", "eps:back-to-sim"]);
  assert.deepEqual(kinds(weeklyGrowth(db, wednesday, SUN)), ["alpha:stake-up", "delta:stake-down", "eps:back-to-sim"], "still the same week on Sunday night");
  assert.deepEqual(kinds(weeklyGrowth(db, wednesday, NEXT_MON)), kinds(wednesday), "the new week's pass takes them all");
});

test("a week that starts with nothing to raise stays that way until the next", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.deepEqual(weeklyGrowth(db, [], MON), []);
  assert.deepEqual(kinds(weeklyGrowth(db, [a("alpha", "try-live"), a("beta", "slice-sim")], WED)), ["beta:slice-sim"]);
});

test("with nothing held, the same list comes back, so the kept suggestions are reused as they are", () => {
  const db = new EngineDb(":memory:", () => {});
  const list = [a("alpha", "stake-up"), a("beta", "stake-down")];
  assert.equal(weeklyGrowth(db, list, MON), list);
  assert.equal(weeklyGrowth(db, list, WED), list);
});
