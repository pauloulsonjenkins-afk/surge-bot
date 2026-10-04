/**
 * Alerts whose full-time edit was missed are read again by message id (telegram/listener.ts): which ones are picked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";

const text = (home: string, settled: boolean) =>
  ["🔔 Time to fight", "", "🇵🇱 Poland III Liga (3rd vs 9th)", `${home} vs Odra`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "1.60 2.20",
    ...(settled ? ["", "⸻⸻ Match Summary ⸻⸻", "", "Half-Time Score: 0-0", "Full-Time Score: 1-0", "", "✅ Hit"] : [])].join("\n");

test("only this chat's alerts in the window with no result yet are read again", () => {
  const db = new EngineDb(":memory:", () => {});
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  db.upsertLivePick("chat", 1, text("Open old", false), parseAlert(text("Open old", false)), hoursAgo(30), hoursAgo(30));
  db.upsertLivePick("chat", 2, text("Settled", true), parseAlert(text("Settled", true)), hoursAgo(30), hoursAgo(30));
  db.upsertLivePick("chat", 3, text("Still playing", false), parseAlert(text("Still playing", false)), hoursAgo(1), hoursAgo(1));
  db.upsertLivePick("chat", 4, text("Too old", false), parseAlert(text("Too old", false)), hoursAgo(24 * 6), hoursAgo(24 * 6));
  db.upsertLivePick("other", 5, text("Other chat", false), parseAlert(text("Other chat", false)), hoursAgo(30), hoursAgo(30));
  assert.deepEqual(db.listOpenAlertMessageIds("chat", hoursAgo(24 * 4), hoursAgo(2)), [1]);
});
