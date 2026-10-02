/**
 * Checks the daily summary notification: it is due at each set UK time (summer and winter), only once, and still goes
 * out a few minutes late after a restart, but not long after.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { buildDailySummary, dueSummary } from "../src/server/daily-summary";

test("due at each UK time, in summer time (BST) and winter time (GMT)", () => {
  // 2 Oct is BST: 14:00 UK = 13:00 UTC.
  assert.equal(dueSummary(null, new Date("2026-10-02T13:00:20Z")), "2026-10-02 14:00");
  assert.equal(dueSummary(null, new Date("2026-10-02T05:50:00Z")), "2026-10-02 06:50");
  assert.equal(dueSummary(null, new Date("2026-10-02T20:30:00Z")), "2026-10-02 21:30");
  // 2 Dec is GMT: 17:00 UK = 17:00 UTC.
  assert.equal(dueSummary(null, new Date("2026-12-02T17:00:00Z")), "2026-12-02 17:00");
  assert.equal(dueSummary(null, new Date("2026-12-02T16:00:00Z")), null);
});

test("sent once, a few minutes late at most", () => {
  const at = new Date("2026-10-02T13:04:00Z"); // 14:04 UK
  assert.equal(dueSummary(null, at), "2026-10-02 14:00", "a restart just after the time still sends it");
  assert.equal(dueSummary("2026-10-02 14:00", at), null, "not twice");
  assert.equal(dueSummary(null, new Date("2026-10-02T13:30:00Z")), null, "not half an hour late");
  assert.equal(dueSummary("2026-10-02 14:00", new Date("2026-10-02T16:00:00Z")), "2026-10-02 17:00");
  assert.equal(dueSummary("2026-10-01 21:30", new Date("2026-10-02T05:51:00Z")), "2026-10-02 06:50", "a new day");
});

test("a day with nothing settled says so", () => {
  const db = new EngineDb(":memory:", () => {});
  const m = buildDailySummary(db, new Date("2026-10-02T13:00:00Z"));
  assert.match(m.title, /14:00: no results yet today/);
});
