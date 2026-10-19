/**
 * Strategies → Weekly: £ week by week per strategy (Monday to Sunday, UK), the last 7 days and the 28 days before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computeStrategyWeeks } from "../src/server/strategy-weeks";

const alert = (n: number, result?: "hit" | "miss") =>
  [
    "🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

test("each bet lands in its week, the last 7 days or the 28 before, per strategy and in the total", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "blistering momentum": 1 }, strategies: { "blistering momentum": true }, dailyCap: 100 });
  const bet = (n: number, r: "hit" | "miss") => {
    const at = new Date(Date.now() - 60_000).toISOString();
    db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), at);
    buildFeed(db, { markSent: true });
    db.upsertLivePick("chat", n, alert(n, r), parseAlert(alert(n, r)), at);
  };
  bet(1, "hit");
  bet(2, "miss");
  // Seen from tomorrow: both in the last 7 days. Seen from 20 days on: both in the 28 days before.
  const soon = computeStrategyWeeks(db, 6, new Date(Date.now() + 86_400_000));
  assert.equal(soon.weeks.length, 6);
  assert.equal(new Date(`${soon.weeks[0]}T12:00:00Z`).getUTCDay(), 1, "weeks start on Monday");
  const s = soon.strategies["blistering momentum"]!;
  assert.equal(s.last7.live.picks, 2);
  assert.equal(s.last7.live.won, 1);
  assert.ok(Math.abs(s.last7.live.profit) < 0.05, "won £1 at evens, lost £1");
  assert.equal(s.weeks.reduce((n, x) => n + x.live.picks, 0), 2);
  assert.equal(soon.strategies.__all__!.last7.all.picks, 2);
  const later = computeStrategyWeeks(db, 6, new Date(Date.now() + 20 * 86_400_000));
  assert.equal(later.strategies["blistering momentum"]!.prev28.live.picks, 2);
  assert.equal(later.strategies["blistering momentum"]!.last7.live.picks, 0);
});
