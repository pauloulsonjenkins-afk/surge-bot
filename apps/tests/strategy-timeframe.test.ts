/**
 * Checks the Strategies page's 1D / 7D / 30D / YTD figures: with a start date, only picks first seen since then count
 * towards a strategy's hits, misses and return, and every strategy is still listed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { computeStrategyReturns } from "../src/server/winloss";

const A = "Blistering Momentum / Action-packed";
const B = "Home Pressure";

function alert(strategy: string, n: number, result: "hit" | "miss"): string {
  return [
    `🔔 ${strategy}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "3.00 1.40",
    "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-1" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss",
  ].join("\n");
}

function setup() {
  const db = new EngineDb(":memory:", () => {});
  const raw = db as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } };
  let id = 1;
  const add = (strategy: string, result: "hit" | "miss", daysAgo: number) => {
    const n = id++;
    const text = alert(strategy, n, result);
    const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    db.upsertLivePick("chat", n, text, parseAlert(text), at);
    raw.db.prepare(`UPDATE live_picks SET first_seen_at = ? WHERE message_id = ?`).run(at, n);
  };
  return { db, add };
}

test("with a start date, only picks since then count, and every strategy is still listed", () => {
  const { db, add } = setup();
  add(A, "hit", 0.1);
  add(A, "miss", 3);
  add(A, "miss", 5);
  add(B, "hit", 10);

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const rows = db.listStrategiesForAdmin(since);
  const a = rows.find((r) => r.label === A);
  assert.equal(a?.hits, 1);
  assert.equal(a?.misses, 0);
  assert.equal(a?.alerts, 3, "the alert count is all time");
  const b = rows.find((r) => r.label === B);
  assert.ok(b, "a strategy with nothing in the period is still listed");
  assert.equal(b.hits + b.misses, 0);

  const all = db.listStrategiesForAdmin();
  assert.equal(all.find((r) => r.label === A)?.misses, 2);

  const recent = computeStrategyReturns(db, since);
  assert.equal(recent[A.toLowerCase()]?.all.settled, 1);
  assert.equal(recent[B.toLowerCase()], undefined);
  assert.equal(computeStrategyReturns(db)[A.toLowerCase()]?.all.settled, 3);
});
