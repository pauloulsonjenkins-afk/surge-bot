/** The drip shadow test (betfair/drip-shadow.ts, server/drip-shadow-report.ts): silent price records and a replayed ladder. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { GROUP_STAKES, isDripStrategy, moveTicks, runDripShadow, settleLadder, simulateLadder } from "../src/betfair/drip-shadow";
import { computeDripReport, maybeSendDripReport } from "../src/server/drip-shadow-report";

test("prices move up in Betfair's own steps", () => {
  assert.equal(moveTicks(1.5, 15), 1.65);
  assert.equal(moveTicks(1.98, 3), 2.02, "0.01 steps to 2.00, then 0.02");
  assert.equal(moveTicks(2.9, 6), 3.05, "0.02 steps to 3.00, then 0.05");
  assert.equal(moveTicks(1.8, 0), 1.8);
});

test("a leg fills only when the best back price reaches it before the first goal", () => {
  const t0 = 1_000_000;
  const ticks = [
    { atMs: t0 + 45_000, back: 1.82 },
    { atMs: t0 + 90_000, back: 1.86 },
    { atMs: t0 + 135_000, back: 1.93 },
    { atMs: t0 + 180_000, back: 2.5 },
  ];
  const cfg = { stakes: GROUP_STAKES, gapTicks: 5 };
  const legs = simulateLadder(1.8, t0, ticks, null, cfg);
  assert.deepEqual(legs.map((l) => l.price), [1.8, 1.85, 1.9, 1.95, 2, 2.1]);
  assert.deepEqual(legs.map((l) => l.filled), [true, true, true, true, true, true], "the last read reached 2.50, past every leg");
  // A goal at +150s: the 2.50 read comes after it and fills nothing.
  const beforeGoal = simulateLadder(1.8, t0, ticks, t0 + 150_000, cfg);
  assert.deepEqual(beforeGoal.map((l) => l.filled), [true, true, true, false, false, false]);
  // No drip: every leg at the alert price, at once.
  assert.ok(simulateLadder(1.8, t0, [], t0 + 1, { stakes: GROUP_STAKES, gapTicks: 0 }).every((l) => l.filled && l.price === 1.8));
});

test("a ladder is settled on the filled legs only, with commission off winnings", () => {
  const legs = [
    { price: 1.8, stake: 1, filled: true, atMs: 0 },
    { price: 1.85, stake: 2.5, filled: true, atMs: 1 },
    { price: 2, stake: 1, filled: false, atMs: null },
  ];
  const win = settleLadder(legs, true, 0);
  assert.equal(win.staked, 3.5);
  assert.ok(Math.abs(win.profit - (0.8 + 2.5 * 0.85)) < 1e-9);
  assert.equal(win.legs, 2);
  assert.equal(settleLadder(legs, false, 0).profit, -3.5);
  assert.ok(Math.abs(settleLadder(legs, true, 0.05).profit - (0.8 + 2.125) * 0.95) < 1e-9);
});

test("only the four half-time strategies are watched", () => {
  for (const n of ["Away Super Fav 1 Goal", "Away Super Fav 2 Goals", "OG 1 Goal SH", "OG 2 SHG"]) assert.equal(isDripStrategy(n), true, n);
  assert.equal(isDripStrategy("Time to fight"), false);
});

const ALERT = (name: string) =>
  [`🔔 ${name}`, "", "🇫🇷 France Ligue 1", "Lyon vs Nantes", "", "Timer: 46'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");

function seed(db: EngineDb, alertAt: string) {
  const text = ALERT("OG 1 Goal SH");
  db.upsertLivePick("chat", 1, text, parseAlert(text), alertAt, alertAt);
  const id = db.getLivePickByMessage("chat", 1)!.id;
  db.setPickExchange(id, "on", "Lyon v Nantes", 1.8, null, "E1");
  return id;
}

/** Records one price read per 45 seconds from a script of best back prices. */
async function record(db: EngineDb, alertAtMs: number, backs: number[]) {
  let i = 0;
  const reader = {
    checkBet: async () => ({ status: "ok" as const, price: 1.8, runners: [], marketId: "M1", selectionId: 7 }),
    quote: async () => ({ marketStatus: "OPEN", runnerStatus: "ACTIVE", back: backs[i] ?? null, lay: (backs[i++] ?? 0) + 0.02 }),
  };
  for (let k = 1; k <= backs.length; k++) await runDripShadow(db, reader, alertAtMs + k * 45_000);
}

test("prices are recorded for watched alerts only, and the report replays the ladder on them", async () => {
  const db = new EngineDb(":memory:", () => {});
  const alertAt = Date.now() - 10 * 60_000;
  const id = seed(db, new Date(alertAt).toISOString());
  const other = "🔔 Time to fight\n\n🇫🇷 France Ligue 1\nParis vs Metz\n\nTimer: 64'\nGoals: 0 - 0\nOver/Under 0.50 Odds:\n2.00 1.80";
  db.upsertLivePick("chat", 2, other, parseAlert(other), new Date(alertAt).toISOString(), new Date(alertAt).toISOString());
  db.setPickExchange(db.getLivePickByMessage("chat", 2)!.id, "on", "Paris v Metz", 2, null, "E2");

  await record(db, alertAt, [1.82, 1.86, 1.93]);

  const settled = [ALERT("OG 1 Goal SH"), "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 1-0", "Full-Time Score: 2-0", "", "✅ Hit"].join("\n");
  db.upsertLivePick("chat", 1, settled, parseAlert(settled), new Date(alertAt).toISOString(), new Date(alertAt).toISOString());
  assert.equal(db.getLivePick(id)?.result, "hit");

  const r = computeDripReport(db);
  assert.equal(r.recorded, 1, "Time to fight was not watched");
  assert.equal(r.settled, 1);
  const flat = r.overall[0]!;
  assert.equal(flat.staked, 10.5);
  assert.ok(Math.abs(flat.profit - 10.5 * 0.8) < 0.01, `no drip wins at the alert price: ${flat.profit}`);
  const d5 = r.overall[1]!;
  assert.equal(d5.staked, 4.5, "the best price reached 1.93: the legs at 1.80, 1.85 and 1.90 (£1, £2.50, £1) fill, 1.95 and above do not");
  assert.ok(Math.abs(d5.profit - (0.8 + 2.5 * 0.85 + 0.9)) < 0.01, `profit ${d5.profit}`);
  assert.match(r.text, /Drip shadow test: 1 alerts watched, 1 settled/);
});

test("nothing is recorded after the last day, and the report goes once from the 15th outside quiet hours", async () => {
  const db = new EngineDb(":memory:", () => {});
  const alertAt = Date.now() - 60_000;
  seed(db, new Date(alertAt).toISOString());
  let reads = 0;
  const reader = { checkBet: async () => ({ status: "ok" as const, price: 1.8, runners: [], marketId: "M1", selectionId: 7 }), quote: async () => (reads++, { marketStatus: "OPEN", runnerStatus: "ACTIVE", back: 1.8, lay: 1.82 }) };
  assert.equal(await runDripShadow(db, reader, new Date("2026-11-17T12:00:00Z").getTime()), 0, "past the last day");

  assert.equal(await maybeSendDripReport(db, new Date("2026-11-14T12:00:00Z")), false, "too early");
  assert.equal(await maybeSendDripReport(db, new Date("2026-11-15T03:00:00Z")), false, "quiet hours");
  assert.equal(await maybeSendDripReport(db, new Date("2026-11-15T09:00:00Z")), true);
  assert.equal(await maybeSendDripReport(db, new Date("2026-11-16T09:00:00Z")), false, "only once");
  assert.match(db.getSetting("drip_shadow_report") ?? "", /Drip shadow test/);
});
