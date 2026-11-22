/** TipMan's bets as the tipster sets them up (tips/tipman-cards.ts), from the real free cards of 22 Nov 2026. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EngineDb } from "../src/storage/engine-db";
import {
  cardResultFrom,
  categoryOf,
  fractionToDecimal,
  kickoffOf,
  listCards,
  normaliseCard,
  pointsOf,
  pointValue,
  profitPts,
  recordCards,
  recordOf,
  setPointValue,
  setResultByHand,
  settleCards,
  type RawCard,
  type TipmanCard,
} from "../src/tips/tipman-cards";

const RAW = JSON.parse(readFileSync(join(__dirname, "fixtures/tipman-free-cards.json"), "utf8")) as RawCard[];
const NOW = new Date("2026-11-22T09:00:00Z");
const card = (id: string) => normaliseCard(RAW.find((c) => c.id === id)!, NOW)!;

test("fractions and prices", () => {
  assert.equal(fractionToDecimal("13/25"), 1.52);
  assert.equal(fractionToDecimal("4.23/1"), 5.23);
  assert.equal(fractionToDecimal("2/1"), 3);
  assert.equal(fractionToDecimal("evens"), 2);
  assert.equal(fractionToDecimal("2.5"), 2.5);
  assert.equal(fractionToDecimal(""), null);
  assert.equal(fractionToDecimal("Returns"), null);
});

test("kick-off times are UK time: GMT in winter, an hour ahead of UTC in summer", () => {
  assert.equal(kickoffOf("22 Nov 16:15", NOW), "2026-11-22T16:15:00.000Z");
  assert.equal(kickoffOf("4 Jul 20:00", new Date("2026-07-03T09:00:00Z")), "2026-07-04T19:00:00.000Z");
  assert.equal(kickoffOf("garbage", NOW), null);
  assert.equal(kickoffOf("2 Jan 15:00", new Date("2026-12-28T09:00:00Z")), "2027-01-02T15:00:00.000Z", "early January read in late December is next year's");
});

test("points are read from the card's own words, and absent ones are left to the default", () => {
  assert.equal(pointsOf("Premium Double 1pt"), 1);
  assert.equal(pointsOf("2.5 pts on the treble"), 2.5);
  assert.equal(pointsOf("0.5 point each way"), 0.5);
  assert.equal(pointsOf("Todays Free ACCA 4.23/1"), null);
  assert.equal(pointsOf("500pts"), null, "nothing like a real stake");
});

test("categories come from the card's name, and a card named for its match with legs in one match is a bet builder", () => {
  const one = [{ match: "A vs B" }];
  assert.equal(categoryOf("Premium BOTD", one), "botd");
  assert.equal(categoryOf("Premium Double/Treble of the Day", one), "double-treble");
  assert.equal(categoryOf("Premium ACCA", one), "acca");
  assert.equal(categoryOf("Premium Booking Bets", one), "booking");
  assert.equal(categoryOf("Premium Bet Builder", one), "bet-builder");
  assert.equal(categoryOf("BTTS & Win Accas", one), "btts-win-acca");
  assert.equal(categoryOf("Liverpool v Manchester Utd", [{ match: "L vs M" }, { match: "L vs M" }]), "bet-builder");
  assert.equal(categoryOf("Something else", [{ match: "A vs B" }, { match: "C vs D" }]), "other");
});

test("the free BOTD: a single at 2/1 (3.0), Lorient to win, settled from the Exchange", () => {
  const c = card("297201");
  assert.equal(c.category, "botd");
  assert.equal(c.tier, "free");
  assert.equal(c.odds, 3);
  assert.equal(c.pts, 1);
  assert.equal(c.ptsAssumed, true, "the free card gives no points");
  assert.equal(c.legs.length, 1);
  assert.deepEqual([c.legs[0]!.home, c.legs[0]!.away, c.legs[0]!.league, c.legs[0]!.kickoff, c.legs[0]!.settle], ["Lorient", "Rennes", "Ligue 1", "2026-11-22T16:15:00.000Z", "exchange"]);
  assert.equal(c.day, "2026-11-22");
  assert.deepEqual(c.books.map((b) => b.book), ["SBK", "Betfair", "bet365", "Paddy Power", "Sky Bet", "BetMGM"]);
  assert.equal(c.books[1]!.odds, 2.9, "19/10 at Betfair");
});

test("the free acca: four Match Result legs at 4.23/1 (5.23), all settled from the Exchange", () => {
  const c = card("297203");
  assert.equal(c.category, "acca");
  assert.equal(c.odds, 5.23);
  assert.deepEqual(c.legs.map((l) => l.selection), ["Brighton Win", "Paris FC Win", "Marseille Win", "Bologna Win"]);
  assert.ok(c.legs.every((l) => l.settle === "exchange"));
  assert.deepEqual(c.legs.map((l) => l.odds), [1.52, 1.333, 1.49, 1.75]);
});

test("the bet builder: no header price, so the best bookmaker's; goals and BTTS legs settle on the Exchange, cards and players don't", () => {
  const c = card("297118");
  assert.equal(c.category, "bet-builder");
  assert.equal(c.odds, 2.26, "Sky Bet's 1.26/1");
  assert.deepEqual(c.legs.map((l) => l.settle), ["exchange", "exchange", "manual", "manual", "manual"]);
  assert.match(c.legs[2]!.why ?? "", /Only goals|which bet/i);
});

test("a result needs every leg: lost at once on any lost leg, won only when all won, a void leg drops out", () => {
  const leg = (result: "won" | "lost" | "void" | null) => ({ result });
  assert.equal(cardResultFrom([leg("won"), leg(null)]), null);
  assert.equal(cardResultFrom([leg("won"), leg("lost"), leg(null)]), "lost");
  assert.equal(cardResultFrom([leg("won"), leg("won")]), "won");
  assert.equal(cardResultFrom([leg("won"), leg("void")]), "won");
  assert.equal(cardResultFrom([leg("void")]), "void");
});

test("points won and lost, and the record by category", () => {
  const base = { pts: 2, odds: 4 } as const;
  assert.equal(profitPts({ ...base, result: "won" }), 6);
  assert.equal(profitPts({ ...base, result: "lost" }), -2);
  assert.equal(profitPts({ ...base, result: null }), null);
  const mk = (category: TipmanCard["category"], result: TipmanCard["result"], pts: number, odds: number) => ({ category, tier: "premium", pts, odds, result }) as TipmanCard;
  const rec = recordOf([mk("acca", "won", 1, 5), mk("acca", "lost", 1, 5), mk("acca", null, 1, 5), mk("botd", "won", 2, 2)]);
  assert.deepEqual(rec.find((r) => r.category === "acca"), { category: "acca", tier: "premium", cards: 3, settled: 2, won: 1, lost: 1, stakedPts: 2, profitPts: 3 });
  assert.equal(rec.find((r) => r.category === "botd")!.profitPts, 2);
});

test("storing: a card seen again keeps its state while its price refreshes; garbage is skipped; £ per point defaults to £1", () => {
  const db = new EngineDb(":memory:", () => {});
  const first = recordCards(db, RAW, NOW);
  assert.equal(first.added.length, 3);
  const stored = listCards(db, "2026-11-22");
  assert.equal(stored.length, 3);
  // The owner marks the BOTD lost; the next read keeps that and updates the price.
  setResultByHand(db, "297201", "lost", NOW);
  const changed = RAW.map((c) => (c.id === "297201" ? { ...c, hdr: "Todays Free BOTD 9/4" } : c));
  const again = recordCards(db, [...changed, { id: "x", free: true, name: "n", hdr: "", legs: [], links: [] }], NOW);
  assert.deepEqual([again.added.length, again.updated, again.skipped], [0, 3, 1]);
  const botd = listCards(db, "2026-11-22").find((c) => c.id === "297201")!;
  assert.equal(botd.result, "lost");
  assert.equal(botd.resultBy, "owner");
  assert.equal(botd.odds, 3.25);
  assert.equal(pointValue(db), 1);
  assert.equal(setPointValue(db, 2.5), 2.5);
  assert.equal(pointValue(db), 2.5);
  assert.throws(() => setPointValue(db, 0), /above 0/);
});

test("settling: legs are found and settled on the Exchange, a lost leg loses the card at once, manual legs wait for the owner", async () => {
  const db = new EngineDb(":memory:", () => {});
  recordCards(db, RAW, NOW);
  const events = new Map<string, string>([
    ["Hull", "Hull v Brighton"],
    ["Paris FC", "Paris FC v Angers"],
    ["Marseille", "Marseille v Le Mans"],
    ["Bologna", "Bologna v Udinese"],
    ["Liverpool", "Liverpool v Man Utd"],
    ["Lorient", "Lorient v Rennes"],
  ]);
  let n = 0;
  const results: Record<string, "WINNER" | "LOSER"> = {};
  const reader = {
    searchEvents: async (word: string) => {
      const name = [...events].find(([k]) => word.toLowerCase().includes(k.toLowerCase().split(" ")[0]!))?.[1];
      return name ? [{ id: `E-${name}`, name, openDate: "2026-11-22T14:00:00.000Z" }] : [];
    },
    checkBet: async (eventId: string, marketType: string, selectionName: string) => {
      n++;
      const key = `${eventId}|${marketType}|${selectionName}`;
      results[`M${n}`] = /Brighton|Paris FC|Marseille/.test(selectionName) ? "WINNER" : "LOSER";
      void key;
      return { status: "ok" as const, price: 2, runners: [], marketId: `M${n}`, selectionId: n };
    },
    runnerResult: async (marketId: string) => results[marketId] ?? null,
  };
  // Too early: nothing has finished, though the legs are looked up.
  assert.equal(await settleCards(db, reader as never, new Date("2026-11-22T15:00:00Z")), 0);
  // After the matches: Bologna (LOSER in this fake) loses the acca; the BOTD (Lorient) is a loser too.
  const settled = await settleCards(db, reader as never, new Date("2026-11-22T22:30:00Z"));
  const cards = listCards(db, "2026-11-22");
  const acca = cards.find((c) => c.id === "297203")!;
  assert.equal(acca.result, "lost", "one lost leg");
  assert.equal(acca.resultBy, "betfair");
  assert.equal(cards.find((c) => c.id === "297201")!.result, "lost");
  const builder = cards.find((c) => c.id === "297118")!;
  assert.equal(builder.result, "lost", "its BTTS leg lost on the Exchange, so the builder is lost whatever the card legs do");
  assert.ok(settled >= 3);
});

test("a settled-by-nobody card with a manual leg waits for the owner", async () => {
  const db = new EngineDb(":memory:", () => {});
  recordCards(db, [RAW[2]!], NOW);
  const reader = {
    searchEvents: async () => [{ id: "E1", name: "Liverpool v Man Utd", openDate: "2026-11-22T16:30:00.000Z" }],
    checkBet: async () => ({ status: "ok" as const, price: 2, runners: [], marketId: "M1", selectionId: 1 }),
    runnerResult: async () => "WINNER" as const,
  };
  assert.equal(await settleCards(db, reader as never, new Date("2026-11-22T23:30:00Z")), 0, "the cards and player legs are manual: not finished");
  const c = listCards(db, "2026-11-22")[0]!;
  assert.equal(c.result, null);
  assert.deepEqual(c.legs.map((l) => l.result), ["won", "won", null, null, null]);
  setResultByHand(db, c.id, "won");
  assert.equal(listCards(db, "2026-11-22")[0]!.resultBy, "owner");
});
