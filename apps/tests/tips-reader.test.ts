/** Free tip channels (tips/reader.ts): messages are stored with their reading, and the owner's call survives an edit. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { addTipChannel, getTipChannels, normaliseChannel, recordTip, removeTipChannel } from "../src/tips/reader";

const now = Math.floor(Date.now() / 1000);

test("channels are kept once, however they were typed", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.equal(normaliseChannel("https://t.me/FreeTips"), "@FreeTips");
  assert.equal(normaliseChannel("https://web.telegram.org/a/#-1001401746016"), "-1001401746016");
  assert.equal(normaliseChannel("-1001401746016"), "-1001401746016");
  addTipChannel(db, "t.me/FreeTips");
  addTipChannel(db, "@freetips");
  assert.deepEqual(getTipChannels(db), ["@FreeTips"]);
  assert.deepEqual(removeTipChannel(db, "@FREETIPS"), []);
  assert.throws(() => addTipChannel(db, "  "), /channel name/);
});

test("a message is stored once; an edit re-reads it but keeps the owner's call", () => {
  const db = new EngineDb(":memory:", () => {});
  const m = { chatKey: "-100123", messageId: 7, date: now, text: "Tip: Over 2.5\nAjax vs PSV @ 1.80", channel: "Free tips" };
  assert.equal(recordTip(db, m), true);
  assert.equal(recordTip(db, m), false, "unchanged: nothing to write");
  assert.equal(db.setChannelTipReview("-100123", 7, "not"), true);
  assert.equal(recordTip(db, { ...m, text: m.text + "\nStake 1 unit" }), true);
  const [row] = db.listChannelTips(new Date(Date.now() - 86_400_000).toISOString());
  assert.equal(row!.verdict, "tip");
  assert.equal(row!.review, "not");
  assert.equal(row!.odds, 1.8);
});
