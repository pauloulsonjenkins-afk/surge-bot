/**
 * Checks that Win/Loss follows strategy merges: merged strategies are one line, the money is
 * unchanged (each pick still uses its own strategy's stake), and the settings list stays per original.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computeWinLoss } from "../src/server/winloss";

const A = "Blistering Momentum / Action-packed";
const B = "Blistering Momentum / Action-packed OJ";
const C = "Both Teams to Score";

function alert(strategy: string, n: number, result: "hit" | "miss"): string {
  const over = strategy === C ? [] : ["Over/Under 0.50 Odds:", "3.00 1.40"];       // Over 0.5 at 3.00
  return [
    `🔔 ${strategy}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", ...over,
    "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-1" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss",
  ].join("\n");
}

function setup() {
  const db = new EngineDb(":memory:", () => {});
  // different stakes on purpose: merging must not change which stake prices which pick
  saveSendingSettings(db, { stakes: { [A.toLowerCase()]: 2, [B.toLowerCase()]: 5, [C.toLowerCase()]: 1 } });
  let id = 1;
  const add = (strategy: string, result: "hit" | "miss") => {
    const t = alert(strategy, id);
    const done = alert(strategy, id, result);
    db.upsertLivePick("chat", id, done, parseAlert(done), new Date().toISOString());
    void t;
    id++;
  };
  return { db, add };
}

test("before merging, each strategy is its own line", () => {
  const { db, add } = setup();
  add(A, "hit"); add(A, "miss"); add(B, "hit"); add(C, "miss");
  const wl = computeWinLoss(db);
  assert.deepEqual(wl.reported.map((l) => l.label).sort(), [A, B, C].sort());
  assert.equal(wl.periods.d1.strategies[A.toLowerCase()], 2);      // +£4 (2 at 3.00) - £2
  assert.equal(wl.periods.d1.strategies[B.toLowerCase()], 10);     // +£10 (5 at 3.00)
});

test("after merging, the two are one line whose figures add up, and the total is unchanged", () => {
  const { db, add } = setup();
  add(A, "hit"); add(A, "miss"); add(B, "hit"); add(C, "miss");
  const before = computeWinLoss(db);
  db.setStrategyMerge(A, B);
  const after = computeWinLoss(db);

  assert.deepEqual(after.reported.map((l) => l.label).sort(), [B, C].sort());
  const merged = after.reported.find((l) => l.key === B.toLowerCase())!;
  assert.deepEqual(merged.members.sort(), [A.toLowerCase(), B.toLowerCase()].sort());
  assert.equal(after.periods.d1.strategies[B.toLowerCase()], 12);        // 2 + 10
  assert.equal(after.periods.d1.strategies[A.toLowerCase()], undefined); // no separate line for the old name
  assert.equal(after.periods.d1.total, before.periods.d1.total);         // merging never changes the money
  assert.equal(after.periods.ytd.total, before.periods.ytd.total);
});

test("the graph's strategy lines follow the merge too, in every view", () => {
  const { db, add } = setup();
  add(A, "hit"); add(B, "miss");
  db.setStrategyMerge(A, B);
  const wl = computeWinLoss(db);
  for (const view of ["d1", "d7", "mtd", "ytd"] as const) {
    const last = wl.series[view].at(-1);
    assert.ok(last, `${view} has points`);
    assert.deepEqual(Object.keys(last.s), [B.toLowerCase()]);
    assert.equal(last.s[B.toLowerCase()], -1);                            // +£4 (2 at 3.00) - £5
  }
});

test("the stake and odds settings list stays per original strategy", () => {
  const { db, add } = setup();
  add(A, "hit"); add(B, "hit");
  db.setStrategyMerge(A, B);
  const wl = computeWinLoss(db);
  const rows = Object.fromEntries(wl.strategies.map((s) => [s.label, s.stake]));
  assert.deepEqual(rows, { [A]: 2, [B]: 5 });
});

test("undoing the merge separates the lines again", () => {
  const { db, add } = setup();
  add(A, "hit"); add(B, "hit");
  db.setStrategyMerge(A, B);
  db.setStrategyMerge(A, null);
  assert.equal(computeWinLoss(db).reported.length, 2);
});

test("month to date has one figure per UK day, zero days included, adding up to the month total", () => {
  const { db, add } = setup();
  const now = new Date();
  const dayOfMonth = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", day: "numeric" }).format(now));
  add(A, "hit"); add(A, "miss"); add(B, "hit");            // today: +4 -2 +10
  const wl = computeWinLoss(db, now);
  assert.equal(wl.mtdDaily.length, dayOfMonth);              // every day from the 1st to today
  assert.equal(wl.mtdDaily.at(-1)?.pnl, 12);
  assert.equal(wl.mtdDaily[0]?.date.endsWith("-01"), true);
  const sum = Math.round(wl.mtdDaily.reduce((n, d) => n + d.pnl, 0) * 100) / 100;
  assert.equal(sum, wl.periods.mtd.total);
});

test("earlier days in the month get their own bar", () => {
  const { db, add } = setup();
  const now = new Date("2026-09-15T12:00:00Z");
  add(A, "hit"); add(A, "miss");
  // back-date the two picks: +£4 on the 3rd, -£2 on the 10th
  const raw = db as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } };
  raw.db.prepare(`UPDATE live_picks SET first_seen_at = ? WHERE message_id = 1`).run("2026-09-03T12:00:00.000Z");
  raw.db.prepare(`UPDATE live_picks SET first_seen_at = ? WHERE message_id = 2`).run("2026-09-10T12:00:00.000Z");
  const wl = computeWinLoss(db, now);
  assert.equal(wl.mtdDaily.length, 15);
  const byDate = Object.fromEntries(wl.mtdDaily.map((d) => [d.date, d.pnl]));
  assert.equal(byDate["2026-09-03"], 4);
  assert.equal(byDate["2026-09-10"], -2);
  assert.equal(byDate["2026-09-04"], 0);                      // a quiet day is still there, at zero
  assert.equal(wl.periods.mtd.total, 2);
});
