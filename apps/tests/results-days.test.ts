/**
 * Checks the Results page's date windows: UK day boundaries (including the days the clocks change),
 * the last-24-hours window, and the list of days that have picks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { isUkDate, ukDayBounds } from "../src/server/uk-time";

const alert = (n: number, result?: "hit" | "miss") =>
  [
    "🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

/** Stores a pick as if it first arrived at `iso`. */
function put(db: EngineDb, n: number, iso: string, result?: "hit" | "miss") {
  const t = alert(n, result);
  db.upsertLivePick("chat", n, t, parseAlert(t), iso);
  // first_seen_at is set by the database when the row is created; back-date it for the test
  (db as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db
    .prepare(`UPDATE live_picks SET first_seen_at = ? WHERE message_id = ?`)
    .run(iso, n);
}

test("UK day bounds are right in winter, in summer, and on the days the clocks change", () => {
  assert.deepEqual(ukDayBounds("2026-01-15"), { from: "2026-01-15T00:00:00.000Z", to: "2026-01-16T00:00:00.000Z" });   // GMT
  assert.deepEqual(ukDayBounds("2026-07-15"), { from: "2026-07-14T23:00:00.000Z", to: "2026-07-15T23:00:00.000Z" });   // BST
  assert.deepEqual(ukDayBounds("2026-03-29"), { from: "2026-03-29T00:00:00.000Z", to: "2026-03-29T23:00:00.000Z" });   // clocks go forward: a 23-hour day
  assert.deepEqual(ukDayBounds("2026-10-25"), { from: "2026-10-24T23:00:00.000Z", to: "2026-10-26T00:00:00.000Z" });   // clocks go back: a 25-hour day
});

test("dates are validated", () => {
  assert.equal(isUkDate("2026-09-29"), true);
  assert.equal(isUkDate("2026-13-40"), false);
  assert.equal(isUkDate("29/09/2026"), false);
  assert.equal(isUkDate("'; DROP TABLE"), false);
});

test("a chosen day returns only that UK day's picks, including just before and after midnight", () => {
  const db = new EngineDb(":memory:", () => {});
  put(db, 1, "2026-07-14T22:59:00.000Z");   // 23:59 UK on the 14th
  put(db, 2, "2026-07-14T23:01:00.000Z");   // 00:01 UK on the 15th
  put(db, 3, "2026-07-15T12:00:00.000Z");   // midday on the 15th
  put(db, 4, "2026-07-15T22:59:00.000Z");   // 23:59 UK on the 15th
  put(db, 5, "2026-07-15T23:01:00.000Z");   // 00:01 UK on the 16th
  const day15 = db.listLivePicks(100, ukDayBounds("2026-07-15")).map((p) => p.messageId).sort();
  assert.deepEqual(day15, [2, 3, 4]);
  assert.deepEqual(db.listLivePicks(100, ukDayBounds("2026-07-14")).map((p) => p.messageId), [1]);
});

test("the last 24 hours window excludes older picks", () => {
  const db = new EngineDb(":memory:", () => {});
  const now = Date.now();
  put(db, 1, new Date(now - 2 * 3_600_000).toISOString());
  put(db, 2, new Date(now - 23 * 3_600_000).toISOString());
  put(db, 3, new Date(now - 25 * 3_600_000).toISOString());
  const range = { from: new Date(now - 24 * 3_600_000).toISOString(), to: new Date(now + 60_000).toISOString() };
  assert.deepEqual(db.listLivePicks(100, range).map((p) => p.messageId).sort(), [1, 2]);
});

test("a big day isn't cut off at 200 picks, and the no-window call is still capped", () => {
  const db = new EngineDb(":memory:", () => {});
  for (let i = 1; i <= 260; i++) put(db, i, "2026-07-15T12:00:00.000Z");
  assert.equal(db.listLivePicks(1000, ukDayBounds("2026-07-15")).length, 260);
  assert.equal(db.listLivePicks(1000).length, 200);
});

test("the day list is newest first with counts, ignoring removed picks in the hit and miss tallies", () => {
  const db = new EngineDb(":memory:", () => {});
  put(db, 1, "2026-07-14T12:00:00.000Z", "hit");
  put(db, 2, "2026-07-15T12:00:00.000Z", "hit");
  put(db, 3, "2026-07-15T13:00:00.000Z", "miss");
  put(db, 4, "2026-07-15T14:00:00.000Z");
  const removed = db.listLivePicks(10).find((p) => p.messageId === 3)!;
  db.setPickExcluded(removed.id, true);
  const days = db.listPickDays();
  assert.deepEqual(days.map((d) => d.date), ["2026-07-15", "2026-07-14"]);
  assert.deepEqual(days[0], { date: "2026-07-15", picks: 3, hits: 1, misses: 0 });
});
