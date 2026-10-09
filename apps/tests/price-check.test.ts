import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { dueChecks, priceCheckReport } from "../src/betfair/price-check";

const pick = (id: number, alertIso: string, market: string | null = "NEXT_GOAL") =>
  ({ id, messageAt: alertIso, firstSeenAt: alertIso, market, detail: null }) as unknown as Parameters<typeof dueChecks>[0];

test("in-play picks are checked 2 and 5 minutes after the alert, each once", () => {
  const t0 = Date.parse("2026-10-09T15:00:00Z");
  const p = pick(1, new Date(t0).toISOString());
  assert.deepEqual(dueChecks(p, t0 + 60_000, new Set()), []);
  assert.deepEqual(dueChecks(p, t0 + 2.5 * 60_000, new Set()), ["t2"]);
  assert.deepEqual(dueChecks(p, t0 + 5.5 * 60_000, new Set(["1:t2"])), ["t5"]);
  assert.deepEqual(dueChecks(p, t0 + 30 * 60_000, new Set()), []);
});

test("a pre-match pick is checked at kick-off", () => {
  const t0 = Date.parse("2026-10-09T14:00:00Z");
  const p = pick(2, new Date(t0).toISOString(), "FIRST_HALF_GOALS"); // kick-off assumed an hour after the alert
  assert.deepEqual(dueChecks(p, t0 + 30 * 60_000, new Set()), []);
  assert.deepEqual(dueChecks(p, t0 + 59 * 60_000, new Set()), ["ko"]);
});

test("the report averages alert price / later price, leaving out bets a goal had already settled", () => {
  const db = new EngineDb(":memory:", () => {});
  const at = new Date().toISOString();
  db.savePriceCheck({ pickId: 1, kind: "t5", strategy: "Time to fight", entry: 2.2, later: 2.0, at }); // +10%
  db.savePriceCheck({ pickId: 2, kind: "t5", strategy: "Time to fight", entry: 1.8, later: 2.0, at }); // -10%
  db.savePriceCheck({ pickId: 3, kind: "t5", strategy: "Time to fight", entry: 1.8, later: 1.01, at }); // goal: left out
  db.savePriceCheck({ pickId: 4, kind: "t5", strategy: "Comeback", entry: 2.4, later: 2.0, at }); // +20%
  const r = priceCheckReport(db, 30);
  const ttf = r.rows.find((x) => x.strategy === "Time to fight")!;
  assert.equal(ttf.picks, 2);
  assert.equal(ttf.edge, 0);
  assert.equal(r.typical.t5, Math.round((100 * (0.1 - 0.1 + 0.2)) / 3 * 10) / 10);
});
