/**
 * Checks the bet feed's safety gates: the one place a pick can leave the app.
 * Runs automatically on every push (see .github/workflows/checks.yml).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, getSendingSettings, saveSendingSettings, toCsv } from "../src/inplayguru/bet-feed";

const NOW = new Date();
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function alert(home: string, away: string, settled = false): string {
  return [
    "🔔 Blistering Momentum",
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    `${home} vs ${away}`,
    "",
    "Timer: 60'",
    "Goals: 1 - 0",
    "Over/Under 1.50 Odds:",
    "1.80 2.00",
    ...(settled ? ["", "⸻⸻ Match Summary ⸻⸻", "", "Half-Time Score: 1-0", "Full-Time Score: 2-0", "", "✅ Hit"] : []),
  ].join("\n");
}

function setup(opts: { enabled?: boolean; dailyCap?: number } = {}) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, {
    enabled: opts.enabled ?? true,
    stakes: { "blistering momentum": 2 },
    strategies: { "blistering momentum": true },
    dailyCap: opts.dailyCap ?? 30,
  });
  let msg = 1;
  const add = (text: string, postedAt: string) => {
    const id = msg++;
    db.upsertLivePick("chat", id, text, parseAlert(text), postedAt);
    return id;
  };
  return { db, add };
}

test("nothing is sent while the master switch is off", () => {
  const { db, add } = setup({ enabled: false });
  add(alert("Lens", "Lille"), minutesAgo(1));
  const feed = buildFeed(db, { markSent: true, now: NOW });
  assert.equal(feed.rows.length, 0);
  assert.equal(feed.blockedReason, "Sending is switched off.");
});

test("a fresh, sendable pick is sent once, then repeated unchanged", () => {
  const { db, add } = setup();
  add(alert("Lens", "Lille"), minutesAgo(1));
  const first = buildFeed(db, { markSent: true, now: NOW });
  assert.equal(first.rows.length, 1);
  assert.equal(first.newlySent, 1);
  assert.equal(first.rows[0]?.marketType, "OVER_UNDER_15");
  assert.equal(first.rows[0]?.stake, 2);
  const second = buildFeed(db, { markSent: true, now: NOW });
  assert.equal(second.newlySent, 0);
  assert.equal(second.csv, first.csv);
});

test("an alert that arrives late is judged by Telegram's posting time, not arrival time", () => {
  const { db, add } = setup();
  add(alert("Lens", "Lille"), minutesAgo(30)); // posted 30 minutes ago, received just now
  assert.equal(buildFeed(db, { markSent: true, now: NOW }).rows.length, 0);
});

test("the daily limit stops new picks", () => {
  const { db, add } = setup({ dailyCap: 1 });
  add(alert("Lens", "Lille"), minutesAgo(2));
  add(alert("Nice", "Brest"), minutesAgo(1));
  const feed = buildFeed(db, { markSent: true, now: NOW });
  assert.equal(feed.rows.length, 1);
  assert.ok(feed.skipped.some((s) => s.reason === "Daily limit reached."));
});

test("a row already sent stays in the feed if its strategy is switched off", () => {
  const { db, add } = setup();
  add(alert("Lens", "Lille"), minutesAgo(1));
  buildFeed(db, { markSent: true, now: NOW });
  saveSendingSettings(db, { strategies: { "blistering momentum": false } });
  assert.equal(buildFeed(db, { markSent: true, now: NOW }).rows.length, 1);
});

test("a settled pick leaves the feed", () => {
  const { db, add } = setup();
  add(alert("Lens", "Lille"), minutesAgo(1));
  buildFeed(db, { markSent: true, now: NOW });
  db.upsertLivePick("chat", 1, alert("Lens", "Lille", true), parseAlert(alert("Lens", "Lille", true)), minutesAgo(1));
  assert.equal(buildFeed(db, { markSent: true, now: NOW }).rows.length, 0);
});

test("the preview never marks anything as sent", () => {
  const { db, add } = setup();
  add(alert("Lens", "Lille"), minutesAgo(1));
  buildFeed(db, { markSent: false, now: NOW });
  assert.equal(buildFeed(db, { markSent: true, now: NOW }).newlySent, 1);
});
test("minimum odds: the feed is unchanged until one is set, then every row carries a MinPrice", () => {
  const { db, add } = setup();
  add(alert("Lens", "Lille"), minutesAgo(1));
  const before = buildFeed(db, { markSent: false, now: NOW });
  assert.ok(!before.csv.includes("MinPrice"), "no MinPrice column while no minimum is set");
  assert.equal(before.csv.split("\r\n")[0], '"Provider","MarketType","SelectionName","EventName","BetType","Size"');

  saveSendingSettings(db, { minOdds: { "blistering momentum": 1.85 } });
  const after = buildFeed(db, { markSent: false, now: NOW });
  assert.equal(after.rows[0]?.minPrice, 1.85);
  const lines = after.csv.split("\r\n");
  assert.equal(lines[0], '"Provider","MarketType","SelectionName","EventName","BetType","Size","MinPrice"');
  assert.ok(lines[1]?.endsWith('"2.00","1.85"'), lines[1]);
});

test("minimum odds: a strategy without one gets 1.01 (no limit) once the column is on", () => {
  const { db, add } = setup();
  saveSendingSettings(db, { minOdds: { "some other strategy": 2.5 } });
  add(alert("Lens", "Lille"), minutesAgo(1));
  const feed = buildFeed(db, { markSent: false, now: NOW });
  assert.equal(feed.rows[0]?.minPrice, null);
  assert.ok(feed.csv.split("\r\n")[1]?.endsWith('"2.00","1.01"'));
});

test("minimum odds: a pick already sent keeps the minimum it was sent with", () => {
  const { db, add } = setup();
  saveSendingSettings(db, { minOdds: { "blistering momentum": 1.85 } });
  add(alert("Lens", "Lille"), minutesAgo(1));
  const first = buildFeed(db, { markSent: true, now: NOW });
  saveSendingSettings(db, { minOdds: { "blistering momentum": 2.4 } }); // changed afterwards
  const second = buildFeed(db, { markSent: true, now: NOW });
  assert.equal(second.newlySent, 0);
  assert.equal(second.csv, first.csv);
  assert.equal(second.rows[0]?.minPrice, 1.85);
});

test("minimum odds: bad values are ignored and null clears one", () => {
  const { db } = setup();
  saveSendingSettings(db, { minOdds: { A: 1.9, b: 0.5, c: "junk", d: 5000, e: "2.345" } });
  assert.deepEqual(getSendingSettings(db).minOdds, { a: 1.9, e: 2.35 });
  saveSendingSettings(db, { minOdds: { a: null } });
  assert.deepEqual(getSendingSettings(db).minOdds, { e: 2.35 });
  assert.ok(toCsv([], true).includes("MinPrice"));
});
