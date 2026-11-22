/**
 * The suggestions are worked out once, in the kept "advice" report, and the Today page takes its Suggestions from there
 * (Ops Watch, 22 Nov 2026: "Today page data took 9288 ms ... advice 7642"). The Today report used to work them out again
 * itself, on the same report worker, so the page waited behind a second copy of 4.7-7.6 s of work; and the "advice"
 * report was worked out afresh after every result, where the suggestions had been kept for 2 minutes (adviceForView).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { ADVICE_KEY, cachedReport, STALE_OK_MS } from "../src/server/report-cache";
import { runReport } from "../src/server/reports";
import { createEngineHttpServer } from "../src/server/http";
import { RESULTS_REUSE_MS, VIEW_MAX_AGE_MS, type Advice } from "../src/server/strategy-advice";

const S = "Blistering Momentum";
const KEY = S.toLowerCase();
const alert = (n: number, result?: "hit" | "miss") =>
  [
    `🔔 ${S}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

function settle(db: EngineDb, n: number, r: "hit" | "miss") {
  const posted = new Date(Date.now() - 60_000).toISOString();
  db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), posted);
  buildFeed(db, { markSent: true });
  db.upsertLivePick("chat", n, alert(n, r), parseAlert(alert(n, r)), posted);
}

/** A Live strategy with `n` picks sent and settled (3 in 4 won): at 110 it is due a stake raise. */
function engine(n: number) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, strategies: { [KEY]: true }, dailyCap: 1000 });
  for (let i = 1; i <= n; i++) settle(db, i, i % 4 === 0 ? "miss" : "hit");
  return db;
}

const tick = () => new Promise<void>((r) => setImmediate(r));

test("the Today report doesn't work the suggestions out", () => {
  const db = engine(110);
  const body = runReport(db, "today", []) as { advice: unknown[]; autoStakes: unknown[]; timings: Record<string, number> };
  assert.deepEqual(body.advice, []);
  assert.deepEqual(body.autoStakes, []);
  assert.equal("advice" in body.timings, false, "no advice step in its timings");
});

test("GET /internal/today shows the same Suggestions as the menus' badge, from the one kept advice report", async () => {
  const db = engine(110);
  const key = "test-key-today-advice";
  const before = process.env.ADMIN_INTERNAL_KEY;
  process.env.ADMIN_INTERNAL_KEY = key;
  const server = createEngineHttpServer({} as never, db, { getStatus: () => ({}) } as never);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  const get = async (path: string) => (await (await fetch(`http://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${key}` } })).json()) as { advice: Advice[]; autoStakes?: unknown[] };
  try {
    const today = await get("/internal/today");
    const badge = await get("/internal/strategy-advice");
    assert.ok(today.advice.some((a) => a.key === KEY && a.kind === "stake-up"), "the raise shows on Today");
    assert.deepEqual(today.advice, badge.advice);
    assert.deepEqual(today.autoStakes, []);
    // Automatic stakes on: the raise is a queued step, not a suggestion, on Today as before.
    saveSendingSettings(db, { ladderAuto: true });
    const auto = await get("/internal/today");
    assert.equal(auto.advice.some((a) => a.kind === "stake-up"), false);
    assert.deepEqual((auto.autoStakes as Array<{ key: string }>).map((q) => q.key), [KEY]);
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    if (before === undefined) delete process.env.ADMIN_INTERNAL_KEY;
    else process.env.ADMIN_INTERNAL_KEY = before;
  }
});

/** The "advice" report under its own key, counting how often it is worked out. */
function counted(db: EngineDb) {
  let runs = 0;
  const report = (now: number) => cachedReport(db, ADVICE_KEY, () => ({ runs: ++runs }), now);
  return { report, runs: () => runs };
}

test("the advice report: results landing reuse it for 2 minutes, not once per result", async () => {
  const db = engine(8);
  const { report, runs } = counted(db);
  const t = Date.now();
  const first = report(t);
  settle(db, 9, "hit");
  assert.equal(report(t + 30_000), first);
  settle(db, 10, "miss");
  assert.equal(report(t + RESULTS_REUSE_MS - 1000), first, "a burst of results doesn't recompute every time");
  assert.equal(runs(), 1);
  // Past 2 minutes: the kept one is shown at once and brought up to date straight after.
  assert.equal(report(t + RESULTS_REUSE_MS + 1000), first);
  await tick();
  assert.equal(runs(), 2);
});

test("the advice report: with nothing changed it is kept up to 30 minutes", async () => {
  const db = engine(8);
  const { report, runs } = counted(db);
  const t = Date.now();
  const first = report(t);
  assert.equal(report(t + 10 * 60_000), first);
  assert.equal(report(t + VIEW_MAX_AGE_MS - 1000), first);
  assert.equal(runs(), 1);
  assert.notEqual(report(t + VIEW_MAX_AGE_MS + STALE_OK_MS + RESULTS_REUSE_MS + 1000), first, "the clock still moves it on");
  await tick();
});

test("the advice report: a setting it reads changing starts it afresh at once", async () => {
  const db = engine(8);
  const { report, runs } = counted(db);
  const t = Date.now();
  report(t);
  saveSendingSettings(db, { stakes: { [KEY]: 2 } });
  report(t + 1000);
  await tick();
  assert.equal(runs(), 2, "a stake change");
  // A setting only the suggestions read (a lock from an applied suggestion), which the other reports don't watch.
  db.setSetting("strategy_advice_locks", JSON.stringify({ [KEY]: { kind: "back-to-sim", at: new Date(t).toISOString() } }));
  report(t + 2000);
  await tick();
  assert.equal(runs(), 3, "a suggestion lock");
});
