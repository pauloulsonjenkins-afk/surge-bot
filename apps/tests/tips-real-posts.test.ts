/**
 * Real posts from the owner's channels that were missed or misread (reviewed 14 Nov 2026): 8 of 26 free tips in four
 * days were recorded. Each is here with what it should be read as (tips/classify.ts, tips/track.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { classifyTip } from "../src/tips/classify";
import { mergeOldTipStrategies, readTipBet, resultFromPost, settleChannelPricePicks, trackTips, TIPS_STRATEGY } from "../src/tips/track";
import { computeStrategyReturns } from "../src/server/winloss";
import { settleValuePicks } from "../src/edge/value-strategy";
import { recordTip } from "../src/tips/reader";

const bet = (text: string) => {
  const r = classifyTip(text);
  const [home = "", away = ""] = (r.match ?? "").split(" v ");
  return { ...r, read: readTipBet(r.selection, text, home, away) };
};

test("a live pick with exclamation marks is a tip, not a celebration (CVPICKS)", () => {
  const r = bet("🚨⚽ LIVE PICK ALERT!!! 🔥🔥\n🇫🇷 ST-OUEN L’AUMÔNE VS BOULOGNE\n⏱️ 63RD MINUTE | 1-0\n🎯 BOULOGNE OR DRAW (X2)\n💎 ODDS: 1.72\nWe’ve spotted an interesting opportunity in the live market! 👀📊\nLET’S SEE IF BOULOGNE CAN TURN THIS AROUND!!! 💣🔥\nVAMOOOOOS, FAMILY!!! 🚀🟢");
  assert.equal(r.verdict, "tip");
  assert.equal(r.match, "ST-OUEN L’AUMÔNE v BOULOGNE");
  assert.equal(r.odds, 1.72);
  assert.deepEqual(r.read, { marketType: "DOUBLE_CHANCE", selectionName: "draw-or-away", words: "BOULOGNE or draw" });
});

test("a live tip whose write-up says a team 'won' earlier is still a tip (PRIME BET)", () => {
  const r = bet("⚽️⚽️⚽️\n🗓️Wednesday, November 11\n🇦🇹Austria U19 vs Belarus U19 🇧🇾\n🏆UEFA European U19 Championship Qualification\n🔴LIVE\n🚀Over 1.5 Goals\n➡️Odds 1.86\n✍️I’m going with Over 1.5 goals here. Austria won the reverse fixture 2:0, and with the game still goalless I’m backing a more open finish.");
  assert.equal(r.verdict, "tip");
  assert.deepEqual(r.read, { marketType: "OVER_UNDER_15", selectionName: "Over 1.5 Goals", words: "Over 1.5 goals" });
});

test("the bet is the bet line, not a sentence of the write-up that says 'this pick:' (PRIME BET)", () => {
  const r = bet("⚽️⚽️⚽️\n🗓️Thursday, November 12\n🇪🇸CS Puertollano vs Albacete Balompié\n🏆Spanish Copa del Rey\n🚀Albacete to Win (W2)\n➡️Odds 1.55\n✍️I’m backing Albacete to win in normal time. That gap in competition is the main argument behind this pick: Albacete regularly face stronger opposition and know half-time adjustments well.");
  assert.equal(r.verdict, "tip");
  assert.equal(r.selection, "🚀Albacete to Win (W2)");
  assert.equal((r.read as { selectionName: string }).selectionName, "away");
});

test("a first-half goals tip is tracked in Betfair's first-half market", () => {
  const r = bet("💥 THIRD FREEBIE OF THE DAY!\n⚽ Armenia vs Cyprus\n🎯 OVER 0.5 FIRST-HALF GOALS\n📊 ODDS: 1/2 (1.50)\n⏰ 17:00 UK 🇬🇧 18:00 EU 🇪🇺\n💷 STAKE: £500");
  assert.equal(r.verdict, "tip");
  assert.deepEqual(r.read, { marketType: "FIRST_HALF_GOALS_05", selectionName: "Over 0.5 Goals", words: "Over 0.5 first-half goals" });
});

test("double chance for the home side; a write-up that mentions cards or half-time doesn't rule a bet out", () => {
  const r = bet("🎁⚽ FRIDAY’S FREE BET IS HERE!!! 🔥🟢\n🏆 AL NAIRYAH VS AL-SAHEL CLUB\n🎯 AL NAIRYAH OR DRAW (1X)\n💵 ODDS @1.44\n⏰ 12:55 EU | 11:55 UK\nA win or a draw will land our selection, whatever the cards or the half-time score! ⚽🎯");
  assert.equal(r.verdict, "tip");
  assert.equal((r.read as { selectionName: string }).selectionName, "home-or-draw");
});

test("bets that can't be priced say why: two in one, Asian lines, other sports", () => {
  assert.match((readTipBet("England to Win + Over 1.5 Total Goals", "", "England", "Croatia") as { reason: string }).reason, /Two bets in one/);
  assert.match((readTipBet("Over 2.0 Total Goals", "", "Bulgaria", "Iceland") as { reason: string }).reason, /Asian goal lines/);
  assert.match((readTipBet("OVER 165.5 POINTS", "", "CHANGWON SAKERS", "SEOUL KNIGHTS") as { reason: string }).reason, /Only football/);
});

test("reminders, recaps and adverts are not tips, and their headings are not matches", () => {
  assert.equal(classifyTip("🚨 FIRST FREEBIE STARTING SOON!\n⚽️ Kawasaki Frontale vs Kashiwa Reysol\nBTTS YES @1.50\nCOME ONNN FAMILY!!! 🟢💰").verdict, "other");
  assert.equal(classifyTip("🔄🔄 FREEBIES RECAP! 🔄🔄\n✅ FIRST FREEBIE Kawasaki vs Kashiwa BTTS 💲\n❌ SECOND FREEBIE\n💰 +£629.11 PROFIT").verdict, "other");
  assert.equal(classifyTip("🟢🔥 THIRD FREEBIE CASHED!!!\nArmenia vs Cyprus\nOver 0.5 First-Half Goals ✅\n💰 £750 RETURN").verdict, "other");
  // A boasting headline wins even when a kick-off-style time appears further down.
  const cashed = classifyTip("💣🟢 STAKE 50 CASHEEEEEEEEEED!!! 🔥🔥🔥\nBOOOOOOOOOOM!!! 🤯💵\n⚽ REAL SOCIEDAD B 2-2 SPORTING\n🎯 OVER 2.5 GOALS — CASHED!!! ✅\nNEXT ONE IS HERE AT 18:00 UK");
  assert.notEqual(cashed.verdict, "tip");
  for (const advert of [
    "🎁 TOP ACCA — STAKE 10 🎁\n🔥 BIG ODDS + REAL VALUE 🔥\n👉 Join AllSports Betting Forum: https://t.me/+62cC8WnOdigxMTBk",
    "Todays Premium BTTS Acca\n4.95/1- 3 points advised  best priced\nAdd to betslip - Betfair\nAdd to betslip - PaddyPower\nhttps://www.tipmantips.com/premium-football-tips/\n18+ GambleAware #ad",
    "🔥FREE vs VIP - WHAT’S THE DIFFERENCE?\nFree picks are a way to show you our approach.\nBut VIP goes deeper. 👇",
  ]) {
    const r = classifyTip(advert);
    assert.equal(r.match, null, advert.slice(0, 30));
    assert.notEqual(r.verdict, "tip");
  }
});

test("an in-play single with a fraction price reads its odds (TipMan InPlays)", () => {
  const r = bet("InPlay Single\nFleetwood v Tranmere\nOver 0.5 Match Goals ☑️\nEngland\n4/6 - 5 points advised");
  assert.equal(r.verdict, "tip");
  assert.equal(r.odds, 1.67);
  assert.equal((r.read as { marketType: string }).marketType, "OVER_UNDER_05");
});

test("every channel records as one strategy, and the old one-per-channel strategies are reported under it", async () => {
  const db = new EngineDb(":memory:", () => {});
  const kickoff = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const reader = {
    searchEvents: async () => [{ id: "e1", name: "Ajax v PSV", openDate: kickoff }],
    checkBet: async () => ({ status: "ok" as const, price: 1.9, runners: [], marketId: "1.23", selectionId: 55 }),
  };
  // A pick from before, under its channel's own name.
  db.addEdgePick({ messageId: 1, strategy: "Telegram: Old channel", selection: "Over 2.5 goals", competition: "Unknown", country: "", home: "A", away: "B", text: "x", detail: { strategyRaw: "Telegram: Old channel" } as never, event: "A v B", eventId: "e0", odds: 2, simRowJson: null, at: new Date().toISOString() });
  recordTip(db, { chatKey: "-1001", messageId: 5, date: Math.floor(Date.now() / 1000), text: "Tip: Over 2.5 goals\nAjax vs PSV @ 1.80", channel: "Channel one" });
  recordTip(db, { chatKey: "-1002", messageId: 6, date: Math.floor(Date.now() / 1000), text: "Tip: BTTS yes\nAjax vs PSV @ 1.70", channel: "Channel two" });
  assert.equal(await trackTips(db, reader), 2);
  assert.deepEqual([...new Set(db.listOpenEdgePicks().map((p) => p.detail.strategyRaw))].sort(), [TIPS_STRATEGY, "Telegram: Old channel"].sort());
  assert.equal(db.getStrategyMerges()["telegram: old channel"], TIPS_STRATEGY);
  assert.equal(mergeOldTipStrategies(db), 0, "merged once only");
});

test("results are read from a channel's later posts: a tick or 'cashed' is a hit, a cross a miss, a recap line by line", () => {
  assert.equal(resultFromPost("🟢🔥 THIRD FREEBIE CASHED!!!\nArmenia vs Cyprus\nOver 0.5 First-Half Goals ✅\n💰 £750 RETURN", "Armenia", "Cyprus"), "hit");
  assert.equal(resultFromPost("🔴 FREEBIE LOST\nZulte-Waregem II vs KVV Zelzate ❌", "Zulte-Waregem II", "KVV Zelzate"), "miss");
  const recap = "🔄 TUESDAY FREEBIES RECAP! 🔄\n❌ FIRST FREEBIE FC Ulaanbaatar vs Erchim Win\n✅ SECOND FREEBIE Chad vs Mali Win\n✅ THIRD FREEBIE PSG vs Bayern BTTS";
  assert.equal(resultFromPost(recap, "FC Ulaanbaatar", "Erchim"), "miss");
  assert.equal(resultFromPost(recap, "Chad", "Mali"), "hit");
  assert.equal(resultFromPost(recap, "Ajax", "PSV"), null, "a match it doesn't name");
  // A recap line that names only the team backed counts for a team-to-win tip, not for a tip that backs no team.
  const short = "🔄 RECAP\n❌ FIRST FREEBIE FC Ulaanbaatar Win\n✅ SECOND FREEBIE Chad (W) Win";
  assert.equal(resultFromPost(short, "Chad (W)", "Mali (W)", "Chad (W)"), "hit");
  assert.equal(resultFromPost(short, "Chad (W)", "Mali (W)", null), null);
  assert.equal(resultFromPost("Armenia vs Cyprus starts soon, good luck family", "Armenia", "Cyprus"), null, "no result in it");
});

test("a tip on a match Betfair doesn't list is recorded in Sim at the channel's price, never sent, and settled from the channel's later post", async () => {
  const db = new EngineDb(":memory:", () => {});
  const none = { searchEvents: async () => [], checkBet: async () => ({ status: "noMarket" as const, price: null, runners: [] }) };
  const posted = Math.floor((Date.now() - 20 * 60_000) / 1000);
  recordTip(db, { chatKey: "-1001", messageId: 10, date: posted, channel: "Channel one", text: "🔥 FIRST FREEBIE OF THE DAY!\n⚽ Royal Dagon FC vs Nay Pyi Taw\n🎯 ROYAL DAGON FC TO WIN\n🔣 ODDS: 4/6 (1.67)\n⏰ 09:00 UK 🇬🇧" });
  assert.equal(await trackTips(db, none), 1);
  const open = db.listOpenEdgePicks();
  assert.equal(open.length, 1);
  assert.equal(open[0]!.detail.strategyRaw, TIPS_STRATEGY);
  const row = db.sqlite.prepare(`SELECT sendable, exchange_odds, sim_row FROM live_picks WHERE id = ?`).get(open[0]!.id) as { sendable: number; exchange_odds: number; sim_row: string };
  assert.equal(row.sendable, 0, "never sent as a real bet");
  assert.equal(row.exchange_odds, 1.67);
  assert.ok(JSON.parse(row.sim_row).stake > 0);
  // Betfair's settling job leaves it alone, and it waits while the channel says nothing.
  assert.equal(await settleValuePicks(db, { runnerResult: async () => "WINNER" }, new Date(Date.now() + 10 * 86_400_000)), 0);
  assert.equal(settleChannelPricePicks(db), 0);
  // The tip's own post, and another tip carrying a tick, are not results.
  recordTip(db, { chatKey: "-1001", messageId: 11, date: posted + 600, channel: "Channel one", text: "Tip: Over 2.5 goals\nRoyal Dagon FC vs Nay Pyi Taw ✅ @ 1.80" });
  assert.equal(settleChannelPricePicks(db), 0);
  // The channel's recap names the match and says how it ended.
  recordTip(db, { chatKey: "-1001", messageId: 12, date: posted + 3 * 3600, channel: "Channel one", text: "🔄 FREEBIES RECAP!\n✅ FIRST FREEBIE Royal Dagon FC vs Nay Pyi Taw Win\n❌ SECOND FREEBIE Ajax vs PSV" });
  assert.equal(settleChannelPricePicks(db), 1);
  const sim = computeStrategyReturns(db)["telegram tips"]!.sim;
  assert.equal(sim.counted, 1);
  assert.equal(sim.hits, 1);
});

test("a channel-priced tip its channel never reports on counts as lost after 30 hours, and one with no price is not recorded", async () => {
  const db = new EngineDb(":memory:", () => {});
  const none = { searchEvents: async () => [], checkBet: async () => ({ status: "noMarket" as const, price: null, runners: [] }) };
  const posted = Math.floor((Date.now() - 31 * 3_600_000) / 1000);
  recordTip(db, { chatKey: "-1001", messageId: 20, date: posted, channel: "Channel one", text: "🎯 ROYAL DAGON FC TO WIN\n⚽ Royal Dagon FC vs Nay Pyi Taw\n🔣 ODDS: 1.67\n⏰ 09:00 UK 🇬🇧" });
  recordTip(db, { chatKey: "-1001", messageId: 21, date: posted, channel: "Channel one", text: "🎯 BAYSWATER CITY TO WIN\n⚽ Bayswater City vs Sydney Olympic\n⏰ 08:30 UK 🇬🇧" });
  await trackTips(db, none);
  const sim = computeStrategyReturns(db)["telegram tips"]!.sim;
  assert.equal(sim.counted, 1, "only the priced tip is recorded");
  assert.equal(sim.hits, 0, "silence is counted as lost");
});