/**
 * Stakes as a percentage of the Betfair balance: worked out to pounds when the bet is built, never guessed, always held
 * to the safety limits, and never changing a bet already built.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { currentStake, getBank, resolveStake, saveBank } from "../src/inplayguru/stake";

const NOW = new Date();
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const KEY = "blistering momentum";

function alert(home: string, away: string): string {
  return ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `${home} vs ${away}`, "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");
}

function setup(patch: Record<string, unknown>) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, strategies: { [KEY]: true }, maxStake: 50, ...patch });
  let msg = 1;
  const add = (text: string, postedAt: string) => db.upsertLivePick("chat", msg++, text, parseAlert(text), postedAt);
  return { db, add };
}

test("the balance is available plus what is tied up in open bets", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.equal(getBank(db).total, null);
  saveBank(db, { available: 900, exposure: -100 }, NOW);
  const b = getBank(db);
  assert.equal(b.total, 1000);
  assert.equal(b.at, NOW.toISOString());
  saveBank(db, { available: null, exposure: null }, NOW); // an unreadable answer changes nothing
  assert.equal(getBank(db).total, 1000);
});

test("a percentage is worked out to the penny; a flat stake is left alone", () => {
  const { db } = setup({ stakePct: { [KEY]: 1.5 } });
  saveBank(db, { available: 1234.56, exposure: 0 }, NOW);
  const s = getSendingSettings(db);
  assert.equal(resolveStake(s, KEY, getBank(db), { now: NOW, live: true }).stake, 18.52); // 1.5% of 1234.56 = 18.5184
  assert.equal(currentStake(db, s, KEY, NOW), 18.52);

  saveSendingSettings(db, { stakes: { [KEY]: 3 } });
  const flat = getSendingSettings(db);
  assert.deepEqual(flat.stakePct, {}, "a flat stake replaces the percentage");
  assert.equal(resolveStake(flat, KEY, getBank(db), { now: NOW, live: true }).stake, 3);
  saveSendingSettings(db, { stakePct: { [KEY]: 2 } });
  assert.deepEqual(getSendingSettings(db).stakes, {}, "a percentage replaces the flat stake");
});

test("no balance, a stale balance (live only), or a tiny result: no bet, with the reason", () => {
  const { db } = setup({ stakePct: { [KEY]: 1 } });
  const s = getSendingSettings(db);
  const none = resolveStake(s, KEY, getBank(db), { now: NOW, live: true });
  assert.equal(none.stake, null);
  assert.match(none.reason!, /balance isn't known/);

  saveBank(db, { available: 500, exposure: 0 }, new Date(NOW.getTime() - 45 * 60_000));
  const stale = resolveStake(s, KEY, getBank(db), { now: NOW, live: true });
  assert.equal(stale.stake, null);
  assert.match(stale.reason!, /out of date/);
  assert.equal(resolveStake(s, KEY, getBank(db), { now: NOW, live: false }).stake, 5, "simulation uses the last balance, however old");

  saveBank(db, { available: 50, exposure: 0 }, NOW); // 1% of £50 = £0.50
  const tiny = resolveStake(s, KEY, getBank(db), { now: NOW, live: true });
  assert.equal(tiny.stake, null);
  assert.match(tiny.reason!, /smallest bet/);
});

test("a percentage that comes to more than the highest allowed stake is held to that limit", () => {
  const { db } = setup({ stakePct: { [KEY]: 10 }, maxStake: 20 });
  saveBank(db, { available: 1000, exposure: 0 }, NOW); // 10% = £100
  const a = resolveStake(getSendingSettings(db), KEY, getBank(db), { now: NOW, live: true });
  assert.equal(a.stake, 20);
  assert.equal(a.capped, true);
});

test("percentages stay within 0.1% and 25%, and a strategy can't go Live without any stake", () => {
  const { db } = setup({});
  saveSendingSettings(db, { stakePct: { [KEY]: 50 } });
  assert.deepEqual(getSendingSettings(db).stakePct, {});
  saveSendingSettings(db, { stakePct: { [KEY]: 0.01 } });
  assert.deepEqual(getSendingSettings(db).stakePct, {});
  assert.equal(getSendingSettings(db).strategies[KEY], false, "no stake of either kind: back to Sim");
  saveSendingSettings(db, { stakePct: { [KEY]: 2 }, strategies: { [KEY]: true } });
  assert.equal(getSendingSettings(db).strategies[KEY], true);
});

test("the bet feed sends the pound figure for a percentage stake, and holds the pick when it can't be worked out", () => {
  const { db, add } = setup({ stakePct: { [KEY]: 2 } });
  add(alert("Lens", "Lille"), minutesAgo(1));
  const held = buildFeed(db, { markSent: true, now: NOW });
  assert.equal(held.rows.length, 0);
  assert.match(held.skipped[0]!.reason, /balance isn't known/);

  saveBank(db, { available: 250, exposure: 0 }, NOW); // 2% of £250 = £5
  const sent = buildFeed(db, { markSent: true, now: NOW });
  assert.equal(sent.rows.length, 1);
  assert.equal(sent.rows[0]!.stake, 5);

  // The balance moves; the bet already sent keeps its £5.
  saveBank(db, { available: 1000, exposure: 0 }, NOW);
  const again = buildFeed(db, { markSent: true, now: NOW });
  assert.equal(again.rows.length, 1);
  assert.equal(again.rows[0]!.stake, 5);
});
