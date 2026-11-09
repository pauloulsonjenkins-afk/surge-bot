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


// Both Teams to Score, 9 Nov 2026: all three free tips were missed. The first has "10:30 AM UK" and a "PROFIT:" stake line
// (read as a boast); the second's teams carry digits ("Tai Po U22").
const freebies = [
  `🔥 FIRST FREEBIE OF THE DAY!!
⚽ GOG FCC vs Clube de Salgaocar
🎯 OVER 2.5 TOTAL GOALS
@ ODDS: 4/7 (1.57)
⏰ 10:30 AM UK 🇬🇧 11:30 AM EU 🇪🇺
💷 STAKE: £500 🔷 RETURN: £785.71
📈 PROFIT: £285.71
📊 THE ANALYSIS
🏠 GOG FCC
- 2/3 matches finished with 3+ goals
✈️ CLUBE DE SALGAOCAR`,
  `📢 SECOND FREEBIE OF THE DAY!
Here we go again, family! Another selection I've been looking into this morning 🧐
⚽ Tai Po U22 vs Hong Kong FC U22
🎯 Hong Kong FC U22 TO WIN
@ ODDS: 1/2 (1.50)
⏰ 12:30 UK 🇬🇧 13:30 EU 🇪🇺
💷 STAKE: £500 ➡️ RETURN: £750
💵 PROFIT: £250
📊 QUICK ANALYSIS
Hong Kong FC U22 have won 4 of their first 5 matches, scoring 10 goals and conceding just 4
Tai Po U22 have lost their last 2 games, conceding 8 goals, while Hong Kong FC have won 2 of their last 3 H2H meetings
LET'S GO FOR THAT SECOND GREEN, FAMILY! 🍀🔥`,
  `📢 THIRD FREEBIE OF THE DAY!
We've been working on this one since early morning, family! Another BTTS selection to finish our FREEBIES today!
⚽ Plymouth Parkway vs Berkhamsted
🎯 BOTH TEAMS TO SCORE - YES
@ ODDS: 8/13 (1.62)
⏰ 19:30 UK 🇬🇧 20:30 EU 🇪🇺
💷 STAKE: £500 ➡️ RETURN: £807.69
💵 PROFIT: £307.69
📊 THE ANALYSIS
Plymouth Parkway have scored 9 goals in their last 5 matches, while Berkhamsted have scored 7, finding the net in 4/5
Both teams scored in 3/5 recent matches for each side, giving us a decent statistical basis for BTTS
We've already landed our first green today, let's see if we can add another! 🟢
COME ONNN FAMILY!!! 🔥`,
];

test("the Both Teams to Score freebies are tips, with their match, bet and price", () => {
  const reads = freebies.map(classifyTip);
  assert.deepEqual(reads.map((r) => r.verdict), ["tip", "tip", "tip"]);
  assert.deepEqual(reads.map((r) => r.match), ["GOG FCC v Clube de Salgaocar", "Tai Po U22 v Hong Kong FC U22", "Plymouth Parkway v Berkhamsted"]);
  assert.deepEqual(reads.map((r) => r.odds), [1.57, 1.5, 1.62]);
  assert.match(reads[0]!.selection ?? "", /OVER 2\.5/);
  assert.match(reads[1]!.selection ?? "", /Hong Kong FC U22 TO WIN/);
});

test("a boast with a time but no forward wording is still not a tip", () => {
  assert.notEqual(classifyTip("CASHED!!! Kups wins the first half\nKups vs Inter 1.80\nSee you at 7pm").verdict, "tip");
});
