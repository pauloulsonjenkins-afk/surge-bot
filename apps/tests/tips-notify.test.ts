/** Free tips notifications (tips/notify.ts): one per fresh proper tip, never for old ones, off when switched off. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { recordTip } from "../src/tips/reader";
import { getTipNotify, notifyNewTips, setTipNotify } from "../src/tips/notify";

const tip = (n: number) => `Tip: Over 2.5 goals\nAjax vs PSV ${n} @ 1.80`;
const noon = new Date("2026-11-03T12:00:00Z");
const post = (db: EngineDb, id: number, minutesBefore: number, text = tip(id)) =>
  recordTip(db, { chatKey: "-1001", messageId: id, date: Math.floor((noon.getTime() - minutesBefore * 60_000) / 1000), text, channel: "Free tips" });
const handled = (db: EngineDb, id: number) => db.listUnnotifiedTips("1970-01-01T00:00:00.000Z").some((t) => t.messageId === id);

test("a fresh tip is handled once; an old one and a non-tip are never sent", async () => {
  const db = new EngineDb(":memory:", () => {});
  post(db, 1, 2); // two minutes ago: fresh
  post(db, 2, 90); // an hour and a half ago: too late to act on
  post(db, 3, 1, "Good morning everyone"); // not a tip
  assert.deepEqual(getTipNotify(db), { on: true, quiet: true });
  await notifyNewTips(db, noon); // no devices subscribed here, so nothing is delivered, but each tip is handled
  assert.equal(handled(db, 1), false, "marked as handled");
  assert.equal(handled(db, 2), false, "an old one is marked too, so it never comes up later");
  assert.equal(db.listChannelTips("1970-01-01T00:00:00.000Z").length, 3);
  assert.equal(await notifyNewTips(db, noon), 0, "nothing left to send the second time");
});

test("switched off, or in quiet hours, nothing is sent but the tip is still marked", async () => {
  const db = new EngineDb(":memory:", () => {});
  setTipNotify(db, { on: false });
  post(db, 1, 1);
  assert.equal(await notifyNewTips(db, noon), 0);
  assert.equal(handled(db, 1), false);
  setTipNotify(db, { on: true });
  const night = new Date("2026-11-03T02:00:00Z");
  recordTip(db, { chatKey: "-1001", messageId: 2, date: Math.floor((night.getTime() - 60_000) / 1000), text: tip(2), channel: "Free tips" });
  assert.equal(await notifyNewTips(db, night), 0, "quiet hours");
  assert.equal(handled(db, 2), false);
});
