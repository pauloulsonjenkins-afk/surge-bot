/**
 * Checks reading bets from Betfair's own API: open and settled orders become stored bets, they merge with what the bet
 * history import already holds, and each sent pick gets a placement state for the Live page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { matchBets } from "../src/betfair/reconcile";
import { findRunner, isTeamGoalsMarket, judgeExchange, missingSettings, pickPlacements, readCredentials, searchWord, toStoredBets, type BetfairLinkStatus } from "../src/betfair/exchange";
import { computeStrategyReturns } from "../src/server/winloss";
import { priceResult } from "../src/server/pricing";

const S = "Blistering Momentum";

function alert(n: number, teams: string): string {
  return [`🔔 ${S}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", teams, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80"].join("\n");
}

const link = (lastOkAt: string | null): BetfairLinkStatus => ({ configured: true, missing: [], lastOkAt, lastErrorAt: null, lastError: null, lastCount: 0 });

test("settings: nothing is read until all five are set, and the missing ones are named", () => {
  assert.equal(readCredentials({}), null);
  assert.deepEqual(missingSettings({ BF_APP_KEY: "k" }), ["BF_USERNAME", "BF_PASSWORD", "BF_CERT_B64", "BF_KEY_B64"]);
  const b64 = (t: string) => Buffer.from(t).toString("base64");
  const c = readCredentials({ BF_APP_KEY: "k", BF_USERNAME: "u", BF_PASSWORD: "p", BF_CERT_B64: b64("CERT"), BF_KEY_B64: b64("KEY") });
  assert.equal(c?.cert, "CERT");
  assert.equal(c?.key, "KEY");
});

test("open and settled orders become stored bets; a settled record wins over the open one", () => {
  const catalogue = new Map([
    ["1.1", { marketId: "1.1", marketName: "Over/Under 0.5 Goals", event: { name: "Lyon v Nantes" }, runners: [{ selectionId: 7, runnerName: "Over 0.5 Goals" }] }],
  ]);
  const bets = toStoredBets(
    [
      { betId: "A", marketId: "1.1", selectionId: 7, side: "BACK", status: "EXECUTION_COMPLETE", priceSize: { price: 1.01, size: 2 }, placedDate: "2026-10-01T12:00:00Z", averagePriceMatched: 1.95, sizeMatched: 2 },
      { betId: "B", marketId: "1.1", selectionId: 7, side: "BACK", status: "EXECUTABLE", priceSize: { price: 2.2, size: 2 }, placedDate: "2026-10-01T12:01:00Z", sizeMatched: 0, sizeRemaining: 2 },
      { betId: "C", marketId: "1.1", selectionId: 7, side: "BACK", status: "EXECUTION_COMPLETE", priceSize: { price: 1.9, size: 2 }, placedDate: "2026-10-01T12:02:00Z", sizeMatched: 2, averagePriceMatched: 1.9 },
    ],
    [
      { betId: "C", marketId: "1.1", selectionId: 7, side: "BACK", placedDate: "2026-10-01T12:02:00Z", settledDate: "2026-10-01T13:00:00Z", betOutcome: "WON", priceMatched: 1.9, sizeSettled: 2, profit: 1.8, itemDescription: { eventDesc: "Lyon v Nantes", marketDesc: "Over/Under 0.5 Goals", runnerDesc: "Over 0.5 Goals" } },
      { betId: "D", marketId: "1.1", selectionId: 7, placedDate: "2026-10-01T12:03:00Z", settledDate: "2026-10-01T12:10:00Z", betOutcome: "LAPSED", itemDescription: { eventDesc: "Lyon v Nantes" } },
    ],
    catalogue,
  );
  const by = Object.fromEntries(bets.map((b) => [b.betId, b]));
  assert.equal(by.A!.status, "matched");
  assert.equal(by.A!.odds, 1.95);
  assert.equal(by.A!.event, "Lyon v Nantes");
  assert.equal(by.A!.selection, "Over 0.5 Goals");
  assert.equal(by.B!.status, "pending");
  assert.equal(by.C!.status, "won");
  assert.equal(by.C!.profit, 1.8);
  assert.equal(by.C!.stake, 2);
  assert.equal(by.D!.status, "unmatched");
  assert.equal(by.D!.matched, 0);
});

test("the API's copy merges with the CSV's: details it lacks are kept, and an unchanged poll writes nothing", () => {
  let changes = 0;
  const db = new EngineDb(":memory:", () => changes++);
  const csv = { betId: "X", placedAt: "2026-10-01T12:00:00Z", settledAt: null, event: "Lyon v Nantes", market: null, selection: "Over 0.5 Goals", side: "back", provider: "blistering momentum", status: "matched" as const, stake: 2, matched: 2, odds: 1.9, profit: null };
  db.saveBetfairBets([csv], "t1");
  changes = 0;
  const api = { ...csv, provider: null, settledAt: "2026-10-01T13:00:00Z", status: "won" as const, profit: 1.8 };
  assert.deepEqual(db.saveBetfairBets([api], "t2"), { added: 0, updated: 1, changed: 1 });
  const stored = db.listBetfairBets()[0]!;
  assert.equal(stored.provider, "blistering momentum");
  assert.equal(stored.status, "won");
  assert.equal(changes, 1);
  // The next poll brings the same bet again: nothing is written, so no backup is triggered.
  assert.deepEqual(db.saveBetfairBets([api], "t3"), { added: 0, updated: 1, changed: 0 });
  assert.equal(changes, 1);
});

test("each sent pick gets a placement state: checking, then not placed, or matched / waiting / settled", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [S.toLowerCase()]: 2 }, strategies: { [S.toLowerCase()]: true }, dailyCap: 100 });
  const now = new Date();
  const posted = new Date(now.getTime() - 60_000).toISOString();
  ["Lyon vs Nantes", "Lille vs Brest", "Nice vs Lens"].forEach((teams, i) => {
    db.upsertLivePick("chat", i + 1, alert(i + 1, teams), parseAlert(alert(i + 1, teams)), posted);
    buildFeed(db, { markSent: true, now });
  });
  const sent = db.listSentPicks();
  const at = (ms: number) => new Date(Date.parse(sent[0]!.sentAt) + ms).toISOString();
  db.saveBetfairBets(
    [
      { betId: "M", placedAt: at(20_000), settledAt: null, event: sent[0]!.sentRow!.eventName!, market: null, selection: "Over 0.5 Goals", side: "back", provider: null, status: "matched", stake: 2, matched: 2, odds: 1.95, profit: null },
      { betId: "W", placedAt: at(20_000), settledAt: null, event: sent[1]!.sentRow!.eventName!, market: null, selection: "Over 0.5 Goals", side: "back", provider: null, status: "pending", stake: 2, matched: 0, odds: null, profit: null },
    ],
    "t",
  );
  matchBets(db);

  // Betfair last checked just now: the third pick is too recent to call.
  let p = pickPlacements(db, link(new Date().toISOString()), now);
  assert.equal(p[sent[0]!.id]!.state, "matched");
  assert.equal(p[sent[0]!.id]!.odds, 1.95);
  assert.equal(p[sent[1]!.id]!.state, "waiting");
  assert.equal(p[sent[2]!.id]!.state, "checking");

  // Ten minutes on, Betfair checked again, still no bet: not placed.
  const later = new Date(now.getTime() + 10 * 60_000);
  p = pickPlacements(db, link(later.toISOString()), later);
  assert.equal(p[sent[2]!.id]!.state, "notPlaced");
  // But if Betfair hasn't been reachable since, it is never called "not placed".
  p = pickPlacements(db, link(now.toISOString()), later);
  assert.equal(p[sent[2]!.id]!.state, "checking");
});

test("is the match on Betfair: on, a team spelled differently, or not there", () => {
  assert.deepEqual(judgeExchange("Wigan Athletic U21", "Huddersfield Town U21", ["Wigan U21 v Huddersfield U21", "Wigan v Stoke"]), {
    result: "on",
    event: "Wigan U21 v Huddersfield U21",
    eventId: null,
  });
  assert.equal(judgeExchange("Lyon", "Nantes", ["Lyon v FC Nantes Atlantique"]).result, "on");
  assert.deepEqual(judgeExchange("Spurs", "Arsenal", ["Tottenham v Arsenal"]), { result: "nameDiffers", event: "Tottenham v Arsenal", eventId: null });
  assert.deepEqual(judgeExchange("Kodagu FC", "Megt Centre", []), { result: "off", event: null, eventId: null });
  assert.equal(searchWord("Wigan Athletic U21"), "Wigan");
  assert.equal(searchWord("FC Kobenhavn"), "Kobenhavn");
  assert.equal(searchWord("Club Atletico Tembetary"), "Tembetary");
});

test("a league marked 'don't send' is recorded but never sent, and the Leagues page counts what Betfair said", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [S.toLowerCase()]: 2 }, strategies: { [S.toLowerCase()]: true }, dailyCap: 100 });
  const now = new Date();
  const posted = new Date(now.getTime() - 60_000).toISOString();
  db.upsertLivePick("chat", 1, alert(1, "Lyon vs Nantes"), parseAlert(alert(1, "Lyon vs Nantes")), posted);
  const pick = db.listLivePicks(10)[0]!;
  db.setPickExchange(pick.id, "off", null);

  let league = db.listLeaguesForAdmin()[0]!;
  assert.deepEqual(league.exchange, { checked: 1, on: 0, nameDiffers: 0, off: 1, lastOffAt: pick.firstSeenAt });
  assert.equal(league.noSend, false);
  assert.equal(db.listLivePicks(10)[0]!.exchange, "off");

  db.updateLeague(pick.leagueKey, { noSend: true });
  league = db.listLeaguesForAdmin()[0]!;
  assert.equal(league.noSend, true);
  const feed = buildFeed(db, { markSent: false, now });
  assert.equal(feed.rows.length, 0);
  assert.match(feed.skipped[0]!.reason, /not on Betfair/);

  db.updateLeague(pick.leagueKey, { noSend: false });
  // Sent by league again, but this match itself wasn't on Betfair, so it still isn't sent; once found, it is.
  const again = buildFeed(db, { markSent: false, now });
  assert.equal(again.rows.length, 0);
  assert.match(again.skipped[0]!.reason, /Not on Betfair: the match wasn't found/);
  db.setPickExchange(pick.id, "on", "Lyon v Nantes", null, null, "E1");
  assert.equal(buildFeed(db, { markSent: false, now }).rows.length, 1);
});

test("a simulated bet on a match that wasn't on Betfair is never priced", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { stakes: { [S.toLowerCase()]: 2 } });
  const posted = new Date(Date.now() - 60_000).toISOString();
  const settled = alert(1, "Lyon vs Nantes") + "\n\n⸻⸻ Match Summary ⸻⸻\nHalf-Time Score: 0-0\nFull-Time Score: 1-0\n\n✅ Hit";
  db.upsertLivePick("chat", 1, settled, parseAlert(settled), posted);
  const id = db.listLivePicks(10)[0]!.id;
  const key = S.toLowerCase();
  assert.equal(computeStrategyReturns(db)[key]!.sim.counted, 1);
  db.setPickExchange(id, "off", null);
  assert.equal(computeStrategyReturns(db)[key]!.sim.counted, 0);
});

test("the event id comes back with a match, and the feed's selection wording finds Betfair's runner", () => {
  assert.equal(judgeExchange("Lyon", "Nantes", [{ id: "321", name: "Lyon v Nantes" }]).eventId, "321");
  const runners = [{ runnerName: "Yes" }, { runnerName: "No" }];
  assert.equal(findRunner(runners, "yes")?.runnerName, "Yes");
  assert.equal(findRunner([{ runnerName: "Over 0.5 Goals" }, { runnerName: "Under 0.5 Goals" }], "Over 0.5 Goals")?.runnerName, "Over 0.5 Goals");
  assert.equal(findRunner([{ runnerName: "Home or Draw" }], "Draw or Home")?.runnerName, "Home or Draw");
  assert.equal(findRunner(runners, "Maybe"), undefined);
});

test("a pick is priced from the alert, then its matched bet, then the Betfair price on arrival, then assumed odds", () => {
  const base = { market: "BOTH_TEAMS_TO_SCORE", result: "hit" as const, targetLine: null, overLine: null, overOdds: null, favouriteOdds: null, sent: false, sentStake: null, sim: null };
  const ctx = { strategyStake: 2, assumedOdds: 1.7, commission: 0 };
  const price = (extra: object) => priceResult({ ...base, ...extra }, ctx);
  const pick = (r: ReturnType<typeof priceResult>) => (r.kind === "priced" ? [r.odds, r.oddsSource] : r.kind);
  assert.deepEqual(pick(price({})), [1.7, "assumed"]);
  assert.deepEqual(pick(price({ exchangeOdds: 1.85 })), [1.85, "exchange"]);
  assert.deepEqual(pick(price({ exchangeOdds: 1.85, betOdds: 1.9 })), [1.9, "bet"]);
  assert.equal(priceResult({ ...base, exchangeOdds: 1.85 }, { ...ctx, assumedOdds: null }).kind, "priced");
  // Next Goal alerts print their price, which still comes first.
  assert.deepEqual(pick(price({ market: "NEXT_GOAL", targetLine: 0.5, overLine: 0.5, overOdds: 2.1, betOdds: 1.9 })), [2.1, "alert"]);
});

test("a pick with a linked Betfair bet is on Betfair, even if the event search missed it", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [S.toLowerCase()]: 2 }, strategies: { [S.toLowerCase()]: true }, dailyCap: 100 });
  const now = new Date();
  db.upsertLivePick("chat", 1, alert(1, "Lyon vs Nantes"), parseAlert(alert(1, "Lyon vs Nantes")), new Date(now.getTime() - 60_000).toISOString());
  buildFeed(db, { markSent: true, now });
  const sent = db.listSentPicks()[0]!;
  db.setPickExchange(sent.id, "off", null);
  assert.equal(db.markBetPicksOnExchange(), 0, "no bet yet");
  const placedAt = new Date(Date.parse(sent.sentAt) + 20_000).toISOString();
  db.saveBetfairBets([{ betId: "M", placedAt, settledAt: null, event: "Olympique Lyon v Nantes", market: null, selection: "Over 0.5 Goals", side: "back", provider: null, status: "matched", stake: 2, matched: 2, odds: 1.95, profit: null }], "t");
  matchBets(db);
  assert.equal(db.markBetPicksOnExchange(), 1);
  const p = db.getLivePick(sent.id)!;
  assert.equal(p.exchange, "on");
  assert.equal(p.exchangeEvent, "Olympique Lyon v Nantes");
  assert.equal(db.markBetPicksOnExchange(), 0, "only changed once");
});

test("only a team's own goals markets are listed for choosing the favourite-to-score codes", () => {
  assert.equal(isTeamGoalsMarket({ code: "TEAM_A_OVER_UNDER_05" }), true);
  assert.equal(isTeamGoalsMarket({ code: "TEAM_B_OVER_UNDER_15" }), true);
  assert.equal(isTeamGoalsMarket({ code: "FIRST_HALF_GOALS_05" }), false);
  assert.equal(isTeamGoalsMarket({ code: "OVER_UNDER_35" }), false);
  assert.equal(isTeamGoalsMarket({ code: "MATCH_ODDS_AND_OU_25" }), false);
});
