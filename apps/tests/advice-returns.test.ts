/**
 * The suggestions' three sets of figures in one pass (winloss.ts computeAdviceReturns) give exactly what the three
 * separate computeStrategyReturns passes gave: all time, from each rule change, and the last 30 days from the rule change.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computeAdviceReturns, computeStrategyReturns, type ResultRow } from "../src/server/winloss";

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;

function rows(n: number, now: number): ResultRow[] {
  // "Time to fight" and "Action-packed" changed their rules in Oct 2026 (RECORD_FROM); the others never did.
  const strategies = ["Time to fight", "Action-packed", "Early pressure with low score", "Away super fav 2 goals (v2)"];
  const out: ResultRow[] = [];
  for (let i = 0; i < n; i++) {
    const at = new Date(now - Math.floor(rnd() * 90 * 86_400_000)).toISOString();
    const placement = pick(["sim", "sim", "betfair", "manual", "notPlaced", "legacy"] as const);
    const byHand = placement === "manual" && rnd() < 0.5;
    const odds = 1.2 + Math.round(rnd() * 200) / 100;
    const sim = { stake: rnd() < 0.8 ? 1 : null, minPrice: null, skipped: null };
    out.push({
      id: i + 1, firstSeenAt: at, strategy: pick(strategies), market: "NEXT_GOAL", result: rnd() < 0.6 ? "hit" : "miss",
      targetLine: 0.5, overLine: 0.5, overOdds: odds, favouriteOdds: null, layOdds: null, edgeBet: null, competition: "L", country: "C",
      betOdds: placement === "betfair" ? odds : null, takenOdds: placement === "manual" ? odds : null, exchangeOdds: rnd() < 0.7 ? odds : null,
      sentStake: placement === "sim" ? null : 2, sent: placement === "betfair" || placement === "manual" || placement === "legacy", placement,
      betStake: placement === "betfair" ? 2 : null, betProfit: null, sim: placement === "sim" ? sim : null, byHand, simShadow: byHand ? sim : null, facts: null,
    } as ResultRow);
  }
  return out.sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt));
}

const modes = (m: Record<string, { live: unknown; sim: unknown; all: unknown }>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { live: v.live, sim: v.sim, all: v.all }]));

test("one pass gives the same figures as the three separate passes", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "time to fight": 1 }, stakePct: { "action-packed": 2 }, dailyCap: 10_000 });
  const now = Date.parse("2026-11-07T22:00:00Z");
  const rs = rows(3000, now);
  const recentSince = new Date(now - 30 * 86_400_000).toISOString();
  const got = computeAdviceReturns(db, rs, recentSince);
  assert.deepEqual(modes(got.all), modes(computeStrategyReturns(db, null, { rows: rs })));
  assert.deepEqual(modes(got.sinceChange), modes(computeStrategyReturns(db, null, { fromRuleChange: true, rows: rs })));
  assert.deepEqual(modes(got.recent), modes(computeStrategyReturns(db, recentSince, { fromRuleChange: true, rows: rs })));
  assert.ok(got.sinceChange["time to fight"], "a rule-changed strategy is there");
});
