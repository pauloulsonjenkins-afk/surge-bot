/**
 * Checks the figures a hit rate and a stop loss are judged by: break-even hit rate, the likely range of the hit rate,
 * and each strategy's drawdown and losing runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { breakevenHitRate, hitRateRange } from "../src/server/pricing";
import { computeHitRateContext, computeStrategyEquity, computeStrategyReturns, saveWinLossSettings } from "../src/server/winloss";

const S = "Blistering Momentum";
const KEY = S.toLowerCase();

function alert(n: number, result?: "hit" | "miss"): string {
  return [
    `🔔 ${S}`,
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    `Home ${n} vs Away ${n}`,
    "",
    "Timer: 60'",
    "Goals: 0 - 0",
    "Over/Under 0.50 Odds:",
    "1.50 2.40",
    ...(result
      ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"]
      : []),
  ].join("\n");
}

test("break-even hit rate: 1.50 odds need 66.7%, more once commission is taken", () => {
  assert.equal(breakevenHitRate(1.5, 0), 66.7);
  assert.equal(breakevenHitRate(1.5, 0.05), 67.8);
  assert.equal(breakevenHitRate(null, 0), null);
});

test("hit rate range: 37 from 58 could be anything from about 51% to 75%", () => {
  assert.deepEqual(hitRateRange(37, 58), { low: 50.9, high: 74.9 });
  assert.equal(hitRateRange(0, 0), null);
});

test("drawdown, losing runs and worst day, for Live and for All", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 2 }, strategies: { [KEY]: true }, dailyCap: 100 });
  saveWinLossSettings(db, { commission: 0 });
  const now = new Date();
  const posted = new Date(now.getTime() - 60_000).toISOString();
  // hit +1, hit +1, miss -2, miss -2, miss -2, hit +1: peak +2, low -4, so a £6 drawdown and 3 losses in a row.
  (["hit", "hit", "miss", "miss", "miss", "hit"] as const).forEach((r, i) => {
    const n = i + 1;
    db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), posted);
    buildFeed(db, { markSent: true, now });
    db.upsertLivePick("chat", n, alert(n, r), parseAlert(alert(n, r)), posted);
  });
  const live = computeStrategyReturns(db)[KEY]!.live;
  assert.equal(live.settled, 6);
  assert.equal(live.hits, 3);
  assert.equal(live.profit, -3);
  assert.equal(live.avgOdds, 1.5);
  assert.equal(live.breakeven, 66.7);
  assert.equal(live.maxDrawdown, 6);
  assert.equal(live.longestLosingRun, 3);
  assert.equal(live.worstDayRun, 3);
  assert.equal(live.worstDay?.profit, -3);
  assert.deepEqual(computeStrategyReturns(db)[KEY]!.all, live);

  const curve = computeStrategyEquity(db, S, "live");
  assert.deepEqual(curve.points.map((p) => p.total), [1, 2, 0, -2, -4, -3]);
  assert.equal(computeStrategyEquity(db, S, "sim").points.length, 0);

  const ctx = computeHitRateContext(db, db.statsSettledIds(null), null);
  assert.equal(ctx.settled, 6);
  assert.equal(ctx.avgOdds, 1.5);
  assert.equal(ctx.roi, -0.25);
});
