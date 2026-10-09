import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { depthAtOrAbove } from "../src/betfair/direct";
import { breakerStatus, guardTick, recordPass, resetGuard } from "../src/betfair/guard";
import { categorise } from "../src/server/today";

const NOW = new Date();
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const alert = (home: string, away: string, settled: "" | "hit" | "miss" = "") =>
  [
    "🔔 Blistering Momentum",
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    `${home} vs ${away}`,
    "",
    "Timer: 60'",
    "Goals: 1 - 0",
    "Over/Under 1.50 Odds:",
    "1.80 2.00",
    ...(settled ? ["", "⸻⸻ Match Summary ⸻⸻", "", "Half-Time Score: 1-0", `Full-Time Score: ${settled === "hit" ? "2-0" : "1-0"}`, "", settled === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

test("the whole-account daily loss stop holds back new bets once Live is down the limit today", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "blistering momentum": 2 }, strategies: { "blistering momentum": true }, dailyLossLimit: 1 });
  db.upsertLivePick("chat", 1, alert("Lens", "Lille"), parseAlert(alert("Lens", "Lille")), minutesAgo(3));
  assert.equal(buildFeed(db, { markSent: true, now: NOW }).newlySent, 1);
  // That bet loses: Live is down £2 today, over the £1 limit.
  db.upsertLivePick("chat", 1, alert("Lens", "Lille", "miss"), parseAlert(alert("Lens", "Lille", "miss")), minutesAgo(3));
  db.upsertLivePick("chat", 2, alert("Nice", "Brest"), parseAlert(alert("Nice", "Brest")), minutesAgo(1));
  const feed = buildFeed(db, { markSent: true, now: NOW });
  assert.equal(feed.newlySent, 0);
  assert.ok(feed.skipped.some((s) => s.reason.startsWith("Daily loss stop")));
});

test("liquidity: only the money on offer at the asked price or better counts", () => {
  const depth = [
    { price: 1.9, size: 1.5 },
    { price: 1.88, size: 4 },
    { price: 1.8, size: 10 },
  ];
  assert.equal(depthAtOrAbove(depth, 1.88), 5.5);
  assert.equal(depthAtOrAbove(depth, 1.95), 0);
  assert.equal(depthAtOrAbove(undefined, 1.5), null);
});

test("the circuit breaker opens after five passes with Betfair errors and closes once one passes cleanly", async () => {
  resetGuard();
  const db = new EngineDb(":memory:", () => {});
  for (let i = 0; i < 4; i++) recordPass(true);
  await guardTick(db);
  assert.equal(breakerStatus().open, false);
  recordPass(true);
  await guardTick(db);
  assert.equal(breakerStatus().open, true);
  recordPass(false);
  await guardTick(db);
  assert.equal(breakerStatus().open, false);
});

test("not-placed reasons are grouped, using the last reason behind 'too old'", () => {
  assert.equal(categorise("Price 1.32 is below the minimum 1.40.").category, "Price below the minimum odds");
  assert.equal(categorise("Too old to bet. Back 1.50 and lay 1.90 are 26.7% apart (limit 15%).").category, "Back and lay too far apart");
  assert.equal(categorise("Too old to bet.").category, "Alert too late to bet");
  assert.equal(categorise("Betfair spells a team differently: add it under Sending → Match names.").category, "Team or selection name differs");
  assert.equal(categorise(null).category, "No reason recorded");
});
