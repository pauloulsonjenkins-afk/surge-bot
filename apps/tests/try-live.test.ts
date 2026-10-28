/**
 * "Try Live" (strategy-advice.ts) since 29 Oct 2026: 200+ priced Sim picks, in profit in BOTH halves of them, and a
 * trial stake on Apply. At 50 picks, short good Sim runs were promoted and then lost Live (Fav Pressure Level +£18.53
 * in Sim, -£11.08 Live).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { recordSimBets, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { saveStopLossRule } from "../src/inplayguru/stop-loss";
import { PROMOTE_FROM, strategyAdvice } from "../src/server/strategy-advice";

const S = "Blistering Momentum";
const KEY = S.toLowerCase();
const alert = (n: number, result: "hit" | "miss") =>
  [
    `🔔 ${S}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0",
    "Over/Under 0.50 Odds:", "2.00 1.80", "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss",
  ].join("\n");

/** A Sim strategy at £1 with a stop loss and `n` priced Sim picks, oldest first; win(i) decides each one (i from 1). */
function simStrategy(n: number, win: (i: number) => boolean) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, dailyCap: 10_000 });
  saveStopLossRule(db, S, { dailyLoss: 10 });
  const start = Date.now() - (n + 5) * 60_000;
  recordSimBets(db, new Date(start - 60_000));
  for (let i = 1; i <= n; i++) {
    const at = new Date(start + i * 60_000).toISOString();
    const r = win(i) ? "hit" : "miss";
    const open = alert(i, r).split("\n\n⸻")[0]!;
    db.upsertLivePick("chat", i, open, parseAlert(open), at);
    recordSimBets(db, new Date(Date.parse(at) + 1000));
    db.upsertLivePick("chat", i, alert(i, r), parseAlert(alert(i, r)), at);
  }
  return db;
}
const tryLive = (db: EngineDb) => strategyAdvice(db).find((a) => a.key === KEY && a.kind === "try-live");

test("a strong Sim record isn't enough under 200 priced picks", () => {
  assert.equal(tryLive(simStrategy(PROMOTE_FROM - 20, (i) => i % 4 !== 0)), undefined);
});

test("200+ picks in profit overall but losing in the newer half: not suggested", () => {
  const n = PROMOTE_FROM + 20;
  // Older half wins every time; newer half wins 4 in 10 at evens - losing, though the whole is well up.
  assert.equal(tryLive(simStrategy(n, (i) => i <= n / 2 || i % 10 < 4)), undefined);
});

test("200+ picks in profit in both halves: suggested, at a trial stake, not its own", () => {
  const a = tryLive(simStrategy(PROMOTE_FROM + 20, (i) => i % 4 !== 0));
  assert.ok(a, "suggested");
  assert.deepEqual(a!.to, { flat: 1 }, "£1 trial for a flat-stake strategy");
  assert.match(a!.action, /trial stake/);
  assert.match(a!.reason, /older half .* newer/);
});
