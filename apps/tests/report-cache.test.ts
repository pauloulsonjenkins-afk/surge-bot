/**
 * The admin's heavy reports are reused for up to a minute (server/report-cache.ts) so they stop holding up alerts and
 * bets, which share the engine's thread (20 Oct 2026: Strategies took 1.5-2 s on every call). They start afresh when a
 * result is written, when a setting the figures use changes, after any change from the admin site, and after a minute.
 * Apply and the automatic stakes never use them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { saveBank } from "../src/inplayguru/stake";
import { cachedReport, clearReportCache, REPORT_TTL_MS, TODAY_TTL_MS } from "../src/server/report-cache";
import { warmReportCache } from "../src/server/http";
import { ALL_TIME, computeStrategyForm, computeStrategyReturns, saveWinLossSettings } from "../src/server/winloss";
import { computeLeagueReturns } from "../src/server/league-returns";
import { applyAdvice, autoApplyStakes, visibleAdvice } from "../src/server/strategy-advice";
import { ukDateOf, ukDateOfIso } from "../src/server/uk-time";
import { createEngineHttpServer } from "../src/server/http";

const S = "Blistering Momentum";
const KEY = S.toLowerCase();
const alert = (n: number, result?: "hit" | "miss") =>
  [
    `🔔 ${S}`,
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    `Home ${n} vs Away ${n}`,
    "",
    "Timer: 60'",
    "Goals: 0 - 0",
    "Over/Under 0.50 Odds:",
    "2.00 1.80",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

/** A Live strategy with `n` picks sent and settled (3 in 4 won). */
function engine(n = 8) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, strategies: { [KEY]: true }, dailyCap: 1000 });
  for (let i = 1; i <= n; i++) settle(db, i, i % 4 === 0 ? "miss" : "hit");
  return db;
}
function settle(db: EngineDb, n: number, r: "hit" | "miss") {
  const posted = new Date(Date.now() - 60_000).toISOString();
  db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), posted);
  buildFeed(db, { markSent: true });
  db.upsertLivePick("chat", n, alert(n, r), parseAlert(alert(n, r)), posted);
}

/** A report that counts how often it is worked out. */
function counted(db: EngineDb) {
  let runs = 0;
  const report = (now = Date.now()) => cachedReport(db, "test", () => ({ runs: ++runs, returns: computeStrategyReturns(db, null) }), now);
  return { report, runs: () => runs };
}

test("a report asked for again within a minute is reused, and worked out again after a minute", () => {
  const db = engine();
  const { report, runs } = counted(db);
  const t = Date.now();
  const first = report(t);
  assert.equal(report(t + 30_000), first, "the same answer half a minute later");
  assert.equal(runs(), 1);
  report(t + REPORT_TTL_MS);
  assert.equal(runs(), 2, "a minute on: worked out again");
});

test("Today keeps its own much shorter reuse window: 10 seconds, not a minute, since it's about risk right now", () => {
  const db = engine();
  let runs = 0;
  const today = (now: number) => cachedReport(db, "today-test", () => ({ runs: ++runs }), now, TODAY_TTL_MS);
  const t = Date.now();
  today(t);
  today(t + TODAY_TTL_MS - 1);
  assert.equal(runs, 1, "still within its 10s window");
  today(t + TODAY_TTL_MS);
  assert.equal(runs, 2, "worked out again after 10s, well before the usual minute");
});

test("the background warmer fills Today and Strategies ahead of a request, and doesn't throw on a broken db", () => {
  const db = engine();
  clearReportCache(db);
  warmReportCache(db);
  const t = Date.now();
  assert.equal(cachedReport(db, "today", () => ({ ran: true }), t, TODAY_TTL_MS).ran, undefined, "already warm: the kept body, not a fresh compute");
  assert.equal(cachedReport(db, "strategies:null", () => ({ ran: true }), t).ran, undefined, "already warm: the kept body, not a fresh compute");
  assert.doesNotThrow(() => warmReportCache(undefined as never), "never throws past its own boundary");
});

test("a result written starts it afresh, and the new result is in the figures", () => {
  const db = engine();
  const { report, runs } = counted(db);
  const before = report() as { returns: Record<string, { all: { settled: number } }> };
  settle(db, 100, "hit");
  const after = report() as { returns: Record<string, { all: { settled: number } }> };
  assert.equal(runs(), 2);
  assert.equal(after.returns[KEY]!.all.settled, before.returns[KEY]!.all.settled + 1);
});

test("a new alert still waiting for its result doesn't start it afresh", () => {
  const db = engine();
  const { report, runs } = counted(db);
  report();
  db.upsertLivePick("chat", 200, alert(200), parseAlert(alert(200)), new Date().toISOString());
  buildFeed(db, { markSent: true });
  report();
  assert.equal(runs(), 1);
});

test("a setting the figures use starts it afresh: stakes, Live switches, commission, the balance", () => {
  const db = engine();
  const { report, runs } = counted(db);
  report();
  saveSendingSettings(db, { stakes: { [KEY]: 2 } });
  report();
  assert.equal(runs(), 2, "a stake");
  saveSendingSettings(db, { strategies: { [KEY]: false } });
  report();
  assert.equal(runs(), 3, "a Live switch");
  saveWinLossSettings(db, { commission: 5 });
  report();
  assert.equal(runs(), 4, "commission");
  saveBank(db, { available: 100, exposure: 0 });
  report();
  assert.equal(runs(), 5, "the balance, which a percentage stake is taken from");
  saveBank(db, { available: 100, exposure: 0 }, new Date(Date.now() + 60_000));
  report();
  assert.equal(runs(), 5, "the same balance read again later: no change");
});

test("clearing (any change made from the admin site) starts it afresh", () => {
  const db = engine();
  const { report, runs } = counted(db);
  report();
  clearReportCache(db);
  report();
  assert.equal(runs(), 2);
});

test("the results count goes up for what changes the money figures, not for background checks", () => {
  const db = engine(1);
  const v = () => db.resultsVersion();
  let last = v();
  const changed = (what: string) => {
    assert.ok(v() > last, `${what} counts`);
    last = v();
  };
  const unchanged = (what: string) => assert.equal(v(), last, `${what} doesn't count`);

  db.upsertLivePick("chat", 50, alert(50), parseAlert(alert(50)), new Date().toISOString());
  unchanged("a new alert waiting for its result");
  db.setPickExchangeOdds(1, 1.9);
  db.markUnplacedAlerted([1], new Date().toISOString());
  unchanged("background checks");
  db.upsertLivePick("chat", 50, alert(50, "hit"), parseAlert(alert(50, "hit")), new Date().toISOString());
  changed("a result arriving");
  const id50 = db.listLivePicks(10).find((p) => p.messageId === 50)!.id;
  db.setResultOverride(1, "miss");
  changed("a result amended");
  db.setPickExcluded(1, true);
  changed("a pick excluded");
  db.setManualBet(id50, { stake: 2, odds: 1.8 });
  changed("a bet placed by hand");
  const placedAt = new Date().toISOString();
  db.saveBetfairBets([{ betId: "B1", placedAt, settledAt: null, event: "Home 1 v Away 1", market: null, selection: "Over 0.5 Goals", side: "back", provider: null, status: "matched", stake: 1, matched: 1, odds: 1.9, profit: null }], "t");
  changed("a Betfair bet saved");
  db.saveBetfairBets([{ betId: "B1", placedAt, settledAt: null, event: "Home 1 v Away 1", market: null, selection: "Over 0.5 Goals", side: "back", provider: null, status: "matched", stake: 1, matched: 1, odds: 1.9, profit: null }], "t");
  unchanged("the same bet read again");
  db.linkBetfairBets([{ betId: "B1", pickId: 1 }]);
  changed("a bet linked to its pick");
});

test("over HTTP: repeat calls give the kept report, and any POST starts it afresh", async () => {
  const db = engine();
  const key = "test-key-0123456789abcdef0123456789abcdef";
  const before = process.env.ADMIN_INTERNAL_KEY;
  process.env.ADMIN_INTERNAL_KEY = key;
  const server = createEngineHttpServer({} as never, db, { getStatus: () => ({}) } as never);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  const call = async (path: string, method = "GET") => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
    return (await res.json()) as { at?: string; timings?: Record<string, number> };
  };
  const wait = () => new Promise((ok) => setTimeout(ok, 5));
  try {
    for (const path of ["/internal/strategies", "/internal/strategies/weeks", "/internal/golden", "/internal/winloss?mode=live"]) {
      const first = await call(path);
      assert.ok(first.at && first.timings, `${path}: worked out, with its timings`);
      await wait();
      assert.equal((await call(path)).at, first.at, `${path}: the kept report`);
      // Any change request clears them, even one turned down (this one is: no such slice).
      await call("/internal/golden/unwatch", "POST");
      await wait();
      assert.notEqual((await call(path)).at, first.at, `${path}: worked out afresh after a change`);
    }
  } finally {
    await new Promise((ok) => server.close(ok));
    if (before === undefined) delete process.env.ADMIN_INTERNAL_KEY;
    else process.env.ADMIN_INTERNAL_KEY = before;
  }
});

test("Apply and the automatic stakes work on fresh figures, not on the suggestions being shown", () => {
  // Too few picks for a stake raise; the Today page shows (and keeps) that.
  const db = engine(40);
  const now = new Date();
  assert.equal(visibleAdvice(db, now).filter((a) => a.kind === "stake-up").length, 0);
  for (let i = 41; i <= 60; i++) settle(db, i, i % 4 === 0 ? "miss" : "hit");
  assert.equal(visibleAdvice(db, new Date(now.getTime() + 1000)).filter((a) => a.kind === "stake-up").length, 0, "the page still shows its kept suggestions");
  // Apply works it out again: the raise is there.
  assert.equal(applyAdvice(db, KEY, "stake-up", now).action, "Raise to £2");
  assert.equal(getSendingSettings(db).stakes[KEY], 2);
  // And so do the automatic stakes, on the same fresh figures (the step a week later).
  saveSendingSettings(db, { ladderAuto: true });
  assert.equal(autoApplyStakes(db, new Date(now.getTime() + 8 * 86_400_000)).length, 1);
  assert.equal(getSendingSettings(db).stakes[KEY], 3);
});

test("one read of every pick, shared, gives the same figures as each reading its own", () => {
  const db = engine(30);
  const rows = db.listResultsForWinLoss(ALL_TIME);
  const since = new Date(Date.now() - 30_000).toISOString();
  for (const s of [null, since]) {
    assert.deepEqual(computeStrategyReturns(db, s, { fromRuleChange: true, rows }), computeStrategyReturns(db, s, { fromRuleChange: true }));
    assert.deepEqual(computeLeagueReturns(db, s, rows), computeLeagueReturns(db, s));
  }
  assert.deepEqual(computeStrategyForm(db, new Date(), rows), computeStrategyForm(db, new Date()));
  // With a fresh start, the shared read already starts there.
  db.setFreshStart(since);
  const fresh = db.listResultsForWinLoss(ALL_TIME);
  assert.deepEqual(computeStrategyReturns(db, null, { rows: fresh }), computeStrategyReturns(db, null));
});

test("the UK day of a time, kept per hour, matches working it out each time, across both clock changes", () => {
  for (const [from, to] of [
    ["2026-03-28T20:00:00.000Z", "2026-03-29T04:00:00.000Z"], // BST starts at 01:00 UTC
    ["2026-10-24T20:00:00.000Z", "2026-10-25T04:00:00.000Z"], // BST ends at 01:00 UTC
    ["2026-07-14T21:30:00.000Z", "2026-07-15T01:30:00.000Z"], // summer midnight is 23:00 UTC
    ["2026-12-31T22:30:00.000Z", "2027-01-01T01:30:00.000Z"], // winter midnight, and the new year
  ]) {
    for (let t = Date.parse(from!); t <= Date.parse(to!); t += 60_000) {
      const iso = new Date(t).toISOString();
      assert.equal(ukDateOfIso(iso), ukDateOf(new Date(iso)), iso);
      const late = new Date(t + 59_999).toISOString();
      assert.equal(ukDateOfIso(late), ukDateOf(new Date(late)), late);
    }
  }
});
