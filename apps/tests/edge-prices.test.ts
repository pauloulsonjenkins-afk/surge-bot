import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { edgeCards, KEY, type EdgeCard } from "../src/edge/edge";
import { betfairBet, neededFor, priceEdge } from "../src/edge/edge-prices";

const dc = { market: "DOUBLE_CHANCE", home: "{home} or Draw", away: "Draw or {away}" };

test("each trend's bet maps to Betfair's market and selection, with Betfair's team names", () => {
  assert.deepEqual(betfairBet({ market: "OU25", pick: "under" }, "Man Utd", "Leeds", dc), { marketType: "OVER_UNDER_25", selection: "Under 2.5 Goals" });
  assert.deepEqual(betfairBet({ market: "HT05", pick: "over" }, "A", "B", dc), { marketType: "FIRST_HALF_GOALS_05", selection: "Over 0.5 Goals" });
  assert.deepEqual(betfairBet({ market: "MO", pick: "away" }, "Man Utd", "Leeds", dc), { marketType: "MATCH_ODDS", selection: "Leeds" });
  assert.deepEqual(betfairBet({ market: "DC", pick: "homeDraw" }, "Man Utd", "Leeds", dc), { marketType: "DOUBLE_CHANCE", selection: "Man Utd or Draw" });
});

test("value = the trend's cautious hit rate above what the Betfair price needs after 2% commission", async () => {
  const db = new EngineDb(":memory:", () => {});
  const kickoff = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const card: EdgeCard = {
    fixture: { div: "E0", league: "Premier League", country: "England", kickoff, home: "Man United", away: "Leeds" },
    headline: { kind: "goals", text: "Over 2.5 goals in 16 of last 20", hits: 16, sample: 20, rate: 0.8, strength: 0.62, bet: { market: "OU25", pick: "over" } },
    trends: [{ kind: "goals", text: "Over 2.5 goals in 16 of last 20", hits: 16, sample: 20, rate: 0.8, strength: 0.62, bet: { market: "OU25", pick: "over" } }],
    homeGames: 20,
    awayGames: 20,
    computedAt: new Date().toISOString(),
  };
  db.replaceEdgeCards([{ key: KEY(card.fixture), kickoff, json: JSON.stringify(card) }], new Date(0).toISOString());
  const reader = {
    searchEvents: async () => [{ id: "E1", name: "Man Utd v Leeds" }],
    checkBet: async (_e: string, market: string, sel: string) => {
      assert.equal(market, "OVER_UNDER_25");
      assert.equal(sel, "Over 2.5 Goals");
      return { status: "ok" as const, price: 1.8, runners: [] };
    },
  };
  assert.equal(await priceEdge(db, reader as never), 1);
  const t = edgeCards(db)[0]!.trends[0]!;
  assert.equal(t.betfair?.price, 1.8);
  assert.ok(Math.abs(t.betfair!.needed! - neededFor(1.8)) < 1e-9);
  assert.ok(Math.abs(t.betfair!.edge! - (0.62 - neededFor(1.8))) < 1e-9);
  assert.equal(edgeCards(db)[0]!.headline?.betfair?.price, 1.8, "the headline shows the price too");
});
