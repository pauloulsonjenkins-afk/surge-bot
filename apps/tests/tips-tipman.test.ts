/** TipMan's own strategies, and the betslip links its premium posts carry (20 Nov 2026). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tipsStrategy, TIPMAN_FREE, TIPMAN_PREMIUM, TIPS_STRATEGY } from "../src/tips/track";
import { betslipLinks, storedLinks, wordsWithLinks } from "../src/tips/reader";

test("TipMan's premium channel and its free ones are strategies of their own; other channels stay Telegram tips", () => {
  assert.equal(tipsStrategy("TipMan Tips Premium"), TIPMAN_PREMIUM);
  assert.equal(tipsStrategy("TipMan InPlays & Rollers"), TIPMAN_FREE);
  assert.equal(tipsStrategy("TipMan InPlay Bot"), TIPMAN_FREE);
  assert.equal(tipsStrategy("CVPICKS 🟢💰 Free Betting Club"), TIPS_STRATEGY);
  assert.equal(tipsStrategy(), TIPS_STRATEGY);
});

const POST = "Premium Bookings\n\n1pt for all 3 doubles\n\nBetfair - add to betslip \nPaddy - add to betslip \n\nhttps://www.tipmantips.com/premium-football-tips/";

test("a linked 'add to betslip' word keeps its address; other links are left out", () => {
  const bf = POST.indexOf("Betfair - add to betslip");
  const pp = POST.indexOf("Paddy - add to betslip");
  const m = {
    message: POST,
    entities: [
      { className: "MessageEntityBold", offset: 0, length: 16 },
      { className: "MessageEntityTextUrl", offset: bf, length: "Betfair - add to betslip".length, url: "https://www.betfair.com/sport/football?betslip=abc" },
      { className: "MessageEntityTextUrl", offset: pp, length: "Paddy - add to betslip".length, url: "https://www.paddypower.com/bet?slip=xyz" },
      { className: "MessageEntityTextUrl", offset: 0, length: 7, url: "https://example.com/about" },
    ],
  };
  assert.deepEqual(betslipLinks(m), ["Betfair - add to betslip: https://www.betfair.com/sport/football?betslip=abc", "Paddy - add to betslip: https://www.paddypower.com/bet?slip=xyz"]);
  const stored = wordsWithLinks(POST, { id: 1, ...m });
  assert.ok(stored.startsWith(POST.trimEnd()));
  assert.match(stored, /\n\nBetfair - add to betslip: https:\/\/www\.betfair\.com/);
});

test("a betslip button is read too, and a post without links is unchanged", () => {
  const m = { id: 2, message: "Bet builder", replyMarkup: { rows: [{ buttons: [{ text: "Add to Betfair betslip", url: "https://betfair.com/x" }, { text: "Join", url: "https://t.me/join" }] }] } };
  assert.deepEqual(betslipLinks(m), ["Add to Betfair betslip: https://betfair.com/x"]);
  assert.equal(wordsWithLinks("Just words", { id: 3, message: "Just words" }), "Just words");
  assert.equal(wordsWithLinks("", m), "", "a post with no words is still not stored");
});

test("the stored links are read back for the page's Open betslip buttons", () => {
  const text = `${POST}\n\nBetfair - add to betslip: https://www.betfair.com/sport/x?b=1\nPaddy - add to betslip: https://paddypower.com/y`;
  assert.deepEqual(storedLinks(text), [
    { label: "Betfair - add to betslip", url: "https://www.betfair.com/sport/x?b=1" },
    { label: "Paddy - add to betslip", url: "https://paddypower.com/y" },
  ]);
  assert.deepEqual(storedLinks(POST), [], "the channel's own web address is not a betslip");
});
