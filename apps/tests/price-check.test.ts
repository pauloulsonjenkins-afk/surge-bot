import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { dueChecks, priceCheckReport, runPriceChecks } from "../src/betfair/price-check";
import { parseAlert } from "../src/inplayguru/parse-alert";

const pick = (id: number, alertIso: string, market: string | null = "NEXT_GOAL") =>
  ({ id, messageAt: alertIso, firstSeenAt: alertIso, market, detail: null }) as unknown as Parameters<typeof dueChecks>[0];

test("in-play picks are checked 2 and 5 minutes after the alert, each once", () => {
  const t0 = Date.parse("2026-10-09T15:00:00Z");
  const p = pick(1, new Date(t0).toISOString());
  assert.deepEqual(dueChecks(p, t0 + 60_000, new Set()), []);
  assert.deepEqual(dueChecks(p, t0 + 2.5 * 60_000, new Set()), ["t2"]);
  assert.deepEqual(dueChecks(p, t0 + 5.5 * 60_000, new Set(["1:t2"])), ["t5"]);
  assert.deepEqual(dueChecks(p, t0 + 30 * 60_000, new Set()), []);
});

test("a pre-match pick is checked at kick-off", () => {
  const t0 = Date.parse("2026-10-09T14:00:00Z");
  const p = pick(2, new Date(t0).toISOString(), "FIRST_HALF_GOALS"); // kick-off assumed an hour after the alert
  assert.deepEqual(dueChecks(p, t0 + 30 * 60_000, new Set()), []);
  assert.deepEqual(dueChecks(p, t0 + 59 * 60_000, new Set()), ["ko"]);
});

test("the report averages alert price / later price, leaving out bets a goal had already settled", () => {
  const db = new EngineDb(":memory:", () => {});
  const at = new Date().toISOString();
  db.savePriceCheck({ pickId: 1, kind: "t5", strategy: "Time to fight", entry: 2.2, later: 2.0, at }); // +10%
  db.savePriceCheck({ pickId: 2, kind: "t5", strategy: "Time to fight", entry: 1.8, later: 2.0, at }); // -10%
  db.savePriceCheck({ pickId: 3, kind: "t5", strategy: "Time to fight", entry: 1.8, later: 1.01, at }); // goal: left out
  db.savePriceCheck({ pickId: 4, kind: "t5", strategy: "Comeback", entry: 2.4, later: 2.0, at }); // +20%
  const r = priceCheckReport(db, 30);
  const ttf = r.rows.find((x) => x.strategy === "Time to fight")!;
  assert.equal(ttf.picks, 2);
  assert.equal(ttf.edge, 0);
  assert.equal(r.typical.t5, Math.round((100 * (0.1 - 0.1 + 0.2)) / 3 * 10) / 10);
});

test("a pick whose Betfair price is a stale pre-goal snapshot gets no price check", async () => {
  const db = new EngineDb(":memory:", () => {});
  const at = new Date("2026-11-16T15:00:00Z");
  const text = ["🔔 Time to fight", "", "🇫🇷 France Ligue 1", "Lyon vs Nantes", "", "Timer: 60'", "Goals: 0 - 1", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");
  db.upsertLivePick("chat", 1, text, parseAlert(text), at.toISOString(), at.toISOString());
  db.upsertLivePick("chat", 2, text.replace("Lyon vs Nantes", "Nice vs Lens"), parseAlert(text.replace("Lyon vs Nantes", "Nice vs Lens")), at.toISOString(), at.toISOString());
  const fair = db.getLivePickByMessage("chat", 1)!.id;
  const stale = db.getLivePickByMessage("chat", 2)!.id;
  db.setPickExchange(fair, "on", "Lyon v Nantes", 1.85, null, "E1");
  // Over 1.5 at 0-1 shown at 5.0: the Over 2.5 price from before the goal, not one that could be taken.
  db.setPickExchange(stale, "on", "Nice v Lens", 5.0, null, "E2");
  const asked: string[] = [];
  const reader = { checkBet: async (eventId: string) => (asked.push(eventId), { status: "ok" as const, price: 1.9, runners: [], marketId: "M1", selectionId: 7 }) };
  await runPriceChecks(db, reader as never, at.getTime() + 3 * 60_000);
  assert.deepEqual(asked, ["E1"]);
});
