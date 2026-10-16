import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { computeWinLoss } from "../src/server/winloss";

test("Profit has a 30-day running series too: one point per UK day plus the £0 start, reaching into last year in January", () => {
  const db = new EngineDb(":memory:", () => {});
  const oct = computeWinLoss(db, new Date("2026-10-16T12:00:00Z"));
  assert.equal(oct.series.d30.length, 31);
  assert.equal(oct.series.d30[1]!.label, "2026-09-17");
  assert.equal(oct.periods.d30.total, 0);
  const jan = computeWinLoss(db, new Date("2027-01-10T12:00:00Z"));
  assert.equal(jan.series.d30[1]!.label, "2026-12-12", "30 days back crosses the year");
  assert.equal(jan.series.ytd[1]!.label, "2027-01-01");
});
