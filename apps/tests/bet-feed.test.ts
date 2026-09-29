/**
 * Checks the bet feed's safety gates: the one place a pick can leave the app.
 * Runs automatically on every push (see .github/workflows/checks.yml).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";

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
