/** use-new-layer.ts: GramJS reads Telegram's current schema, so posts with newer media keep their words. */
import { test } from "node:test";
import assert from "node:assert/strict";
// The reader loads GramJS the way the engine does: the newer schema goes in first.
import "../src/tips/reader";
import { telegramLayer } from "../src/telegram/use-new-layer";
import { TELEGRAM_API_LAYER } from "../src/telegram/api-layer";
import { Api } from "telegram";
import { BinaryReader } from "telegram/extensions";
import { messageWords } from "../src/tips/rich-text";
import { classifyTip } from "../src/tips/classify";
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

test("a rich post (words in page blocks, not in message) is read as the freebie it is", () => {
  const A = Api as unknown as Record<string, new (args: Record<string, unknown>) => { getBytes(): Buffer }>;
  const plain = (text: string) => new A.TextPlain!({ text });
  const para = (...parts: unknown[]) => new A.PageBlockParagraph!({ text: parts.length === 1 ? parts[0] : new A.TextConcat!({ texts: parts }) });
  const rich = new A.RichMessage!({
    blocks: [
      new A.PageBlockHeader!({ text: new A.TextBold!({ text: plain("🔥 FIRST FREEBIE OF THE DAY!!") }) }),
      para(plain("⚽ GOG FCC vs Clube de Salgaocar")),
      para(plain("🎯 "), new A.TextBold!({ text: plain("OVER 2.5 TOTAL GOALS") })),
      para(plain("@ ODDS: 4/7 (1.57)")),
      para(plain("⏰ 10:30 AM UK 🇬🇧 11:30 AM EU 🇪🇺")),
      para(plain("💷 STAKE: £500 🔷 RETURN: £785.71")),
      para(plain("📈 PROFIT: £285.71")),
      new A.PageBlockList!({ items: [new A.PageListItemText!({ text: plain("2/3 matches finished with 3+ goals") })] }),
    ],
    photos: [],
    documents: [],
  });
  const post = new A.Message!({ id: 5380, peerId: new Api.PeerChannel({ channelId: 1401746016 as never }), date: 1794040000, message: "", post: true, richMessage: rich });
  const back = new BinaryReader(post.getBytes()).tgReadObject() as { message: string; richMessage: unknown };
  assert.equal(back.message, "");
  const words = messageWords(back);
  assert.match(words, /^🔥 FIRST FREEBIE OF THE DAY!!\n⚽ GOG FCC vs Clube de Salgaocar\n🎯 OVER 2\.5 TOTAL GOALS\n@ ODDS: 4\/7 \(1\.57\)/);
  const read = classifyTip(words);
  assert.equal(read.verdict, "tip");
  assert.equal(read.match, "GOG FCC v Clube de Salgaocar");
  assert.equal(read.odds, 1.57);
});

test("plain text wins over a rich part, and a message with neither has no words", () => {
  assert.equal(messageWords({ message: "Tip: Arsenal to win @ 1.80" }), "Tip: Arsenal to win @ 1.80");
  assert.equal(messageWords({ message: "" }), "");
  assert.equal(messageWords({ message: "", richMessage: { blocks: [] } }), "");
});

test("buttons the newer layer dropped have stand-ins, so GramJS's own checks don't throw", () => {
  const A = Api as unknown as Record<string, unknown>;
  for (const name of ["KeyboardButtonUrl", "KeyboardButtonCallback", "KeyboardButtonSwitchInline"]) {
    assert.equal(typeof A[name], "function", name);
    assert.equal({} instanceof (A[name] as new () => unknown), false);
  }
});
