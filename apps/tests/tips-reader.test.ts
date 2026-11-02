/** Free tip channels (tips/reader.ts): messages are stored with their reading, and the owner's call survives an edit. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { addTipChannel, getTipChannels, normaliseChannel, recordTip, removeTipChannel, rescoreChannel } from "../src/tips/reader";

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

const withFooter = (a: string, b: string, odds: string) => `Tip: Over 2.5 goals\n${a} vs ${b} @ ${odds}\n\nWant more tips like this? Join our VIP group`;

test("a message that reads like one you confirmed from the same channel moves with it; another channel is left alone", () => {
  const db = new EngineDb(":memory:", () => {});
  const add = (id: number, chat: string, text: string) => recordTip(db, { chatKey: chat, messageId: id, date: now - 1000 + id, text, channel: chat });
  add(1, "-1001", "COMPLETELY DIFFERENT CHATTER ABOUT NOTHING MUCH AT ALL TODAY");
  add(2, "-1001", withFooter("Gangwon FC", "Kuching City", "1.48"));
  add(3, "-1001", withFooter("Porto", "Benfica", "2.10"));
  add(4, "-1002", withFooter("Porto", "Benfica", "2.10"));
  const verdict = (chat: string, id: number) => db.listChannelTips("1970-01-01T00:00:00.000Z").find((r) => r.chatKey === chat && r.messageId === id)!;
  assert.equal(verdict("-1001", 3).verdict, "maybe", "a tip with a join-VIP footer is only a maybe on its own");
  db.setChannelTipReview("-1001", 2, "tip");
  assert.ok(rescoreChannel(db, "-1001") >= 1);
  assert.equal(verdict("-1001", 3).verdict, "tip");
  assert.match(verdict("-1001", 3).reasons.join(" "), /reads like a tip you confirmed/);
  assert.equal(verdict("-1001", 1).verdict, "other", "unlike it: unchanged");
  assert.equal(verdict("-1002", 4).verdict, "maybe", "another channel does not learn from this one");
});

test("a message is stored once; an edit re-reads it but keeps the owner's call", () => {
  const db = new EngineDb(":memory:", () => {});
  const m = { chatKey: "-100123", messageId: 7, date: now, text: "Tip: Over 2.5\nAjax vs PSV @ 1.80", channel: "Free tips" };
  assert.equal(recordTip(db, m), true);
  assert.equal(recordTip(db, m), false, "unchanged: nothing to write");
  assert.equal(db.setChannelTipReview("-100123", 7, "not"), true);
  assert.equal(recordTip(db, { ...m, text: m.text + "\nStake 1 unit" }), true);
  const [row] = db.listChannelTips(new Date(Date.now() - 86_400_000).toISOString());
  // It now reads like the one marked Not a tip (its own earlier text), so it is held back as "maybe".
  assert.equal(row!.verdict, "maybe");
  assert.match(row!.reasons.join(" "), /marked Not a tip/);
  assert.equal(row!.review, "not");
  assert.equal(row!.odds, 1.8);
});
