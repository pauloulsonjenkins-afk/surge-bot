/**
 * The catch-up sync must never take a result away (telegram/listener.ts, isStaleSyncCopy): Telegram can return the text
 * from before the full-time edit for a few seconds after it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { isStaleSyncCopy } from "../src/telegram/listener";

const text = (settled: boolean) =>
  ["🔔 Time to fight", "", "🇵🇱 Poland III Liga (3rd vs 9th)", "Stal vs Odra", "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "1.60 2.20",
    ...(settled ? ["", "⸻⸻ Match Summary ⸻⸻", "", "Half-Time Score: 0-0", "Full-Time Score: 0-0", "", "❌ Miss"] : [])].join("\n");

test("an older copy without the result is not stored over a settled alert", () => {
  const db = new EngineDb(":memory:", () => {});
  db.upsertLivePick("chat", 1, text(true), parseAlert(text(true)));
  assert.equal(isStaleSyncCopy(db, "chat", 1, text(false)), true);
});

test("a copy that brings the result is still stored", () => {
  const db = new EngineDb(":memory:", () => {});
  db.upsertLivePick("chat", 1, text(false), parseAlert(text(false)));
  assert.equal(isStaleSyncCopy(db, "chat", 1, text(true)), false);
  assert.equal(isStaleSyncCopy(db, "chat", 2, text(false)), false);
});
