/** use-new-layer.ts: GramJS reads Telegram's current schema, so posts with newer media keep their words. */
import { test } from "node:test";
import assert from "node:assert/strict";
// The reader loads GramJS the way the engine does: the newer schema goes in first.
import "../src/tips/reader";
import { telegramLayer } from "../src/telegram/use-new-layer";
import { TELEGRAM_API_LAYER } from "../src/telegram/api-layer";
import { Api } from "telegram";
import { BinaryReader } from "telegram/extensions";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const all = require("telegram/tl/AllTLObjects") as { LAYER: number };

test("GramJS runs on the newer layer and announces it when connecting", () => {
  assert.equal(telegramLayer, TELEGRAM_API_LAYER);
  assert.equal(all.LAYER, TELEGRAM_API_LAYER);
  assert.ok(TELEGRAM_API_LAYER > 198);
});

test("a channel post with a bet-slip card (a widget) is read with its words, not as 'unsupported'", () => {
  const A = Api as unknown as Record<string, new (args: Record<string, unknown>) => { getBytes(): Buffer }>;
  const text = "📢 THIRD FREEBIE OF THE DAY!\n⚽ Plymouth Parkway vs Berkhamsted\n🎯 BOTH TEAMS TO SCORE - YES\n@ ODDS: 8/13 (1.62)";
  const media = new A.MessageMediaWidget!({ width: 400, height: 300, payload: Buffer.from("slip") });
  const post = new A.Message!({ id: 5386, peerId: new Api.PeerChannel({ channelId: 1401746016 as never }), date: 1794067081, message: text, media, post: true });
  const back = new BinaryReader(post.getBytes()).tgReadObject() as { className: string; message: string; media: { className: string } };
  assert.equal(back.className, "Message");
  assert.equal(back.media.className, "MessageMediaWidget");
  assert.equal(back.message, text);
});

test("buttons the newer layer dropped have stand-ins, so GramJS's own checks don't throw", () => {
  const A = Api as unknown as Record<string, unknown>;
  for (const name of ["KeyboardButtonUrl", "KeyboardButtonCallback", "KeyboardButtonSwitchInline"]) {
    assert.equal(typeof A[name], "function", name);
    assert.equal({} instanceof (A[name] as new () => unknown), false);
  }
});
