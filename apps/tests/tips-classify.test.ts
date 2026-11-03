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

test("a shouty, all-caps tip that looks ahead (CVPICKS Thursday free bet) is a tip", () => {
  const tip =
    "🚨🎁 THURSDAY FREE BET IS HERE!!! ⚽🔥\n\nGOOD MORNING, CV PICKS FAMILY!!! 🟢\n\nAfter another brilliant Wednesday, we're ready to keep the momentum going! 🚀\n\n🏆 GANGWON FC VS KUCHING CITY FC\n🎯 GANGWON FC TO WIN\n💰 ODDS @1.48\n⏰ 10:00 UK | 11:00 EU\n\nWe're backing Gangwon FC to take the victory! ⚽💪\n\nLET'S KICK OFF THURSDAY WITH ANOTHER BIG GREEN!!! 🐐";
  const r = classifyTip(tip);
  assert.equal(r.verdict, "tip");
  assert.equal(r.match, "GANGWON FC v KUCHING CITY FC");
  assert.equal(r.odds, 1.48);
  assert.match(r.selection ?? "", /GANGWON FC TO WIN/);
});

test("a live in-play post (CVPICKS 'live free pick alert') is a tip with its match and selection", () => {
  const r = classifyTip("🚨⚽ LIVE FREE PICK ALERT!!! 🔥🔥\n\nWE'VE FOUND ANOTHER LIVE OPPORTUNITY, FAMILY!!! 👀💰\n\n🏆 AL JEEL VS AL NAJMA\n\n⏱️ 4TH MINUTE | 0-0\n🎯 AL NAJMA TO WIN\n💰 ODDS @1.57\n\nWE'RE BACKING AL NAJMA TO TAKE ALL THREE POINTS AWAY FROM HOME!!! 💪⚽\n\nPLENTY OF FOOTBALL STILL TO PLAY!!! 🎯🔥\n\nLET'S GO FOR ANOTHER BIG GREEN!!! 🚀🟢🔥");
  assert.equal(r.verdict, "tip");
  assert.equal(r.match, "AL JEEL v AL NAJMA");
  assert.equal(r.odds, 1.57);
  assert.match(r.selection ?? "", /AL NAJMA TO WIN/);
});

test("a bet stated outright with its match needs no price: it is priced from Betfair when tracked", () => {
  assert.equal(classifyTip("Tip: Man City to win\nMan City vs Fulham").verdict, "tip");
  // Both Teams to Score channel, 3 Nov 2026: never quotes a price.
  const r = classifyTip("▶️▶️ FIRST FREEBIE IS LIVE! ▶️▶️\n🇨🇳 Hebei W vs Qingdao West Coast W\n🔣QINGDAO WEST COAST TO WIN\nOur first selection of the day is officially in play! 💥💥\nCOME ON QINGDAO, LET'S GET THAT FIRST GREEN!");
  assert.equal(r.verdict, "tip");
  assert.equal(r.match, "Hebei W v Qingdao West Coast W");
  assert.equal(r.odds, null);
  assert.match(r.selection ?? "", /QINGDAO WEST COAST TO WIN/);
});

test("a match and a market with no stated bet, or a stated bet mixed with a link, still isn't a tip", () => {
  assert.equal(classifyTip("Tip of the day, goals galore\nMan City vs Fulham").verdict, "maybe");
  assert.notEqual(classifyTip("Man City to win\nMan City vs Fulham\nJoin free: https://t.me/+abc123").verdict, "tip");
});
