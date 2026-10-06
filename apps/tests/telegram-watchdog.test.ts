import { test } from "node:test";
import assert from "node:assert/strict";
import { telegramProblems, watchdogStep, type WatchdogState } from "../src/server/telegram-watchdog";

const started = new Date("2026-10-06T08:00:00Z");
const ok = { watching: "123", lastSyncAt: "2026-10-06T12:55:00Z", lastSyncError: null };
const clean: WatchdogState = { alertedAt: null, lastReminderAt: null, reasons: [] };

test("watchdog: no problems while connected and alerts are recent", () => {
  assert.deepEqual(telegramProblems({ now: new Date("2026-10-06T13:00:00Z"), startedAt: started, configured: true, listener: ok, lastPickAt: "2026-10-06T12:30:00Z" }), []);
});

test("watchdog: not watching counts only after the restart grace period", () => {
  const listener = { ...ok, watching: null };
  assert.deepEqual(telegramProblems({ now: new Date(started.getTime() + 60_000), startedAt: started, configured: true, listener, lastPickAt: null }), []);
  const later = telegramProblems({ now: new Date(started.getTime() + 10 * 60_000), startedAt: started, configured: true, listener, lastPickAt: null });
  assert.equal(later.length, 1);
  assert.match(later[0]!, /isn't connected/);
});

test("watchdog: quiet is 3 hours in the day (UK) and 8 hours at night", () => {
  // 15:00 BST, last alert 3.5h ago: a problem.
  assert.equal(telegramProblems({ now: new Date("2026-10-06T14:00:00Z"), startedAt: started, configured: true, listener: ok, lastPickAt: "2026-10-06T10:30:00Z" }).length, 1);
  // 05:00 BST, last alert 5.5h ago: normal for the night.
  assert.equal(telegramProblems({ now: new Date("2026-10-07T04:00:00Z"), startedAt: started, configured: true, listener: ok, lastPickAt: "2026-10-06T22:30:00Z" }).length, 0);
});

test("watchdog: nothing when Telegram isn't set up", () => {
  assert.deepEqual(telegramProblems({ now: new Date("2026-10-06T14:00:00Z"), startedAt: started, configured: false, listener: { ...ok, watching: null }, lastPickAt: null }), []);
});

test("watchdog: alert once, remind after 3 hours, then say when it's back", () => {
  const t0 = new Date("2026-10-06T14:00:00Z");
  const a = watchdogStep(clean, ["down"], t0);
  assert.equal(a.action.kind, "alert");
  const b = watchdogStep(a.state, ["down"], new Date(t0.getTime() + 60 * 60_000));
  assert.equal(b.action.kind, "none");
  const c = watchdogStep(b.state, ["down"], new Date(t0.getTime() + 3 * 60 * 60_000));
  assert.equal(c.action.kind, "remind");
  const d = watchdogStep(c.state, [], new Date(t0.getTime() + 4 * 60 * 60_000));
  assert.equal(d.action.kind, "recovered");
  assert.deepEqual(d.state, clean);
  assert.equal(watchdogStep(d.state, [], new Date(t0.getTime() + 5 * 60 * 60_000)).action.kind, "none");
});
