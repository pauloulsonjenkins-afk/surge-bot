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
import { judgeExchange, missingSettings, pickPlacements, readCredentials, searchWord, toStoredBets, type BetfairLinkStatus } from "../src/betfair/exchange";
import { computeStrategyReturns } from "../src/server/winloss";

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
  });
  assert.equal(judgeExchange("Lyon", "Nantes", ["Lyon v FC Nantes Atlantique"]).result, "on");
  assert.deepEqual(judgeExchange("Spurs", "Arsenal", ["Tottenham v Arsenal"]), { result: "nameDiffers", event: "Tottenham v Arsenal" });
  assert.deepEqual(judgeExchange("Kodagu FC", "Megt Centre", []), { result: "off", event: null });
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
