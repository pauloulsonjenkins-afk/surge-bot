/**
 * The Dashboard's break-even: judged on what the winners actually paid, not the average price of every pick, and the
 * same picks split into price ranges.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computeHitRateContext, effectiveBreakeven, saveWinLossSettings } from "../src/server/winloss";

const S = "Blistering Momentum";
const KEY = S.toLowerCase();

function alert(n: number, odds: string, result?: "hit" | "miss"): string {
  return [
    `🔔 ${S}`,
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    `Home ${n} vs Away ${n}`,
    "",
    "Timer: 60'",
    "Goals: 0 - 0",
    "Over/Under 0.50 Odds:",
    `${odds} 2.40`,
    ...(result
      ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"]
      : []),
  ].join("\n");
}

test("effectiveBreakeven: 1.50 winners with equal stakes need 66.7%", () => {
  assert.equal(effectiveBreakeven(0.5, 1), 66.7);
  assert.equal(effectiveBreakeven(0, 1), null);
  assert.equal(effectiveBreakeven(1, 0), null);
});

/** Shorter-priced picks win, longer-priced ones lose, so the average price (1.65) says 60.6% but the winners paid 1.50. */
function build() {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 2 }, strategies: { [KEY]: true }, dailyCap: 100 });
  saveWinLossSettings(db, { commission: 0 });
  const now = new Date();
  const posted = new Date(now.getTime() - 60_000).toISOString();
  // 6 hits at 1.50 and 2 misses at 1.50, then 4 misses at 1.80 and 1 hit at 1.80 (13 picks).
  const picks: Array<[string, "hit" | "miss"]> = [
    ...Array.from({ length: 6 }, (): [string, "hit" | "miss"] => ["1.50", "hit"]),
    ["1.50", "miss"],
    ["1.50", "miss"],
    ...Array.from({ length: 4 }, (): [string, "hit" | "miss"] => ["1.80", "miss"]),
    ["1.80", "hit"],
  ];
  picks.forEach(([odds, r], i) => {
    const n = i + 1;
    db.upsertLivePick("chat", n, alert(n, odds), parseAlert(alert(n, odds)), posted);
    buildFeed(db, { markSent: true, now });
    db.upsertLivePick("chat", n, alert(n, odds, r), parseAlert(alert(n, odds, r)), posted);
  });
  return db;
}

test("the break-even is judged on what the winners paid, so it matches the profit", () => {
  const db = build();
  const c = computeHitRateContext(db, db.statsSettledIds(null), null);
  assert.equal(c.settled, 13);
  assert.equal(c.hits, 7);
  // Average price of every pick is (8 x 1.50 + 5 x 1.80) / 13 = 1.62, which on its own says 61.7%.
  assert.equal(c.avgOdds, 1.62);
  assert.equal(c.breakeven, 61.7);
  // Profit at £2 a pick: 6 x £1 + 1 x £1.60 - 6 x £2 = -£4.40.
  assert.equal(c.profit, -4.4);
  // Winners paid (6 x £1 + 1 x £1.60) / 7 = £1.086 per win, losers cost £2: needs 2 / (1.086 + 2) = 64.8%.
  assert.equal(c.breakevenEffective, 64.8);
  // At exactly that hit rate the profit would be nil.
  const hitRate = (c.hits / c.settled) * 100;
  assert.ok(hitRate < (c.breakevenEffective ?? 0), "below the line, and losing: they agree");
});

test("odds bands split the same picks by price", () => {
  const db = build();
  const c = computeHitRateContext(db, db.statsSettledIds(null), null);
  const by = Object.fromEntries(c.bands.map((b) => [b.label, b]));
  assert.equal(c.bands.length, 4);
  assert.equal(by["Under 1.50"]!.settled, 0);
  assert.equal(by["Under 1.50"]!.hitRate, null);
  const mid = by["1.50 – 1.79"]!;
  assert.equal(mid.settled, 8);
  assert.equal(mid.hits, 6);
  assert.equal(mid.hitRate, 75);
  assert.equal(mid.breakeven, 66.7, "1.50 winners with equal stakes");
  assert.equal(mid.profit, 2);
  const long = by["1.80 – 2.19"]!;
  assert.equal(long.settled, 5);
  assert.equal(long.hits, 1);
  assert.equal(long.hitRate, 20);
  assert.equal(long.profit, -6.4);
  assert.equal(c.bands.reduce((n, b) => n + b.settled, 0), c.settled, "every priced pick is in exactly one band");
});
