/**
 * The suggestions shown on the Today page are kept until something they're worked out from changes (strategy-advice.ts).
 * They used to be worked out afresh every 2 minutes (1-1.3 s on the live data, holding the engine up each time), even at
 * night with nothing settling (7 Nov 2026).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { saveSendingSettings } from "../src/inplayguru/bet-feed";
import { RESULTS_REUSE_MS, VIEW_MAX_AGE_MS, visibleAdvice } from "../src/server/strategy-advice";

const alert = (n: number) =>
  [
    "🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0",
    "Over/Under 0.50 Odds:", "2.00 1.80", "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", "Full-Time Score: 1-0", "", "✅ Hit",
  ].join("\n");

function db() {
  const d = new EngineDb(":memory:", () => {});
  saveSendingSettings(d, { enabled: true, stakes: { "blistering momentum": 1 }, dailyCap: 10_000 });
  d.upsertLivePick("chat", 1, alert(1), parseAlert(alert(1)), new Date(Date.now() - 3_600_000).toISOString());
  return d;
}

test("nothing changed: the same suggestions are reused, however often the page asks (up to 30 minutes)", () => {
  const d = db();
  const t0 = Date.now();
  const first = visibleAdvice(d, new Date(t0));
  assert.equal(visibleAdvice(d, new Date(t0 + 15_000)), first);
  assert.equal(visibleAdvice(d, new Date(t0 + 10 * 60_000)), first, "no longer thrown away after 2 minutes");
  assert.equal(visibleAdvice(d, new Date(t0 + VIEW_MAX_AGE_MS - 1000)), first);
  assert.notEqual(visibleAdvice(d, new Date(t0 + VIEW_MAX_AGE_MS + 1000)), first, "the clock still moves them on");
});

test("a result written: reused for up to 2 minutes, then worked out afresh", () => {
  const d = db();
  const t0 = Date.now();
  const first = visibleAdvice(d, new Date(t0));
  d.upsertLivePick("chat", 2, alert(2), parseAlert(alert(2)), new Date(t0 - 1_800_000).toISOString());
  assert.equal(visibleAdvice(d, new Date(t0 + 30_000)), first, "a burst of results doesn't recompute every time");
  const later = visibleAdvice(d, new Date(t0 + RESULTS_REUSE_MS + 1000));
  assert.notEqual(later, first);
  assert.equal(visibleAdvice(d, new Date(t0 + RESULTS_REUSE_MS + 60_000)), later, "and kept again once up to date");
});

test("a setting changed: worked out afresh straight away", () => {
  const d = db();
  const t0 = Date.now();
  const first = visibleAdvice(d, new Date(t0));
  saveSendingSettings(d, { stakes: { "blistering momentum": 2 } });
  assert.notEqual(visibleAdvice(d, new Date(t0 + 1000)), first);
  const second = visibleAdvice(d, new Date(t0 + 2000));
  d.setSetting("strategy_advice_locks", JSON.stringify({ "blistering momentum": { kind: "back-to-sim", at: new Date(t0).toISOString() } }));
  assert.notEqual(visibleAdvice(d, new Date(t0 + 3000)), second, "a lock from an applied suggestion counts too");
});
