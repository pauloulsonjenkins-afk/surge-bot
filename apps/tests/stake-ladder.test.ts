import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { ladderStep, strategyAdvice, applyAdvice } from "../src/server/strategy-advice";
import { buildWeeklyReview, dueWeeklyReview } from "../src/server/weekly-review";
import { saveSendingSettings, getSendingSettings } from "../src/inplayguru/bet-feed";

test("the stake ladder moves one step at a time and stops at its ends", () => {
  assert.deepEqual(ladderStep({ pct: 2 }, 1), { pct: 3 });
  assert.deepEqual(ladderStep({ pct: 2 }, -1), { pct: 1.5 });
  assert.deepEqual(ladderStep({ pct: 2.5 }, 1), { pct: 3 }, "an off-ladder stake goes to the next step");
  assert.equal(ladderStep({ pct: 5 }, 1), null);
  assert.equal(ladderStep({ pct: 1 }, -1), null);
  assert.deepEqual(ladderStep({ flat: 2 }, 1), { flat: 3 });
  assert.equal(ladderStep({ flat: 1 }, -1), null);
});

test("no suggestions and nothing applied without enough bets", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, strategies: { "favourite pressure 2nd half": true }, stakePct: { "favourite pressure 2nd half": 2 } });
  assert.deepEqual(strategyAdvice(db), []);
  assert.throws(() => applyAdvice(db, "favourite pressure 2nd half", "stake-up"), /no longer applies/);
  assert.equal(getSendingSettings(db).stakePct["favourite pressure 2nd half"], 2, "the stake is untouched");
});

test("the Sunday review is due once, from 19:00 UK on Sunday", () => {
  const sun = new Date("2026-10-18T18:05:00Z"); // 19:05 UK (BST)
  const monday = dueWeeklyReview(null, sun);
  assert.equal(monday, "2026-10-12");
  assert.equal(dueWeeklyReview(monday, sun), null, "sent already");
  assert.equal(dueWeeklyReview(null, new Date("2026-10-18T16:00:00Z")), null, "17:00 UK: not yet");
  assert.equal(dueWeeklyReview(null, new Date("2026-10-17T18:05:00Z")), null, "Saturday");
  const msg = buildWeeklyReview(new EngineDb(":memory:", () => {}), sun);
  assert.match(msg.title, /GoalBrew week: Live/);
  assert.match(msg.body, /No changes suggested/);
});
