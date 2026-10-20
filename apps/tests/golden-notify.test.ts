/**
 * Golden alert notifications (golden-notify.ts): off until a slice is switched on, one per alert however many
 * switched-on slices it is in, nothing in quiet hours (23:00-07:00 UK) unless they're off, nothing for an alert
 * recovered too late to act on, and what GoalBrew does with the alert said in words.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { saveSendingSettings } from "../src/inplayguru/bet-feed";
import { getGoldenNotify, goldenNotification, isQuietHour, setGoldenNotify } from "../src/server/golden-notify";

const S = "Time to fight";
const KEY = S.toLowerCase();
const alert = [`🔔 ${S}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", "Lyon vs Nice", "", "Timer: 63'", "Goals: 2 - 0", "Over/Under 2.50 Odds:", "1.80 2.00"].join("\n");
const NOON = new Date("2026-10-20T11:00:00Z"); // 12:00 UK (BST)

function pick(postedAt: Date) {
  const db = new EngineDb(":memory:", () => {});
  db.upsertLivePick("chat", 1, alert, parseAlert(alert), postedAt.toISOString(), postedAt.toISOString());
  const p = db.getLivePickByMessage("chat", 1);
  assert.ok(p, "the pick is stored");
  return { db, p: p! };
}
const twoApart = { id: "two-apart", label: "Golden: 2+ goals apart" };
const other = { id: "c1", label: "Golden: 2-3 goals so far, 60-69'" };

test("off until a slice is switched on; then one notification saying what happens to the alert", () => {
  const { db, p } = pick(new Date(NOON.getTime() - 60_000));
  assert.equal(goldenNotification(db, p, [twoApart], NOON), null, "nothing by default");
  setGoldenNotify(db, { slice: { strategyKey: KEY, id: "two-apart", on: true } });
  const m = goldenNotification(db, p, [twoApart], NOON);
  assert.ok(m);
  assert.equal(m!.tag, `golden-${p.id}`);
  assert.match(m!.title, /^Golden alert · /);
  assert.match(m!.body, /2\+ goals apart/);
  assert.match(m!.body, /Lyon v Nice, 63'/);
  assert.match(m!.body, /Sim: not bet/);
  assert.deepEqual(m!.muteSlice, { strategyKey: KEY, id: "two-apart", name: "2+ goals apart" });
  // Its own Golden betting Live: said so.
  saveSendingSettings(db, { enabled: true, segmentBets: { [`${KEY}#two-apart`]: { live: true, stakePct: 2 } } });
  assert.match(goldenNotification(db, p, [twoApart], NOON)!.body, /Bet Live at 2%/);
});

test("an alert in two switched-on slices is one notification naming both; a switched-off slice isn't named", () => {
  const { db, p } = pick(new Date(NOON.getTime() - 60_000));
  setGoldenNotify(db, { slice: { strategyKey: KEY, id: "two-apart", on: true } });
  setGoldenNotify(db, { slice: { strategyKey: KEY, id: "c1", on: true } });
  assert.match(goldenNotification(db, p, [twoApart, other], NOON)!.body, /2\+ goals apart · 2-3 goals so far/);
  setGoldenNotify(db, { slice: { strategyKey: KEY, id: "c1", on: false } });
  assert.doesNotMatch(goldenNotification(db, p, [twoApart, other], NOON)!.body, /2-3 goals/);
  assert.deepEqual(getGoldenNotify(db).slices, { [`${KEY}#two-apart`]: true });
});

test("quiet hours: nothing 23:00-07:00 UK unless switched off", () => {
  const late = new Date("2026-10-20T22:30:00Z"); // 23:30 UK
  assert.equal(isQuietHour(late), true);
  assert.equal(isQuietHour(new Date("2026-10-20T06:30:00Z")), false); // 07:30 UK
  const { db, p } = pick(new Date(late.getTime() - 60_000));
  setGoldenNotify(db, { slice: { strategyKey: KEY, id: "two-apart", on: true } });
  assert.equal(getGoldenNotify(db).quiet, true, "on by default");
  assert.equal(goldenNotification(db, p, [twoApart], late), null);
  setGoldenNotify(db, { quiet: false });
  assert.ok(goldenNotification(db, p, [twoApart], late));
});

test("an alert recovered more than 10 minutes after it was posted isn't notified", () => {
  const { db, p } = pick(new Date(NOON.getTime() - 20 * 60_000));
  setGoldenNotify(db, { slice: { strategyKey: KEY, id: "two-apart", on: true } });
  assert.equal(goldenNotification(db, p, [twoApart], NOON), null);
});
