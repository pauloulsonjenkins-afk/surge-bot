import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import type { EdgeCard, EdgeTrend } from "../src/edge/edge";
import { betWords, recordValuePicks, settleValuePicks, STRATEGY, valuePicks } from "../src/edge/value-strategy";

const now = new Date("2026-10-10T12:00:00Z");

function trend(text: string, market: string, pick: string, price: number, edge: number, selectionId: number): EdgeTrend {
  return {
    kind: "goals",
    text,
    hits: 16,
    sample: 20,
    rate: 0.8,
    strength: 0.62,
    bet: { market, pick } as EdgeTrend["bet"],
    betfair: { price, needed: 0.62 - edge, edge, at: now.toISOString(), marketType: `MT_${market}`, eventId: "E1", event: "Man Utd v Leeds", marketId: `1.${selectionId}`, selectionId, selection: `SEL_${pick}` },
  };
}

function card(hoursAhead: number, trends: EdgeTrend[]): EdgeCard {
  return {
    fixture: { div: "E0", league: "Premier League", country: "England", kickoff: new Date(now.getTime() + hoursAhead * 3_600_000).toISOString(), home: "Man United", away: "Leeds" },
    headline: trends[0] ?? null,
    trends,
    homeGames: 20,
    awayGames: 20,
    computedAt: now.toISOString(),
  };
}

test("the bet is worded per market, with Betfair's team names", () => {
  assert.equal(betWords({ market: "OU25", pick: "under" }, "Man Utd", "Leeds"), "Under 2.5 goals");
  assert.equal(betWords({ market: "BTTS", pick: "no" }, "Man Utd", "Leeds"), "Both teams to score: No");
  assert.equal(betWords({ market: "MO", pick: "away" }, "Man Utd", "Leeds"), "Leeds to win");
  assert.equal(betWords({ market: "DC", pick: "homeDraw" }, "Man Utd", "Leeds"), "Man Utd or draw");
});

test("only value trends on matches in the next 3 hours, best two per match", () => {
  const soon = card(2, [trend("a", "OU25", "over", 1.9, 0.03, 1), trend("b", "BTTS", "yes", 1.8, 0.08, 2), trend("c", "HT05", "over", 1.6, 0.05, 3), trend("d", "OU15", "over", 1.2, -0.02, 4)]);
  const later = card(5, [trend("e", "OU35", "under", 1.5, 0.1, 5)]);
  assert.deepEqual(valuePicks([soon, later], now).map((p) => p.trend.text), ["b", "c"]);
});

test("result bets (to win, double chance) are no longer picked: 8-16 and about -40% per £1 by 18 Oct", () => {
  const c = card(1, [trend("Liverpool to win", "MO", "home", 2.1, 0.12, 1), trend("Liverpool or draw", "DC", "homeDraw", 1.5, 0.1, 2), trend("Under 2.5", "OU25", "under", 2.0, 0.06, 3)]);
  assert.deepEqual(valuePicks([c], now).map((p) => p.trend.text), ["Under 2.5"]);
});

test("picks are added once as never-sendable Sim picks at the Betfair price, then settled from Betfair's result", async () => {
  const db = new EngineDb(":memory:", () => {});
  const c = card(1, [trend("BTTS in 16 of last 20", "BTTS", "yes", 1.8, 0.08, 2), trend("Over 2.5 in 15 of 20", "OU25", "over", 2.0, 0.06, 7)]);
  assert.equal(recordValuePicks(db, [c], now), 2);
  assert.equal(recordValuePicks(db, [c], now), 0, "the same match and bet is only added once");
  const picks = db.listLivePicks(10);
  assert.equal(picks.length, 2);
  for (const p of picks) {
    assert.equal(p.strategy, STRATEGY);
    assert.equal(p.market, "EDGE_VALUE");
    assert.equal(p.sendable, true, "sendable, but only goes out when the strategy is Live");
    assert.equal(p.sentAt, null);
  }
  assert.equal(picks.find((p) => p.selection === "Both teams to score: Yes")?.exchangeOdds, 1.8);

  const results: Record<number, "WINNER" | "LOSER"> = { 2: "WINNER", 7: "LOSER" };
  assert.equal(await settleValuePicks(db, { runnerResult: async () => "WINNER" }, now), 0, "not before the match is over");
  const later = new Date(now.getTime() + 4 * 3_600_000);
  assert.equal(await settleValuePicks(db, { runnerResult: async (_m, sel) => results[sel]! }, later), 2);
  const won = db.listResultsForWinLoss(new Date(0).toISOString(), { ignoreFreshStart: true });
  assert.deepEqual(won.map((r) => r.result).sort(), ["hit", "miss"]);
  const btts = won.find((r) => r.exchangeOdds === 1.8)!;
  assert.equal(btts.result, "hit");
  assert.equal(btts.sim?.stake, 1, "£1 Sim stake until one is set");
});

test("in Sim nothing is sent; switched Live, each pick goes out as its own market and selection until kick-off", async () => {
  const { buildFeed, saveSendingSettings } = await import("../src/inplayguru/bet-feed");
  const db = new EngineDb(":memory:", () => {});
  const realNow = new Date();
  const c = card(0, [trend("BTTS in 16 of last 20", "BTTS", "yes", 1.8, 0.08, 2)]);
  c.fixture.kickoff = new Date(realNow.getTime() + 3_600_000).toISOString();
  saveSendingSettings(db, { enabled: true, stakes: { "best value cuppa": 2 } });
  assert.equal(recordValuePicks(db, [c], realNow), 1);
  const sim = buildFeed(db, { markSent: false, now: realNow });
  assert.equal(sim.rows.length, 0);
  assert.match(sim.skipped[0]!.reason, /switch is off/);

  saveSendingSettings(db, { strategies: { "best value cuppa": true } });
  const live = buildFeed(db, { markSent: false, now: realNow });
  assert.equal(live.rows.length, 1);
  assert.equal(live.rows[0]!.marketType, "MT_BTTS");
  assert.equal(live.rows[0]!.selectionName, "SEL_yes");
  assert.equal(live.rows[0]!.eventName, "Man Utd v Leeds");
  assert.equal(live.rows[0]!.stake, 2);
  const afterKickoff = buildFeed(db, { markSent: false, now: new Date(realNow.getTime() + 2 * 3_600_000) });
  assert.equal(afterKickoff.rows.length, 0, "not bet once the match is under way");
});

test("never two bets that pull against each other, nothing under 5 points of edge or 10 games", () => {
  const overUnder = card(1, [trend("Over 2.5", "OU25", "over", 1.9, 0.08, 4), trend("Under 3.5", "OU35", "under", 1.5, 0.07, 5)]);
  assert.deepEqual(valuePicks([overUnder], now).map((p) => p.trend.text), ["Over 2.5"]);
  const thin = trend("Under 2.5 in 7 of the last 8 meetings", "OU25", "under", 2.0, 0.2, 6);
  thin.sample = 8;
  assert.deepEqual(valuePicks([card(1, [thin, trend("small", "BTTS", "yes", 1.8, 0.04, 7)])], now), []);
});

test("a match Betfair lists the other way round is not priced", async () => {
  const { sameOrder } = await import("../src/edge/edge-prices");
  assert.equal(sameOrder("Csikszereda M. Ciuc", "Univ. Craiova", "Universitatea Craiova v Csikszereda"), false);
  assert.equal(sameOrder("Man United", "Leeds", "Man Utd v Leeds"), true);
});

test("Bet by hand: a Sim value pick is handed to direct betting at the chosen stake, once, and only before kick-off", async () => {
  const { betValuePick, bettableValuePicks } = await import("../src/edge/value-strategy");
  const { saveSendingSettings } = await import("../src/inplayguru/bet-feed");
  const db = new EngineDb(":memory:", () => {});
  const realNow = new Date();
  const c = card(0, [trend("BTTS in 16 of last 20", "BTTS", "yes", 2.2, 0.08, 7)]);
  c.fixture.kickoff = new Date(realNow.getTime() + 2 * 3_600_000).toISOString();
  saveSendingSettings(db, { maxStake: 5 });
  recordValuePicks(db, [c], realNow);
  const [p] = bettableValuePicks(db, realNow);
  assert.ok(p);
  assert.equal(p.sent, null);
  assert.throws(() => betValuePick(db, p.id, 1, { directLive: false }, realNow), /direct betting isn't Live/);
  assert.throws(() => betValuePick(db, p.id, 0.5, { directLive: true }, realNow), /smallest bet/);
  assert.throws(() => betValuePick(db, p.id, 10, { directLive: true }, realNow), /highest stake/);
  betValuePick(db, p.id, 1.5, { directLive: true }, realNow);
  const sent = db.getLivePick(p.id)!;
  const row = JSON.parse(sent.sentRowJson!);
  assert.equal(row.marketType, "MT_BTTS");
  assert.equal(row.selectionName, "SEL_yes");
  assert.equal(row.stake, 1.5);
  assert.ok(bettableValuePicks(db, realNow)[0]!.sent, "shown as sent");
  assert.throws(() => betValuePick(db, p.id, 1, { directLive: true }, realNow), /already been handed/);
  assert.throws(() => betValuePick(db, p.id, 1, { directLive: true }, new Date(realNow.getTime() + 3 * 3_600_000)), /already been handed|kicked off/);
});
