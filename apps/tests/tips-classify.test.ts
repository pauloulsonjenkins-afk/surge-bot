/** Free tip channels (tips/classify.ts): a real tip is told from the premium adverts in the same channel. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTip } from "../src/tips/classify";

test("a plain tip is a tip, with its match, price and stake read out", () => {
  const r = classifyTip("⚽ Tip: Over 2.5 goals\nArsenal vs Chelsea\nOdds: 1.85\nStake 2 units");
  assert.equal(r.verdict, "tip");
  assert.equal(r.match, "Arsenal v Chelsea");
  assert.equal(r.odds, 1.85);
  assert.match(r.selection ?? "", /Over 2.5 goals/);
  assert.match(r.stake ?? "", /2 units/);
});

test("fractional prices are turned into decimal", () => {
  const r = classifyTip("Bet: Liverpool to win\nLiverpool v Everton @ 4/6");
  assert.equal(r.verdict, "tip");
  assert.equal(r.odds, 1.67);
});

test("a premium advert is an advert", () => {
  const r = classifyTip("🔥 JOIN OUR VIP GROUP 🔥 100% guaranteed wins, only 5 spots left! DM @admin or t.me/vipwins");
  assert.equal(r.verdict, "advert");
});

test("a tip with a join-VIP footer is only 'maybe'", () => {
  const r = classifyTip("Tip: BTTS\nSpurs vs West Ham @ 1.90\n\nWant more? Join our VIP");
  assert.equal(r.verdict, "maybe");
});

test("a tip buried in heavy selling is an advert", () => {
  const r = classifyTip("Tip: Over 2.5\nAjax vs PSV @ 1.80\nJoin VIP now, guaranteed 100% profit, limited spots, DM admin, https://x.com");
  assert.equal(r.verdict, "advert");
});

test("results and chatter are not tips", () => {
  assert.equal(classifyTip("✅ Won! Arsenal 2-0 Chelsea").verdict, "other");
  assert.equal(classifyTip("Good morning everyone").verdict, "other");
  assert.equal(classifyTip("   ").verdict, "other");
});

test("a celebration of a bet already won is not a tip, even though it names the match and price", () => {
  const brag = "STAKE 50 COMPENSATION CASHEEEEEEEEEED!!! 🔥\n\nBOOOOOOOOM!!!\n\nKUPS KUOPIO WINS THE FIRST HALF!!!\n\n🏆 KuPS Kuopio vs IF Gnistan\nKuPS TO WIN FIRST HALF @1.90";
  const r = classifyTip(brag);
  assert.equal(r.verdict, "other");
  assert.match(r.reasons[0] ?? "", /already won/);
  // a forward-looking tip that says "to win" is still a tip
  assert.equal(classifyTip("Tip: Liverpool to win\nLiverpool v Everton @ 1.70").verdict, "tip");
});

test("a bet with no price is worth a look, not a tip", () => {
  const r = classifyTip("Tip: Man City to win\nMan City vs Fulham");
  assert.equal(r.verdict, "maybe");
});
